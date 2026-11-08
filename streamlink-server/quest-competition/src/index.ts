import { createComponent, createSystem, OneHandGrabbable, PokeInteractable, Pressed, RayInteractable, Types, World } from '@iwsdk/core';
import {
  BoxGeometry, CanvasTexture, DirectionalLight, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry,
  SphereGeometry, TorusGeometry, Vector3
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
const telemetryBox = byId<HTMLDivElement>('telemetry');
const accountLine = byId<HTMLParagraphElement>('account-line');
const passport = byId<HTMLDivElement>('passport');

let sessionId = `quest-${Math.random().toString(36).slice(2, 10)}`;
if (sessionInput) sessionInput.value = sessionId;
let currentQuality = qualityInput?.value || 'high';
let platformMeta: PlatformMeta[] = [];
let configuredPlatforms: ConfiguredPlatform[] = [];
let selectedDestinationNames = new Set<string>();
let knownDestinationNames = new Set<string>();
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
  refreshQuestPanel();
}
function safeLabel(platform: PlatformMeta) { return platform.label || platform.name; }

async function loadAccount() {
  if (!window.SLAuth?.enabled) {
    if (accountLine) accountLine.textContent = 'Account sign-in is not configured on this server.';
    return;
  }
  currentUser = await window.SLAuth.getUser();
  if (!currentUser) {
    if (accountLine) accountLine.textContent = 'Guest mode · VR Arena is available. Sign in to enable streaming.';
    return;
  }
  if (accountLine) accountLine.textContent = currentUser.email ? `Signed in as ${currentUser.email}` : 'Signed in to StreamLink';
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
function getSelectedPlatforms(): ConfiguredPlatform[] {
  return collectPlatforms().filter((platform) => selectedDestinationNames.has(platform.name));
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
  socket.on('stopped', () => setStreamUi(false));
}

async function ensureCapture() {
  if (cameraStream) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    throw new Error('This browser does not support camera streaming. Use Gamey on a desktop browser instead.');
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
  if (window.SLAuth?.enabled && !currentUser) {
    statusText('Sign in to StreamLink before starting a broadcast. VR Arena is available without signing in.');
    return;
  }
  if (!configuredPlatforms.length) {
    statusText('Select at least one configured destination in the VR destination picker first.');
    return;
  }
  try {
    statusText('Requesting camera and microphone access…');
    await ensureCapture();
    connectSocket();
    if (socket?.connected) socket.emit('join', sessionId);
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
  let stopError: unknown = null;
  try {
    await endRecording();
  } catch (error) {
    stopError = error;
    if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
    recorder = null;
  }
  // Always tell the relay to stop, even if browser capture cleanup failed.
  try {
    const response = await apiFetch(`/stop/${encodeURIComponent(sessionId)}`, { method: 'POST' });
    if (!response.ok) throw new Error(`Relay stop failed: ${response.status}`);
  } catch (error) {
    stopError ||= error;
  }
  try {
    await endHistory();
  } catch (error) {
    stopError ||= error;
  }
  setStreamUi(false);
  statusText(stopError
    ? (stopError instanceof Error ? stopError.message : 'Stream cleanup completed with a warning.')
    : 'Stream stopped and capture devices released.');
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
  refreshQuestPanel();
}

startButton?.addEventListener('click', () => {
  sessionId = sessionInput?.value.trim() || sessionId;
  currentQuality = qualityInput?.value || 'high';
  const allPlatforms = collectPlatforms();
  configuredPlatforms = getSelectedPlatforms();
  if (window.SLAuth?.enabled && currentUser && allPlatforms.length) {
    void window.SLAuth.saveCredentials(allPlatforms);
  }
  void startStream();
});
stopButton?.addEventListener('click', () => void stopStream());
qualityInput?.addEventListener('change', () => void setQuality());
window.addEventListener('pagehide', () => {
  // Best-effort relay shutdown when the user closes or navigates away from Quest Studio.
  // stopStream also releases any active camera/microphone tracks.
  if (streamActive || recorder || cameraStream) void stopStream();
  if (socket) socket.disconnect();
  if (arenaActive) stopArena('Arena paused');
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


// ─── IWSDK HANDS-FIRST CREATOR CONTROLS + VR ARENA ──────────────────────────
// The controls below are actual 3D scene entities. IWSDK's pointer system
// handles hand pinch, poke, and controller rays through RayInteractable.
const QuestButton = createComponent('QuestStudioButton', {
  action: { type: Types.String, default: '' },
});
const ArenaTarget = createComponent('QuestArenaTarget', {
  active: { type: Types.Boolean, default: true },
});

let arenaActive = false;
let arenaPaused = false;
let focusMode = false;
let comfortMode = false;
let arenaScore = 0;
let arenaHits = 0;
let arenaCombo = 0;
let arenaBestCombo = 0;
let arenaWave = 1;
const ARENA_GOAL = 15;
let arenaSeconds = 45;
let arenaDeadline = 0;
let arenaTimer: number | null = null;
const arenaMeshes = new Set<Mesh>();
const arenaEntities = new Map<Mesh, any>();
const actionByEntity = new Map<number, string>();
const actionHandlers = new Map<string, () => void>();
const pressedButtons = new Set<number>();
const pressedTargets = new Set<number>();

const panelCanvas = document.createElement('canvas');
panelCanvas.width = 1024;
panelCanvas.height = 640;
const panelCtx = panelCanvas.getContext('2d');
if (!panelCtx) throw new Error('Could not create Quest Studio panel canvas');
const panelTexture = new CanvasTexture(panelCanvas);
const panelMaterial = new MeshBasicMaterial({ map: panelTexture, transparent: true });
const panelMesh = new Mesh(new PlaneGeometry(0.95, 1.0), panelMaterial);
panelMesh.position.set(0, 1.45, -0.75);
panelMesh.userData.label = 'StreamLink Quest Studio control panel';
world.createTransformEntity(panelMesh).addComponent(OneHandGrabbable, { rotate: true, translate: true });

const destinationPanelGroup = new Group();
destinationPanelGroup.position.set(0.78, 1.35, -0.78);
destinationPanelGroup.visible = false;
const destinationCanvas = document.createElement('canvas');
destinationCanvas.width = 512;
destinationCanvas.height = 640;
const destinationContext = destinationCanvas.getContext('2d');
if (!destinationContext) throw new Error('Could not create destination picker canvas');
const destinationTexture = new CanvasTexture(destinationCanvas);
const destinationBacking = new Mesh(
  new PlaneGeometry(0.78, 0.92),
  new MeshBasicMaterial({ map: destinationTexture, transparent: true }),
);
destinationPanelGroup.add(destinationBacking);
world.createTransformEntity(destinationPanelGroup);

function drawQuestPanel() {
  const ctx = panelCtx!;
  ctx.clearRect(0, 0, 1024, 640);
  const gradient = ctx.createLinearGradient(0, 0, 1024, 640);
  gradient.addColorStop(0, '#101b35');
  gradient.addColorStop(1, '#080d1b');
  ctx.fillStyle = gradient;
  ctx.beginPath(); ctx.roundRect(8, 8, 1008, 624, 30); ctx.fill();
  ctx.strokeStyle = '#49649a'; ctx.lineWidth = 5; ctx.stroke();
  ctx.fillStyle = '#f4f7ff'; ctx.font = 'bold 46px Inter, sans-serif';
  ctx.fillText('STREAMLINK XR', 48, 76);
  ctx.fillStyle = '#9fb2d6'; ctx.font = '24px Inter, sans-serif';
  ctx.fillText(focusMode ? 'FOCUS MODE · CREATOR STUDIO' : 'HANDS-FIRST CREATOR STUDIO', 48, 116);
  ctx.fillStyle = streamActive ? '#42e6a4' : '#aab8d2';
  ctx.font = 'bold 28px Inter, sans-serif';
  ctx.fillText(streamActive ? '● STREAM LIVE' : '● STREAM IDLE', 48, 168);
  ctx.fillStyle = '#dce6fb'; ctx.font = '25px Inter, sans-serif';
  ctx.fillText(`Quality: ${currentQuality.toUpperCase()}     Arena: ${arenaActive ? (arenaPaused ? 'PAUSED' : 'PLAYING') : 'READY'}`, 48, 218);
  ctx.fillStyle = '#42e6a4'; ctx.font = 'bold 30px Inter, sans-serif';
  ctx.fillText(`SCORE ${arenaScore}   WAVE ${arenaWave}   COMBO x${Math.min(5, 1 + Math.floor(Math.max(0, arenaCombo - 1) / 3))}   TIME ${arenaSeconds}s`, 48, 276);
  ctx.fillStyle = '#aab8d2'; ctx.font = '21px Inter, sans-serif';
  ctx.fillText(`ARENA OBJECTIVE  ${arenaHits}/${ARENA_GOAL} targets · best combo ${arenaBestCombo}`, 48, 330);
  ctx.fillText('Pinch or poke targets. Every 5 hits advances the wave and raises the challenge.', 48, 365);
  ctx.fillText(`DESTINATIONS  ${selectedDestinationNames.size} selected · use ADD DEST to choose platforms`, 48, 410);
  ctx.fillText('Use the physical headset menu to exit the immersive session.', 48, 450);
  panelTexture.needsUpdate = true;
}
function refreshQuestPanel() { drawQuestPanel(); }

function makeQuestButton(label: string, action: string, x: number, y: number, color: number, parent: Group | Mesh = panelMesh) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 180;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0c1730';
  ctx.beginPath(); ctx.roundRect(4, 4, 504, 172, 26); ctx.fill();
  ctx.strokeStyle = '#' + color.toString(16).padStart(6, '0');
  ctx.lineWidth = 8; ctx.stroke();
  ctx.fillStyle = '#f5f8ff'; ctx.font = 'bold 48px Inter, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, 256, 90);
  const texture = new CanvasTexture(canvas);
  const mesh = new Mesh(new PlaneGeometry(0.25, 0.10), new MeshBasicMaterial({ map: texture, transparent: true }));
  mesh.position.set(x, y - 1.45, 0.025);
  mesh.userData.action = action;
  const entity = world.createTransformEntity(mesh);
  parent.add(mesh);
  entity.addComponent(RayInteractable).addComponent(PokeInteractable).addComponent(QuestButton, { action });
  actionByEntity.set(entity.index, action);
  return entity;
}

type DestinationButton = { mesh: Mesh; context: CanvasRenderingContext2D; texture: CanvasTexture };
const destinationButtons = new Map<string, DestinationButton>();

function drawDestinationButton(name: string, button: DestinationButton) {
  const selected = selectedDestinationNames.has(name);
  const label = platformMeta.find((platform) => platform.name === name)?.label || name;
  const ctx = button.context;
  ctx.clearRect(0, 0, 512, 180);
  ctx.fillStyle = '#0c1730';
  ctx.beginPath(); ctx.roundRect(4, 4, 504, 172, 24); ctx.fill();
  ctx.strokeStyle = selected ? '#42e6a4' : '#52658e';
  ctx.lineWidth = 8; ctx.stroke();
  ctx.fillStyle = '#f5f8ff'; ctx.font = 'bold 34px Inter, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const shortLabel = label.length > 13 ? `${label.slice(0, 11)}…` : label;
  ctx.fillText(`${shortLabel}  ${selected ? 'ON' : 'OFF'}`, 256, 90);
  button.texture.needsUpdate = true;
}
function refreshDestinationButtons() {
  const available = collectPlatforms();
  for (const platform of available) {
    if (!knownDestinationNames.has(platform.name)) selectedDestinationNames.add(platform.name);
    knownDestinationNames.add(platform.name);
    if (destinationButtons.has(platform.name)) {
      drawDestinationButton(platform.name, destinationButtons.get(platform.name)!);
      continue;
    }
    const index = destinationButtons.size;
    if (index >= 8) continue;
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 180;
    const context = canvas.getContext('2d')!;
    const texture = new CanvasTexture(canvas);
    const mesh = new Mesh(
      new PlaneGeometry(0.34, 0.105),
      new MeshBasicMaterial({ map: texture, transparent: true }),
    );
    const column = index % 2;
    const row = Math.floor(index / 2);
    mesh.position.set(column === 0 ? -0.19 : 0.19, 0.25 - row * 0.145, 0.035);
    destinationPanelGroup.add(mesh);
    const entity = world.createTransformEntity(mesh);
    const action = `destination-toggle:${platform.name}`;
    entity.addComponent(RayInteractable).addComponent(PokeInteractable).addComponent(QuestButton, { action });
    actionByEntity.set(entity.index, action);
    actionHandlers.set(action, () => {
      if (selectedDestinationNames.has(platform.name)) selectedDestinationNames.delete(platform.name);
      else selectedDestinationNames.add(platform.name);
      drawDestinationButton(platform.name, destinationButtons.get(platform.name)!);
      statusText(`${platformMeta.find((item) => item.name === platform.name)?.label || platform.name} ${selectedDestinationNames.has(platform.name) ? 'enabled' : 'disabled'} for the next broadcast.`);
      refreshQuestPanel();
    });
    const button = { mesh, context, texture };
    destinationButtons.set(platform.name, button);
    drawDestinationButton(platform.name, button);
  }
  const ctx = destinationContext!;
  ctx.clearRect(0, 0, 512, 640);
  ctx.fillStyle = '#0c1730';
  ctx.beginPath(); ctx.roundRect(5, 5, 502, 630, 28); ctx.fill();
  ctx.strokeStyle = '#49649a'; ctx.lineWidth = 5; ctx.stroke();
  ctx.fillStyle = '#f5f8ff'; ctx.font = 'bold 36px Inter, sans-serif';
  ctx.textAlign = 'center'; ctx.fillText('STREAM DESTINATIONS', 256, 58);
  ctx.fillStyle = '#aab8d2'; ctx.font = '22px Inter, sans-serif';
  ctx.fillText('Pinch a platform to toggle it', 256, 96);
  if (!available.length) {
    ctx.fillText('No saved keys found.', 256, 250);
    ctx.fillText('Add destinations in Account', 256, 286);
  } else if (available.length > 8) {
    ctx.fillText('Showing the first 8 saved destinations', 256, 600);
  }
  destinationTexture.needsUpdate = true;
}
function spawnArenaTarget() {
  const color = [0x31d6ff, 0x8b7bff, 0xffb84d, 0x42e6a4, 0xff668c][Math.floor(Math.random() * 5)];
  const targetRadius = Math.max(0.075, 0.13 - (arenaWave - 1) * 0.012);
  const spread = Math.min(0.9, 0.4 + (arenaWave - 1) * 0.08);
  const mesh = new Mesh(
    new SphereGeometry(targetRadius, 24, 18),
    new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, roughness: 0.22, metalness: 0.25 }),
  );
  mesh.position.set((Math.random() - 0.5) * spread * 2, 1.0 + Math.random() * 0.65, -0.42 - Math.random() * 0.45);
  const ring = new Mesh(new TorusGeometry(0.19, 0.014, 8, 32), new MeshBasicMaterial({ color: 0xffffff }));
  mesh.add(ring);
  const entity = world.createTransformEntity(mesh);
  entity.addComponent(RayInteractable).addComponent(PokeInteractable).addComponent(ArenaTarget);
  arenaMeshes.add(mesh);
  arenaEntities.set(mesh, entity);
  return entity;
}
function clearArena() {
  for (const mesh of arenaMeshes) {
    arenaEntities.get(mesh)?.destroy?.();
    arenaEntities.delete(mesh);
    mesh.parent?.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as MeshStandardMaterial).dispose();
    mesh.children.forEach(child => {
      (child as Mesh).geometry?.dispose?.();
      const material = (child as Mesh).material;
      if (material && !Array.isArray(material)) material.dispose();
    });
  }
  arenaMeshes.clear();
}
function stopArena(message = 'Arena complete') {
  arenaActive = false;
  arenaPaused = false;
  if (arenaTimer !== null) window.clearInterval(arenaTimer);
  arenaTimer = null;
  clearArena();
  statusText(`${message} · score ${arenaScore} · ${arenaHits}/${ARENA_GOAL} targets · best combo ${arenaBestCombo}`);
  refreshQuestPanel();
}
function startArena() {
  if (arenaActive) { stopArena('Arena stopped'); return; }
  arenaActive = true;
  arenaPaused = false;
  arenaScore = 0;
  arenaHits = 0;
  arenaCombo = 0;
  arenaBestCombo = 0;
  arenaWave = 1;
  arenaSeconds = 45;
  arenaDeadline = Date.now() + 45000;
  clearArena();
  for (let i = 0; i < 5; i++) spawnArenaTarget();
  if (arenaTimer !== null) window.clearInterval(arenaTimer);
  arenaTimer = window.setInterval(() => {
    arenaSeconds = Math.max(0, Math.ceil((arenaDeadline - Date.now()) / 1000));
    if (arenaSeconds <= 0) stopArena('Time is up');
    else refreshQuestPanel();
  }, 250);
  statusText(`VR Arena started · hit ${ARENA_GOAL} targets in 45 seconds. Build combos for bonus points.`);
  refreshQuestPanel();
}
function pauseArena() {
  if (!arenaActive) {
    statusText('Start VR Arena before pausing.');
    return;
  }
  if (!arenaPaused) {
    arenaPaused = true;
    if (arenaTimer !== null) window.clearInterval(arenaTimer);
    arenaTimer = null;
    statusText(`Arena paused · score ${arenaScore} · ${arenaSeconds}s remaining.`);
  } else {
    arenaPaused = false;
    arenaDeadline = Date.now() + arenaSeconds * 1000;
    arenaTimer = window.setInterval(() => {
      arenaSeconds = Math.max(0, Math.ceil((arenaDeadline - Date.now()) / 1000));
      if (arenaSeconds <= 0) stopArena('Time is up');
      else refreshQuestPanel();
    }, 250);
    statusText('Arena resumed.');
  }
  refreshQuestPanel();
}
function registerQuestAction(action: string, handler: () => void) {
  actionHandlers.set(action, handler);
}

