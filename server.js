const express  = require('express');
const { spawn } = require('child_process');
const cors     = require('cors');
const http     = require('http');
const path     = require('path');
const { Server } = require('socket.io');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST', 'DELETE'] } });

app.use(cors());
app.use(express.json());

// ─── SERVE THE WEBSITE + VR APP FROM THIS SAME PROCESS ───────────────────────
// One repo, one deployed service: the static site and streamlink-xr.html live
// in ./public, inside this same folder — not one level up. That matters on
// Railway specifically: when Root Directory is set to streamlink-server/,
// Railway only copies that directory into the build; anything outside it
// (like a sibling folder at the repo root) genuinely does not exist in the
// deployed container. Putting the static files in ./public keeps everything
// this server needs inside the directory Railway actually ships.
const STATIC_ROOT = path.join(__dirname, 'public');

// Public Supabase config for the browser, read from the Render env vars
// (SUPABASE_URL, SUPABASE_ANON_KEY). Both are safe to expose by design — the
// anon/publishable key only grants what Row Level Security allows, and the
// platform_credentials table's policies restrict each user to their own rows.
// Served as JS so static pages can just <script src="/config.js">. Never put a
// secret/service-role key here.
app.get('/config.js', (req, res) => {
  res.type('application/javascript');
  res.set('Cache-Control', 'no-store');
  res.send(`window.__SUPABASE__ = ${JSON.stringify({
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || ''
  })};`);
});

app.use(express.static(STATIC_ROOT));
app.get('/app', (req, res) => res.sendFile(path.join(STATIC_ROOT, 'streamlink-xr.html')));
app.get('/live', (req, res) => res.sendFile(path.join(STATIC_ROOT, 'go-live.html')));

// ─── PLATFORM REGISTRY ─────────────────────────────────────────────────────
const RTMP_FIXED = {
  youtube:   'rtmp://a.rtmp.youtube.com/live2',
  twitch:    'rtmp://live.twitch.tv/app',
  tiktok:    'rtmp://push.tiktok.com/live',
  instagram: 'rtmps://live-upload.instagram.com:443/rtmp',
  facebook:  'rtmps://live-api-s.facebook.com:443/rtmp',
  kick:      'rtmp://fa723fc1b171.global-contribute.live-video.net/app',
  dlive:     'rtmp://stream.dlive.tv/live',
};

const DYNAMIC_URL_PLATFORMS = new Set(['vimeo', 'linkedin', 'x', 'rumble', 'custom']);

const PLATFORM_META = [
  { name: 'youtube',   label: 'YouTube',       requiresUrl: false },
  { name: 'twitch',    label: 'Twitch',        requiresUrl: false },
  { name: 'tiktok',    label: 'TikTok',        requiresUrl: false },
  { name: 'instagram', label: 'Instagram',     requiresUrl: false },
  { name: 'facebook',  label: 'Facebook',      requiresUrl: false },
  { name: 'kick',      label: 'Kick',          requiresUrl: false },
  { name: 'vimeo',     label: 'Vimeo',         requiresUrl: true, note: 'Vimeo issues a per-event RTMPS URL and stream key.' },
  { name: 'dlive',     label: 'DLive',         requiresUrl: false },
  { name: 'linkedin',  label: 'LinkedIn Live', requiresUrl: true, note: 'LinkedIn generates the ingest URL/key per scheduled event.' },
  { name: 'x',         label: 'X Live',        requiresUrl: true, note: 'X generates a per-broadcast ingest URL.' },
  { name: 'rumble',    label: 'Rumble',        requiresUrl: true, note: 'Rumble generates a per-stream ingest URL.' },
  { name: 'custom',    label: 'Custom RTMP',   requiresUrl: true, note: 'Bring your own RTMP(S) endpoint.' },
];

