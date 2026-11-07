import { OneHandGrabbable, World } from '@iwsdk/core';
import {
  BoxGeometry, DirectionalLight, Mesh, MeshStandardMaterial, PlaneGeometry,
  SphereGeometry, Vector3
} from 'three';
import projectOptions from 'virtual:iwsdk-project';

type PlatformMeta = { name: string; label?: string; requiresUrl?: boolean };
type ConfiguredPlatform = { name: string; key?: string; url?: string };
type StreamTelemetry = { bitrateKbps?: number; uptimeSec?: number; reconnects?: number; quality?: string };

declare global {
  interface Window {
    SLAuth?: any;
    io?: any;
  }
}

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
const container = byId<HTMLDivElement>('scene-container');
const enterButton = byId<HTMLButtonElement>('enter-xr');
const status = byId<HTMLDivElement>('status');
const statusText = (message: string) => { if (status) status.textContent = message; };
const apiFetch = (url: string, options: RequestInit = {}) =>
  window.SLAuth?.enabled ? window.SLAuth.fetch(url, options) : fetch(url, options);
const socketOptions = () => window.SLAuth?.socketOptions?.() || { transports: ['websocket'] };

if (!container) throw new Error('Missing #scene-container');

const world = await World.create(container, projectOptions);
const keyLight = new DirectionalLight(0xffffff, 2.2);
keyLight.position.set(3, 6, 4);
world.scene.add(keyLight);
const fillLight = new DirectionalLight(0x6c8cff, 0.8);
fillLight.position.set(-4, 5, 3);
world.scene.add(fillLight);

