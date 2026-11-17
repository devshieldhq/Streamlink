import {
  BoxGeometry, CanvasTexture, CapsuleGeometry, ConeGeometry, CylinderGeometry, IcosahedronGeometry, OctahedronGeometry, createComponent, createSystem, DirectionalLight, EnvironmentType, Group, LocomotionEnvironment, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, OneHandGrabbable, PlaneGeometry, PokeInteractable, Pressed, RayInteractable,
  SphereGeometry, TorusGeometry, Types, Vector2, Vector3, Raycaster, Quaternion, World
} from '@iwsdk/core';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinnedModel } from 'three/addons/utils/SkeletonUtils.js';
import { AnimationMixer, Box3 } from 'three';
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

// Build a lightweight, high-contrast VR Arena shell directly in the IWSDK scene.
const arenaShellMaterial = new MeshBasicMaterial({ color: 0x101b35 });
const arenaAccentMaterial = new MeshBasicMaterial({ color: 0x16d9ff });
const arenaPurpleMaterial = new MeshBasicMaterial({ color: 0x6c55ff });
const arenaFloorLineMaterial = new MeshBasicMaterial({ color: 0x174c79 });
const arenaCoreMaterial = new MeshBasicMaterial({ color: 0x20dfff });
const arenaGoldMaterial = new MeshBasicMaterial({ color: 0xffb84d });
const arenaEnvironmentMeshes: Mesh[] = [];
const arenaEnvironmentRooms = new Map<string, Group>();
const addArenaMesh = (geometry: any, material: any, position: [number, number, number], rotation?: [number, number, number]) => {
  const mesh = new Mesh(geometry, material);
  // Register first: IWSDK binds Object3D transforms to ECS storage here.
  const entity = world.createTransformEntity(mesh, { persistent: true });
  entity.object3D!.position.set(position[0], position[1], position[2]);
  if (rotation) entity.object3D!.rotation.set(rotation[0], rotation[1], rotation[2]);
  if (!(window as any).__streamLinkEcsRootProbe) {
    (window as any).__streamLinkEcsRootProbe = true;
    const persistentRoot = world.getPersistentRoot();
    const chain = (object: any) => {
      const rows = [];
      for (let node = object; node; node = node.parent) {
        rows.push({ name: node.name || node.type, visible: node.visible, isScene: node === world.scene });
      }
      return rows;
    };
    console.info('[StreamLink ECS attachment diagnostic]', {
      entityIndex: entity.index,
      entityParentIsPersistentRoot: entity.object3D?.parent === persistentRoot,
      persistentRootIsScene: persistentRoot === world.scene,
      persistentRootVisible: persistentRoot.visible,
      sceneVisible: world.scene.visible,
      entityChain: chain(entity.object3D),
      persistentRootChain: chain(persistentRoot),
      sceneChildren: world.scene.children.length,
    });
  }
  arenaEnvironmentMeshes.push(mesh);
  return mesh;
};

// Rear wall, side fins, and luminous crown define the arena boundaries.
addArenaMesh(new BoxGeometry(13.5, 5.2, 0.22), arenaShellMaterial, [0, 2.35, -5.35]);
addArenaMesh(new BoxGeometry(0.22, 4.4, 7.8), arenaShellMaterial, [-6.55, 2.0, -2.0]);
addArenaMesh(new BoxGeometry(0.22, 4.4, 7.8), arenaShellMaterial, [6.55, 2.0, -2.0]);
addArenaMesh(new BoxGeometry(13.8, 0.12, 0.18), arenaAccentMaterial, [0, 4.95, -5.18]);
addArenaMesh(new BoxGeometry(0.12, 4.5, 0.18), arenaAccentMaterial, [-5.9, 2.15, -5.18]);
addArenaMesh(new BoxGeometry(0.12, 4.5, 0.18), arenaPurpleMaterial, [5.9, 2.15, -5.18]);

// Floor grid and luminous rings provide depth and orientation cues.
for (let z = -4.8; z <= 1.2; z += 1.2) {
  addArenaMesh(new BoxGeometry(12.2, 0.018, 0.025), arenaFloorLineMaterial, [0, 0.012, z]);
}
for (let x = -5.4; x <= 5.4; x += 1.8) {
  addArenaMesh(new BoxGeometry(0.025, 0.018, 6.2), arenaFloorLineMaterial, [x, 0.012, -1.8]);
}
addArenaMesh(new TorusGeometry(2.8, 0.035, 8, 64), arenaAccentMaterial, [0, 0.055, -2.2], [Math.PI / 2, 0, 0]);
addArenaMesh(new TorusGeometry(2.25, 0.022, 8, 64), arenaPurpleMaterial, [0, 0.06, -2.2], [Math.PI / 2, 0, 0]);

// Rift Gate: a large, unmistakable focal point behind the combat zone.
addArenaMesh(new TorusGeometry(1.72, 0.075, 12, 96), arenaCoreMaterial, [0, 2.45, -5.12]);
addArenaMesh(new TorusGeometry(1.42, 0.028, 8, 96), arenaGoldMaterial, [0, 2.45, -5.08]);
addArenaMesh(new TorusGeometry(1.10, 0.018, 8, 96), arenaPurpleMaterial, [0, 2.45, -5.04]);
addArenaMesh(new SphereGeometry(0.34, 24, 18), arenaCoreMaterial, [0, 2.45, -5.02]);
for (const x of [-5.35, -4.95, 4.95, 5.35]) {
  addArenaMesh(new BoxGeometry(0.055, 3.7, 0.055), arenaCoreMaterial, [x, 2.0, -4.9]);
}
for (const y of [0.75, 1.05, 3.75, 4.05]) {
  addArenaMesh(new BoxGeometry(10.4, 0.025, 0.035), arenaFloorLineMaterial, [0, y, -5.0]);
}

// Side pylons frame the play area while keeping the center open.
for (const x of [-4.8, -3.8, 3.8, 4.8]) {
  addArenaMesh(new BoxGeometry(0.16, 2.6, 0.16), x < 0 ? arenaAccentMaterial : arenaPurpleMaterial, [x, 1.3, -3.9]);
  addArenaMesh(new BoxGeometry(0.55, 0.08, 0.55), arenaShellMaterial, [x, 0.08, -3.9]);
}

const floor = new Mesh(
  new PlaneGeometry(18, 18),
  new MeshStandardMaterial({ color: 0x101a31, roughness: 0.92, metalness: 0.08 }),
);
const floorEntity = world.createTransformEntity(floor, { persistent: true });
floorEntity.object3D!.rotation.x = -Math.PI / 2;
floorEntity.object3D!.position.y = -0.025;
floorEntity.addComponent(LocomotionEnvironment, { type: EnvironmentType.STATIC });

const stage = new Mesh(
  new BoxGeometry(5.2, 0.12, 3.2),
  new MeshStandardMaterial({ color: 0x1c2b4b, roughness: 0.55, metalness: 0.28 }),
);
const stageEntity = world.createTransformEntity(stage, { persistent: true });
stageEntity.object3D!.position.set(0, 0.02, -2.2);
stageEntity.addComponent(RayInteractable).addComponent(OneHandGrabbable, { rotate: true, translate: true });

const colors = [0x31d6ff, 0x8b7bff, 0xffb84d, 0x42e6a4, 0xff668c];
const arenaTargets: Mesh[] = [];
colors.forEach((color, index) => {
  const target = new Mesh(
    new SphereGeometry(0.19, 32, 24),
    new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.22, roughness: 0.28, metalness: 0.35 }),
  );
  const targetEntity = world.createTransformEntity(target, { persistent: true });
  targetEntity.object3D!.position.set((index - 2) * 0.92, 1.45 + (index % 2) * 0.48, -2.0 - (index % 2) * 0.22);
  targetEntity.addComponent(OneHandGrabbable, { rotate: true, translate: true });
  arenaTargets.push(target);
});

// Removed temporary cyan/green/magenta camera probes after render diagnosis.

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
      // Wait for the XR runtime to apply the headset pose before sampling the camera.
      requestAnimationFrame(() => requestAnimationFrame(() => { placeStudioInFrontOfCamera(); logQuestCameraAndMeshes(); }));
      document.body.classList.add('immersive-active');
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
world.registerComponent(QuestButton).registerComponent(ArenaTarget);