function resolvePlatformUrl(p) {
  const name = (p.name || '').toLowerCase();
  if (DYNAMIC_URL_PLATFORMS.has(name)) {
    if (!p.url) return null;
    const base = p.url.replace(/\/$/, '');
    return p.key ? `${base}/${p.key}` : base;
  }
  const endpoint = RTMP_FIXED[name];
  if (!endpoint || !p.key) return null;
  return `${endpoint}/${p.key}`;
}

// ─── QUALITY PRESETS ─────────────────────────────────────────────────────────
const QUALITY = {
  ultra:  { vb: '4500k', maxrate: '4500k', buf: '9000k', preset: 'fast',      fps: 60 },
  high:   { vb: '2500k', maxrate: '2500k', buf: '5000k', preset: 'veryfast',  fps: 30 },
  medium: { vb: '1500k', maxrate: '1500k', buf: '3000k', preset: 'veryfast',  fps: 30 },
  low:    { vb: '800k',  maxrate: '800k',  buf: '1600k', preset: 'ultrafast', fps: 24 },
  mobile: { vb: '500k',  maxrate: '500k',  buf: '1000k', preset: 'ultrafast', fps: 20 },
};

// ─── STATE ───────────────────────────────────────────────────────────────────
// Each session now runs ONE FFMPEG CHILD PROCESS PER PLATFORM (session.processes),
// instead of one process fanning out to N outputs. That's the architecture fix:
// a dropped platform's process can be killed and respawned on its own — the
// other platforms' processes never see it happen. See spawnPlatformFFmpeg /
// doReconnectPlatform below for the actual isolation.
const sessions       = {}; // sessionId -> { platforms, quality, autoRecover, processes:{name:proc}, reconnectCounts:{name:n}, reconnectTimers:{name:timer}, platformStatus:{name:status}, telemetry, ... }
const sessionConfigs = {}; // sessionId -> { platforms, quality } — remembered after stop, so the AI agent can restart without re-listing platforms
const schedules      = {};
const clipBuffers    = {};
const CLIP_BUFFER_SECONDS = 60;

function log(sessionId, msg, type = 'info') {
  console.log(`[${sessionId}] ${msg}`);
  io.to(sessionId).emit('log', { msg, type, ts: Date.now() });
}

// ─────────────────────────────────────────────────────────────────────────────
// PER-PLATFORM FFMPEG PROCESS
// ─────────────────────────────────────────────────────────────────────────────
function buildPlatformArgs(url, quality) {
  const q = QUALITY[quality] || QUALITY.high;
  return [
    '-re', '-fflags', 'nobuffer', '-flags', 'low_delay',
    // The browser sends a continuous MediaRecorder webm stream (one chunk
    // per POST to /stream/:sessionId) — telling ffmpeg the input format
    // explicitly avoids it having to probe a live pipe to guess, which adds
    // latency and can fail outright if probesize is reached before enough
    // data has arrived.
    '-f', 'webm', '-i', 'pipe:0', '-map', '0',
    '-c:v', 'libx264', '-preset', q.preset, '-b:v', q.vb, '-maxrate', q.maxrate, '-bufsize', q.buf,
    '-pix_fmt', 'yuv420p', '-g', String(q.fps * 2), '-r', String(q.fps),
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
    '-f', 'flv', url
  ];
}

