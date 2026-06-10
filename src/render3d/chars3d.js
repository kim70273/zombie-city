// chars3d.js — procedural HoYoverse-style (ZZZ/Genshin SD) cel-shaded anime characters.
// All geometry/material/texture generated at runtime; no external assets.
// Rigs share geometries + materials via the factory; each rig owns only its Group,
// cloned-mesh transforms and one tiny face material (face textures are shared).
import * as THREE from 'three';

export const CHAR_HEIGHT = 52; // world units (1 tile = 32). SD ~3.5 heads tall.

const TAU = Math.PI * 2;
const OUTLINE = 1.05;          // inverted-hull scale (crisp HoYo black outline)
const INK = '#221b2e';
const GREY = new THREE.Color(0x8e8e96);
const GREEN = new THREE.Color(0x4d7a50);

// 8 looks — palettes carried over from the 2D game.
const LOOKS = [
  { hair: 0xff9ecb, top: 0xffffff, bottom: 0x3a4a8c, accent: 0xff4d73, style: 'twintail' }, // 0 트윈테일 핑크 / 세일러
  { hair: 0x9fe8d2, top: 0xfff1d6, bottom: 0xff8a7a, accent: 0xff6a55, style: 'bob' },      // 1 단발 보브 민트 / 후디
  { hair: 0xffe08a, top: 0xcdb6f2, bottom: 0xb39ae8, accent: 0xffffff, style: 'long' },     // 2 롱스트레이트 금발 / 라벤더 원피스
  { hair: 0x7ab8ff, top: 0xffffff, bottom: 0x3f4a66, accent: 0xff5a5a, style: 'ponytail' }, // 3 포니테일 블루 / 트랙 재킷
  { hair: 0x4a4a5a, top: 0x555a66, bottom: 0x3c4150, accent: 0xaaddee, style: 'spiky' },    // 4 숏컷 차콜 / 블레이저
  { hair: 0xb07a4a, top: 0xff6a6a, bottom: 0xffd24a, accent: 0xffd24a, style: 'buns' },     // 5 만두머리 브라운
  { hair: 0xc9a6ff, top: 0x6a8ad8, bottom: 0x5d79c6, accent: 0xffd86a, style: 'sidepony' }, // 6 사이드포니 라벤더 / 오버올
  { hair: 0xff7a5a, top: 0x2f6a6a, bottom: 0xfff1d6, accent: 0xffc9a0, style: 'wavy' },     // 7 웨이브 오렌지 / 틸
];

/* ----------------------------- small builders ----------------------------- */