let arenaActive = false;
let arenaPaused = false;
let focusMode = false;
let comfortMode = false;
let arenaScore = 0;
let arenaHits = 0;
let arenaCombo = 0;
let arenaBestCombo = 0;
let arenaWave = 1;
let arenaGoal = 15;
let arenaShield = 3;
let arenaLastFrameTime = performance.now() / 1000;
let raceLane=1, raceDistance=0, raceSpawnClock=0, racePoliceLevel=1;
const raceObjects: {mesh:Group;entity:any;lane:number;speed:number;passed:boolean;kind:'traffic'|'police'|'roadblock'}[]=[];
const raceTrackMeshes:{mesh:Mesh;entity:any}[]=[];
let raceCar:Group|null=null, raceCarEntity:any=null, raceTrackActive=false;
let activeGameMode: 'orb-rush' | 'drone-defense' | 'meteor-blitz' | 'phantom-hunt' | 'zero-g-rush' | 'last-stand' | 'titan-breaker' | 'inferno-run' | 'nightfall-survival' | 'rift-racer' = 'orb-rush';
const firstPersonGun = new Group();
const rifleMetal = new MeshStandardMaterial({ color: 0x252c34, metalness: 0.86, roughness: 0.3 });
const rifleDark = new MeshStandardMaterial({ color: 0x111820, metalness: 0.25, roughness: 0.72 });
const rifleSteel = new MeshStandardMaterial({ color: 0x59636e, metalness: 0.94, roughness: 0.22 });
const riflePolymer = new MeshStandardMaterial({ color: 0x303a35, metalness: 0.08, roughness: 0.88 });
const gloveMat = new MeshStandardMaterial({ color: 0x303c32, roughness: 0.96 });
const sleeveMat = new MeshStandardMaterial({ color: 0x343d43, roughness: 0.95 });
function addRiflePart(geometry: any, material: any, x: number, y: number, z: number, parent: Group = firstPersonGun) {
  const part = new Mesh(geometry, material);
  part.position.set(x, y, z);
  part.castShadow = true;
  part.receiveShadow = true;
  parent.add(part);
  return part;
}
// Detailed compact tactical carbine. The muzzle points down local -Z;
// stock and shoulder pad sit behind the receiver on +Z.
addRiflePart(new BoxGeometry(0.22, 0.17, 0.48), rifleMetal, 0, 0, -0.12); // receiver
addRiflePart(new BoxGeometry(0.19, 0.15, 0.42), riflePolymer, 0, 0.005, -0.53); // handguard
addRiflePart(new BoxGeometry(0.075, 0.075, 0.48), rifleSteel, 0, 0.015, -0.91); // barrel
addRiflePart(new CylinderGeometry(0.034, 0.034, 0.15, 16), rifleSteel, 0, 0.015, -1.205).rotation.x = Math.PI / 2;
addRiflePart(new CylinderGeometry(0.052, 0.052, 0.075, 20), rifleDark, 0, 0.015, -1.31).rotation.x = Math.PI / 2; // muzzle brake
// Stock with a broad shoulder pad, cheek rest and angled buffer tube.
addRiflePart(new BoxGeometry(0.13, 0.13, 0.34), rifleDark, 0, -0.005, 0.28);
addRiflePart(new BoxGeometry(0.19, 0.23, 0.13), riflePolymer, 0, -0.005, 0.53);
addRiflePart(new BoxGeometry(0.205, 0.25, 0.045), rifleDark, 0, -0.005, 0.615);
addRiflePart(new BoxGeometry(0.13, 0.045, 0.22), riflePolymer, 0, 0.095, 0.37); // cheek rest
// Magazine, pistol grip, trigger guard and forward support grip.
const magazine = addRiflePart(new BoxGeometry(0.145, 0.34, 0.19), rifleDark, 0, -0.245, -0.10);
magazine.rotation.x = -0.10;
addRiflePart(new BoxGeometry(0.13, 0.22, 0.15), riflePolymer, 0, -0.185, 0.13).rotation.x = -0.20;
addRiflePart(new BoxGeometry(0.10, 0.19, 0.12), rifleDark, 0, -0.17, -0.62).rotation.x = -0.10;
addRiflePart(new TorusGeometry(0.075, 0.012, 8, 18), rifleSteel, 0, -0.13, 0.015).scale.set(1, 0.8, 0.7);
// Top rail and a compact optic with visible front/rear glass rings.
addRiflePart(new BoxGeometry(0.055, 0.035, 0.82), rifleDark, 0, 0.105, -0.34);
addRiflePart(new BoxGeometry(0.075, 0.045, 0.20), rifleSteel, 0, 0.16, -0.38);
addRiflePart(new CylinderGeometry(0.055, 0.055, 0.19, 18), rifleDark, 0, 0.225, -0.38).rotation.x = Math.PI / 2;
addRiflePart(new TorusGeometry(0.052, 0.012, 8, 20), rifleSteel, 0, 0.225, -0.49);
addRiflePart(new TorusGeometry(0.052, 0.012, 8, 20), rifleSteel, 0, 0.225, -0.27);
addRiflePart(new BoxGeometry(0.045, 0.09, 0.06), rifleDark, 0, 0.17, -0.79); // front sight
// Side rails and small fasteners make the handguard read as a real assembly.
addRiflePart(new BoxGeometry(0.035, 0.055, 0.52), rifleSteel, 0.115, 0.005, -0.53);
addRiflePart(new BoxGeometry(0.035, 0.055, 0.52), rifleSteel, -0.115, 0.005, -0.53);
for (let z = -0.72; z <= -0.32; z += 0.10) {
  addRiflePart(new BoxGeometry(0.012, 0.018, 0.035), rifleDark, 0.14, 0.012, z);
  addRiflePart(new BoxGeometry(0.012, 0.018, 0.035), rifleDark, -0.14, 0.012, z);
}
const gunMuzzleFlash = new Mesh(new SphereGeometry(0.105, 12, 10), new MeshBasicMaterial({ color: 0xffd45c, toneMapped: false }));
gunMuzzleFlash.position.set(0, 0.005, -1.18);
gunMuzzleFlash.visible = false;
firstPersonGun.add(gunMuzzleFlash);
firstPersonGun.position.set(0.30, -0.30, -0.52);
firstPersonGun.visible = false;
world.camera.add(firstPersonGun);

// Quest hand-tracking mode: the POV rifle stays camera-mounted. Pinch the RIGHT
// thumb and index fingertips to fire once; release before pinching again.
let rightHandPinching = false;
const handGunDirection = new Vector3();
world.onXRFrame((frame) => {
  const rightHandSource = Array.from(frame.session.inputSources).find(
    (source) => source.handedness === 'right' && source.hand,
  );
  const trackedHand = rightHandSource?.hand;
  if (!rightHandSource || !trackedHand || !world.xrReferenceSpace) {
    rightHandPinching = false;
    if (firstPersonGun.parent !== world.camera) {
      firstPersonGun.parent?.remove(firstPersonGun);
      world.camera.add(firstPersonGun);
      firstPersonGun.position.set(0.30, -0.30, -0.52);
      firstPersonGun.rotation.set(0, 0, 0);
    }
    return;
  }

  // Keep the weapon camera-mounted for a true first-person POV in Quest.
  // Hand tracking is used only for the pinch-to-fire gesture, not to attach
  // the rifle to the palm (which makes the weapon look awkward and unstable).
  if (firstPersonGun.parent !== world.camera) {
    firstPersonGun.parent?.remove(firstPersonGun);
    world.camera.add(firstPersonGun);
  }
  firstPersonGun.position.set(0.30, -0.30, -0.52);
  firstPersonGun.rotation.set(0, 0, 0);
  firstPersonGun.visible = arenaActive && isShooterMode();

  const thumb = trackedHand.get('thumb-tip');
  const index = trackedHand.get('index-finger-tip');
  if (!thumb || !index) return;
  const thumbPose = frame.getJointPose?.(thumb, world.xrReferenceSpace);
  const indexPose = frame.getJointPose?.(index, world.xrReferenceSpace);
  if (!thumbPose || !indexPose) return;
  const a = thumbPose.transform.position;
  const b = indexPose.transform.position;
  const pinchDistance = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const pinching = pinchDistance < 0.027;
  if (pinching && !rightHandPinching && arenaActive && !arenaPaused && isShooterMode()) {
    world.camera.getWorldQuaternion(new Quaternion());
    handGunDirection.set(0, 0, -1).applyQuaternion(world.camera.getWorldQuaternion(new Quaternion())).normalize();
    fireFirstPersonGun(handGunDirection);
  }
  rightHandPinching = pinching;
});
function playRecordedGunshot() {
  // Generate the shot locally. No remote audio request or download is needed.
  playArenaSound('shot');
}
function isShooterMode() { return activeGameMode === 'drone-defense' || activeGameMode === 'last-stand' || activeGameMode === 'nightfall-survival'; }
function syncFirstPersonGun() { firstPersonGun.visible = isShooterMode(); }
function fireFirstPersonGun(direction?: Vector3) {
  if (!arenaActive || arenaPaused || !isShooterMode()) return;
  playRecordedGunshot();
  gunMuzzleFlash.visible = true;
  window.setTimeout(() => { gunMuzzleFlash.visible = false; }, 75);
  const origin = new Vector3();
  world.camera.getWorldPosition(origin);
  const shotDirection = direction?.clone().normalize() || new Vector3();
  if (!direction) world.camera.getWorldDirection(shotDirection);
  const tracer = new Mesh(new BoxGeometry(0.028, 0.028, 3.8), new MeshBasicMaterial({ color: 0xffd52a, toneMapped: false }));
  tracer.position.copy(origin).addScaledVector(shotDirection, 1.95);
  tracer.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), shotDirection);
  const tracerEntity = world.createTransformEntity(tracer, { persistent: true });
  window.setTimeout(() => {
    tracerEntity.destroy?.();
    tracer.parent?.remove(tracer);
    tracer.geometry.dispose();
    (tracer.material as MeshBasicMaterial).dispose();
  }, 95);
}
let arenaSeconds = 45;
let arenaDeadline = 0;
let arenaTimer: number | null = null;
const arenaMeshes = new Set<Mesh>();
const arenaEntities = new Map<Mesh, any>();
const arenaMotion = new Map<number, { x: number; y: number; z: number; phase: number; speed: number; drift: number; approachSpeed: number; attackClock: number }>();
const hostileShots: { mesh: Mesh; entity: any; velocity: Vector3; target: Vector3 }[] = [];
const raiderMixers = new Map<Mesh, AnimationMixer>();
const raiderModelUrls = [
  'https://cdn.3dassets.dev/assets/32901/v1/model.glb', // CC0 rigged scout with authored idle, walk, run and grasp clips
];
const raiderModelPromises: Promise<any>[] = [];
// Use the optimized built-in human raider for combat rounds. This avoids
// remote GLB downloads and keeps the weapon, arms and hands in one shared rig.
function attachAnimatedHumanRaider(_target: Mesh) {
  // Intentionally use the procedural soldier built in spawnArenaTarget().
}
let arenaAudio: AudioContext | null = null;
function playArenaSound(kind: 'shot' | 'hit' | 'damage' | 'start') {
  try {
    const AudioCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtor) return;
    arenaAudio ||= new AudioCtor();
    if (arenaAudio.state === 'suspended') void arenaAudio.resume();
    const ctx = arenaAudio;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    filter.type = 'lowpass';
    if (kind === 'shot') {
      // Punchy close-range rifle report: a short broadband crack plus a low
      // body thump. The noise buffer is created once and reused for every shot.
      let noiseBuffer = (ctx as any).__streamLinkGunNoise as AudioBuffer | undefined;
      if (!noiseBuffer) {
        noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.22), ctx.sampleRate);
        const samples = noiseBuffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * (1 - i / samples.length);
        (ctx as any).__streamLinkGunNoise = noiseBuffer;
      }
      const noise = ctx.createBufferSource(); noise.buffer = noiseBuffer;
      const crackFilter = ctx.createBiquadFilter(); crackFilter.type = 'highpass'; crackFilter.frequency.setValueAtTime(520, now);
      const crackGain = ctx.createGain(); crackGain.gain.setValueAtTime(0.0001, now); crackGain.gain.exponentialRampToValueAtTime(0.34, now + 0.004); crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.19);
      noise.connect(crackFilter); crackFilter.connect(crackGain); crackGain.connect(ctx.destination);
      osc.type = 'triangle'; osc.frequency.setValueAtTime(118, now); osc.frequency.exponentialRampToValueAtTime(38, now + 0.15);
      filter.type = 'lowpass'; filter.frequency.setValueAtTime(460, now);
      gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(0.24, now + 0.006); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);
      noise.start(now); noise.stop(now + 0.2); osc.start(now); osc.stop(now + 0.18);
    } else if (kind === 'hit') {
      osc.type = 'triangle'; osc.frequency.setValueAtTime(720, now); osc.frequency.exponentialRampToValueAtTime(260, now + 0.12);
      filter.frequency.value = 2400; gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(0.14, now + 0.008); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
      osc.start(now); osc.stop(now + 0.16);
    } else if (kind === 'damage') {
      osc.type = 'square'; osc.frequency.setValueAtTime(115, now); osc.frequency.exponentialRampToValueAtTime(42, now + 0.28);
      filter.frequency.value = 520; gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
      osc.start(now); osc.stop(now + 0.31);
    } else {
      osc.type = 'sine'; osc.frequency.setValueAtTime(330, now); osc.frequency.exponentialRampToValueAtTime(660, now + 0.22);
      filter.frequency.value = 1800; gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(0.10, now + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
      osc.start(now); osc.stop(now + 0.26);
    }
  } catch (error) { console.warn('[StreamLink arena audio]', error); }
}
const actionByEntity = new Map<number, string>();
const actionHandlers = new Map<string, () => void>();
const pressedTargets = new Set<number>();