function spawnPlatformFFmpeg(sessionId, platform, quality) {
  const url = resolvePlatformUrl(platform);
  if (!url) return null;

  const proc = spawn('ffmpeg', buildPlatformArgs(url, quality), { stdio: ['pipe', 'pipe', 'pipe'] });

  proc.stderr.on('data', (data) => {
    const msg = data.toString();
    log(sessionId, `[${platform.name}] ${msg.trim()}`, 'ffmpeg');
    const session = sessions[sessionId];
    if (!session) return;
    // This process only ever carries this one platform's output, so any
    // line in its stderr genuinely describes THIS platform — no more
    // guessing which output a shared process's log line belonged to.
    if (/Connection refused|Broken pipe|Failed|No route to host|Operation timed out/i.test(msg)) {
      session.platformStatus[platform.name] = 'error';
      io.to(sessionId).emit('platformStatus', { platform: platform.name, status: 'error' });
    } else if (/frame=\s*\d+/.test(msg)) {
      session.platformStatus[platform.name] = 'live';
      io.to(sessionId).emit('platformStatus', { platform: platform.name, status: 'live' });
    }
  });

  proc.on('close', (code) => {
    const session = sessions[sessionId];
    if (!session) return;
    // If session.processes[name] no longer points at THIS process object, it
    // was deliberately superseded (manual reconnect or a quality change) —
    // not a real drop, so don't run auto-recovery for it.
    if (session.processes[platform.name] !== proc) return;

    if (code !== 0 && session.autoRecover) {
      const attempt = (session.reconnectCounts[platform.name] || 0) + 1;
      session.reconnectCounts[platform.name] = attempt;
      if (attempt <= 5) {
        const delay = attempt * 3000;
        session.platformStatus[platform.name] = 'connecting';
        io.to(sessionId).emit('platformStatus', { platform: platform.name, status: 'connecting' });
        io.to(sessionId).emit('recovering', { platform: platform.name, attempt, delay });
        log(sessionId, `${platform.name} dropped (code ${code}). Auto-recovering in ${delay / 1000}s (attempt ${attempt}/5) — other platforms unaffected.`, 'warn');
        session.reconnectTimers[platform.name] = setTimeout(() => {
          const s = sessions[sessionId];
          if (!s) return;
          const fresh = spawnPlatformFFmpeg(sessionId, platform, s.quality);
          if (fresh) { s.processes[platform.name] = fresh; io.to(sessionId).emit('recovered', { platform: platform.name, attempt }); }
        }, delay);
        return;
      }
    }
    session.platformStatus[platform.name] = 'error';
    io.to(sessionId).emit('platformStatus', { platform: platform.name, status: 'error' });
    delete session.processes[platform.name];
  });

  proc.on('error', (err) => log(sessionId, `[${platform.name}] FFmpeg error: ${err.message}`, 'error'));
  return proc;
}

// ── REAL-TIME STREAM INTELLIGENCE ────────────────────────────────────────────
const TELEMETRY_INTERVAL_MS = 3000;
const LOW_BITRATE_KBPS = 300;

function startTelemetry(sessionId) {
  const session = sessions[sessionId];
  if (!session) return;
  session.lastBytes = session.bytesReceived;
  session.lowBitrateStreak = 0;

  session.telemetryTimer = setInterval(() => {
    const s = sessions[sessionId];
    if (!s) return;
    const deltaBytes = s.bytesReceived - s.lastBytes;
    s.lastBytes = s.bytesReceived;
    const bitrateKbps = Math.round((deltaBytes * 8) / 1024 / (TELEMETRY_INTERVAL_MS / 1000));
    const uptimeSec = Math.floor((Date.now() - s.startTime) / 1000);
    const reconnects = Object.values(s.reconnectCounts).reduce((a, b) => a + b, 0);

    s.telemetry = { bitrateKbps, uptimeSec, reconnects, quality: s.quality, platformStatus: s.platformStatus };
    io.to(sessionId).emit('telemetry', s.telemetry);

    if (bitrateKbps > 0 && bitrateKbps < LOW_BITRATE_KBPS) {
      s.lowBitrateStreak++;
      if (s.lowBitrateStreak === 2) {
        io.to(sessionId).emit('streamWarning', { message: `Bitrate has dropped to ${bitrateKbps} kbps — your connection looks unstable.` });
      }
    } else {
      s.lowBitrateStreak = 0;
    }
  }, TELEMETRY_INTERVAL_MS);
}

function stopTelemetry(sessionId) {
  const session = sessions[sessionId];
  if (session && session.telemetryTimer) clearInterval(session.telemetryTimer);
}