const floor = new Mesh(
  new PlaneGeometry(18, 18),
  new MeshStandardMaterial({ color: 0x101a31, roughness: 0.92, metalness: 0.08 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.025;
world.createTransformEntity(floor);

const stage = new Mesh(
  new BoxGeometry(5.2, 0.12, 3.2),
  new MeshStandardMaterial({ color: 0x1c2b4b, roughness: 0.55, metalness: 0.28 }),
);
stage.position.set(0, 0.02, -2.2);
world.createTransformEntity(stage).addComponent(OneHandGrabbable, { rotate: true, translate: true });

const colors = [0x31d6ff, 0x8b7bff, 0xffb84d, 0x42e6a4, 0xff668c];
const arenaTargets: Mesh[] = [];
colors.forEach((color, index) => {
  const target = new Mesh(
    new SphereGeometry(0.19, 32, 24),
    new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.22, roughness: 0.28, metalness: 0.35 }),
  );
  target.position.set((index - 2) * 0.92, 1.45 + (index % 2) * 0.48, -2.0 - (index % 2) * 0.22);
  world.createTransformEntity(target).addComponent(OneHandGrabbable, { rotate: true, translate: true });
  arenaTargets.push(target);
});

// Existing StreamLink auth, Supabase credentials, REST APIs and Socket.IO remain the source of truth.
const sessionInput = byId<HTMLInputElement>('session-id');
const qualityInput = byId<HTMLSelectElement>('quality');
const platformList = byId<HTMLDivElement>('platform-list');
const startButton = byId<HTMLButtonElement>('start-stream');
const stopButton = byId<HTMLButtonElement>('stop-stream');
const agentInput = byId<HTMLInputElement>('agent-message');
const telemetryBox = byId<HTMLDivElement>('telemetry');
const accountLine = byId<HTMLParagraphElement>('account-line');
const passport = byId<HTMLDivElement>('passport');

let sessionId = `quest-${Math.random().toString(36).slice(2, 10)}`;
if (sessionInput) sessionInput.value = sessionId;
let currentQuality = qualityInput?.value || 'high';
let platformMeta: PlatformMeta[] = [];
let configuredPlatforms: ConfiguredPlatform[] = [];
let currentUser: any = null;
let socket: any = null;
let cameraStream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let uploadChain: Promise<void> = Promise.resolve();
let streamActive = false;
let sessionRowId: string | null = null;
let lastTelemetry: StreamTelemetry = {};

function setTelemetry(message?: string) {
  if (telemetryBox) {
    telemetryBox.innerHTML = message || `Stream: ${streamActive ? 'LIVE' : 'idle'}<br>Bitrate: ${lastTelemetry.bitrateKbps ?? '—'} kbps<br>Uptime: ${lastTelemetry.uptimeSec ?? '—'} sec<br>Reconnects: ${lastTelemetry.reconnects ?? 0}`;
  }
}
function setStreamUi(active: boolean) {
  streamActive = active;
  if (startButton) startButton.disabled = active;
  if (stopButton) stopButton.disabled = !active;
  setTelemetry();
}
function safeLabel(platform: PlatformMeta) { return platform.label || platform.name; }

async function loadAccount() {
  if (!window.SLAuth?.enabled) {
    if (accountLine) accountLine.textContent = 'Account sign-in is not configured on this server.';
    return;
  }
  await window.SLAuth.requireSignIn();
  currentUser = await window.SLAuth.getUser();
  if (accountLine) accountLine.textContent = currentUser?.email ? `Signed in as ${currentUser.email}` : 'Signed in to StreamLink';
  if (passport && currentUser) {
    const [wallet, stats] = await Promise.all([
      window.SLAuth.getWallet().catch(() => null),
      window.SLAuth.getStats().catch(() => null),
    ]);
    passport.classList.remove('hidden');
    passport.textContent = wallet?.address
      ? `Creator passport · ${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)} · ${stats?.streams ?? 0} broadcasts`
      : `Creator passport · ${stats?.streams ?? 0} broadcasts · link a wallet from Account`;
  }
}

function renderPlatforms() {
  if (!platformList) return;
  platformList.replaceChildren();
  for (const platform of platformMeta) {
    const row = document.createElement('div');
    row.className = 'platform';
    const title = document.createElement('strong');
    title.textContent = safeLabel(platform);
    row.appendChild(title);
    if (platform.requiresUrl) {
      const url = document.createElement('input');
      url.type = 'url';
      url.dataset.platform = platform.name;
      url.dataset.field = 'url';
      url.placeholder = 'Ingest URL';
      url.autocomplete = 'off';
      row.appendChild(url);
    }
    const key = document.createElement('input');
    key.type = 'password';
    key.dataset.platform = platform.name;
    key.dataset.field = 'key';
    key.placeholder = 'Stream key';
    key.autocomplete = 'off';
    row.appendChild(key);
    platformList.appendChild(row);
  }
}
function collectPlatforms(): ConfiguredPlatform[] {
  const values: Record<string, ConfiguredPlatform> = {};
  platformList?.querySelectorAll<HTMLInputElement>('input[data-platform]').forEach((input) => {
    const name = input.dataset.platform;
    const field = input.dataset.field;
    const value = input.value.trim();
    if (!name || !value || (field !== 'key' && field !== 'url')) return;
    values[name] ||= { name };
    values[name][field] = value;
  });
  return Object.values(values);
}
async function loadPlatforms() {
  const response = await fetch('/platforms');
  if (!response.ok) throw new Error('Could not load streaming destinations.');
  platformMeta = await response.json() as PlatformMeta[];
  renderPlatforms();
  if (window.SLAuth?.enabled && currentUser) {
    const saved = await window.SLAuth.loadCredentials();
    for (const row of saved || []) {
      const key = platformList?.querySelector<HTMLInputElement>(`input[data-platform="${CSS.escape(row.platform_name)}"][data-field="key"]`);
      const url = platformList?.querySelector<HTMLInputElement>(`input[data-platform="${CSS.escape(row.platform_name)}"][data-field="url"]`);
      if (key && row.stream_key) key.value = row.stream_key;
      if (url && row.ingest_url) url.value = row.ingest_url;
    }
  }
}

function connectSocket() {
  if (!window.io || socket) return;
  socket = window.io(window.location.origin, socketOptions());
  socket.on('connect', () => socket.emit('join', sessionId));
  socket.on('platformStatus', ({ platform, status: state }: { platform: string; status: string }) => {
    statusText(`${platform} is ${state}.`);
  });
  socket.on('telemetry', (data: StreamTelemetry) => {
    lastTelemetry = data;
    setTelemetry();
    if (data.quality && qualityInput) qualityInput.value = data.quality;
  });
  socket.on('recovering', ({ attempt }: { attempt: number }) => statusText(`Auto-recovering stream · attempt ${attempt}`));
  socket.on('recovered', () => statusText('Stream recovered.'));
  socket.on('streamWarning', ({ message }: { message: string }) => statusText(message));
  socket.on('agentStep', (step: any) => {
    if (step?.text) statusText(step.text);
    if (step?.phase === 'result' && step.ok && step.tool === 'stop_stream') setStreamUi(false);
  });
  socket.on('stopped', () => setStreamUi(false));
}

async function ensureCapture() {
  if (cameraStream) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    throw new Error('This browser does not support camera streaming. Try Classic VR or Gamey.');
  }
  cameraStream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    audio: true,
  });
}
function beginRecording() {
  if (!cameraStream) throw new Error('Camera and microphone are not ready.');
  const mime = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm']
    .find((type) => MediaRecorder.isTypeSupported(type));
  recorder = new MediaRecorder(cameraStream, mime ? { mimeType: mime } : undefined);
  recorder.ondataavailable = (event) => {
    if (!event.data?.size) return;
    const chunk = event.data;
    uploadChain = uploadChain.then(async () => {
      const response = await apiFetch(`/stream/${encodeURIComponent(sessionId)}`, { method: 'POST', body: chunk });
      if (!response.ok) throw new Error(`Stream upload failed: ${response.status}`);
    }).catch((error) => statusText(error instanceof Error ? error.message : 'Stream upload failed.'));
  };
  recorder.start(1000);
}
async function endRecording() {
  if (recorder && recorder.state !== 'inactive') {
    const active = recorder;
    await new Promise<void>((resolve) => {
      active.addEventListener('stop', () => resolve(), { once: true });
      active.stop();
    });
  }
  recorder = null;
  await uploadChain;
  if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = null;
}
async function startHistory() {
  if (!window.SLAuth?.enabled) return;
  const row = await window.SLAuth.startSession({
    platformCount: configuredPlatforms.length, quality: currentQuality, via: 'quest-iwsdk',
  });
  sessionRowId = row || null;
}
async function endHistory() {
  if (!sessionRowId || !window.SLAuth) return;
  const id = sessionRowId;
  sessionRowId = null;
  await window.SLAuth.endSession(id);
  await loadAccount();
}
async function startStream() {
  if (!configuredPlatforms.length) {
    statusText('Add at least one streaming destination and its key first.');
    return;
  }
  try {
    statusText('Requesting camera and microphone access…');
    await ensureCapture();
    connectSocket();
    const response = await apiFetch('/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, platforms: configuredPlatforms, quality: currentQuality, autoRecover: true }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not start stream.');
    beginRecording();
    setStreamUi(true);
    await startHistory();
    statusText(`You are live on ${result.platforms?.length || configuredPlatforms.length} destination(s).`);
  } catch (error) {
    if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
    statusText(error instanceof Error ? error.message : 'Could not start streaming.');
  }
}
async function stopStream() {
  try {
    await endRecording();
    await apiFetch(`/stop/${encodeURIComponent(sessionId)}`, { method: 'POST' });
  } catch (error) {
    statusText(error instanceof Error ? error.message : 'Could not stop the stream cleanly.');
  }
  await endHistory();
  setStreamUi(false);
  statusText('Stream stopped.');
}
async function setQuality() {
  currentQuality = qualityInput?.value || 'high';
  if (!streamActive) return;
  const response = await apiFetch(`/quality/${encodeURIComponent(sessionId)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quality: currentQuality }),
  });
  if (!response.ok) statusText('Could not update stream quality.');
  else statusText(`Stream quality changed to ${currentQuality}.`);
}
async function sendAgentCommand() {
  const message = agentInput?.value.trim();
  if (!message) return;
  if (agentInput) agentInput.value = '';
  try {
    const response = await apiFetch('/agent', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Agent is unavailable.');
    if (result.reply) statusText(result.reply);
    else statusText('Command sent. Watch the status for agent updates.');
  } catch (error) {
    statusText(error instanceof Error ? error.message : 'Could not reach the agent.');
  }
}

startButton?.addEventListener('click', () => {
  sessionId = sessionInput?.value.trim() || sessionId;
  currentQuality = qualityInput?.value || 'high';
  configuredPlatforms = collectPlatforms();
  if (window.SLAuth?.enabled && currentUser && configuredPlatforms.length) {
    void window.SLAuth.saveCredentials(configuredPlatforms);
  }
  void startStream();
});
stopButton?.addEventListener('click', () => void stopStream());
qualityInput?.addEventListener('change', () => void setQuality());
byId<HTMLButtonElement>('send-agent')?.addEventListener('click', () => void sendAgentCommand());
agentInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') void sendAgentCommand();
});
window.addEventListener('pagehide', () => {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
});

const xr = (navigator as Navigator & { xr?: { isSessionSupported(mode: string): Promise<boolean> } }).xr;
const xrSupported = xr ? await xr.isSessionSupported('immersive-vr').catch(() => false) : false;
if (enterButton) {
  enterButton.disabled = !xrSupported;
  enterButton.textContent = xrSupported ? 'ENTER QUEST VR' : 'OPEN ON META QUEST';
  enterButton.addEventListener('click', async () => {
    try {
      await world.launchXR();
      statusText('Quest session active · use hand pinch to grab and arrange the studio objects.');
    } catch (error) {
      console.error('Unable to start immersive session:', error);
      statusText('XR could not start. Open this HTTPS page in Quest Browser and check headset permissions.');
    }
  });
}

try {
  await loadAccount();
  await loadPlatforms();
  connectSocket();
  statusText(xrSupported
    ? 'IWSDK studio ready · sign in, configure destinations, then enter Quest VR.'
    : 'Desktop preview ready · open this HTTPS page in Meta Quest Browser to enter VR.');
} catch (error) {
  statusText(error instanceof Error ? error.message : 'Studio setup failed.');
}