registerQuestAction('stream', () => {
  if (streamActive) void stopStream();
  else {
    sessionId = sessionInput?.value.trim() || sessionId;
    currentQuality = qualityInput?.value || 'high';
    const allPlatforms = collectPlatforms();
    configuredPlatforms = getSelectedPlatforms();
    if (window.SLAuth?.enabled && currentUser && allPlatforms.length) void window.SLAuth.saveCredentials(allPlatforms);
    void startStream();
  }
});
registerQuestAction('quality', () => {
  const options = ['ultra', 'high', 'medium', 'low', 'mobile'];
  const current = options.indexOf(currentQuality);
  currentQuality = options[(current + 1) % options.length];
  if (qualityInput) qualityInput.value = currentQuality;
  void setQuality();
  refreshQuestPanel();
});
registerQuestAction('arena', startArena);
registerQuestAction('pause', pauseArena);
registerQuestAction('focus', () => {
  focusMode = !focusMode;
  floor.visible = !focusMode;
  stage.visible = !focusMode;
  const panel = byId<HTMLDivElement>('studio-panel');
  panel?.classList.toggle('hidden', focusMode);
  statusText(focusMode ? 'Focus mode on · only the creator controls remain in view.' : 'Focus mode off · full studio visible.');
  refreshQuestPanel();
});
registerQuestAction('comfort', () => {
  comfortMode = !comfortMode;
  if (comfortMode) {
    panelMesh.position.set(0, 1.18, -0.58);
    panelMesh.scale.setScalar(0.86);
    destinationPanelGroup.position.set(0.66, 1.18, -0.62);
    destinationPanelGroup.scale.setScalar(0.86);
    statusText('Seated comfort on · controls moved closer and lowered for seated reach.');
  } else {
    panelMesh.position.set(0, 1.45, -0.75);
    panelMesh.scale.setScalar(1);
    destinationPanelGroup.position.set(0.78, 1.35, -0.78);
    destinationPanelGroup.scale.setScalar(1);
    statusText('Seated comfort off · standard studio reach restored.');
  }
  refreshQuestPanel();
});
registerQuestAction('reset', () => {
  focusMode = false;
  floor.visible = true;
  stage.visible = true;
  byId<HTMLDivElement>('studio-panel')?.classList.remove('hidden');
  panelMesh.position.set(0, 1.45, -0.75);
  panelMesh.rotation.set(0, 0, 0);
  panelMesh.scale.setScalar(1);
  comfortMode = false;
  destinationPanelGroup.position.set(0.78, 1.35, -0.78);
  destinationPanelGroup.rotation.set(0, 0, 0);
  destinationPanelGroup.scale.setScalar(1);
  destinationPanelGroup.visible = false;
  statusText('Studio panel layout reset.');
  refreshQuestPanel();
});