// ── ACTIONS (shared by HTTP routes AND the AI agent) ─────────────────────────
function doStartStream(sessionId, platforms, quality = 'high', autoRecover = true) {
  if (sessions[sessionId]) return { ok: false, error: 'Session already active' };
  if (!platforms || !platforms.length) return { ok: false, error: 'No platforms configured for this session yet' };

  const resolvable = platforms.filter(p => resolvePlatformUrl(p));
  if (!resolvable.length) return { ok: false, error: 'None of the configured platforms have a valid key/url' };

  const session = {
    platforms, quality, autoRecover,
    startTime: Date.now(), bytesReceived: 0,
    processes: {}, reconnectCounts: {}, reconnectTimers: {},
    platformStatus: {}, telemetry: null
  };
  sessions[sessionId] = session;

  for (const p of resolvable) {
    const proc = spawnPlatformFFmpeg(sessionId, p, quality);
    if (proc) { session.processes[p.name] = proc; session.platformStatus[p.name] = 'connecting'; }
  }

  sessionConfigs[sessionId] = { platforms, quality };
  startTelemetry(sessionId);
  log(sessionId, `Stream started — ${Object.keys(session.processes).length} platforms, one isolated FFmpeg process each — quality: ${quality}`, 'ok');
  return { ok: true, platforms: Object.keys(session.processes), skipped: platforms.filter(p => !resolvePlatformUrl(p)).map(p => p.name) };
}

function doStopStream(sessionId) {
  const session = sessions[sessionId];
  if (!session) return { ok: false, error: 'No active session' };
  stopTelemetry(sessionId);
  session.autoRecover = false;
  Object.values(session.reconnectTimers).forEach(clearTimeout);
  Object.values(session.processes).forEach(proc => { try { proc.stdin.end(); proc.kill('SIGTERM'); } catch (e) {} });
  delete sessions[sessionId];
  log(sessionId, 'Stream stopped', 'info');
  return { ok: true };
}

function doSetQuality(sessionId, quality) {
  const session = sessions[sessionId];
  if (!session) return { ok: false, error: 'No active session' };
  if (!QUALITY[quality]) return { ok: false, error: 'Invalid quality preset' };

  session.quality = quality;
  sessionConfigs[sessionId] = { platforms: session.platforms, quality };

  // Each platform's encoder is restarted independently — a quality change no
  // longer blacks out every platform at once the way a single shared process did.
  for (const p of session.platforms) {
    const old = session.processes[p.name];
    if (!old) continue;
    try { old.stdin.end(); old.kill('SIGTERM'); } catch (e) {}
    const fresh = spawnPlatformFFmpeg(sessionId, p, quality);
    if (fresh) {
      session.processes[p.name] = fresh;
      session.platformStatus[p.name] = 'connecting';
      io.to(sessionId).emit('platformStatus', { platform: p.name, status: 'connecting' });
    }
  }

  log(sessionId, `Quality changed to ${quality}`, 'ok');
  io.to(sessionId).emit('qualityChanged', { quality });
  return { ok: true };
}

function doReconnectPlatform(sessionId, platformName) {
  const session = sessions[sessionId];
  if (!session) return { ok: false, error: 'No active session' };
  const target = session.platforms.find(p => p.name.toLowerCase() === platformName.toLowerCase());
  if (!target) return { ok: false, error: `${platformName} is not part of this session` };

  const old = session.processes[target.name];
  if (old) { try { old.stdin.end(); old.kill('SIGTERM'); } catch (e) {} }

  session.platformStatus[target.name] = 'connecting';
  io.to(sessionId).emit('platformStatus', { platform: target.name, status: 'connecting' });

  const fresh = spawnPlatformFFmpeg(sessionId, target, session.quality);
  if (!fresh) return { ok: false, error: 'Could not restart this platform — check its key/url' };

  // This is the isolation the old architecture didn't have: only target's
  // process is touched. Every other platform's process keeps running,
  // untouched, throughout.
  session.processes[target.name] = fresh;
  session.reconnectCounts[target.name] = 0;

  log(sessionId, `Manual reconnect for ${target.name} — other platforms unaffected`, 'info');
  return { ok: true };
}

