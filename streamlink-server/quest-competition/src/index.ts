import {
  BoxGeometry, CanvasTexture, ConeGeometry, IcosahedronGeometry, OctahedronGeometry, createComponent, createSystem, DirectionalLight, EnvironmentType, Group, LocomotionEnvironment, Mesh, MeshBasicMaterial,
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
let raceLane=1, raceDistance=0, raceSpawnClock=0;
const raceObjects: {mesh:Mesh;entity:any;lane:number;speed:number;passed:boolean}[]=[];
const raceTrackMeshes:{mesh:Mesh;entity:any}[]=[];
let raceCar:Group|null=null, raceCarEntity:any=null, raceTrackActive=false;
let activeGameMode: 'orb-rush' | 'drone-defense' | 'meteor-blitz' | 'phantom-hunt' | 'zero-g-rush' | 'last-stand' | 'titan-breaker' | 'inferno-run' | 'nightfall-survival' | 'rift-racer' = 'orb-rush';
let arenaSeconds = 45;
let arenaDeadline = 0;
let arenaTimer: number | null = null;
const arenaMeshes = new Set<Mesh>();
const arenaEntities = new Map<Mesh, any>();
const arenaMotion = new Map<number, { x: number; y: number; z: number; phase: number; speed: number; drift: number; approachSpeed: number; attackClock: number }>();
const hostileShots: { mesh: Mesh; entity: any; speed: number }[] = [];
const raiderMixers = new Map<Mesh, AnimationMixer>();
let raiderModelPromise: Promise<any> | null = null;
function attachAnimatedHumanRaider(target: Mesh) {
  if (!raiderModelPromise) {
    const loader = new GLTFLoader();
    raiderModelPromise = loader.loadAsync('https://models.codelove.in/models/military-male-03.glb')
      .catch((error) => { console.warn('[StreamLink] Human character model unavailable; using fallback character.', error); return null; });
  }
  void raiderModelPromise.then((gltf) => {
    if (!gltf || !arenaMeshes.has(target) || !target.parent) return;
    target.children.forEach((child) => { child.visible = false; });
    target.geometry.dispose();
    target.geometry = new SphereGeometry(0.001, 4, 4);
    const human = cloneSkinnedModel(gltf.scene);
    const bounds = new Box3().setFromObject(human);
    const size = bounds.getSize(new Vector3());
    const modelScale = 1.72 / Math.max(0.01, size.y);
    human.scale.setScalar(modelScale);
    human.position.set(0, -bounds.min.y * modelScale, 0);
    human.rotation.y = Math.PI;
    human.traverse((part: any) => {
      if (part.isMesh) { part.castShadow = true; part.frustumCulled = false; }
    });
    target.add(human);
    const weapon = new Group();
    const gunMaterial = new MeshStandardMaterial({ color: 0x202832, metalness: 0.82, roughness: 0.28 });
    const gunBody = new Mesh(new BoxGeometry(0.105, 0.105, 0.62), gunMaterial);
    const gunBarrel = new Mesh(new BoxGeometry(0.045, 0.045, 0.34), new MeshStandardMaterial({ color: 0x6d7782, metalness: 0.9, roughness: 0.2 }));
    gunBarrel.position.z = 0.46;
    weapon.add(gunBody, gunBarrel);
    weapon.position.set(0.20, 1.02, 0.18);
    human.add(weapon);
    const walkClip = gltf.animations.find((clip: any) => /walk/i.test(clip.name)) || gltf.animations.find((clip: any) => /run/i.test(clip.name)) || gltf.animations[0];
    if (walkClip) {
      const mixer = new AnimationMixer(human);
      mixer.clipAction(walkClip).play();
      raiderMixers.set(target, mixer);
    }
  });
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
      osc.type = 'sawtooth'; osc.frequency.setValueAtTime(210, now); osc.frequency.exponentialRampToValueAtTime(75, now + 0.16);
      filter.frequency.value = 1100; gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(0.11, now + 0.012); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      osc.start(now); osc.stop(now + 0.19);
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
  ctx.fillText(activeGameMode === 'rift-racer' ? `DISTANCE ${Math.floor(raceDistance)}m   LANE ${raceLane+1}/3   TIME ${arenaSeconds}s` : `SCORE ${arenaScore}   WAVE ${arenaWave}   COMBO x${Math.min(5, 1 + Math.floor(Math.max(0, arenaCombo - 1) / 3))}   TIME ${arenaSeconds}s`, 48, 276);
  ctx.fillStyle = activeGameMode === 'drone-defense' || activeGameMode === 'last-stand' || activeGameMode === 'nightfall-survival' ? (arenaShield > 1 ? '#42e6a4' : '#ff668c') : '#8198c4';
  ctx.font = 'bold 22px Inter, sans-serif';
  ctx.fillText(activeGameMode === 'drone-defense' || activeGameMode === 'last-stand' || activeGameMode === 'nightfall-survival' ? `SHIELD INTEGRITY  ${'◆ '.repeat(arenaShield)}${'◇ '.repeat(3 - arenaShield)}` : 'ARCADE CHALLENGE · HIT TARGETS TO BUILD YOUR COMBO', 48, 306);
  ctx.fillStyle = '#aab8d2'; ctx.font = '21px Inter, sans-serif';
  ctx.fillText(`ARENA OBJECTIVE  ${arenaHits}/${arenaGoal} targets · best combo ${arenaBestCombo}`, 48, 330);
  ctx.fillText(activeGameMode==='rift-racer' ? 'ARROWS / A-D to steer · drag left/right · avoid rival cars and roadblocks.' : (activeGameMode === 'nightfall-survival' || activeGameMode === 'last-stand') ? 'HOSTILES FIRE BACK · dodge red plasma shots and eliminate attackers with hand pinch.' : 'Track the enemies. Pinch or poke to strike; every 5 hits advances the wave.', 48, 365);
  ctx.fillText(`DESTINATIONS  ${selectedDestinationNames.size} selected · use ADD DEST to choose platforms`, 48, 410);
  const gameLabel = ({ 'rift-racer': 'RIFT RACER · dodge traffic and roadblocks on a neon highway.', 'orb-rush': 'ORB RUSH · warm-up arcade challenge.', 'drone-defense': 'RIFT GUARD · protect the core from incoming attack craft.', 'meteor-blitz': 'METEOR BLITZ · smash the incoming meteor storm.', 'phantom-hunt': 'PHANTOM HUNT · precision shots on unstable spectres.', 'zero-g-rush': 'ZERO-G RUSH · chase spinning energy gates.', 'last-stand': 'LAST STAND · defend the core through enemy waves.', 'titan-breaker': 'TITAN BREAKER · smash the colossal targets before time runs out.', 'inferno-run': 'INFERNO RUN · intercept the firestorm before it reaches you.', 'nightfall-survival': 'NIGHTFALL SURVIVAL · hold the line against relentless night drones.' } as Record<string, string>)[activeGameMode];
  ctx.fillText(gameLabel, 48, 450);
  ctx.fillStyle = '#8198c4'; ctx.font = '18px Inter, sans-serif';
  ctx.fillText('MOVING TARGETS · hand pinch / controller trigger · combos multiply your score', 48, 605);
  panelTexture.needsUpdate = true;
}
function refreshQuestPanel() { drawQuestPanel(); }

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
      const upperArm = new Mesh(new SphereGeometry(0.17, 14, 12), clothing);
      upperArm.scale.set(0.72, 1.15, 0.78); upperArm.position.set(side * 0.34, 0.055, 0.025); upperArm.rotation.z = side * -0.12; mesh.add(upperArm);
      const forearm = new Mesh(new SphereGeometry(0.145, 14, 12), clothing);
      forearm.scale.set(0.76, 1.12, 0.78); forearm.position.set(side * 0.32, -0.19, 0.14); forearm.rotation.x = -0.42; mesh.add(forearm);
      const hand = new Mesh(new SphereGeometry(0.075, 12, 10), skinLight);
      hand.position.set(side * 0.30, -0.32, 0.24); mesh.add(hand);
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

    // A compact rifle is held in front; muzzle flash remains visible during attack.
    const rifle = new Mesh(new BoxGeometry(0.10, 0.105, 0.52), clothDark);
    rifle.position.set(0.13, -0.105, 0.39); mesh.add(rifle);
    const barrel = new Mesh(new BoxGeometry(0.045, 0.045, 0.22), vest);
    barrel.position.set(0.13, -0.10, 0.74); mesh.add(barrel);
    const muzzle = new Mesh(new SphereGeometry(0.085, 12, 10), new MeshBasicMaterial({ color: 0xff542e }));
    muzzle.position.set(0.13, -0.10, 0.86); mesh.add(muzzle);
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
 for(const item of raceObjects){item.entity?.destroy?.();item.mesh.parent?.remove(item.mesh);item.mesh.geometry?.dispose?.();(item.mesh.material as any)?.dispose?.();} raceObjects.length=0;
 for(const item of raceTrackMeshes){item.entity?.destroy?.();item.mesh.parent?.remove(item.mesh);item.mesh.geometry?.dispose?.();(item.mesh.material as any)?.dispose?.();} raceTrackMeshes.length=0;
 if(raceCarEntity)raceCarEntity.destroy?.(); if(raceCar){raceCar.parent?.remove(raceCar);raceCar.traverse((o:any)=>{if(o.isMesh){o.geometry?.dispose?.();(o.material as any)?.dispose?.();}});} raceCar=null;raceCarEntity=null;raceTrackActive=false;
}
function addRaceMesh(geometry:any,material:any,position:[number,number,number]){const mesh=new Mesh(geometry,material);const entity=world.createTransformEntity(mesh,{persistent:true});entity.object3D!.position.set(...position);raceTrackMeshes.push({mesh,entity});return mesh;}
function buildRaceTrack(){
 clearRaceTrack();raceTrackActive=true;
 addRaceMesh(new BoxGeometry(8.8,.12,34),new MeshStandardMaterial({color:0x171d2b,roughness:.88}),[0,-.12,-11]);
 const cyan=new MeshBasicMaterial({color:0x20dfff}), white=new MeshBasicMaterial({color:0xe8f7ff});
 addRaceMesh(new BoxGeometry(.22,.45,34),cyan,[-4.45,.12,-11]);addRaceMesh(new BoxGeometry(.22,.45,34),cyan,[4.45,.12,-11]);
 for(let z=3;z>-29;z-=4){addRaceMesh(new BoxGeometry(.055,.025,1.7),white,[-1.47,0,z]);addRaceMesh(new BoxGeometry(.055,.025,1.7),white,[1.47,0,z]);}
 const car=new Group();const body=new Mesh(new BoxGeometry(.95,.28,1.65),new MeshStandardMaterial({color:0x11b8ff,metalness:.75,roughness:.2,emissive:0x063a66}));body.position.y=.38;car.add(body);
 const cockpit=new Mesh(new BoxGeometry(.62,.34,.68),new MeshStandardMaterial({color:0x101a32,metalness:.7,roughness:.12}));cockpit.position.set(0,.67,-.12);car.add(cockpit);
 const nose=new Mesh(new BoxGeometry(.72,.12,.42),new MeshStandardMaterial({color:0xffb84d,metalness:.5,roughness:.25,emissive:0x8a3b00}));nose.position.set(0,.42,-.88);car.add(nose);
 const wheels=new MeshStandardMaterial({color:0x080b12,roughness:.95});for(const x of [-.52,.52])for(const z of [-.52,.52]){const w=new Mesh(new TorusGeometry(.17,.07,8,16),wheels);w.rotation.y=Math.PI/2;w.position.set(x,.22,z);car.add(w);}
 raceCar=car;raceCarEntity=world.createTransformEntity(car,{persistent:true});raceCarEntity.addComponent(ArenaTarget);car.position.set(0,.03,1.8);
}
function spawnRaceObstacle(){if(!raceTrackActive)return;const lane=Math.floor(Math.random()*3),isCar=Math.random()>.42;const color=isCar?[0xff3b5c,0xffa52e,0x9b6bff][Math.floor(Math.random()*3)]:0xffd34e;const mesh=new Mesh(isCar?new BoxGeometry(.95,.9,1.45):new BoxGeometry(1.15,.65,.5),new MeshStandardMaterial({color,emissive:color,emissiveIntensity:.22,metalness:.58,roughness:.28}));mesh.position.set((lane-1)*2.85,isCar?.48:.34,-27);const entity=world.createTransformEntity(mesh,{persistent:true});raceObjects.push({mesh,entity,lane,speed:13+Math.random()*4,passed:false});}
function steerRace(direction:number){if(!arenaActive||activeGameMode!=='rift-racer'||arenaPaused)return;raceLane=Math.max(0,Math.min(2,raceLane+direction));if(raceCar)raceCar.position.x=(raceLane-1)*2.85;refreshQuestPanel();}
function startRiftRacer(){
 if(arenaActive)stopArena('Previous game ended');activeGameMode='rift-racer';arenaActive=true;arenaPaused=false;arenaScore=0;arenaHits=0;arenaCombo=0;arenaBestCombo=0;arenaWave=1;arenaShield=3;arenaGoal=999;arenaSeconds=75;arenaDeadline=Date.now()+75000;raceLane=1;raceDistance=0;raceSpawnClock=0;clearArena();buildRaceTrack();
 for(let i=0;i<4;i++){spawnRaceObstacle();raceObjects[raceObjects.length-1].mesh.position.z=-12-i*5;}
 if(arenaTimer!==null)window.clearInterval(arenaTimer);arenaTimer=window.setInterval(()=>{arenaSeconds=Math.max(0,Math.ceil((arenaDeadline-Date.now())/1000));if(arenaSeconds<=0)stopArena('RIFT RACER · FINISH LINE');else refreshQuestPanel();},250);
 playArenaSound('start');statusText('RIFT RACER START · Arrow keys / A-D or drag to steer. Avoid rival cars and roadblocks. Three crashes and it is over!');refreshQuestPanel();
}
function clearArena() {
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
  playArenaSound('hit');
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
  if (arenaHits >= arenaGoal) stopArena('Arena cleared');
  else spawnArenaTarget();
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
    stopArena('MISSION FAILED · shield breached');
    return;
  }
  statusText(`DRONE BREACH · shield ${arenaShield}/3 · intercept the next wave!`);
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
  arenaShield = 3;
  arenaGoal = 15;
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
  playArenaSound('start');
  statusText(`VR Arena started · hit ${arenaGoal} targets in 45 seconds. Build combos for bonus points.`);
  refreshQuestPanel();
}
function startDroneDefense() {
  if (arenaActive) stopArena('Previous game ended');
  activeGameMode = 'drone-defense';
  arenaShield = 3;
  arenaGoal = 20;
  arenaActive = true;
  arenaPaused = false;
  arenaScore = 0; arenaHits = 0; arenaCombo = 0; arenaBestCombo = 0; arenaWave = 1;
  arenaSeconds = 60; arenaDeadline = Date.now() + 60000;
  clearArena();
  for (let i = 0; i < 6; i++) spawnArenaTarget();
  if (arenaTimer !== null) window.clearInterval(arenaTimer);
  arenaTimer = window.setInterval(() => {
    arenaSeconds = Math.max(0, Math.ceil((arenaDeadline - Date.now()) / 1000));
    if (arenaSeconds <= 0) stopArena('Defense time expired'); else refreshQuestPanel();
  }, 250);
  playArenaSound('start');
  statusText('RIFT GUARD ONLINE · intercept attack craft before they breach the core.');
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
  arenaSeconds = 45; arenaDeadline = Date.now() + 45000;
  clearArena();
  for (let i = 0; i < 8; i++) spawnArenaTarget();
  if (arenaTimer !== null) window.clearInterval(arenaTimer);
  arenaTimer = window.setInterval(() => {
    arenaSeconds = Math.max(0, Math.ceil((arenaDeadline - Date.now()) / 1000));
    if (arenaSeconds <= 0) stopArena('Meteor storm survived'); else refreshQuestPanel();
  }, 250);
  playArenaSound('start');
  statusText('METEOR BLITZ · smash 30 fast-moving meteors before the storm ends. Keep your combo alive!');
  refreshQuestPanel();
}
function startExtraGame(mode: 'phantom-hunt' | 'zero-g-rush' | 'last-stand' | 'titan-breaker' | 'inferno-run' | 'nightfall-survival') {
  if (arenaActive) stopArena('Previous game ended');
  activeGameMode = mode;
  const config = mode === 'phantom-hunt'
    ? { goal: 18, seconds: 40, targets: 6, intro: 'PHANTOM HUNT · track unstable spectres. Small targets score 25 points; chain precision hits!' }
    : mode === 'zero-g-rush'
      ? { goal: 35, seconds: 45, targets: 9, intro: 'ZERO-G RUSH · chase spinning energy gates. Fast movement, wide drift, 35 hits to clear!' }
      : mode === 'last-stand'
        ? { goal: 65, seconds: 180, targets: 9, intro: 'LAST STAND · survive a 3-minute assault. Armed raiders push your position in escalating waves. Take them down and dodge incoming fire!' }
        : mode === 'titan-breaker'
          ? { goal: 18, seconds: 50, targets: 4, intro: 'TITAN BREAKER · colossal targets, heavy impact and a 50-second countdown. Land 18 hits!' }
          : mode === 'inferno-run'
            ? { goal: 30, seconds: 45, targets: 8, intro: 'INFERNO RUN · a firestorm is closing in. Intercept 30 blazing meteors before time expires!' }
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
window.addEventListener('keydown',(event)=>{if(event.key==='ArrowLeft'||event.key.toLowerCase()==='a'){event.preventDefault();steerRace(-1);}if(event.key==='ArrowRight'||event.key.toLowerCase()==='d'){event.preventDefault();steerRace(1);}});
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
    if(activeGameMode==='rift-racer'&&raceTrackActive){raceDistance+=delta*68;raceSpawnClock+=delta;if(raceSpawnClock>1.05){raceSpawnClock=0;spawnRaceObstacle();}if(raceCar)raceCar.rotation.z+=((raceLane-1)*-.11-raceCar.rotation.z)*Math.min(1,delta*7);for(let i=raceObjects.length-1;i>=0;i--){const item=raceObjects[i];item.mesh.position.z+=item.speed*delta;if(!item.passed&&item.mesh.position.z>.9){item.passed=true;if(item.lane===raceLane){arenaShield=Math.max(0,arenaShield-1);statusText(`CRASH! Shield ${arenaShield}/3 · change lanes!`);if(arenaShield<=0){stopArena('RACE WRECKED');return;}}else{arenaScore+=100;arenaHits++;}item.entity?.destroy?.();item.mesh.parent?.remove(item.mesh);item.mesh.geometry.dispose();(item.mesh.material as MeshStandardMaterial).dispose();raceObjects.splice(i,1);}}refreshQuestPanel();return;}
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
        const arms = mesh.userData.combatArms as Mesh[] | undefined;
        if (arms?.length) { arms[0].rotation.x = Math.sin(time * 7 + motion.phase) * 0.42; arms[1].rotation.x = -0.18 + Math.sin(time * 7 + motion.phase + Math.PI) * 0.42; }
        const muzzle = mesh.userData.muzzle as Mesh | undefined;
        if (muzzle) muzzle.visible = Math.sin(time * 16 + motion.phase) > 0.82;
        if (activeGameMode === 'nightfall-survival' || activeGameMode === 'last-stand') {
          motion.attackClock += delta;
          if (motion.attackClock >= 4.0 + Math.random() * 1.0) {
            motion.attackClock = 0;
            const shot = new Mesh(new BoxGeometry(0.22, 0.22, 1.35), new MeshBasicMaterial({ color: 0xffd52a, toneMapped: false }));
            const tracerGlow = new Mesh(new SphereGeometry(0.19, 12, 10), new MeshBasicMaterial({ color: 0xff5a08, transparent: true, opacity: 0.72, toneMapped: false }));
            shot.add(tracerGlow);
            const shotEntity = world.createTransformEntity(shot, { persistent: true });
            shotEntity.object3D!.position.set(mesh.position.x + 0.42, 1.02, mesh.position.z + 0.42);
            hostileShots.push({ mesh: shot, entity: shotEntity, speed: 7.0 + arenaWave * 0.3 });
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
      shot.mesh.position.z += shot.speed * delta;
      shot.mesh.scale.setScalar(1 + Math.sin(time * 18 + i) * 0.16);
      if (shot.mesh.position.z >= 0.75) {
        arenaShield = Math.max(0, arenaShield - 1);
        playArenaSound('damage');
        statusText(`INCOMING FIRE HIT · shield ${arenaShield}/3 · eliminate the shooters!`);
        shot.entity?.destroy?.(); shot.mesh.parent?.remove(shot.mesh); shot.mesh.geometry.dispose(); (shot.mesh.material as MeshBasicMaterial).dispose(); hostileShots.splice(i, 1);
        if (arenaShield <= 0) { stopArena('OVERWHELMED · SURVIVAL FAILED'); return; }
        refreshQuestPanel();
      } else if (shot.mesh.position.z > 2.2) {
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