const panelCanvas = document.createElement('canvas');
panelCanvas.width = 1024;
panelCanvas.height = 640;
const panelCtx = panelCanvas.getContext('2d');
if (!panelCtx) throw new Error('Could not create Quest Studio panel canvas');
const panelTexture = new CanvasTexture(panelCanvas);
const panelMaterial = new MeshBasicMaterial({ map: panelTexture, transparent: true });
const panelMesh = new Mesh(new PlaneGeometry(1.75, 1.10), panelMaterial);
panelMesh.userData.label = 'StreamLink Quest Studio control panel';
const panelEntity = world.createTransformEntity(panelMesh, { persistent: true });
panelEntity.object3D!.position.set(0, 1.5, -1.55);
panelEntity.addComponent(RayInteractable).addComponent(OneHandGrabbable, { rotate: true, translate: true });

const destinationPanelGroup = new Group();
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
const destinationPanelEntity = world.createTransformEntity(destinationPanelGroup, { persistent: true });
destinationPanelEntity.object3D!.position.set(1.25, 1.45, -1.55);

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
  ctx.fillText(activeGameMode === 'rift-racer' ? `DISTANCE ${Math.floor(raceDistance)}m   FBI LEVEL ${racePoliceLevel}   DAMAGE ${3-arenaShield}/3   TIME ${arenaSeconds}s` : `SCORE ${arenaScore}   WAVE ${arenaWave}   COMBO x${Math.min(5, 1 + Math.floor(Math.max(0, arenaCombo - 1) / 3))}   TIME ${arenaSeconds}s`, 48, 276);
  ctx.fillStyle = activeGameMode === 'drone-defense' || activeGameMode === 'last-stand' || activeGameMode === 'nightfall-survival' ? (arenaShield > 1 ? '#42e6a4' : '#ff668c') : '#8198c4';
  ctx.font = 'bold 22px Inter, sans-serif';
  ctx.fillText(activeGameMode === 'drone-defense' || activeGameMode === 'last-stand' || activeGameMode === 'nightfall-survival' ? `SHIELD INTEGRITY  ${'◆ '.repeat(arenaShield)}${'◇ '.repeat(3 - arenaShield)}` : 'ARCADE CHALLENGE · HIT TARGETS TO BUILD YOUR COMBO', 48, 306);
  ctx.fillStyle = '#aab8d2'; ctx.font = '21px Inter, sans-serif';
  ctx.fillText(`ARENA OBJECTIVE  ${arenaHits}/${arenaGoal} targets · best combo ${arenaBestCombo}`, 48, 330);
  ctx.fillText(activeGameMode==='rift-racer' ? 'FBI PURSUIT · A/D or arrows to change lanes · dodge police interceptors, traffic and roadblocks.' : (activeGameMode === 'nightfall-survival' || activeGameMode === 'last-stand') ? 'HOSTILES FIRE BACK · dodge red plasma shots and eliminate attackers with hand pinch.' : 'Track the enemies. Pinch or poke to strike; every 5 hits advances the wave.', 48, 365);
  ctx.fillText(`DESTINATIONS  ${selectedDestinationNames.size} selected · use ADD DEST to choose platforms`, 48, 410);
  const gameLabel = ({ 'rift-racer': 'FBI PURSUIT · survive a five-minute highway chase with escalating police units.', 'orb-rush': 'ORB RUSH · warm-up arcade challenge.', 'drone-defense': 'RIFT GUARD · protect the core from incoming attack craft.', 'meteor-blitz': 'METEOR BLITZ · smash the incoming meteor storm.', 'phantom-hunt': 'PHANTOM HUNT · precision shots on unstable spectres.', 'zero-g-rush': 'ZERO-G RUSH · chase spinning energy gates.', 'last-stand': 'LAST STAND · defend the core through enemy waves.', 'titan-breaker': 'TITAN BREAKER · smash the colossal targets before time runs out.', 'inferno-run': 'INFERNO RUN · intercept the firestorm before it reaches you.', 'nightfall-survival': 'NIGHTFALL SURVIVAL · hold the line against relentless night drones.' } as Record<string, string>)[activeGameMode];
  ctx.fillText(gameLabel, 48, 450);
  ctx.fillStyle = '#8198c4'; ctx.font = '18px Inter, sans-serif';
  ctx.fillText('MOVING TARGETS · hand pinch / controller trigger · combos multiply your score', 48, 605);
  panelTexture.needsUpdate = true;
}
function refreshQuestPanel() {
  drawQuestPanel();
  // Keep the floating creator/settings panel out of the player's sight during active gameplay.
  // Its hand controls return automatically when the round ends.
  panelMesh.visible = !arenaActive;
  if (arenaActive) destinationPanelGroup.visible = false;
}