function getSessionSummary(sessionId) {
  const session = sessions[sessionId];
  if (!session) {
    const cfg = sessionConfigs[sessionId];
    return { active: false, lastConfig: cfg ? { platforms: cfg.platforms.map(p => p.name), quality: cfg.quality } : null };
  }
  return {
    active: true,
    platforms: session.platforms.map(p => p.name),
    quality: session.quality,
    uptimeSec: Math.floor((Date.now() - session.startTime) / 1000),
    reconnects: Object.values(session.reconnectCounts).reduce((a, b) => a + b, 0),
    platformStatus: session.platformStatus,
    telemetry: session.telemetry
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AI AGENT
// A real multi-turn tool-use loop: Claude can call check_stream_health to
// OBSERVE current state, DECIDE what to do (narrated as a short text block),
// ACT by calling a tool, then observe again before deciding on any further
// step — e.g. "Twitch dropped. Fix it and lower quality if needed" genuinely
// requires reconnect → re-check bitrate → conditionally lower quality → report,
// which is exactly this loop, not a single tool call.
// Requires ANTHROPIC_API_KEY. Without it, falls back to a small deterministic
// handler (below) that still performs the same observe→act→report sequence
// for the common commands, so the demo doesn't depend on the API being up.
// ─────────────────────────────────────────────────────────────────────────────
const AGENT_TOOLS = [
  { name: 'check_stream_health', description: 'Observe current platform status, bitrate, uptime and reconnect count for this session. Call this before deciding on a fix, and again after acting to confirm the result.', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'start_stream',  description: 'Start the multistream session using the platforms already configured for this session.', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'stop_stream',   description: 'Stop the active stream.', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'reconnect_platform', description: 'Reconnect a single platform that has dropped, without affecting any other platform.', input_schema: { type: 'object', properties: { platform: { type: 'string' } }, required: ['platform'] } },
  { name: 'set_quality',   description: 'Change the stream quality preset for all platforms. Lower presets use less bitrate and are more resilient on a weak connection.', input_schema: { type: 'object', properties: { quality: { type: 'string', enum: Object.keys(QUALITY) } }, required: ['quality'] } },
];

function phaseForTool(name) { return name === 'check_stream_health' ? 'observing' : 'acting'; }

function executeAgentTool(sessionId, toolName, input) {
  switch (toolName) {
    case 'check_stream_health':  return { ok: true, ...getSessionSummary(sessionId) };
    case 'start_stream': {
      const cfg = sessionConfigs[sessionId];
      if (!cfg) return { ok: false, error: 'No platforms configured yet for this session' };
      return doStartStream(sessionId, cfg.platforms, cfg.quality);
    }
    case 'stop_stream':        return doStopStream(sessionId);
    case 'reconnect_platform': return doReconnectPlatform(sessionId, input.platform);
    case 'set_quality':        return doSetQuality(sessionId, input.quality);
    default:                   return { ok: false, error: `Unknown tool ${toolName}` };
  }
}

// Deterministic fallback used when ANTHROPIC_API_KEY isn't set (or the API
// call fails). It emits the same 'agentStep' events as the real loop so the
// VR agent log looks identical either way — it just isn't an LLM deciding.
function fallbackAgentReply(sessionId, message) {
  const cmd = message.toLowerCase();
  const emitStep = (phase, extra) => io.to(sessionId).emit('agentStep', { phase, ...extra });
  emitStep('reasoning', { text: '(rule-based fallback — set ANTHROPIC_API_KEY for the real agent)' });

  const runTool = (tool, input) => {
    emitStep(phaseForTool(tool), { tool, input });
    const result = executeAgentTool(sessionId, tool, input);
    emitStep('result', { tool, input, ...result });
    return result;
  };

  // The compound demo command: "Twitch dropped. Fix it and lower quality if
  // needed." — reconnect the named platform, observe fresh bitrate, then only
  // lower quality if that observation actually shows trouble.
  const dropMatch = cmd.match(/(\w+)\s+(?:dropped|disconnected|is down)/) || (/fix it/.test(cmd) && cmd.match(/reconnect (\w+)/));
  if (dropMatch || (/fix it/.test(cmd) && /quality/.test(cmd))) {
    const platform = dropMatch ? dropMatch[1] : 'twitch';
    const r1 = runTool('reconnect_platform', { platform });
    const health = runTool('check_stream_health', {});
    let reply = r1.ok ? `Reconnected ${platform}.` : `Could not reconnect ${platform}: ${r1.error}`;
    const bitrate = health.telemetry?.bitrateKbps;
    if (bitrate && bitrate < LOW_BITRATE_KBPS) {
      runTool('set_quality', { quality: 'medium' });
      reply += ` Bitrate was ${bitrate} kbps, so I lowered quality to medium.`;
    } else {
      reply += ' Bitrate looks fine, so I left quality as is.';
    }
    emitStep('report', { text: reply });
    return { reply, ok: true };
  }

  if (/start.*stream/.test(cmd)) { const r = runTool('start_stream', {}); const reply = r.ok ? 'Starting the stream.' : `Couldn't start: ${r.error}`; emitStep('report', { text: reply }); return { reply, ...r }; }
  if (/stop.*stream/.test(cmd))  { const r = runTool('stop_stream', {});  const reply = r.ok ? 'Stopping the stream.' : `Couldn't stop: ${r.error}`;  emitStep('report', { text: reply }); return { reply, ...r }; }

  const rc = cmd.match(/reconnect (\w+)/);
  if (rc) { const r = runTool('reconnect_platform', { platform: rc[1] }); const reply = r.ok ? `Reconnecting ${rc[1]}.` : `Couldn't reconnect ${rc[1]}: ${r.error}`; emitStep('report', { text: reply }); return { reply, ...r }; }

  if (/(lower|reduce|drop).*quality/.test(cmd))    { const r = runTool('set_quality', { quality: 'medium' }); emitStep('report', { text: 'Lowering quality.' }); return { reply: 'Lowering quality.', ...r }; }
  if (/(raise|increase|boost).*quality/.test(cmd)) { const r = runTool('set_quality', { quality: 'ultra' });  emitStep('report', { text: 'Raising quality.' });  return { reply: 'Raising quality.', ...r }; }

  const summary = getSessionSummary(sessionId);
  const reply = summary.active ? `You're live on ${summary.platforms.join(', ')}.` : 'The stream is not live right now.';
  emitStep('report', { text: reply });
  return { reply, ok: true };
}

async function callAnthropicAgent(sessionId, message) {
  const summary = getSessionSummary(sessionId);
  const system =
    `You are the AI co-pilot inside StreamLink XR, a VR streaming control room. ` +
    `Speak the way you would out loud to a streamer wearing a headset — short, plain sentences, no markdown. ` +
    `Before acting, briefly say what you're checking or about to do, then call the matching tool. ` +
    `Use check_stream_health to observe current status and bitrate — call it again after an action like ` +
    `reconnect_platform to verify the result before deciding on any further step (for example, only lower ` +
    `quality if the health check actually still shows a weak bitrate). ` +
    `When you are completely done, give one short final spoken summary with no further tool calls. ` +
    `Starting session state: ${JSON.stringify(summary)}`;

  let messages = [{ role: 'user', content: message }];
  const allActions = [];
  let finalText = '';

  for (let turn = 0; turn < 6; turn++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 400, system, messages, tools: AGENT_TOOLS })
    });
    if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
    const data = await res.json();

    const toolUses = (data.content || []).filter(b => b.type === 'tool_use');
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ').trim();

    if (text) {
      finalText = text;
      io.to(sessionId).emit('agentStep', { phase: toolUses.length ? 'reasoning' : 'report', text });
    }
    if (toolUses.length === 0) break;

    messages.push({ role: 'assistant', content: data.content });

    const toolResultBlocks = [];
    for (const block of toolUses) {
      io.to(sessionId).emit('agentStep', { phase: phaseForTool(block.name), tool: block.name, input: block.input });
      const result = executeAgentTool(sessionId, block.name, block.input || {});
      allActions.push({ tool: block.name, input: block.input, ...result });
      io.to(sessionId).emit('agentStep', { phase: 'result', tool: block.name, input: block.input, ...result });
      toolResultBlocks.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
    }
    messages.push({ role: 'user', content: toolResultBlocks });
  }

  if (!finalText) finalText = allActions.length ? 'Done.' : "I'm not sure what you'd like me to do.";
  io.to(sessionId).emit('agentStep', { phase: 'done', text: finalText });
  return { reply: finalText, actionsTaken: allActions };
}