registerQuestAction('destination', () => {
  refreshDestinationButtons();
  destinationPanelGroup.visible = !destinationPanelGroup.visible;
  statusText(destinationPanelGroup.visible
    ? 'Destination picker open · pinch platforms to include or exclude them from your next broadcast.'
    : 'Destination picker closed.');
});

makeQuestButton('GO LIVE / STOP', 'stream', -0.31, 1.25, 0x42e6a4);
makeQuestButton('QUALITY', 'quality', 0, 1.25, 0x31d6ff);
makeQuestButton('VR ARENA', 'arena', 0.31, 1.25, 0xffb84d);
makeQuestButton('FOCUS', 'focus', -0.31, 1.10, 0x8b7bff);
makeQuestButton('COMFORT', 'comfort', 0, 1.10, 0x42e6a4);
makeQuestButton('RESET', 'reset', 0.31, 1.10, 0xff668c);
makeQuestButton('PAUSE / RESUME', 'pause', -0.16, 1.03, 0xffb84d);
makeQuestButton('ADD DEST', 'destination', 0.16, 1.03, 0x31d6ff);
makeQuestButton('DONE', 'destination', 0, 1.10, 0x42e6a4, destinationPanelGroup);
refreshDestinationButtons();
platformList?.addEventListener('input', refreshDestinationButtons);

