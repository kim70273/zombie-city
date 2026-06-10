// dev-only: 3D character inspection gallery (vite dev server → /gallery3d.html)
import * as THREE from 'three';
import { CharacterFactory, CHAR_HEIGHT } from './render3d/chars3d.js';

const W = window.innerWidth;
const H = window.innerHeight - 40;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x232336);
scene.add(new THREE.HemisphereLight(0xcfeaff, 0x9a8f7a, 1.0));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
sun.position.set(300, 500, 200);
scene.add(sun, new THREE.AmbientLight(0xffffff, 0.25));

const camera = new THREE.PerspectiveCamera(40, W / H, 1, 2000);
const q = new URLSearchParams(location.search);
if (q.get('cam') === 'close') { // close-up on looks 0-2 (human row) for face review
  camera.position.set(-160, 52, 130);
  camera.lookAt(-160, 40, -10);
} else if (q.get('cam') === 'face') { // head close-up on look 0 (human)
  camera.position.set(-224, 68, 28);
  camera.lookAt(-224, 64, -10);
} else {
  camera.position.set(0, 66, 400);
  camera.lookAt(0, 36, 0);
}
const spin = q.get('spin') !== '0';
if (q.get('mode') === 'walk') setTimeout(() => dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2' })), 0);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(2000, 600),
  new THREE.MeshToonMaterial({ color: 0x3a3a4e })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const factory = new CharacterFactory();
const rigs = [];
const GAP = 64;
for (let look = 0; look < 8; look++) {
  for (const zombie of [false, true]) {
    const rig = factory.create({ look, zombie });
    rig.group.position.set((look - 3.5) * GAP, 0, zombie ? 70 : -10);
    scene.add(rig.group);
    rigs.push(rig);
  }
}

let mode = 0; // 0 idle, 1 walk, 2 attack loop, 3 airborne
addEventListener('keydown', (e) => {
  if (e.code === 'Digit1') mode = 0;
  if (e.code === 'Digit2') mode = 1;
  if (e.code === 'Digit3') mode = 2;
  if (e.code === 'Digit4') mode = 3;
});

renderer.setAnimationLoop(() => {
  const now = performance.now();
  for (const rig of rigs) {
    rig.setYaw(spin ? now / 1600 : Math.PI / 2);
    rig.update(now, {
      moving: mode === 1,
      attacking: mode === 2 && (now % 1000) < 220,
      stunned: false,
      airborne: mode === 3,
    });
  }
  renderer.render(scene, camera);
});

console.log('gallery3d ready — 1: idle, 2: walk, 3: attack, CHAR_HEIGHT =', CHAR_HEIGHT);