app.post('/agent', async (req, res) => {
  const { sessionId, message } = req.body;
  if (!sessionId || !message) return res.status(400).json({ error: 'sessionId and message required' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.json({ ...fallbackAgentReply(sessionId, message), fallback: true });
  }
  try {
    const result = await callAnthropicAgent(sessionId, message);
    res.json({ ...result, fallback: false });
  } catch (e) {
    console.error('Agent call failed, using fallback:', e.message);
    res.json({ ...fallbackAgentReply(sessionId, message), fallback: true, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────
// Moved off '/' — the static middleware above now serves index.html (the
// website) there instead. Health/status info lives at /api/status.
app.get('/api/status', (req, res) => {
  res.json({ status: 'StreamLink relay server running', sessions: Object.keys(sessions).length, schedules: Object.keys(schedules).length, uptime: process.uptime() });
});

app.get('/platforms', (req, res) => res.json(PLATFORM_META));

app.post('/start', (req, res) => {
  const { sessionId, platforms, quality = 'high', autoRecover = true } = req.body;
  if (!sessionId || !platforms || !platforms.length) return res.status(400).json({ error: 'sessionId and platforms required' });
  const result = doStartStream(sessionId, platforms, quality, autoRecover);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ success: true, sessionId, ...result });
});

// Fan the incoming bytes out to every platform's own FFmpeg process.
app.post('/stream/:sessionId', (req, res) => {
  const session = sessions[req.params.sessionId];
  if (!session) return res.status(404).json({ error: 'No active session' });
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const data = Buffer.concat(chunks);
    session.bytesReceived += data.length;
    for (const name in session.processes) {
      try { session.processes[name].stdin.write(data); } catch (e) {}
    }
    addToClipBuffer(req.params.sessionId, data);
    res.json({ ok: true });
  });
});

app.post('/stop/:sessionId', (req, res) => {
  const result = doStopStream(req.params.sessionId);
  if (!result.ok) return res.status(404).json({ error: result.error });
  res.json({ success: true });
});

app.get('/status/:sessionId', (req, res) => res.json(getSessionSummary(req.params.sessionId)));

app.post('/quality/:sessionId', (req, res) => {
  const result = doSetQuality(req.params.sessionId, req.body.quality);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ success: true, quality: req.body.quality });
});

