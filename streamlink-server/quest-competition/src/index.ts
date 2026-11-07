import { OneHandGrabbable, World } from '@iwsdk/core';
import { BoxGeometry, DirectionalLight, Mesh, MeshStandardMaterial, PlaneGeometry, SphereGeometry } from 'three';
import projectOptions from 'virtual:iwsdk-project';

const container = document.getElementById('scene-container');
const enterButton = document.getElementById('enter-xr') as HTMLButtonElement | null;
const status = document.getElementById('status');

if (!(container instanceof HTMLDivElement)) throw new Error('Missing #scene-container');

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
const stageEntity = world.createTransformEntity(stage);
stageEntity.addComponent(OneHandGrabbable, { rotate: true, translate: true });

const colors = [0x31d6ff, 0x8b7bff, 0xffb84d, 0x42e6a4, 0xff668c];
colors.forEach((color, index) => {
  const target = new Mesh(
    new SphereGeometry(0.19, 32, 24),
    new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.22, roughness: 0.28, metalness: 0.35 }),
  );
  target.position.set((index - 2) * 0.92, 1.45 + (index % 2) * 0.48, -2.0 - (index % 2) * 0.22);
  const entity = world.createTransformEntity(target);
  entity.addComponent(OneHandGrabbable, { rotate: true, translate: true });
});

const xr = (navigator as Navigator & { xr?: { isSessionSupported(mode: string): Promise<boolean> } }).xr;
const xrSupported = xr ? await xr.isSessionSupported('immersive-vr').catch(() => false) : false;

if (enterButton) {
  enterButton.disabled = !xrSupported;
  enterButton.textContent = xrSupported ? 'ENTER QUEST VR' : 'OPEN ON META QUEST';
  enterButton.addEventListener('click', async () => {
    try {
      await world.launchXR();
    } catch (error) {
      console.error('Unable to start immersive session:', error);
      if (status) status.textContent = 'XR could not start. Open this HTTPS page in Quest Browser and check headset permissions.';
    }
  });
}

if (status) {
  status.textContent = xrSupported
    ? 'Hands-first studio ready · pinch and grab the floating stage and targets'
    : 'Desktop preview ready · open this HTTPS page in Meta Quest Browser to enter VR';
}
