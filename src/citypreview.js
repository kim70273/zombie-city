// dev-only: 3D city inspection preview (vite dev server → /citypreview.html)
// URL params: ?seed=123&dur=10&r=700&h=300&a=0.6&x=0&z=0&speed=0.05&focus=apt
import * as THREE from 'three';
import { generateMap } from './core/mapgen.js';
import { TILE } from './config.js';
import { CityWorld } from './render3d/world3d.js';

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? parseFloat(q.get(k)) : d);

const W = window.innerWidth;
const H = window.innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87c8ec);
scene.fog = new THREE.Fog(0x9fd2ee, 800, 3200);

const map = generateMap(num('seed', 123), num('dur', 10));
const world = new CityWorld(scene, map);

// camera target: map center, or first apartment (?focus=apt)
const cxW = map.w * TILE / 2;
const czW = map.h * TILE / 2;
let target = new THREE.Vector3(cxW + num('x', 0), 0, czW + num('z', 0));
if (q.get('focus') === 'apt') {
  const apt = map.buildings.find((b) => b.kind === 'apartment');
  if (apt) target = new THREE.Vector3((apt.x + apt.w / 2) * TILE, 0, (apt.y + apt.h / 2) * TILE);
}

// lights (renderer3d-style) + shadow-casting sun centered on the target
scene.add(new THREE.HemisphereLight(0xcfeaff, 0x9a8f7a, 1.0));
scene.add(new THREE.AmbientLight(0xffffff, 0.25));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
sun.position.set(target.x + 600, 1000, target.z + 350);
sun.target.position.copy(target);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -1300;
sun.shadow.camera.right = 1300;
sun.shadow.camera.top = 1300;
sun.shadow.camera.bottom = -1300;
sun.shadow.camera.near = 100;
sun.shadow.camera.far = 2600;
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

const camera = new THREE.PerspectiveCamera(50, W / H, 4, 6000);
const radius = num('r', 700);
const height = num('h', 300);
const speed = num('speed', 0.05); // rad/s — slow orbit
const a0 = num('a', 0.6);

const fadeId = q.has('fade') ? parseInt(q.get('fade'), 10) : -1; // force-fade a building (interior check)
let frames = 0;
renderer.setAnimationLoop(() => {
  const a = a0 + performance.now() / 1000 * speed;
  camera.position.set(target.x + Math.cos(a) * radius, height, target.z + Math.sin(a) * radius);
  camera.lookAt(target.x, 40, target.z);
  world.update(fadeId, 1 / 60);
  renderer.render(scene, camera);
  if (++frames === 30) window.__cityReady = true; // playwright hook (fade settled)
});

const apts = map.buildings.filter((b) => b.kind === 'apartment');
console.log(`citypreview ready — buildings=${map.buildings.length} apartments=${apts.length}`,
  apts.map((b) => `#${b.id}(${b.floors}F)`).join(' '));