function makeQuestButton(label: string, action: string, x: number, y: number, color: number, parent: any = panelEntity) {
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
  const mesh = new Mesh(new PlaneGeometry(0.38, 0.14), new MeshBasicMaterial({ map: texture, transparent: true }));
  mesh.userData.action = action;
  const entity = world.createTransformEntity(mesh, { parent });
  entity.object3D!.position.set(x, y - 1.45, 0.025);
  entity.addComponent(RayInteractable).addComponent(PokeInteractable).addComponent(QuestButton, { action });
  mesh.addEventListener('click', () => actionHandlers.get(action)?.());
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
    const entity = world.createTransformEntity(mesh, { parent: destinationPanelEntity });
    entity.object3D!.position.set(column === 0 ? -0.19 : 0.19, 0.25 - row * 0.145, 0.035);
    const action = `destination-toggle:${platform.name}`;
    entity.addComponent(RayInteractable).addComponent(PokeInteractable).addComponent(QuestButton, { action });
    actionByEntity.set(entity.index, action);
    mesh.addEventListener('click', () => actionHandlers.get(action)?.());
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
  const isSiege = activeGameMode === 'drone-defense' || activeGameMode === 'last-stand' || activeGameMode === 'nightfall-survival';
  const color = isSiege ? [0xff4d6d, 0xff8a3d, 0xffd166][Math.floor(Math.random() * 3)] : activeGameMode === 'meteor-blitz' ? [0xff5b35, 0xffc247, 0xff3d81][Math.floor(Math.random() * 3)] : activeGameMode === 'phantom-hunt' ? [0x9b5cff, 0xe45bff, 0x5d7cff][Math.floor(Math.random() * 3)] : activeGameMode === 'zero-g-rush' ? [0x19e6d2, 0x39a7ff, 0xf3e65c][Math.floor(Math.random() * 3)] : activeGameMode === 'titan-breaker' ? [0xffb000, 0xff542e, 0xffdf65][Math.floor(Math.random() * 3)] : activeGameMode === 'inferno-run' ? [0xff3b1f, 0xff8a24, 0xffd34e][Math.floor(Math.random() * 3)] : [0x31d6ff, 0x8b7bff, 0xffb84d, 0x42e6a4, 0xff668c][Math.floor(Math.random() * 5)];
  const isDrone = isSiege;
  const isGroundCombat = activeGameMode !== 'rift-racer';
  const targetRadius = activeGameMode === 'titan-breaker' ? 0.34 : activeGameMode === 'meteor-blitz' || activeGameMode === 'inferno-run' ? 0.135 : activeGameMode === 'phantom-hunt' ? 0.105 : Math.max(0.14, 0.24 - (arenaWave - 1) * 0.012);
  const spread = Math.min(1.35, 0.72 + (arenaWave - 1) * 0.08);
  const droneMaterial = new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.15, roughness: 0.2, metalness: 0.32 });
  const geometry = activeGameMode === 'titan-breaker'
    ? new BoxGeometry(0.68, 0.86, 0.38)
    : activeGameMode === 'inferno-run' || activeGameMode === 'meteor-blitz'
      ? new IcosahedronGeometry(targetRadius * 1.55, 1)
      : activeGameMode === 'phantom-hunt'
        ? new OctahedronGeometry(targetRadius * 1.65, 0)
        : isGroundCombat ? new BoxGeometry(0.48, 0.82, 0.34)
          : isDrone ? new BoxGeometry(0.34, 0.14, 0.24)
            : activeGameMode === 'zero-g-rush' ? new TorusGeometry(0.19, 0.065, 12, 28)
              : new SphereGeometry(targetRadius, 28, 20);
  const mesh = new Mesh(geometry, droneMaterial);
  if (activeGameMode === 'titan-breaker') {
    const armor = new MeshStandardMaterial({ color: 0x4c5268, metalness: 0.88, roughness: 0.22 });
    const eye = new Mesh(new SphereGeometry(0.09, 16, 12), new MeshBasicMaterial({ color: 0xff3b1f }));
    eye.position.set(0, 0.13, 0.22);
    mesh.add(eye);
    for (const side of [-1, 1]) {
      const arm = new Mesh(new BoxGeometry(0.2, 0.62, 0.22), armor);
      arm.position.set(side * 0.43, -0.08, 0);
      mesh.add(arm);
      const fist = new Mesh(new BoxGeometry(0.24, 0.22, 0.28), droneMaterial);
      fist.position.set(side * 0.45, -0.43, 0.02);
      mesh.add(fist);
    }
    const crown = new Mesh(new ConeGeometry(0.17, 0.3, 5), armor);
    crown.position.set(0, 0.56, 0);
    mesh.add(crown);
  }
  if (activeGameMode === 'inferno-run' || activeGameMode === 'meteor-blitz') {
    const flame = new Mesh(new ConeGeometry(targetRadius * 0.9, targetRadius * 2.5, 7), new MeshBasicMaterial({ color: 0xff5a18 }));
    flame.rotation.x = Math.PI / 2;
    flame.position.z = 0.2;
    mesh.add(flame);
  }
  if (activeGameMode === 'phantom-hunt') {
    const aura = new Mesh(new TorusGeometry(targetRadius * 1.8, 0.012, 6, 24), new MeshBasicMaterial({ color: 0xe45bff }));
    mesh.add(aura);
  }
  if (isGroundCombat) {
    // Human raiders: visible skin, faces, hair, tactical clothing and natural proportions.
    const skin = new MeshStandardMaterial({ color: 0xb87955, roughness: 0.82, metalness: 0.02 });
    const skinLight = new MeshStandardMaterial({ color: 0xd49a72, roughness: 0.86 });
    const clothing = new MeshStandardMaterial({ color: activeGameMode === 'nightfall-survival' ? 0x292b35 : 0x35483b, roughness: 0.9, metalness: 0.04 });
    const clothDark = new MeshStandardMaterial({ color: 0x171d24, roughness: 0.94 });
    const vest = new MeshStandardMaterial({ color: 0x5b4937, roughness: 0.86, metalness: 0.06 });
    const trim = new MeshStandardMaterial({ color: 0xb94d32, emissive: 0x351008, emissiveIntensity: 0.22, roughness: 0.65 });
    const eyeWhite = new MeshBasicMaterial({ color: 0xf2e7d6 });
    const pupil = new MeshBasicMaterial({ color: 0x171313 });

    // Torso, neck and head form a recognisably human silhouette.
    const torso = new Mesh(new SphereGeometry(0.31, 24, 18), clothing);
    torso.scale.set(0.86, 1.12, 0.58);
    torso.position.set(0, 0.03, 0); mesh.add(torso);
    const neck = new Mesh(new BoxGeometry(0.16, 0.16, 0.16), skin);
    neck.position.set(0, 0.39, 0.025); mesh.add(neck);
    const head = new Mesh(new SphereGeometry(0.205, 20, 16), skin);
    head.scale.set(0.88, 1.12, 0.92);
    head.position.set(0, 0.59, 0.035); mesh.add(head);
    const hair = new Mesh(new SphereGeometry(0.19, 16, 12), clothDark);
    hair.scale.set(1.02, 0.55, 1.02);
    hair.position.set(0, 0.735, 0.015); mesh.add(hair);
    const hairBack = new Mesh(new BoxGeometry(0.29, 0.18, 0.12), clothDark);
    hairBack.position.set(0, 0.62, -0.12); mesh.add(hairBack);
    for (const side of [-1, 1]) {
      const ear = new Mesh(new SphereGeometry(0.045, 10, 8), skinLight);
      ear.position.set(side * 0.18, 0.58, 0.025); mesh.add(ear);
      const brow = new Mesh(new SphereGeometry(0.043, 10, 8), clothDark);
      brow.scale.set(1.3, 0.32, 0.42); brow.position.set(side * 0.075, 0.675, 0.194); mesh.add(brow);
      const eye = new Mesh(new SphereGeometry(0.025, 10, 8), eyeWhite);
      eye.position.set(side * 0.075, 0.625, 0.205); mesh.add(eye);
      const iris = new Mesh(new SphereGeometry(0.012, 8, 6), pupil);
      iris.position.set(side * 0.075, 0.625, 0.227); mesh.add(iris);
      const shoulder = new Mesh(new SphereGeometry(0.14, 12, 10), clothing);
      shoulder.position.set(side * 0.29, 0.25, 0); mesh.add(shoulder);
      const thigh = new Mesh(new SphereGeometry(0.19, 14, 12), clothing);
      thigh.scale.set(0.72, 1.12, 0.78); thigh.position.set(side * 0.13, -0.43, 0); mesh.add(thigh);
      const lowerLeg = new Mesh(new SphereGeometry(0.155, 14, 12), clothDark);
      lowerLeg.scale.set(0.72, 1.15, 0.78); lowerLeg.position.set(side * 0.13, -0.72, 0.015); mesh.add(lowerLeg);
      const boot = new Mesh(new BoxGeometry(0.19, 0.13, 0.31), clothDark);
      boot.position.set(side * 0.13, -0.91, 0.07); mesh.add(boot);
    }

    // Chest rig, straps, pouches and belt make them read as human combatants.
    const rig = new Mesh(new BoxGeometry(0.39, 0.39, 0.075), vest);
    rig.position.set(0, 0.075, 0.17); mesh.add(rig);
    for (const side of [-1, 1]) {
      const pouch = new Mesh(new BoxGeometry(0.105, 0.13, 0.085), clothDark);
      pouch.position.set(side * 0.105, -0.035, 0.225); mesh.add(pouch);
    }
    const belt = new Mesh(new BoxGeometry(0.47, 0.09, 0.29), clothDark);
    belt.position.set(0, -0.22, 0); mesh.add(belt);

    // Slim, recognisable carbine silhouette with a separate stock, receiver,
    // handguard, sights, pistol grip, magazine and narrow muzzle.
    const enemyRifle = new Group();
    enemyRifle.position.set(0.20, 0.105, 0.20);
    const rifleBody = new Mesh(new BoxGeometry(0.085, 0.09, 0.40), clothDark);
    rifleBody.position.set(0, 0.015, 0.22); enemyRifle.add(rifleBody);
    const upperRail = new Mesh(new BoxGeometry(0.045, 0.025, 0.50), rifleMetal);
    upperRail.position.set(0, 0.067, 0.34); enemyRifle.add(upperRail);
    const handguard = new Mesh(new BoxGeometry(0.075, 0.075, 0.30), vest);
    handguard.position.set(0, 0.005, 0.53); enemyRifle.add(handguard);
    const barrel = new Mesh(new CylinderGeometry(0.014, 0.017, 0.38, 10), rifleMetal);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.015, 0.86); enemyRifle.add(barrel);
    const stock = new Mesh(new BoxGeometry(0.09, 0.105, 0.22), clothDark);
    stock.position.set(0, 0.005, -0.105); enemyRifle.add(stock);
    const grip = new Mesh(new BoxGeometry(0.055, 0.16, 0.075), clothDark);
    grip.position.set(0, -0.105, 0.16); grip.rotation.x = -0.20; enemyRifle.add(grip);
    const magazine = new Mesh(new BoxGeometry(0.06, 0.17, 0.085), rifleDark);
    magazine.position.set(0, -0.125, 0.32); magazine.rotation.x = -0.10; enemyRifle.add(magazine);
    const frontSight = new Mesh(new BoxGeometry(0.025, 0.07, 0.025), rifleMetal);
    frontSight.position.set(0, 0.105, 0.69); enemyRifle.add(frontSight);
    const rearSight = new Mesh(new BoxGeometry(0.045, 0.045, 0.035), rifleMetal);
    rearSight.position.set(0, 0.095, 0.10); enemyRifle.add(rearSight);
    const muzzle = new Mesh(new SphereGeometry(0.026, 10, 8), new MeshBasicMaterial({ color: 0xff542e }));
    muzzle.position.set(0, 0.015, 1.055); muzzle.visible = false; enemyRifle.add(muzzle);
    mesh.add(enemyRifle);
    mesh.userData.enemyRifle = enemyRifle;
    mesh.userData.muzzle = muzzle;

    // Arms are anchored at the shoulders; both gloved hands are children of
    // the rifle group and sit directly on the pistol grip and forward handguard.
    const armMaterial = clothing;
    const gloveMaterial = new MeshStandardMaterial({ color: 0x252b30, roughness: 0.92 });
    const addArmSegment = (from: Vector3, to: Vector3, radius: number) => {
      const delta = to.clone().sub(from);
      const segment = new Mesh(new CapsuleGeometry(radius, Math.max(0.025, delta.length() - radius * 2), 6, 10), armMaterial);
      segment.position.copy(from).add(to).multiplyScalar(0.5);
      segment.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize());
      mesh.add(segment);
    };
    const rightShoulder = new Vector3(0.29, 0.25, 0.01);
    const rightElbow = new Vector3(0.31, 0.12, 0.29);
    const rightHand = new Vector3(0, -0.055, 0.16);
    const leftShoulder = new Vector3(-0.29, 0.25, 0.01);
    const leftElbow = new Vector3(0.00, 0.12, 0.55);
    const leftHand = new Vector3(0, 0.005, 0.53);
    const rifleOrigin = enemyRifle.position.clone();
    const rightHandWorld = rifleOrigin.clone().add(rightHand);
    const leftHandWorld = rifleOrigin.clone().add(leftHand);
    addArmSegment(rightShoulder, rightElbow, 0.067);
    addArmSegment(rightElbow, rightHandWorld, 0.055);
    addArmSegment(leftShoulder, leftElbow, 0.067);
    addArmSegment(leftElbow, leftHandWorld, 0.055);
    const triggerHand = new Mesh(new SphereGeometry(0.052, 12, 10), gloveMaterial);
    triggerHand.position.copy(rightHand); enemyRifle.add(triggerHand);
    const supportHand = new Mesh(new SphereGeometry(0.052, 12, 10), gloveMaterial);
    supportHand.position.copy(leftHand); enemyRifle.add(supportHand);

    const nose = new Mesh(new SphereGeometry(0.035, 10, 8), skinLight);
    nose.scale.set(0.72, 1.2, 0.8); nose.position.set(0, 0.585, 0.226); mesh.add(nose);
    const mouth = new Mesh(new BoxGeometry(0.085, 0.018, 0.018), clothDark);
    mouth.position.set(0, 0.515, 0.218); mesh.add(mouth);
    mesh.userData.combatArms = [];
    mesh.userData.muzzle = muzzle;
    mesh.scale.setScalar(activeGameMode === 'nightfall-survival' || activeGameMode === 'last-stand' ? 1.12 : 1.0);
  }
  if (isDrone && !isGroundCombat) {
    if (activeGameMode === 'nightfall-survival') mesh.scale.setScalar(1.9);
    const wingMaterial = new MeshStandardMaterial({ color: 0xffb84d, emissive: 0xff4d6d, emissiveIntensity: 0.65, metalness: 0.45, roughness: 0.25 });
    for (const side of [-1, 1]) {
      const wing = new Mesh(new BoxGeometry(0.16, 0.045, 0.42), wingMaterial);
      wing.position.set(side * 0.22, 0, 0);
      mesh.add(wing);
    }
    const core = new Mesh(new SphereGeometry(activeGameMode === 'nightfall-survival' ? 0.13 : 0.105, 16, 12), new MeshBasicMaterial({ color: 0xffffff }));
    core.position.set(0, 0.015, 0.14);
    mesh.add(core);
    if (activeGameMode === 'nightfall-survival') {
      const nose = new Mesh(new ConeGeometry(0.12, 0.48, 8), new MeshStandardMaterial({ color: 0x9a173b, emissive: 0x5a061e, metalness: 0.7, roughness: 0.22 }));
      nose.rotation.x = -Math.PI / 2; nose.position.z = -0.27; mesh.add(nose);
      for (const side of [-1, 1]) {
        const engine = new Mesh(new BoxGeometry(0.11, 0.11, 0.28), new MeshBasicMaterial({ color: 0xff5a35 }));
        engine.rotation.x = Math.PI / 2; engine.position.set(side * 0.2, -0.02, 0.22); mesh.add(engine);
      }
    }
  }
  if (!isGroundCombat) {
    const ring = new Mesh(new TorusGeometry(isDrone ? 0.34 : 0.30, 0.018, 8, 40), new MeshBasicMaterial({ color: 0xffffff }));
    mesh.add(ring);
  }
  const entity = world.createTransformEntity(mesh, { persistent: true });
  if (isGroundCombat) attachAnimatedHumanRaider(mesh);
  // Keep runtime-spawned targets on the same persistent scene root as the arena shell.
  // This prevents ECS root visibility/lifecycle differences from hiding gameplay targets.
  const baseX = isGroundCombat ? (Math.floor(Math.random() * 3) - 1) * 1.65 : (Math.random() - 0.5) * spread * 3.2;
  const baseY = isGroundCombat ? 0.93 : 1.15 + Math.random() * 1.45;
  const baseZ = isGroundCombat ? -4.2 - Math.random() * 1.35 : -3.0 - Math.random() * 1.55;
  entity.object3D!.position.set(baseX, baseY, baseZ);
  entity.addComponent(RayInteractable).addComponent(PokeInteractable).addComponent(ArenaTarget);
  arenaMeshes.add(mesh);
  arenaEntities.set(mesh, entity);
  arenaMotion.set(entity.index, {
    x: baseX, y: baseY, z: baseZ,
    phase: Math.random() * Math.PI * 2,
    speed: isSiege ? 1.35 + arenaWave * 0.12 : activeGameMode === 'meteor-blitz' || activeGameMode === 'inferno-run' ? 2.0 + arenaWave * 0.16 : activeGameMode === 'titan-breaker' ? 1.7 + arenaWave * 0.14 : activeGameMode === 'phantom-hunt' ? 2.65 + arenaWave * 0.20 : activeGameMode === 'zero-g-rush' ? 2.35 + arenaWave * 0.18 : 0.85 + arenaWave * 0.08,
    drift: isGroundCombat ? 0.12 : isSiege ? 0.48 : activeGameMode === 'meteor-blitz' || activeGameMode === 'inferno-run' ? 0.62 : activeGameMode === 'titan-breaker' ? 0.35 : 0.30,
    approachSpeed: isGroundCombat ? (activeGameMode === 'nightfall-survival' || activeGameMode === 'last-stand' ? 0.92 + arenaWave * 0.12 : 0.72 + arenaWave * 0.10) : isSiege ? 0.34 + arenaWave * 0.035 : activeGameMode === 'meteor-blitz' ? 0.10 + arenaWave * 0.012 : activeGameMode === 'inferno-run' ? 0.19 + arenaWave * 0.022 : 0,
    attackClock: 0.45 + Math.random() * 1.2,
  });
  return entity;
}
function clearRaceTrack(){
 for(const item of raceObjects){item.entity?.destroy?.();item.mesh.parent?.remove(item.mesh);item.mesh.traverse((o:any)=>{if(o.isMesh){o.geometry?.dispose?.();if(Array.isArray(o.material))o.material.forEach((m:any)=>m.dispose());else o.material?.dispose?.();}});} raceObjects.length=0;
 for(const item of raceTrackMeshes){item.entity?.destroy?.();item.mesh.parent?.remove(item.mesh);item.mesh.traverse((o:any)=>{if(o.isMesh){o.geometry?.dispose?.();if(Array.isArray(o.material))o.material.forEach((m:any)=>m.dispose());else o.material?.dispose?.();}});} raceTrackMeshes.length=0;
 if(raceCarEntity)raceCarEntity.destroy?.(); if(raceCar){raceCar.parent?.remove(raceCar);raceCar.traverse((o:any)=>{if(o.isMesh){o.geometry?.dispose?.();(o.material as any)?.dispose?.();}});} raceCar=null;raceCarEntity=null;raceTrackActive=false;
}
function addRaceMesh(geometry:any,material:any,position:[number,number,number]){const mesh=new Mesh(geometry,material);const entity=world.createTransformEntity(mesh,{persistent:true});entity.object3D!.position.set(...position);raceTrackMeshes.push({mesh,entity});return mesh;}
function makeRoadCar(color:number,police=false){
 const car=new Group();const paint=new MeshStandardMaterial({color,metalness:.72,roughness:.24});const dark=new MeshStandardMaterial({color:0x101722,metalness:.35,roughness:.16});const glass=new MeshStandardMaterial({color:0x172b40,metalness:.45,roughness:.12});const rubber=new MeshStandardMaterial({color:0x090c11,roughness:.92});const chrome=new MeshStandardMaterial({color:0xb9c6d1,metalness:.9,roughness:.18});
 const body=new Mesh(new BoxGeometry(1.28,.34,2.45),paint);body.position.y=.48;car.add(body);const hood=new Mesh(new BoxGeometry(1.18,.12,.72),paint);hood.position.set(0,.69,-.78);car.add(hood);const cabin=new Mesh(new BoxGeometry(1.02,.48,1.12),glass);cabin.position.set(0,.88,.08);car.add(cabin);const roof=new Mesh(new BoxGeometry(.98,.08,.82),paint);roof.position.set(0,1.14,.08);car.add(roof);
 const bumperF=new Mesh(new BoxGeometry(1.3,.13,.16),chrome);bumperF.position.set(0,.34,-1.22);car.add(bumperF);const bumperR=new Mesh(new BoxGeometry(1.3,.13,.16),chrome);bumperR.position.set(0,.34,1.22);car.add(bumperR);
 const headMat=new MeshBasicMaterial({color:0xfff1bd,toneMapped:false});for(const x of [-.43,.43]){const head=new Mesh(new BoxGeometry(.22,.11,.035),headMat);head.position.set(x,.57,-1.245);car.add(head);const tail=new Mesh(new BoxGeometry(.2,.1,.035),new MeshBasicMaterial({color:0xff2020,toneMapped:false}));tail.position.set(x,.55,1.245);car.add(tail);}
 for(const x of [-.69,.69])for(const z of [-.82,.82]){const wheel=new Mesh(new TorusGeometry(.235,.095,10,20),rubber);wheel.rotation.y=Math.PI/2;wheel.position.set(x,.31,z);car.add(wheel);const hub=new Mesh(new TorusGeometry(.105,.025,8,16),chrome);hub.rotation.y=Math.PI/2;hub.position.set(x*1.005,.31,z);car.add(hub);}
 if(police){const bar=new Mesh(new BoxGeometry(.76,.1,.2),dark);bar.position.set(0,1.22,.12);car.add(bar);const red=new Mesh(new BoxGeometry(.31,.12,.17),new MeshBasicMaterial({color:0xff142b,toneMapped:false}));red.position.set(-.2,1.3,.12);red.userData.siren='red';car.add(red);const blue=new Mesh(new BoxGeometry(.31,.12,.17),new MeshBasicMaterial({color:0x167bff,toneMapped:false}));blue.position.set(.2,1.3,.12);blue.userData.siren='blue';car.add(blue);}
 car.userData.police=police;return car;
}
function buildRaceTrack(){
 clearRaceTrack();raceTrackActive=true;const asphalt=new MeshStandardMaterial({color:0x292e35,roughness:.96});const concrete=new MeshStandardMaterial({color:0x929aa3,roughness:.88});const lanePaint=new MeshBasicMaterial({color:0xf4f0d9});const barrier=new MeshStandardMaterial({color:0xb9c1c9,metalness:.25,roughness:.8});
 addRaceMesh(new BoxGeometry(10.8,.16,52),asphalt,[0,-.14,-15]);addRaceMesh(new BoxGeometry(1.3,.12,52),concrete,[-6.05,-.19,-15]);addRaceMesh(new BoxGeometry(1.3,.12,52),concrete,[6.05,-.19,-15]);addRaceMesh(new BoxGeometry(.18,.62,52),barrier,[-5.35,.12,-15]);addRaceMesh(new BoxGeometry(.18,.62,52),barrier,[5.35,.12,-15]);
 for(let z=4;z>-54;z-=5){for(const x of [-1.8,1.8]){const dash=addRaceMesh(new BoxGeometry(.12,.025,2.2),lanePaint,[x,-.045,z]);dash.userData.scroll=true;}for(const x of [-6.3,6.3]){const post=addRaceMesh(new BoxGeometry(.14,1.25,.14),barrier,[x,.58,z]);post.userData.scroll=true;}}
 for(const side of [-1,1]){for(let z=-4;z>-52;z-=12){const trunk=addRaceMesh(new BoxGeometry(.24,2.1,.24),new MeshStandardMaterial({color:0x554b3e}),[side*8.4,1,z]);trunk.userData.scroll=true;const crown=addRaceMesh(new ConeGeometry(1.15,2.8,7),new MeshStandardMaterial({color:0x234b36,roughness:1}),[side*8.4,3.25,z]);crown.userData.scroll=true;}}
 const car=makeRoadCar(0x087fe8);raceCar=car;raceCarEntity=world.createTransformEntity(car,{persistent:true});raceCarEntity.addComponent(ArenaTarget);car.position.set(0,.02,1.8);
}
function spawnRaceObstacle(){if(!raceTrackActive)return;const policeChance=Math.min(.58,.18+racePoliceLevel*.045);const roll=Math.random();const kind: 'traffic'|'police'|'roadblock'=roll<policeChance?'police':roll>.91?'roadblock':'traffic';const lane=Math.floor(Math.random()*3);const color=kind==='police'?0xe9edf2:[0xb82d35,0x222d3c,0xd9dce0,0x1e765e,0xd18a27][Math.floor(Math.random()*5)];const mesh=kind==='roadblock'?new Group():makeRoadCar(color,kind==='police');if(kind==='roadblock'){const block=new Mesh(new BoxGeometry(2.4,.75,.6),new MeshStandardMaterial({color:0xf3a21b,roughness:.7}));block.position.y=.42;mesh.add(block);for(let x=-.8;x<=.8;x+=.8){const stripe=new Mesh(new BoxGeometry(.34,.78,.63),new MeshBasicMaterial({color:0x20252d}));stripe.position.x=x;mesh.add(stripe);}}mesh.position.set((lane-1)*3.6,.02,-42);const entity=world.createTransformEntity(mesh,{persistent:true});raceObjects.push({mesh,entity,lane,speed:kind==='police'?16+racePoliceLevel*1.3:kind==='roadblock'?15:12+Math.random()*3,passed:false,kind});}
function steerRace(direction:number){if(!arenaActive||activeGameMode!=='rift-racer'||arenaPaused)return;raceLane=Math.max(0,Math.min(2,raceLane+direction));if(raceCar)raceCar.position.x=(raceLane-1)*3.6;refreshQuestPanel();}
function startRiftRacer(){if(arenaActive)stopArena('Previous game ended');activeGameMode='rift-racer';syncFirstPersonGun();arenaActive=true;arenaPaused=false;arenaScore=0;arenaHits=0;arenaCombo=0;arenaBestCombo=0;arenaWave=1;arenaShield=3;arenaGoal=999;arenaSeconds=300;arenaDeadline=Date.now()+300000;raceLane=1;raceDistance=0;raceSpawnClock=0;racePoliceLevel=1;clearArena();buildRaceTrack();for(let i=0;i<5;i++){spawnRaceObstacle();raceObjects[raceObjects.length-1].mesh.position.z=-12-i*6;}if(arenaTimer!==null)window.clearInterval(arenaTimer);arenaTimer=window.setInterval(()=>{arenaSeconds=Math.max(0,Math.ceil((arenaDeadline-Date.now())/1000));if(arenaSeconds<=0)stopArena('FIVE-MINUTE PURSUIT SURVIVED');else refreshQuestPanel();},250);playArenaSound('start');statusText('FBI PURSUIT · 5 MINUTES · Arrow keys / A-D or drag to change lanes. Dodge traffic, roadblocks and flashing FBI interceptors. Three collisions end the chase.');refreshQuestPanel();}
function clearArena() {
  detailedRaiderCount = 0;
  for (const mesh of arenaMeshes) {
    const entity = arenaEntities.get(mesh);
    if (entity) arenaMotion.delete(entity.index);
    entity?.destroy?.();
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
  for (const shot of hostileShots) { shot.entity?.destroy?.(); shot.mesh.parent?.remove(shot.mesh); shot.mesh.geometry.dispose(); (shot.mesh.material as MeshBasicMaterial).dispose(); }
  hostileShots.length = 0;
  clearRaceTrack();
}
function hitArenaTarget(entity: any) {
  if (!arenaActive || arenaPaused || pressedTargets.has(entity.index)) return;
  pressedTargets.add(entity.index);
  const mesh = entity.object3D as Mesh | undefined;
  if (mesh) {
    arenaMeshes.delete(mesh);
    raiderMixers.get(mesh)?.stopAllAction();
    raiderMixers.delete(mesh);
    arenaMotion.delete(entity.index);
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
  if (isShooterMode()) playArenaSound('hit');
  arenaCombo += 1;
  arenaBestCombo = Math.max(arenaBestCombo, arenaCombo);
  const multiplier = Math.min(5, 1 + Math.floor((arenaCombo - 1) / 3));
  const precisionBonus = activeGameMode === 'titan-breaker' ? 30 : activeGameMode === 'phantom-hunt' ? 25 : activeGameMode === 'zero-g-rush' ? 15 : 10;
  const points = precisionBonus * multiplier;
  arenaScore += points;
  if (arenaHits % 5 === 0 && arenaHits < arenaGoal) {
    arenaWave += 1;
    arenaCombo = 0;
    statusText(`Wave ${arenaWave}! Targets are faster and more spread out. Score: ${arenaScore}`);
  } else {
    statusText(`Direct hit! +${points} · combo x${multiplier} · ${arenaHits}/${arenaGoal}`);
  }
  if (arenaHits >= arenaGoal) statusText(`OBJECTIVE REACHED · ${arenaHits} hits! Keep playing until the 2-minute round ends.`);
  spawnArenaTarget();
  refreshQuestPanel();
}

function breachArenaTarget(entity: any) {
  if (!arenaActive || arenaPaused) return;
  const mesh = entity.object3D as Mesh | undefined;
  if (mesh) {
    arenaMeshes.delete(mesh);
    raiderMixers.get(mesh)?.stopAllAction();
    raiderMixers.delete(mesh);
    arenaMotion.delete(entity.index);
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
  arenaShield = Math.max(0, arenaShield - 1);
  playArenaSound('damage');
  arenaCombo = 0;
  if (arenaShield <= 0) {
    statusText('SHIELDS DOWN · keep fighting until the full 2-minute round ends!');
  } else {
    statusText(`DRONE BREACH · shield ${arenaShield}/3 · intercept the next wave!`);
  }
  spawnArenaTarget();
  refreshQuestPanel();
}

function stopArena(message = 'Arena complete') {
  arenaActive = false;
  arenaPaused = false;
  if (arenaTimer !== null) window.clearInterval(arenaTimer);
  arenaTimer = null;
  clearArena();
  statusText(`${message} · score ${arenaScore} · ${arenaHits}/${arenaGoal} targets · best combo ${arenaBestCombo}`);
  refreshQuestPanel();
}
function startArena() {
  if (arenaActive) { stopArena('Arena stopped'); return; }
  activeGameMode = 'orb-rush';
  syncFirstPersonGun();
  arenaShield = 3;
  arenaGoal = 15;
  arenaActive = true;
  arenaPaused = false;
  arenaScore = 0;
  arenaHits = 0;
  arenaCombo = 0;
  arenaBestCombo = 0;
  arenaWave = 1;
  arenaSeconds = 120;
  arenaDeadline = Date.now() + 120000;
  clearArena();
  for (let i = 0; i < 5; i++) spawnArenaTarget();
  if (arenaTimer !== null) window.clearInterval(arenaTimer);
  arenaTimer = window.setInterval(() => {
    arenaSeconds = Math.max(0, Math.ceil((arenaDeadline - Date.now()) / 1000));
    if (arenaSeconds <= 0) stopArena('Time is up');
    else refreshQuestPanel();
  }, 250);
  playArenaSound('start');
  statusText(`VR Arena started · 2-minute minimum round. Build combos and keep playing until the timer ends.`);
  refreshQuestPanel();
}
function startDroneDefense() {
  if (arenaActive) stopArena('Previous game ended');
  activeGameMode = 'drone-defense';
  syncFirstPersonGun();
  arenaShield = 3;
  arenaGoal = 20;
  arenaActive = true;
  arenaPaused = false;
  arenaScore = 0; arenaHits = 0; arenaCombo = 0; arenaBestCombo = 0; arenaWave = 1;
  arenaSeconds = 120; arenaDeadline = Date.now() + 120000;
  clearArena();
  for (let i = 0; i < 6; i++) spawnArenaTarget();
  if (arenaTimer !== null) window.clearInterval(arenaTimer);
  arenaTimer = window.setInterval(() => {
    arenaSeconds = Math.max(0, Math.ceil((arenaDeadline - Date.now()) / 1000));
    if (arenaSeconds <= 0) stopArena('Defense time expired'); else refreshQuestPanel();
  }, 250);
  playArenaSound('start');
  statusText('RIFT GUARD ONLINE · 2-minute defense. Intercept attack craft before they breach the core.');
  refreshQuestPanel();
}
function startMeteorBlitz() {
  if (arenaActive) stopArena('Previous game ended');
  activeGameMode = 'meteor-blitz';
  arenaShield = 3;
  arenaGoal = 30;
  arenaActive = true;
  arenaPaused = false;
  arenaScore = 0; arenaHits = 0; arenaCombo = 0; arenaBestCombo = 0; arenaWave = 1;
  arenaSeconds = 120; arenaDeadline = Date.now() + 120000;
  clearArena();
  for (let i = 0; i < 8; i++) spawnArenaTarget();
  if (arenaTimer !== null) window.clearInterval(arenaTimer);
  arenaTimer = window.setInterval(() => {
    arenaSeconds = Math.max(0, Math.ceil((arenaDeadline - Date.now()) / 1000));
    if (arenaSeconds <= 0) stopArena('Meteor storm survived'); else refreshQuestPanel();
  }, 250);
  playArenaSound('start');
  statusText('METEOR BLITZ · 2-minute meteor storm. Smash incoming meteors and keep your combo alive!');
  refreshQuestPanel();
}
function startExtraGame(mode: 'phantom-hunt' | 'zero-g-rush' | 'last-stand' | 'titan-breaker' | 'inferno-run' | 'nightfall-survival') {
  if (arenaActive) stopArena('Previous game ended');
  activeGameMode = mode;
  syncFirstPersonGun();
  const config = mode === 'phantom-hunt'
    ? { goal: 18, seconds: 120, targets: 6, intro: 'PHANTOM HUNT · 2-minute hunt. Track unstable spectres and chain precision hits!' }
    : mode === 'zero-g-rush'
      ? { goal: 35, seconds: 120, targets: 9, intro: 'ZERO-G RUSH · 2-minute run. Chase spinning energy gates and keep moving!' }
      : mode === 'last-stand'
        ? { goal: 65, seconds: 180, targets: 9, intro: 'LAST STAND · survive a 3-minute assault. Armed raiders push your position in escalating waves. Take them down and dodge incoming fire!' }
        : mode === 'titan-breaker'
          ? { goal: 18, seconds: 120, targets: 4, intro: 'TITAN BREAKER · 2-minute battle. Smash colossal targets with heavy impact!' }
          : mode === 'inferno-run'
            ? { goal: 30, seconds: 120, targets: 8, intro: 'INFERNO RUN · survive a 2-minute firestorm and intercept blazing meteors!' }
            : { goal: 90, seconds: 180, targets: 10, intro: 'NIGHTFALL SURVIVAL · survive a 3-minute raid. Human soldiers advance in escalating waves and fire at your position. Eliminate 90 hostiles and dodge incoming shots!' };
  arenaShield = 3; arenaGoal = config.goal; arenaActive = true; arenaPaused = false;
  arenaScore = 0; arenaHits = 0; arenaCombo = 0; arenaBestCombo = 0; arenaWave = 1;
  arenaSeconds = config.seconds; arenaDeadline = Date.now() + config.seconds * 1000;
  clearArena();
  for (let i = 0; i < config.targets; i++) spawnArenaTarget();
  if (arenaTimer !== null) window.clearInterval(arenaTimer);
  arenaTimer = window.setInterval(() => {
    arenaSeconds = Math.max(0, Math.ceil((arenaDeadline - Date.now()) / 1000));
    if (arenaSeconds <= 0) stopArena(mode === 'last-stand' || mode === 'nightfall-survival' ? 'SURVIVAL COMPLETE' : 'Challenge complete');
    else refreshQuestPanel();
  }, 250);
  playArenaSound('start');
  statusText(config.intro);
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
registerQuestAction('rift-racer',startRiftRacer);
registerQuestAction('race-left',()=>steerRace(-1));
registerQuestAction('race-right',()=>steerRace(1));
const gameModes = ['orb-rush','drone-defense','meteor-blitz','phantom-hunt','zero-g-rush','last-stand','titan-breaker','inferno-run','nightfall-survival','rift-racer'] as const;
registerQuestAction('next-game', () => {
  const current = gameModes.indexOf(activeGameMode as typeof gameModes[number]);
  const next = gameModes[(current + 1) % gameModes.length];
  const selector = byId<HTMLSelectElement>('game-select');
  if (selector) selector.value = next;
  if (next === 'rift-racer') startRiftRacer();
  else if (next === 'orb-rush') startArena();
  else if (next === 'drone-defense') startDroneDefense();
  else if (next === 'meteor-blitz') startMeteorBlitz();
  else startExtraGame(next);
  statusText(`GAME SELECTED · ${next.replace(/-/g, ' ').toUpperCase()} · use the game dropdown on desktop to jump directly to any mode.`);
});
registerQuestAction('drone-defense', startDroneDefense);
registerQuestAction('meteor-blitz', startMeteorBlitz);
registerQuestAction('phantom-hunt', () => startExtraGame('phantom-hunt'));
registerQuestAction('zero-g-rush', () => startExtraGame('zero-g-rush'));
registerQuestAction('last-stand', () => startExtraGame('last-stand'));
registerQuestAction('titan-breaker', () => startExtraGame('titan-breaker'));
registerQuestAction('inferno-run', () => startExtraGame('inferno-run'));
registerQuestAction('nightfall-survival', () => startExtraGame('nightfall-survival'));
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
    panelMesh.position.set(0, 1.35, -1.25);
    panelMesh.scale.setScalar(0.86);
    destinationPanelGroup.position.set(1.25, 1.35, -1.25);
    destinationPanelGroup.scale.setScalar(0.86);
    statusText('Seated comfort on · controls moved closer and lowered for seated reach.');
  } else {
    panelMesh.position.set(0, 1.5, -1.55);
    panelMesh.scale.setScalar(1);
    destinationPanelGroup.position.set(1.25, 1.45, -1.55);
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
  panelMesh.position.set(0, 1.5, -1.55);
  panelMesh.rotation.set(0, 0, 0);
  panelMesh.scale.setScalar(1);
  comfortMode = false;
  destinationPanelGroup.position.set(1.25, 1.45, -1.55);
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

makeQuestButton('GO LIVE / STOP', 'stream', -0.42, 1.25, 0x42e6a4);
makeQuestButton('QUALITY', 'quality', 0, 1.25, 0x31d6ff);
makeQuestButton('GAME SELECT', 'next-game', 0.42, 1.25, 0xffb84d);
makeQuestButton('FOCUS', 'focus', -0.42, 1.10, 0x8b7bff);
makeQuestButton('COMFORT', 'comfort', 0, 1.10, 0x42e6a4);
makeQuestButton('RESET', 'reset', 0.42, 1.10, 0xff668c);
makeQuestButton('PAUSE', 'pause', -0.51, 1.00, 0xffb84d);
makeQuestButton('DEST', 'destination', -0.17, 1.00, 0x31d6ff);
makeQuestButton('NEXT GAME', 'next-game', 0.17, 1.00, 0x31d6ff);
makeQuestButton('DONE', 'destination', 0, 1.10, 0x42e6a4, destinationPanelEntity);
makeQuestButton('STEER LEFT','race-left',-0.45,0.82,0x31d6ff);
makeQuestButton('STEER RIGHT','race-right',0.45,0.82,0xffb84d);

// Desktop preview controls provide mouse-accessible equivalents to the 3D hand buttons.
byId<HTMLButtonElement>('desktop-pause')?.addEventListener('click', () => actionHandlers.get('pause')?.());
byId<HTMLButtonElement>('desktop-reset')?.addEventListener('click', () => actionHandlers.get('reset')?.());
// Desktop controls: IWSDK's browserControls binding handles WASD/arrow movement
// through its locomotion engine and moves world.player (not the headset camera).
// Keep L as the desktop fire key; racing retains its dedicated lane steering.
window.addEventListener('keydown',(event)=>{
  const key=event.key.toLowerCase();
  const target=event.target as HTMLElement|null;
  const typing=!!target&&(['INPUT','TEXTAREA','SELECT'].includes(target.tagName)||target.isContentEditable);
  if(typing)return;
  if(key==='l'&&!event.repeat&&arenaActive&&!arenaPaused){event.preventDefault();fireFirstPersonGun();}
  if(activeGameMode==='rift-racer'&&arenaActive&&!arenaPaused){
    if(event.key==='ArrowLeft'||key==='a'){event.preventDefault();steerRace(-1);}
    if(event.key==='ArrowRight'||key==='d'){event.preventDefault();steerRace(1);}
  }
});
// Desktop mouse/touch drag lets players physically reposition and aim the first-person rifle.
let gunDragPointer:number|null=null;
let gunDragLastX=0, gunDragLastY=0;
container.addEventListener('pointerdown',(event)=>{
  if(!arenaActive||!isShooterMode()||!firstPersonGun.visible)return;
  gunDragPointer=event.pointerId;
  gunDragLastX=event.clientX; gunDragLastY=event.clientY;
  try{container.setPointerCapture(event.pointerId);}catch{}
});
container.addEventListener('pointermove',(event)=>{
  if(gunDragPointer!==event.pointerId)return;
  const dx=event.clientX-gunDragLastX, dy=event.clientY-gunDragLastY;
  gunDragLastX=event.clientX; gunDragLastY=event.clientY;
  firstPersonGun.position.x=Math.max(-0.42,Math.min(0.62,firstPersonGun.position.x+dx*0.0024));
  firstPersonGun.position.y=Math.max(-0.62,Math.min(-0.12,firstPersonGun.position.y-dy*0.0024));
  firstPersonGun.rotation.y=Math.max(-0.48,Math.min(0.48,firstPersonGun.rotation.y-dx*0.0018));
  firstPersonGun.rotation.x=Math.max(-0.28,Math.min(0.28,firstPersonGun.rotation.x-dy*0.0018));
});
const releaseGunDrag=(event:PointerEvent)=>{
  if(gunDragPointer!==event.pointerId)return;
  gunDragPointer=null;
};
container.addEventListener('pointerup',releaseGunDrag);
container.addEventListener('pointercancel',releaseGunDrag);
let raceDragX:number|null=null;
container.addEventListener('pointerdown',(event)=>{if(activeGameMode==='rift-racer'&&arenaActive)raceDragX=event.clientX;});
container.addEventListener('pointerup',(event)=>{if(raceDragX!==null&&activeGameMode==='rift-racer'&&arenaActive){const dx=event.clientX-raceDragX;if(Math.abs(dx)>22)steerRace(dx>0?1:-1);raceDragX=null;}});
byId<HTMLSelectElement>('game-select')?.addEventListener('change', (event) => {
  const mode = (event.currentTarget as HTMLSelectElement).value;
  if (mode === 'drone-defense') actionHandlers.get('drone-defense')?.();
  else if (mode === 'meteor-blitz') actionHandlers.get('meteor-blitz')?.();
  else if (mode === 'phantom-hunt') actionHandlers.get('phantom-hunt')?.();
  else if (mode === 'zero-g-rush') actionHandlers.get('zero-g-rush')?.();
  else if (mode === 'last-stand') actionHandlers.get('last-stand')?.();
  else if (mode === 'titan-breaker') actionHandlers.get('titan-breaker')?.();
  else if (mode === 'inferno-run') actionHandlers.get('inferno-run')?.();
  else if (mode === 'nightfall-survival') actionHandlers.get('nightfall-survival')?.();
  else if (mode === 'rift-racer') actionHandlers.get('rift-racer')?.();
  else actionHandlers.get('arena')?.();
});
refreshDestinationButtons();
platformList?.addEventListener('input', refreshDestinationButtons);

class QuestInteractionSystem extends createSystem({
  targets: { required: [ArenaTarget, Pressed] },
}) {
  update() {
    this.queries.targets.entities.forEach((entity: any) => {
      hitArenaTarget(entity);
    });
    const currentlyHit = new Set<number>();
    this.queries.targets.entities.forEach((entity: any) => currentlyHit.add(entity.index));
    for (const id of pressedTargets) if (!currentlyHit.has(id)) pressedTargets.delete(id);
  }
}
world.registerSystem(QuestInteractionSystem);

// Desktop mouse fallback: aim with the pointer and click directly on a glowing target.
// This uses the same scoring and target cleanup as Quest hand/controller interaction.
const desktopRaycaster = new Raycaster();
const desktopPointer = new Vector2();
container.addEventListener('pointerdown', (event: PointerEvent) => {
  if (event.button !== 0 || !arenaActive || arenaPaused) return;
  const canvas = container.querySelector('canvas');
  if (!canvas) return;
  const bounds = canvas.getBoundingClientRect();
  desktopPointer.set(
    ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
    -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
  );
  desktopRaycaster.setFromCamera(desktopPointer, world.camera);
  if (isShooterMode()) fireFirstPersonGun(desktopRaycaster.ray.direction);
  const intersections = desktopRaycaster.intersectObjects([...arenaMeshes], true);
  if (!intersections.length) return;
  let target: any = intersections[0].object;
  while (target && !arenaEntities.has(target)) target = target.parent;
  if (!target) return;
  const entity = arenaEntities.get(target as Mesh);
  if (entity) hitArenaTarget(entity);
});
container.style.cursor = 'crosshair';


// Animate every live target so the arena feels like an active arcade game.
// Targets drift across the play space, bob vertically, rotate and pulse.
class ArenaMotionSystem extends createSystem({
  targets: { required: [ArenaTarget] },
}) {
  update() {
    const time = performance.now() / 1000;
    const delta = Math.min(0.05, Math.max(0, time - arenaLastFrameTime));
    for (const mixer of raiderMixers.values()) mixer.update(delta);
    arenaLastFrameTime = time;
    if (!arenaActive || arenaPaused) return;
    if(activeGameMode==='rift-racer'&&raceTrackActive){
 raceDistance+=delta*(42+racePoliceLevel*3);raceSpawnClock+=delta;racePoliceLevel=1+Math.floor(raceDistance/850);if(raceSpawnClock>Math.max(.62,1.35-racePoliceLevel*.075)){raceSpawnClock=0;spawnRaceObstacle();}
 for(const part of raceTrackMeshes){if(part.mesh.userData.scroll){part.mesh.position.z+=delta*(14+racePoliceLevel*1.2);if(part.mesh.position.z>7)part.mesh.position.z-=58;}}
 if(raceCar){raceCar.position.x+=(raceLane-1)*3.6;raceCar.rotation.z+=((raceLane-1)*-.09-raceCar.rotation.z)*Math.min(1,delta*6);}
 for(let i=raceObjects.length-1;i>=0;i--){const item=raceObjects[i];item.mesh.position.z+=item.speed*delta;if(item.kind==='police'){item.mesh.children.forEach((part:any)=>{if(part.userData.siren)part.visible=part.userData.siren==='red'?Math.sin(time*18)>0:Math.sin(time*18)<=0;});}
 if(!item.passed&&item.mesh.position.z>1.05){item.passed=true;if(item.lane===raceLane){arenaShield=Math.max(0,arenaShield-1);arenaCombo=0;playArenaSound('damage');statusText((item.kind==='police'?'FBI INTERCEPTOR HIT':'COLLISION')+' · damage '+(3-arenaShield)+'/3');if(arenaShield<=0){statusText('VEHICLE CRITICAL · keep driving! The full 5-minute pursuit continues.');}}else{arenaScore+=item.kind==='police'?350:item.kind==='roadblock'?250:150;arenaHits++;arenaCombo++;arenaBestCombo=Math.max(arenaBestCombo,arenaCombo);if(item.kind==='police')statusText('FBI INTERCEPTOR DODGED · +350');}item.entity?.destroy?.();item.mesh.parent?.remove(item.mesh);item.mesh.traverse((o:any)=>{if(o.isMesh){o.geometry?.dispose?.();if(Array.isArray(o.material))o.material.forEach((m:any)=>m.dispose());else o.material?.dispose?.();}});raceObjects.splice(i,1);}else if(item.mesh.position.z>5){item.entity?.destroy?.();item.mesh.parent?.remove(item.mesh);item.mesh.traverse((o:any)=>{if(o.isMesh){o.geometry?.dispose?.();if(Array.isArray(o.material))o.material.forEach((m:any)=>m.dispose());else o.material?.dispose?.();}});raceObjects.splice(i,1);}}
 if(Math.floor(raceDistance/850)+1>arenaWave){arenaWave=Math.floor(raceDistance/850)+1;statusText('PURSUIT ESCALATING · FBI units increasing · survive!');}refreshQuestPanel();return;
}
    this.queries.targets.entities.forEach((entity: any) => {
      const mesh = entity.object3D as Mesh | undefined;
      const motion = arenaMotion.get(entity.index);
      if (!mesh || !motion) return;
      const groundCombat = activeGameMode !== 'rift-racer';
      if (groundCombat) {
        // Enemies advance along the floor toward the player. Their feet stay planted;
        // no bobbing, hovering or orbiting target motion is used in these modes.
        motion.z += motion.approachSpeed * delta;
        const laneSway = Math.sin(time * 1.25 + motion.phase) * motion.drift;
        mesh.position.set(motion.x + laneSway, motion.y, motion.z);
        mesh.rotation.y = Math.atan2(-mesh.position.x, 4.8) + Math.sin(time * 1.7 + motion.phase) * 0.06;
        const raider = mesh.userData.raiderModel as Group | undefined;
        if (raider) {
          // Keep the boots planted at the imported model's measured floor offset.
          // Authored walk/run animation (when supplied by the model) moves the legs;
          // only a tiny torso sway is added here, never a vertical hover/bob.
          raider.position.y = raider.userData.floorAlignedY ?? raider.position.y;
          raider.rotation.z = Math.sin(time * 5.8 + motion.phase) * 0.008;
          if (!raider.userData.hasWalkClip) {
            const phase = time * (4.8 + motion.approachSpeed * 0.55) + motion.phase;
            const stride = Math.sin(phase);
            const bend = Math.max(0, Math.cos(phase));
            const bones = raider.userData.walkBones as any[] | undefined;
            bones?.forEach(({ bone, rest, side, role }) => {
              let angle = 0;
              if (role === 'thigh') angle = stride * 0.48 * side;
              else if (role === 'shin') angle = bend * 0.58 * (side === (stride > 0 ? 1 : -1) ? 1 : 0.18);
              else if (role === 'arm') angle = -stride * 0.22 * side;
              bone.quaternion.copy(rest).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), angle));
            });
          }
        }
        const muzzle = mesh.userData.muzzle as Mesh | undefined;
        if (muzzle) muzzle.visible = Math.sin(time * 16 + motion.phase) > 0.82;
        if (isShooterMode()) {
          motion.attackClock += delta;
          if (motion.attackClock >= 1.65 + Math.random() * 1.15) {
            motion.attackClock = 0;
            // Aim each hostile round at the player's current headset/camera position.
            // Use world coordinates so the projectile visibly travels from the rifle muzzle to the player.
            world.scene.updateMatrixWorld(true);
            const muzzle = mesh.userData.muzzle as Mesh | undefined;
            if (!muzzle) return;
            const muzzleWorld = new Vector3();
            muzzle.getWorldPosition(muzzleWorld);
            const targetWorld = new Vector3();
            world.camera.getWorldPosition(targetWorld);
            targetWorld.y -= 0.28;
            const direction = targetWorld.clone().sub(muzzleWorld).normalize();
            const shot = new Mesh(new BoxGeometry(0.105, 0.105, 0.62), new MeshBasicMaterial({ color: 0xffd52a, toneMapped: false }));
            const tracerGlow = new Mesh(new SphereGeometry(0.105, 12, 10), new MeshBasicMaterial({ color: 0xff5a08, transparent: true, opacity: 0.82, toneMapped: false }));
            tracerGlow.position.z = 0.24;
            shot.add(tracerGlow);
            shot.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), direction);
            const shotEntity = world.createTransformEntity(shot, { persistent: true });
            shotEntity.object3D!.position.copy(muzzleWorld);
            hostileShots.push({ mesh: shot, entity: shotEntity, velocity: direction.multiplyScalar(8.5 + arenaWave * 0.35), target: targetWorld });
            muzzle.visible = true;
            window.setTimeout(() => { muzzle.visible = false; }, 105);
            playArenaSound('shot');
          }
        }
        if (motion.z >= 1.05) { breachArenaTarget(entity); return; }
        return;
      }
      // All non-racing modes are handled by the grounded enemy movement above.
    });
    for (let i = hostileShots.length - 1; i >= 0; i--) {
      const shot = hostileShots[i];
      shot.mesh.position.addScaledVector(shot.velocity, delta);
      shot.mesh.scale.setScalar(1 + Math.sin(time * 22 + i) * 0.12);
      const distanceToPlayer = shot.mesh.position.distanceTo(shot.target);
      const travelledPastTarget = shot.mesh.position.clone().sub(shot.target).dot(shot.velocity) > 0;
      if (distanceToPlayer < 0.38 || travelledPastTarget) {
        arenaShield = Math.max(0, arenaShield - 1);
        playArenaSound('damage');
        statusText(`ENEMY FIRE HIT · shield ${arenaShield}/3 · eliminate the shooters!`);
        shot.entity?.destroy?.(); shot.mesh.parent?.remove(shot.mesh); shot.mesh.geometry.dispose(); (shot.mesh.material as MeshBasicMaterial).dispose(); hostileShots.splice(i, 1);
        if (arenaShield <= 0) statusText('SHIELDS DOWN · keep fighting until the round ends!');
        refreshQuestPanel();
      } else if (shot.mesh.position.distanceTo(shot.target) > 18) {
        shot.entity?.destroy?.(); shot.mesh.parent?.remove(shot.mesh); shot.mesh.geometry.dispose(); (shot.mesh.material as MeshBasicMaterial).dispose(); hostileShots.splice(i, 1);
      }
    }
  }
}
world.registerSystem(ArenaMotionSystem);
drawQuestPanel();