// This now genuinely restarts only the named platform's own FFmpeg process.
app.post('/reconnect/:sessionId/:platform', (req, res) => {
  const result = doReconnectPlatform(req.params.sessionId, req.params.platform);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ success: true });
});

app.post('/schedule', (req, res) => {
  const { userId, sessionId, platforms, quality = 'high', startAt, title } = req.body;
  if (!userId || !sessionId || !platforms || !startAt) return res.status(400).json({ error: 'userId, sessionId, platforms, startAt required' });

  const delay = new Date(startAt).getTime() - Date.now();
  if (delay < 0) return res.status(400).json({ error: 'startAt must be in the future' });

  const scheduleId = 'sch_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  const timer = setTimeout(() => {
    if (!sessions[sessionId]) doStartStream(sessionId, platforms, quality, true);
    io.to(sessionId).emit('scheduledStart', { sessionId, scheduleId });
    delete schedules[scheduleId];
  }, delay);

  schedules[scheduleId] = { userId, sessionId, platforms, quality, startAt, title, timer };
  if (delay > 5 * 60 * 1000) setTimeout(() => io.to(sessionId).emit('scheduleReminder', { scheduleId, minutesLeft: 5 }), delay - 5 * 60 * 1000);
  if (delay > 60 * 1000)     setTimeout(() => io.to(sessionId).emit('scheduleReminder', { scheduleId, minutesLeft: 1 }), delay - 60 * 1000);

  res.json({ success: true, scheduleId, startsIn: Math.floor(delay / 1000) });
});