class QuestInteractionSystem extends createSystem({
  buttons: { required: [QuestButton, Pressed] },
  targets: { required: [ArenaTarget, Pressed] },
}) {
  update() {
    this.queries.buttons.entities.forEach((entity: any) => {
      if (pressedButtons.has(entity.index)) return;
      pressedButtons.add(entity.index);
      const action = QuestButton.data.action[entity.index];
      actionHandlers.get(action)?.();
    });
    const currentlyPressed = new Set<number>();
    this.queries.buttons.entities.forEach((entity: any) => currentlyPressed.add(entity.index));
    for (const id of pressedButtons) if (!currentlyPressed.has(id)) pressedButtons.delete(id);

    this.queries.targets.entities.forEach((entity: any) => {
      if (pressedTargets.has(entity.index) || !arenaActive || arenaPaused) return;
      pressedTargets.add(entity.index);
      const mesh = entity.object3D as Mesh | undefined;
      if (mesh) {
        arenaMeshes.delete(mesh);
        arenaEntities.delete(mesh);
        mesh.parent?.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as MeshStandardMaterial).dispose();
        mesh.children.forEach(child => {
          (child as Mesh).geometry?.dispose?.();
          const material = (child as Mesh).material;
          if (material && !Array.isArray(material)) material.dispose();
        });
      }
      entity.destroy?.();
      arenaHits += 1;
      arenaCombo += 1;
      arenaBestCombo = Math.max(arenaBestCombo, arenaCombo);
      const multiplier = Math.min(5, 1 + Math.floor((arenaCombo - 1) / 3));
      const points = 10 * multiplier;
      arenaScore += points;
      if (arenaHits % 5 === 0 && arenaHits < ARENA_GOAL) {
        arenaWave += 1;
        arenaCombo = 0;
        statusText(`Wave ${arenaWave}! Targets are smaller and more spread out. Score: ${arenaScore}`);
      } else {
        statusText(`Target hit! +${points} · combo x${multiplier} · ${arenaHits}/${ARENA_GOAL}`);
      }
      if (arenaHits >= ARENA_GOAL) stopArena('Arena cleared');
      else spawnArenaTarget();
      refreshQuestPanel();
    });
    const currentlyHit = new Set<number>();
    this.queries.targets.entities.forEach((entity: any) => currentlyHit.add(entity.index));
    for (const id of pressedTargets) if (!currentlyHit.has(id)) pressedTargets.delete(id);
  }
}
world.registerSystem(QuestInteractionSystem);
drawQuestPanel();
world.scene.add(panelMesh);