// TEMPORARY CAMERA + WORLD-SPACE DIAGNOSTIC.
// Run only after immersive XR has started so the camera pose reflects the headset.
function placeStudioInFrontOfCamera() {
  world.scene.updateMatrixWorld(true);
  world.camera.updateMatrixWorld(true);
  const cameraPosition = new Vector3();
  const cameraDirection = new Vector3();
  world.camera.getWorldPosition(cameraPosition);
  world.camera.getWorldDirection(cameraDirection);
  panelMesh.position.copy(cameraPosition).addScaledVector(cameraDirection, 1.35);
  panelMesh.position.y -= 0.08;
  panelMesh.lookAt(cameraPosition);
  destinationPanelGroup.position.copy(panelMesh.position).add(new Vector3(0.95, -0.05, 0));
  destinationPanelGroup.quaternion.copy(panelMesh.quaternion);
  refreshQuestPanel();
}
function logQuestCameraAndMeshes() {
  world.scene.updateMatrixWorld(true);
  world.camera.updateMatrixWorld(true);
  const player = (world as any).player;
  player?.updateMatrixWorld?.(true);
  const cameraWorldPosition = new Vector3();
  const cameraWorldDirection = new Vector3();
  const playerWorldPosition = new Vector3();
  world.camera.getWorldPosition(cameraWorldPosition);
  world.camera.getWorldDirection(cameraWorldDirection);
  player?.getWorldPosition?.(playerWorldPosition);
  const transformChain = (object: any) => {
    const chain: any[] = [];
    let current = object;
    while (current) {
      const worldPosition = new Vector3();
      current.getWorldPosition?.(worldPosition);
      chain.push({
        name: current.name || current.type,
        type: current.type,
        localPosition: current.position?.toArray?.() ?? null,
        worldPosition: current.getWorldPosition ? worldPosition.toArray() : null,
      });
      current = current.parent;
    }
    return chain;
  };
  const sceneMeshReport: any[] = [];
  world.scene.traverse((object: any) => {
    if (!object.isMesh) return;
    const worldPosition = new Vector3();
    object.getWorldPosition(worldPosition);
    sceneMeshReport.push({
      name: object.name || object.userData?.label || object.type,
      position: worldPosition.toArray().map((value: number) => Number(value.toFixed(3))),
      visible: object.visible,
      parent: object.parent?.name || object.parent?.type || null,
      geometry: object.geometry?.type || null,
      materialVisible: Array.isArray(object.material)
        ? object.material.map((material: any) => material.visible)
        : object.material?.visible,
    });
  });
  console.info('[StreamLink camera and world-space diagnostic]', {
    playerLocalPosition: player?.position?.toArray?.() ?? null,
    playerWorldPosition: player ? playerWorldPosition.toArray() : null,
    playerChain: transformChain(player),
    cameraLocalPosition: world.camera.position.toArray(),
    cameraWorldPosition: cameraWorldPosition.toArray(),
    cameraParent: world.camera.parent?.name || world.camera.parent?.type || null,
    cameraParentChain: transformChain(world.camera),
    cameraDirection: cameraWorldDirection.toArray(),
    cameraNear: world.camera.near,
    cameraFar: world.camera.far,
    sceneMeshCount: sceneMeshReport.length,
    meshes: sceneMeshReport,
  });
}