app.get('/schedules/:userId', (req, res) => {
  res.json(Object.entries(schedules).filter(([, s]) => s.userId === req.params.userId)
    .map(([id, s]) => ({ id, sessionId: s.sessionId, startAt: s.startAt, title: s.title, platforms: s.platforms.map(p => p.name) })));
});

app.delete('/schedule/:scheduleId', (req, res) => {
  const schedule = schedules[req.params.scheduleId];
  if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
  clearTimeout(schedule.timer);
  delete schedules[req.params.scheduleId];
  res.json({ success: true });
});

function addToClipBuffer(sessionId, chunk) {
  if (!clipBuffers[sessionId]) clipBuffers[sessionId] = [];
  const buf = clipBuffers[sessionId];
  buf.push({ data: chunk, ts: Date.now() });
  const cutoff = Date.now() - CLIP_BUFFER_SECONDS * 1000;
  while (buf.length && buf[0].ts < cutoff) buf.shift();
}

app.get('/clip/:sessionId', (req, res) => {
  const buf = clipBuffers[req.params.sessionId];
  if (!buf || buf.length === 0) return res.status(404).json({ error: 'No clip buffer available' });
  const seconds = Math.min(parseInt(req.query.seconds) || 30, CLIP_BUFFER_SECONDS);
  const cutoff = Date.now() - seconds * 1000;
  const chunks = buf.filter(c => c.ts >= cutoff).map(c => c.data);
  if (chunks.length === 0) return res.status(404).json({ error: 'Not enough data in buffer' });
  const combined = Buffer.concat(chunks);
  res.set('Content-Type', 'video/webm');
  res.set('Content-Disposition', `attachment; filename="clip_${Date.now()}.webm"`);
  res.send(combined);
});

// ─────────────────────────────────────────────────────────────────────────────
// SOCKET.IO
// ─────────────────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.on('join', (sessionId) => socket.join(sessionId));

  socket.on('networkQuality', ({ sessionId, mbps }) => {
    const session = sessions[sessionId];
    if (!session) return;
    let recommended;
    if      (mbps >= 8) recommended = 'ultra';
    else if (mbps >= 4) recommended = 'high';
    else if (mbps >= 2) recommended = 'medium';
    else if (mbps >= 1) recommended = 'low';
    else                recommended = 'mobile';
    if (recommended !== session.quality) socket.emit('qualityRecommendation', { recommended, current: session.quality, mbps });
  });

  socket.on('agentAction', ({ sessionId, action, platform }) => {
    if (action === 'reconnect' && platform) socket.emit('agentActionResult', { action, platform, ...doReconnectPlatform(sessionId, platform) });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`StreamLink server running on port ${PORT}`));