function put(parent, geo, mat, pos = [0, 0, 0], scl = [1, 1, 1], rot = null) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(pos[0], pos[1], pos[2]);
  m.scale.set(scl[0], scl[1], scl[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(m);
  return m;
}

function pivotAt(parent, x, y, z) {
  const p = new THREE.Group();
  p.position.set(x, y, z);
  parent.add(p);
  return p;
}

// Inverted-hull outline: same geometry, BackSide black, slightly scaled up.
function outlineOf(mesh, outlineMat) {
  const o = new THREE.Mesh(mesh.geometry, outlineMat);
  o.position.copy(mesh.position);
  o.rotation.copy(mesh.rotation);
  o.scale.copy(mesh.scale).multiplyScalar(OUTLINE);
  mesh.parent.add(o);
  return o;
}

/* ------------------------------ face textures ----------------------------- */

function drawEye(ctx, cx, cy, side, zombie) {
  ctx.save();
  // sclera (big + glossy)
  ctx.beginPath(); ctx.ellipse(cx, cy, 30, 38, 0, 0, TAU);
  ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.lineWidth = 4.5; ctx.strokeStyle = INK; ctx.stroke();
  // iris — strong vertical gradient, bright at the bottom (HoYo glossy look)
  const g = ctx.createLinearGradient(0, cy - 22, 0, cy + 30);
  if (zombie) { g.addColorStop(0, '#6e0c0c'); g.addColorStop(0.55, '#c22424'); g.addColorStop(1, '#ff7a5a'); }
  else { g.addColorStop(0, '#2c2f6e'); g.addColorStop(0.5, '#3f6ac4'); g.addColorStop(1, '#8fd8ff'); }
  ctx.beginPath(); ctx.ellipse(cx, cy + 5, 21, 26, 0, 0, TAU); ctx.fillStyle = g; ctx.fill();
  // pupil
  ctx.beginPath(); ctx.ellipse(cx, cy + 4, 9, 13, 0, 0, TAU); ctx.fillStyle = '#160f22'; ctx.fill();
  // heavy upper lash + outward flick (sharp ZZZ lash)
  ctx.lineCap = 'round'; ctx.strokeStyle = INK;
  ctx.lineWidth = 9;
  ctx.beginPath(); ctx.ellipse(cx, cy, 31, 39, 0, Math.PI * 1.06, Math.PI * 1.94); ctx.stroke();
  ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(cx + side * 29, cy - 14); ctx.lineTo(cx + side * 40, cy - 21); ctx.stroke();
  // sparkle highlights
  ctx.fillStyle = '#ffffff';
  if (zombie) {
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.arc(cx - 6, cy - 5, 5, 0, TAU); ctx.fill();
  } else {
    ctx.beginPath(); ctx.arc(cx - 9, cy - 9, 8, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 9, cy + 14, 4.5, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.arc(cx + 13, cy - 2, 2.6, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

function drawFace(ctx, mode) {
  const zombie = mode.includes('zombie'), blink = mode.includes('blink');
  ctx.clearRect(0, 0, 256, 256);
  // blush
  ctx.fillStyle = zombie ? 'rgba(140,90,120,0.35)' : 'rgba(255,118,144,0.42)';
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(128 + s * 70, 160, 16, 9, 0, 0, TAU); ctx.fill(); }
  // tiny smile
  ctx.lineCap = 'round'; ctx.lineWidth = 5; ctx.strokeStyle = '#9c4458';
  ctx.beginPath(); ctx.arc(128, 172, 11, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
  // eyes
  for (const s of [-1, 1]) {
    const cx = 128 + s * 46, cy = 112;
    if (blink) { // ^ ^
      ctx.lineWidth = 7; ctx.strokeStyle = INK;
      ctx.beginPath(); ctx.arc(cx, cy + 16, 18, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke();
    } else drawEye(ctx, cx, cy, s, zombie);
  }
  if (zombie) { // small cheek stitch
    ctx.strokeStyle = '#35522f'; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.moveTo(184, 148); ctx.lineTo(214, 164);
    for (let i = 1; i <= 3; i++) {
      const x = 184 + 30 * i * 0.25, y = 148 + 16 * i * 0.25;
      ctx.moveTo(x - 3, y + 5); ctx.lineTo(x + 3, y - 5);
    }
    ctx.stroke();
  }
}

/* --------------------------------- hair ----------------------------------- */
// Built in head-local space (head center = origin, +X forward, head radius 9).

function buildHair(style, c) {
  const { g, head, hair, gloss, acc, out, sway } = c;
  const cap = put(head, g.ball, hair, [-1.3, 1.5, 0], [9.7, 9.1, 9.7]);
  outlineOf(cap, out);
  // angel-ring shine: bright ellipsoid band poking through the upper cap
  put(head, g.ball, gloss, [-1.0, 6.0, 0], [9.2, 1.5, 9.3]);
  // front bangs under the cap edge
  for (let i = 0; i < 4; i++) {
    const z = -5.2 + i * 3.47;
    put(head, g.ball, hair, [Math.sqrt(Math.max(14, 59 - z * z)), 4.3 + (i % 2) * 0.9, z], [2.3, 3.7, 2.8]);
  }
  switch (style) {
    case 'twintail':
      for (const s of [-1, 1]) {
        const p = pivotAt(head, -1.6, 2.5, s * 8.9);
        put(p, g.ball, acc, [0, 0.4, s * 0.7], [1.8, 1.8, 1.8]);
        outlineOf(put(p, g.ball, hair, [-1.0, -9.2, s * 2.0], [2.4, 10.5, 2.4]), out);
        sway.push({ o: p, base: s * -0.1, off: s * 2 });
      }
      break;
    case 'bob': // rounder mass + inward curls
      outlineOf(put(head, g.ball, hair, [-0.8, -1.2, 0], [9.4, 8.9, 9.4]), out);
      for (const s of [-1, 1]) put(head, g.ball, hair, [1.6, -6.8, s * 7.0], [3.6, 2.8, 2.6]);
      break;
    case 'long': // straight back volume to mid-body + side strands
      outlineOf(put(head, g.ball, hair, [-5.8, -8.0, 0], [4.4, 13, 7.4]), out);
      for (const s of [-1, 1]) put(head, g.ball, hair, [2.9, -5.4, s * 7.9], [1.9, 6.6, 1.9]);
      break;
    case 'ponytail': {
      const p = pivotAt(head, -4.9, 7.4, 0);
      put(p, g.ball, acc, [0, 0, 0], [1.9, 1.9, 1.9]);
      put(p, g.ball, hair, [-0.8, 1.2, 0], [3.0, 3.0, 3.0]);
      outlineOf(put(p, g.cone, hair, [-2.2, -5.4, 0], [2.5, 11, 2.5], [0, 0, Math.PI + 0.22]), out);
      sway.push({ o: p, base: 0, off: 0 });
      break;
    }
    case 'spiky': { // messy short spikes
      const S = [[-4.9, 7.0, 0, 0.0, -0.6], [-0.8, 8.8, 2.9, -0.45, 0.15], [-0.8, 8.8, -2.9, 0.45, 0.15],
                 [3.3, 7.4, 1.5, -0.2, 0.5], [2.5, 7.8, -1.7, 0.35, 0.4]];
      for (const [x, y, z, rx, rz] of S) put(head, g.cone, hair, [x, y, z], [1.7, 4.6, 1.7], [rx, 0, rz]);
      break;
    }
    case 'buns':
      for (const s of [-1, 1]) {
        outlineOf(put(head, g.ball, hair, [-1.6, 8.1, s * 5.7], [3.6, 3.3, 3.6]), out);
        put(head, g.ball, acc, [-1.6, 6.2, s * 7.5], [1.2, 1.2, 1.2]);
      }
      break;
    case 'sidepony': {
      const p = pivotAt(head, -2.5, 3.7, 8.1);
      put(p, g.ball, acc, [0, 0.4, 0], [1.7, 1.7, 1.7]);
      outlineOf(put(p, g.cone, hair, [-0.8, -5.6, 1.0], [2.1, 10, 2.1], [0, 0, Math.PI - 0.14]), out);
      sway.push({ o: p, base: -0.08, off: 1.3 });
      break;
    }
    case 'wavy': // stacked offset blobs down the back
      for (let i = 0; i < 4; i++) {
        const m = put(head, g.ball, hair,
          [-5.8 - i * 0.3, -2.0 - i * 4.0, (i % 2 ? 2.0 : -2.0)], [3.8 - i * 0.4, 3.1, 6.2 - i * 1.0]);
        if (i === 0) outlineOf(m, out);
      }
      break;
  }
}

/* --------------------------------- factory --------------------------------- */

export class CharacterFactory {
  constructor() {
    this._geo = null;        // shared geometries
    this._core = null;       // gradient map + global materials
    this._faces = null;      // shared face textures
    this._mats = new Map();  // per (look|zombie|muted) material sets
  }

  _ensureCore() {
    if (this._core) return this._core;
    // 2 HARD cel steps: dark 0.55, bright 1.0
    const grad = new THREE.DataTexture(new Uint8Array([140, 255]), 2, 1, THREE.RedFormat);
    grad.minFilter = grad.magFilter = THREE.NearestFilter;
    grad.needsUpdate = true;
    const toon = (hex) => new THREE.MeshToonMaterial({ color: hex, gradientMap: grad });
    this._core = {
      grad,
      skinH: toon(0xffddc6),
      skinZ: toon(0xa8d8a0),
      shoe: toon(0x35304a),
      gun: toon(0x23232c),
      outline: new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide }),
    };
    return this._core;
  }

  _ensureGeo() {
    if (this._geo) return this._geo;
    // capsule with guaranteed total height (CapsuleGeometry semantics changed across three versions)
    const cap = (r, totalH) => {
      const geo = new THREE.CapsuleGeometry(r, Math.max(0.05, totalH - r * 2), 5, 14);
      geo.computeBoundingBox();
      const h = geo.boundingBox.max.y - geo.boundingBox.min.y;
      if (Math.abs(h - totalH) > 0.05) geo.scale(1, totalH / h, 1);
      return geo;
    };
    const leg = cap(2.3, 16.8); leg.translate(0, -7.0, 0);  // pivot at hip
    const arm = cap(1.9, 12.6); arm.translate(0, -5.2, 0);  // pivot at shoulder
    this._geo = {
      head: new THREE.SphereGeometry(9, 26, 18),
      // front hemisphere panel carrying the transparent face texture
      face: new THREE.SphereGeometry(9.35, 22, 12, Math.PI - 0.95, 1.9, Math.PI * 0.24, Math.PI * 0.5),
      body: cap(4.8, 17),
      skirt: new THREE.CylinderGeometry(4.6, 7.6, 6, 16),
      leg, arm,
      ball: new THREE.SphereGeometry(1, 14, 11),
      cone: new THREE.ConeGeometry(1, 1, 12),
      box: new THREE.BoxGeometry(1, 1, 1),
    };
    return this._geo;
  }

  _ensureFaces() {
    if (this._faces) return this._faces;
    if (typeof document === 'undefined') { // headless (Node) fallback — keeps create() safe
      const mk = () => {
        const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
        t.needsUpdate = true;
        return t;
      };
      this._faces = { normal: mk(), blink: mk(), zombie: mk() };
    } else {
      const mk = (mode) => {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 256;
        drawFace(cv.getContext('2d'), mode);
        const t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      };
      this._faces = { normal: mk('normal'), blink: mk('blink'), zombie: mk('zombie') };
    }
    return this._faces;
  }

  // Shared material set for (look, zombie, muted). Hair lives only on the human
  // set (zombies keep hair unchanged); setZombie() swaps skin/outfit references.
  _matSet(look, zombie, muted) {
    const key = `${look}|${zombie ? 1 : 0}|${muted ? 1 : 0}`;
    let set = this._mats.get(key);
    if (set) return set;
    const core = this._ensureCore();
    const L = LOOKS[look];
    const col = (hex) => {
      const c = new THREE.Color(hex);
      if (muted) c.lerp(GREY, 0.4);                              // desaturated citizens
      if (zombie) { c.multiplyScalar(0.75); c.lerp(GREEN, 0.22); } // dim + green tint
      return c;
    };
    const toon = (c) => new THREE.MeshToonMaterial({ color: c, gradientMap: core.grad });
    set = {
      skin: zombie ? core.skinZ : core.skinH,
      top: toon(col(L.top)),
      bottom: toon(col(L.bottom)),
      accent: toon(col(L.accent)),
    };
    if (!zombie) {
      set.hair = toon(col(L.hair));
      set.gloss = toon(col(L.hair).lerp(new THREE.Color(0xffffff), 0.5)); // angel-ring shine
    }
    this._mats.set(key, set);
    return set;
  }

  create({ look = 0, zombie = false, muted = false } = {}) {
    look = (((look | 0) % LOOKS.length) + LOOKS.length) % LOOKS.length;
    const rig = new CharacterRig(this, look, !!muted);
    if (zombie) rig.setZombie(true);
    return rig;
  }

  dispose() {
    if (this._geo) { for (const k in this._geo) this._geo[k].dispose(); this._geo = null; }
    for (const set of this._mats.values()) {
      set.top.dispose(); set.bottom.dispose(); set.accent.dispose();
      if (set.hair) set.hair.dispose();
      if (set.gloss) set.gloss.dispose();
    }
    this._mats.clear();
    if (this._core) {
      const c = this._core;
      c.grad.dispose(); c.skinH.dispose(); c.skinZ.dispose();
      c.shoe.dispose(); c.gun.dispose(); c.outline.dispose();
      this._core = null;
    }
    if (this._faces) { for (const k in this._faces) this._faces[k].dispose(); this._faces = null; }
  }
}

/* ----------------------------------- rig ----------------------------------- */

class CharacterRig {
  constructor(factory, look, muted) {
    const g = factory._ensureGeo();
    const core = factory._ensureCore();
    this._faces = factory._ensureFaces();
    this._hSet = factory._matSet(look, false, muted);
    this._zSet = factory._matSet(look, true, muted);
    this._zombie = false;
    this._sway = [];
    this._phase = Math.random() * TAU;
    this._nextBlink = -1;
    this._blinkUntil = 0;
    this._closed = false;

    const M = this._hSet, out = core.outline;
    const skinM = [], topM = [], botM = [], accM = [];

    // group origin at FEET center; +Y up; model faces +X at yaw 0
    const group = this.group = new THREE.Group();
    const root = this._root = pivotAt(group, 0, 0, 0); // bob / lean / sway target

    // legs (pivot at hip y=16) + shoes
    for (const s of [-1, 1]) {
      const p = pivotAt(root, 0, 16, s * 2.3);
      const lm = put(p, g.leg, M.skin);
      skinM.push(lm); outlineOf(lm, out);
      put(p, g.ball, core.shoe, [1.0, -14.0, 0], [3.2, 2.0, 2.6]); // sole rests at y=0
      this[s < 0 ? '_legL' : '_legR'] = p;
    }

    // torso (lean pivot at hips); slim waist via x/z scale on the body capsule
    const torso = this._torso = pivotAt(root, 0, 16, 0);
    const body = put(torso, g.body, M.top, [0, 8, 0], [0.92, 1, 1.08]);
    topM.push(body); outlineOf(body, out);
    const skirt = put(torso, g.skirt, M.bottom, [0, 2.0, 0]);
    botM.push(skirt); outlineOf(skirt, out);
    const belt = put(torso, g.box, M.accent, [0, 5.2, 0], [9.2, 1.5, 10.6]);  // accent belt
    accM.push(belt);
    const collar = put(torso, g.ball, M.accent, [0, 16.4, 0], [3.4, 1.0, 3.9]); // accent collar
    accM.push(collar);
    const ribbon = put(torso, g.ball, M.accent, [4.3, 12.6, 0], [1.2, 1.7, 2.5]); // chest ribbon
    accM.push(ribbon);

    // arms (pivot at shoulder, slight outward tilt)
    for (const s of [-1, 1]) {
      const p = pivotAt(torso, 0, 14.6, s * 5.9);
      p.userData.tx = -s * 0.14;
      p.rotation.x = p.userData.tx;
      const am = put(p, g.arm, M.skin);
      skinM.push(am); outlineOf(am, out);
      this[s < 0 ? '_armL' : '_armR'] = p;
    }

    // tiny pistol in the right hand (hidden by default)
    const gun = this._gun = pivotAt(this._armR, 0.5, -10.8, 0);
    put(gun, g.box, core.gun, [0, -1.6, 0], [1.3, 3.8, 1.1]);  // barrel (forward when arm raised)
    put(gun, g.box, core.gun, [-1.1, -0.4, 0], [1.9, 1.2, 1.0]); // grip
    gun.visible = false;

    // head (big SD sphere, slightly flattened) + face panel + hair
    const head = this._head = pivotAt(torso, 0, 25.5, 0);
    const hm = put(head, g.head, M.skin, [0, 0, 0], [1, 0.94, 1]);
    skinM.push(hm); outlineOf(hm, out);
    this._faceMat = new THREE.MeshBasicMaterial({ map: this._faces.normal, transparent: true, alphaTest: 0.06 });
    put(head, g.face, this._faceMat, [0, 0, 0], [1, 0.94, 1]);
    buildHair(LOOKS[look].style, { g, head, hair: M.hair, gloss: M.gloss, acc: M.accent, out, sway: this._sway });

    this._skinM = skinM; this._topM = topM; this._botM = botM; this._accM = accM;
  }

  setYaw(a) { this.group.rotation.y = -a; }

  setGun(visible) { this._gun.visible = !!visible; }

  setZombie(z) {
    z = !!z;
    if (z === this._zombie) return;
    this._zombie = z;
    const S = z ? this._zSet : this._hSet; // hair meshes untouched — hair stays
    for (const m of this._skinM) m.material = S.skin;
    for (const m of this._topM) m.material = S.top;
    for (const m of this._botM) m.material = S.bottom;
    for (const m of this._accM) m.material = S.accent;
    this._head.rotation.x = z ? 0.13 : 0;   // slight head tilt
    if (!z) { this._armL.rotation.z = 0; this._armR.rotation.z = 0; }
    this._applyFace();
  }

  _applyFace() {
    const f = this._faces;
    this._faceMat.map = this._closed ? f.blink : (this._zombie ? f.zombie : f.normal);
  }

  update(now, state = {}) {
    const { moving = false, attacking = false, stunned = false } = state;
    const t = now * 0.001, z = this._zombie, r = this._root;

    // blink (130ms every 2.5–5s)
    if (this._nextBlink < 0) this._nextBlink = now + 1000 + Math.random() * 3000;
    if (now >= this._nextBlink) {
      this._blinkUntil = now + 130;
      this._nextBlink = now + 2500 + Math.random() * 2500;
    }
    const closed = now < this._blinkUntil;
    if (closed !== this._closed) { this._closed = closed; this._applyFace(); }

    // legs: walk swing / zombie shuffle (forward-back = local Z with +X facing)
    const phase = t * (z ? 6 : 8.5) + this._phase;
    const s = moving ? Math.sin(phase) : 0;
    const legAmp = z ? 0.3 : 0.55;
    this._legL.rotation.z = s * legAmp;
    this._legR.rotation.z = -s * legAmp;

    // arms
    let aL, aR;
    if (attacking) aL = aR = z ? 1.5 : 0.9;                       // thrust forward
    else if (z) { aL = 1.35 + Math.sin(t * 3.1 + this._phase) * 0.08; aR = 1.35 + Math.cos(t * 2.7 + this._phase) * 0.08; }
    else if (moving) { aL = -s * 0.4; aR = s * 0.4; }
    else { aL = Math.sin(t * 1.7 + this._phase) * 0.05; aR = -aL; }
    this._armL.rotation.z = aL;
    this._armR.rotation.z = aR;

    // body bob + forward lean / stun wobble / zombie side sway
    r.position.y = moving ? Math.abs(Math.cos(phase)) * 0.8 : Math.sin(t * 2.1 + this._phase) * 0.4;
    const lean = attacking ? -0.12 : (moving ? -0.06 : 0);
    r.rotation.z = stunned ? Math.sin(t * 16) * 0.12 : lean;
    r.rotation.x = (z && moving) ? Math.sin(t * 5 + this._phase) * 0.05 : 0;

    // hair sway (twin tails / ponytails)
    const amp = moving ? 0.16 : 0.05, w = moving ? 8.5 : 1.8;
    for (const p of this._sway) p.o.rotation.x = p.base + Math.sin(t * w + this._phase + p.off) * amp;
  }

  dispose() {
    this._faceMat.dispose(); // only per-rig resource; geometries/materials/textures are shared
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
