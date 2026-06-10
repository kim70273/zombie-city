// chars3d.js — procedural anime-style (6.5–7 heads tall, ZZZ/Genshin proportions)
// cel-shaded characters. No external assets: primitives + canvas textures only.
// Geometries/materials/face-textures are shared via the factory; each rig owns
// only its Group, mesh transforms and one small face material.
import * as THREE from 'three';

export const CHAR_HEIGHT = 74; // world units (1 tile = 32). ~6.7 heads tall.

const TAU = Math.PI * 2;
const OUTLINE = 1.025;         // thin inverted-hull outline
const INK = '#1c1526';
const GREY = new THREE.Color(0x8e8e96);
const GREEN = new THREE.Color(0x4d7a50);

// skeleton landmarks (feet at y = 0, +X forward at yaw 0)
const HIP_Y = 37, LEG_Z = 3.3, KNEE_LEN = 19;          // legs ≈ half the body
const SHOULDER_Y = 20, ELBOW_LEN = 11.6;               // torso-local (torso pivot at HIP_Y)
const HEAD_PIV = 22.9, HEAD_R = 5.6, HEAD_LIFT = 5.3;  // head ≈ 11 units tall

// 8 looks — palettes carried over from the 2D game; outfits ZZZ-streetwear/Genshin-cute.
const LOOKS = [
  { hair: 0xff9ecb, top: 0xffffff, bottom: 0x3a4a8c, accent: 0xff4d73, style: 'twintail', outfit: 'skirt', sailor: 1, socks: 1 }, // 세일러복
  { hair: 0x9fe8d2, top: 0xfff1d6, bottom: 0xff8a7a, accent: 0xff6a55, style: 'bob', outfit: 'shorts', sleeves: 1, hood: 1 },     // 후디+쇼츠
  { hair: 0xffe08a, top: 0xcdb6f2, bottom: 0xb39ae8, accent: 0xffffff, style: 'long', outfit: 'dress' },                          // 라벤더 원피스
  { hair: 0x7ab8ff, top: 0xffffff, bottom: 0x3f4a66, accent: 0xff5a5a, style: 'ponytail', outfit: 'shorts', sleeves: 1, track: 1 }, // 트랙재킷
  { hair: 0x4a4a5a, top: 0x555a66, bottom: 0x3c4150, accent: 0xaaddee, style: 'spiky', outfit: 'pants', sleeves: 1, tie: 1 },     // 블레이저
  { hair: 0xb07a4a, top: 0xff6a6a, bottom: 0xffd24a, accent: 0xffd24a, style: 'buns', outfit: 'skirt', belt: 1 },                 // 만두머리
  { hair: 0xc9a6ff, top: 0x6a8ad8, bottom: 0x5d79c6, accent: 0xffd86a, style: 'sidepony', outfit: 'shorts', overall: 1 },         // 오버올
  { hair: 0xff7a5a, top: 0x2f6a6a, bottom: 0xfff1d6, accent: 0xffc9a0, style: 'wavy', outfit: 'skirt', sleeves: 1, belt: 1 },     // 틸 니트
];

/* ----------------------------- small builders ----------------------------- */

function put(parent, geo, mat, pos = [0, 0, 0], scl = [1, 1, 1], rot = null) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(pos[0], pos[1], pos[2]);
  m.scale.set(scl[0], scl[1], scl[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function pivotAt(parent, x, y, z) {
  const p = new THREE.Group();
  p.position.set(x, y, z);
  parent.add(p);
  return p;
}

// inverted-hull outline: same geometry, BackSide black, slightly scaled up
function outlineOf(mesh, outlineMat) {
  const o = new THREE.Mesh(mesh.geometry, outlineMat);
  o.position.copy(mesh.position);
  o.rotation.copy(mesh.rotation);
  o.scale.copy(mesh.scale).multiplyScalar(OUTLINE);
  o.castShadow = false;
  mesh.parent.add(o);
  return o;
}

/* ------------------------------ face textures ----------------------------- */
// 512×512 canvas mapped on the front hemisphere panel.

function drawEye(ctx, cx, cy, side, zombie) {
  ctx.save();
  // sclera
  ctx.beginPath(); ctx.ellipse(cx, cy, 56, 60, 0, 0, TAU);
  ctx.fillStyle = '#ffffff'; ctx.fill();
  // iris — big, vertical gradient, bright at the bottom (glossy anime look)
  const g = ctx.createLinearGradient(0, cy - 46, 0, cy + 58);
  if (zombie) { g.addColorStop(0, '#570909'); g.addColorStop(0.5, '#b51e1e'); g.addColorStop(1, '#ff8a55'); }
  else { g.addColorStop(0, '#23306e'); g.addColorStop(0.45, '#3c66c8'); g.addColorStop(1, '#a4e2ff'); }
  ctx.beginPath(); ctx.ellipse(cx, cy + 6, 42, 52, 0, 0, TAU); ctx.fillStyle = g; ctx.fill();
  // bottom rim light
  ctx.globalAlpha = zombie ? 0.35 : 0.6; ctx.fillStyle = zombie ? '#ffb27a' : '#dff5ff';
  ctx.beginPath(); ctx.ellipse(cx, cy + 38, 24, 12, 0, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
  // pupil
  ctx.beginPath(); ctx.ellipse(cx, cy + 5, 16, 25, 0, 0, TAU); ctx.fillStyle = '#140c20'; ctx.fill();
  // sharp upper lash + outward flick
  ctx.lineCap = 'round'; ctx.strokeStyle = INK;
  ctx.lineWidth = 16;
  ctx.beginPath(); ctx.ellipse(cx, cy, 57, 60, 0, Math.PI * 1.06, Math.PI * 1.94); ctx.stroke();
  ctx.lineWidth = 11;
  ctx.beginPath(); ctx.moveTo(cx + side * 52, cy - 26);
  ctx.quadraticCurveTo(cx + side * 68, cy - 34, cx + side * 76, cy - 47); ctx.stroke();
  // lower lid hint
  ctx.lineWidth = 5; ctx.globalAlpha = 0.7;
  ctx.beginPath(); ctx.moveTo(cx + side * 28, cy + 57);
  ctx.quadraticCurveTo(cx + side * 46, cy + 53, cx + side * 55, cy + 42); ctx.stroke();
  ctx.globalAlpha = 1;
  // sparkles
  ctx.fillStyle = '#ffffff';
  if (zombie) {
    ctx.globalAlpha = 0.45;
    ctx.beginPath(); ctx.ellipse(cx - 12, cy - 12, 10, 12, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  } else {
    ctx.beginPath(); ctx.ellipse(cx - 14, cy - 14, 14, 17, -0.25, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 17, cy + 29, 8, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.arc(cx + 22, cy - 8, 4, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawFace(ctx, mode) {
  const zombie = mode.includes('zombie'), blink = mode.includes('blink');
  ctx.clearRect(0, 0, 512, 512);
  // opaque skin base with soft edges — the unlit face panel hides the harsh
  // toon terminator on the face (flat anime-face lighting, HoYo style)
  const base = ctx.createRadialGradient(256, 250, 190, 256, 250, 325);
  base.addColorStop(0, zombie ? '#9ad394' : '#ffddc6');
  base.addColorStop(0.82, zombie ? '#9ad394' : '#ffddc6');
  base.addColorStop(1, zombie ? 'rgba(154,211,148,0)' : 'rgba(255,221,198,0)');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);
  const EX = 98, EY = 312; // eye centers (low on the face — anime placement)
  // blush (soft radial)
  for (const s of [-1, 1]) {
    const bg = ctx.createRadialGradient(256 + s * 134, 384, 4, 256 + s * 134, 384, 32);
    bg.addColorStop(0, zombie ? 'rgba(120,80,110,0.4)' : 'rgba(255,118,142,0.5)');
    bg.addColorStop(1, 'rgba(255,118,142,0)');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.ellipse(256 + s * 134, 384, 32, 18, 0, 0, TAU); ctx.fill();
  }
  // eyebrows
  ctx.lineCap = 'round'; ctx.lineWidth = 8;
  ctx.strokeStyle = zombie ? '#3a4a35' : '#5a4050';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    if (zombie) { ctx.moveTo(256 + s * 58, 246); ctx.lineTo(256 + s * 132, 224); }
    else {
      ctx.moveTo(256 + s * 54, 240);
      ctx.quadraticCurveTo(256 + s * 98, 220, 256 + s * 136, 232);
    }
    ctx.stroke();
  }
  // tiny nose
  ctx.fillStyle = '#d88a78';
  ctx.beginPath(); ctx.arc(256, 374, 4, 0, TAU); ctx.fill();
  // mouth
  ctx.lineCap = 'round'; ctx.lineWidth = 7;
  if (zombie) {
    ctx.strokeStyle = '#4a2b35';
    ctx.beginPath(); ctx.moveTo(226, 398); ctx.lineTo(244, 405);
    ctx.lineTo(264, 396); ctx.lineTo(286, 404); ctx.stroke();
  } else {
    ctx.strokeStyle = '#8a2f44'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(256, 392, 18, Math.PI * 0.16, Math.PI * 0.84); ctx.stroke();
  }
  // eyes
  for (const s of [-1, 1]) {
    if (blink) { // happy closed lashes
      ctx.lineWidth = 14; ctx.strokeStyle = INK;
      ctx.beginPath(); ctx.arc(256 + s * EX, EY + 10, 40, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      ctx.lineWidth = 10;
      ctx.beginPath(); ctx.moveTo(256 + s * (EX + 36), EY - 12);
      ctx.lineTo(256 + s * (EX + 55), EY - 27); ctx.stroke();
    } else drawEye(ctx, 256 + s * EX, EY, s, zombie);
  }
  if (zombie) { // cheek stitch
    ctx.strokeStyle = '#35522f'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(360, 360); ctx.lineTo(420, 388);
    for (let i = 1; i <= 3; i++) {
      const x = 360 + 60 * i * 0.25, y = 360 + 28 * i * 0.25;
      ctx.moveTo(x - 5, y + 9); ctx.lineTo(x + 5, y - 9);
    }
    ctx.stroke();
  }
}

/* --------------------------------- hair ----------------------------------- */
// Built in head-local space (head sphere centre = origin, +X forward, radius 5.6).

function buildHair(style, c) {
  const { g, head, hair, gloss, acc, out, sway } = c;
  const R = HEAD_R;
  // skull cap + angel-ring gloss torus hugging the crown
  outlineOf(put(head, g.ball, hair, [-0.7, 0.6, 0], [R + 0.65, R + 0.35, R + 0.65]), out);
  put(head, g.ring, gloss, [-0.7, 5.0, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
  // volumetric zigzag bangs covering the forehead (short over the eyes, long between/outside)
  for (let i = 0; i < 5; i++) {
    const zz = -3.8 + i * 1.9, odd = i % 2;
    const x = Math.sqrt(Math.max(6, (R + 0.6) ** 2 - zz * zz * 1.2)) - 0.55;
    put(head, g.ball, hair, [x, 2.5 + odd * 0.55, zz], [1.7, 2.8 - odd * 0.3, 1.7]);
  }
  // side locks framing the face
  if (style !== 'bob' && style !== 'long' && style !== 'wavy')
    for (const s of [-1, 1]) put(head, g.ball, hair, [2.0, -1.8, s * (R - 0.3)], [1.5, 4.2, 1.35]);
  switch (style) {
    case 'twintail':
      for (const s of [-1, 1]) {
        const p = pivotAt(head, -1.2, 2.6, s * (R - 0.3));
        put(p, g.ball, acc, [0, 0, s * 1.1], [1.25, 1.25, 1.25]);
        outlineOf(put(p, g.ball, hair, [-0.4, -3.6, s * 1.6], [2.3, 4.2, 2.1]), out);
        put(p, g.ball, hair, [-1.1, -9.6, s * 2.3], [1.9, 4.0, 1.7]);
        put(p, g.cone, hair, [-1.6, -15.2, s * 2.6], [1.5, 6.0, 1.4], [0, 0, Math.PI]);
        sway.push({ o: p, base: -s * 0.12, off: s * 2, amp: 1 });
      }
      break;
    case 'bob':
      outlineOf(put(head, g.ball, hair, [-1.0, -1.0, 0], [R + 0.2, R - 0.5, R + 0.8]), out);
      for (const s of [-1, 1]) put(head, g.ball, hair, [2.0, -4.6, s * (R - 1.1)], [1.7, 2.4, 1.5]);
      break;
    case 'long': // layered straight mass down to the waist
      outlineOf(put(head, g.ball, hair, [-3.4, -4.5, 0], [2.6, 6.0, 4.8]), out);
      put(head, g.ball, hair, [-3.9, -11.5, 0], [2.2, 6.5, 4.2]);
      put(head, g.ball, hair, [-4.2, -18.0, 0], [1.8, 5.5, 3.4]);
      for (const s of [-1, 1]) put(head, g.ball, hair, [1.8, -6.0, s * (R - 0.7)], [1.3, 5.5, 1.2]);
      break;
    case 'ponytail': {
      const p = pivotAt(head, -4.3, 4.0, 0);
      put(p, g.ball, acc, [0, 0.3, 0], [1.3, 1.3, 1.3]);
      put(p, g.ball, hair, [-1.5, 1.6, 0], [2.4, 2.6, 2.4]);
      outlineOf(put(p, g.ball, hair, [-2.8, -3.2, 0], [2.0, 5.0, 1.9]), out);
      put(p, g.ball, hair, [-3.4, -9.0, 0], [1.6, 4.4, 1.5]);
      put(p, g.cone, hair, [-3.8, -14.4, 0], [1.2, 5.4, 1.1], [0, 0, Math.PI + 0.18]);
      sway.push({ o: p, base: 0, off: 0, amp: 1 });
      break;
    }
    case 'spiky': {
      const S = [[-4.4, 4.6, 0, 0, -0.7], [-1.2, 6.2, 2.2, -0.5, 0.2], [-1.2, 6.2, -2.2, 0.5, 0.2],
                 [2.2, 5.4, 1.2, -0.25, 0.55], [1.6, 5.8, -1.4, 0.4, 0.45],
                 [-3.6, 3.4, 3.2, -0.9, -0.3], [-3.6, 3.4, -3.2, 0.9, -0.3]];
      for (const [x, y, zz, rx, rz] of S) put(head, g.cone, hair, [x, y, zz], [1.3, 3.6, 1.3], [rx, 0, rz]);
      break;
    }
    case 'buns':
      for (const s of [-1, 1]) {
        outlineOf(put(head, g.ball, hair, [-1.4, R + 0.3, s * 3.4], [2.5, 2.2, 2.5]), out);
        put(head, g.box, acc, [-1.4, R - 1.0, s * 4.4], [1.7, 0.9, 1.7]);
        const p = pivotAt(head, -2.2, 0.5, s * (R - 0.6));
        put(p, g.ball, hair, [-0.3, -4.5, s * 0.6], [0.85, 5.0, 0.8]); // thin tail
        sway.push({ o: p, base: -s * 0.08, off: s * 1.5, amp: 0.7 });
      }
      break;
    case 'sidepony': {
      const p = pivotAt(head, -2.4, 3.0, R - 0.9);
      put(p, g.ball, acc, [0, 0.2, 0.8], [1.2, 1.2, 1.2]);
      outlineOf(put(p, g.ball, hair, [-0.6, -3.8, 1.6], [1.9, 4.6, 1.8]), out);
      put(p, g.ball, hair, [-1.2, -9.6, 2.2], [1.5, 4.2, 1.4]);
      put(p, g.cone, hair, [-1.6, -14.8, 2.5], [1.1, 5.0, 1.0], [0, 0, Math.PI]);
      sway.push({ o: p, base: -0.15, off: 1.3, amp: 1 });
      break;
    }
    case 'wavy': {
      for (let i = 0; i < 5; i++) {
        const m = put(head, g.ball, hair,
          [-3.6 - i * 0.25, -1.5 - i * 3.4, (i % 2 ? 1.9 : -1.9) * (1 - i * 0.08)],
          [2.4 - i * 0.25, 2.6, 4.6 - i * 0.55]);
        if (i === 0) outlineOf(m, out);
      }
      for (const s of [-1, 1]) put(head, g.ball, hair, [2.0, -5.0, s * (R - 0.8)], [1.3, 4.0, 1.2]);
      break;
    }
  }
}

/* --------------------------------- factory --------------------------------- */

export class CharacterFactory {
  constructor() {
    this._geo = null;
    this._core = null;
    this._faces = null;
    this._mats = new Map(); // per (look|zombie|muted)
  }

  _ensureCore() {
    if (this._core) return this._core;
    // 2 hard cel steps
    const grad = new THREE.DataTexture(new Uint8Array([158, 255]), 2, 1, THREE.RedFormat);
    grad.minFilter = grad.magFilter = THREE.NearestFilter;
    grad.needsUpdate = true;
    const toon = (hex) => new THREE.MeshToonMaterial({ color: hex, gradientMap: grad });
    this._core = {
      grad,
      skinH: toon(0xffddc6),
      skinZ: toon(0x9ad394),
      shoe: toon(0x35304a),
      gun: toon(0x23232c),
      outline: new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide }),
    };
    return this._core;
  }

  _ensureGeo() {
    if (this._geo) return this._geo;
    // capsule with guaranteed total height, pivot offset baked via translate
    const cap = (r, totalH, dy = 0) => {
      const geo = new THREE.CapsuleGeometry(r, Math.max(0.05, totalH - r * 2), 8, 20);
      geo.computeBoundingBox();
      const h = geo.boundingBox.max.y - geo.boundingBox.min.y;
      if (Math.abs(h - totalH) > 0.05) geo.scale(1, totalH / h, 1);
      if (dy) geo.translate(0, dy, 0);
      return geo;
    };
    const flat = (geo) => {
      const f = geo.toNonIndexed();
      f.computeVertexNormals();
      geo.dispose();
      return f;
    };
    // egg-warp: taper the lower half toward a soft anime jaw (seamless, no chin mesh)
    const egg = (geo, R) => {
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y < 0) {
          const s = 1 - 0.22 * Math.min(1, -y / R);
          pos.setX(i, pos.getX(i) * s);
          pos.setZ(i, pos.getZ(i) * s);
        }
      }
      geo.computeVertexNormals();
      return geo;
    };
    this._geo = {
      head: egg(new THREE.SphereGeometry(HEAD_R, 28, 20), HEAD_R),
      face: egg(new THREE.SphereGeometry(HEAD_R + 0.25, 24, 16, Math.PI - 0.95, 1.9, Math.PI * 0.22, Math.PI * 0.6), HEAD_R + 0.25),
      chest: cap(4.0, 13.5),
      waist: new THREE.CylinderGeometry(2.9, 3.6, 7, 14),
      neck: new THREE.CylinderGeometry(1.35, 1.55, 3.6, 10),
      // pleat facets: non-indexed → per-face normals (toon flatShading unsupported)
      skirt: flat(new THREE.CylinderGeometry(3.6, 7.0, 7.5, 14, 1, true)),
      dress: flat(new THREE.CylinderGeometry(3.8, 8.2, 12, 16, 1, true)),
      shorts: new THREE.CylinderGeometry(2.5, 2.75, 6, 12),
      pantsU: new THREE.CylinderGeometry(2.45, 2.15, 17, 12),
      pantsL: new THREE.CylinderGeometry(2.0, 1.8, 12, 10),
      sock: new THREE.CylinderGeometry(1.95, 1.85, 9, 10),
      thigh: cap(2.4, 21.5, -9.8),   // pivot at hip, knee at -19
      calf: cap(2.05, 16.8, -7.4),   // pivot at knee
      uarm: cap(1.65, 13, -5.6),     // pivot at shoulder, elbow at -11.6
      farm: cap(1.42, 12.4, -5.2),   // pivot at elbow
      ball: new THREE.SphereGeometry(1, 24, 18),
      cone: new THREE.ConeGeometry(1, 1, 14),
      ring: new THREE.TorusGeometry(4.0, 0.22, 8, 28),
      box: new THREE.BoxGeometry(1, 1, 1),
    };
    return this._geo;
  }

  _ensureFaces() {
    if (this._faces) return this._faces;
    if (typeof document === 'undefined') { // headless (Node) fallback
      const mk = () => {
        const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
        t.needsUpdate = true;
        return t;
      };
      this._faces = { normal: mk(), blink: mk(), zombie: mk() };
    } else {
      const mk = (mode) => {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 512;
        drawFace(cv.getContext('2d'), mode);
        const t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      };
      this._faces = { normal: mk('normal'), blink: mk('blink'), zombie: mk('zombie') };
    }
    return this._faces;
  }

  // shared material set for (look, zombie, muted); hair only on the human set
  _matSet(look, zombie, muted) {
    const key = `${look}|${zombie ? 1 : 0}|${muted ? 1 : 0}`;
    let set = this._mats.get(key);
    if (set) return set;
    const core = this._ensureCore();
    const L = LOOKS[look];
    const col = (hex) => {
      const c = new THREE.Color(hex);
      if (muted) c.lerp(GREY, 0.4);
      if (zombie) { c.multiplyScalar(0.75); c.lerp(GREEN, 0.22); }
      return c;
    };
    const toon = (c, extra) => new THREE.MeshToonMaterial({ color: c, gradientMap: core.grad, ...extra });
    set = {
      skin: zombie ? core.skinZ : core.skinH,
      top: toon(col(L.top)),
      bottom: toon(col(L.bottom)),
      // skirt/dress material (open cone → DoubleSide)
      bottomFlat: toon(col(L.bottom), { side: THREE.DoubleSide }),
      accent: toon(col(L.accent)),
      white: toon(col(0xf2f2f6)),
    };
    if (!zombie) {
      set.hair = toon(col(L.hair));
      set.gloss = toon(col(L.hair).lerp(new THREE.Color(0xffffff), 0.18));
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
      set.top.dispose(); set.bottom.dispose(); set.bottomFlat.dispose();
      set.accent.dispose(); set.white.dispose();
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

    const L = LOOKS[look];
    const M = this._hSet, out = core.outline;
    const lists = { skin: [], top: [], bot: [], botFlat: [], acc: [], wht: [] };
    const reg = (list, mesh) => { lists[list].push(mesh); return mesh; };

    // group origin at FEET; +Y up; faces +X at yaw 0
    const group = this.group = new THREE.Group();
    const root = this._root = pivotAt(group, 0, 0, 0);

    /* legs: thigh (hip pivot) → calf (knee pivot) → shoe */
    for (const s of [-1, 1]) {
      const hip = pivotAt(root, 0, HIP_Y, s * LEG_Z);
      reg('skin', put(hip, g.thigh, M.skin));
      const knee = pivotAt(hip, 0, -KNEE_LEN, 0);
      reg('skin', put(knee, g.calf, M.skin));
      if (L.socks) reg('wht', put(knee, g.sock, M.white, [0, -10.5, 0]));
      put(knee, g.ball, core.shoe, [0, -14.6, 0], [2.1, 2.3, 2.1]);          // ankle
      put(knee, g.ball, core.shoe, [1.2, -16.4, 0], [3.3, 1.9, 2.4]);        // shoe
      if (L.outfit === 'shorts') reg('bot', put(hip, g.shorts, M.bottom, [0, -3.0, 0]));
      if (L.outfit === 'pants') {
        reg('bot', put(hip, g.pantsU, M.bottom, [0, -9.2, 0]));
        reg('bot', put(knee, g.pantsL, M.bottom, [0, -5.8, 0]));
      }
      this[s < 0 ? '_hipL' : '_hipR'] = hip;
      this[s < 0 ? '_kneeL' : '_kneeR'] = knee;
    }

    /* torso: hips → slim waist → chest (lean pivot at hips) */
    const torso = this._torso = pivotAt(root, 0, HIP_Y, 0);
    const hips = reg('bot', put(torso, g.ball, M.bottom, [0, 1.8, 0], [4.1, 3.5, 5.1]));
    outlineOf(hips, out);
    reg('top', put(torso, g.waist, M.top, [0, 7.5, 0]));
    const chest = reg('top', put(torso, g.chest, M.top, [0, 14.8, 0], [0.88, 1, 1.32]));
    outlineOf(chest, out);
    reg('skin', put(torso, g.neck, M.skin, [0, 22, 0]));
    for (const s of [-1, 1]) // shoulder caps (sleeve puffs)
      reg('top', put(torso, g.ball, M.top, [0, SHOULDER_Y - 0.5, s * 5.9], [1.9, 1.6, 1.9]));

    /* outfit detail */
    if (L.outfit === 'skirt') {
      const sk = reg('botFlat', put(torso, g.skirt, M.bottomFlat, [0, 1.2, 0]));
      outlineOf(sk, out);
      reg('bot', put(torso, g.box, M.bottom, [0, 5.2, 0], [6.4, 1.6, 7.6])); // waistband
    } else if (L.outfit === 'dress') {
      const dr = reg('botFlat', put(torso, g.dress, M.bottomFlat, [0, -0.5, 0]));
      outlineOf(dr, out);
      reg('wht', put(torso, g.ball, M.white, [0, 20.6, 0], [2.2, 0.8, 2.6])); // white collar
      reg('wht', put(torso, g.box, M.white, [0, 6.0, 0], [6.0, 1.4, 7.2]));   // sash
    }
    if (L.belt) reg('acc', put(torso, g.box, M.accent, [0, 5.4, 0], [6.6, 1.4, 7.8]));
    if (L.sailor) {
      reg('bot', put(torso, g.box, M.bottom, [-1.4, 19.6, 0], [5.2, 1.0, 8.0]));      // sailor collar
      reg('acc', put(torso, g.ball, M.accent, [3.8, 16.4, 0], [1.0, 1.0, 1.0]));      // ribbon knot
      reg('acc', put(torso, g.cone, M.accent, [3.7, 15.2, 1.5], [0.9, 2.6, 0.5], [0.9, 0, 0]));
      reg('acc', put(torso, g.cone, M.accent, [3.7, 15.2, -1.5], [0.9, 2.6, 0.5], [-0.9, 0, 0]));
    }
    if (L.track) {
      put(torso, g.box, core.gun, [3.6, 13.8, 0], [0.7, 12.0, 0.8]);                  // zipper
      reg('acc', put(torso, g.box, M.accent, [3.2, 13.8, 3.3], [0.7, 11.5, 1.1]));    // side stripes
      reg('acc', put(torso, g.box, M.accent, [3.2, 13.8, -3.3], [0.7, 11.5, 1.1]));
    }
    if (L.hood) {
      reg('top', put(torso, g.ball, M.top, [-3.5, 19.0, 0], [2.9, 2.3, 4.0]));        // hood bump
      reg('acc', put(torso, g.box, M.accent, [3.5, 9.8, 0], [1.2, 3.4, 5.2]));        // pocket
    }
    if (L.tie) {
      reg('wht', put(torso, g.ball, M.white, [0, 20.4, 0], [2.4, 0.8, 2.7]));         // shirt collar
      reg('acc', put(torso, g.cone, M.accent, [4.0, 16.6, 0], [0.95, 4.6, 1.5], [0, 0, Math.PI]));
    }
    if (L.overall) {
      reg('bot', put(torso, g.box, M.bottom, [3.3, 12.8, 0], [1.5, 6.0, 6.2]));       // bib
      reg('bot', put(torso, g.box, M.bottom, [1.6, 18.2, 2.6], [1.1, 6.0, 1.5], [0, 0, -0.22])); // straps
      reg('bot', put(torso, g.box, M.bottom, [1.6, 18.2, -2.6], [1.1, 6.0, 1.5], [0, 0, -0.22]));
      reg('acc', put(torso, g.ball, M.accent, [4.0, 15.4, 2.4], [0.6, 0.6, 0.6]));    // buttons
      reg('acc', put(torso, g.ball, M.accent, [4.0, 15.4, -2.4], [0.6, 0.6, 0.6]));
    }

    /* arms: upper (shoulder pivot) → forearm (elbow pivot) → hand */
    const sleeveMat = L.sleeves ? M.top : M.skin;
    const sleeveList = L.sleeves ? 'top' : 'skin';
    for (const s of [-1, 1]) {
      const sh = pivotAt(torso, 0, SHOULDER_Y, s * 6.6);
      reg(sleeveList, put(sh, g.uarm, sleeveMat));
      const el = pivotAt(sh, 0, -ELBOW_LEN, 0);
      reg(sleeveList, put(el, g.farm, sleeveMat));
      reg('skin', put(el, g.ball, M.skin, [0, -11.2, 0], [1.55, 1.55, 1.45])); // hand
      this[s < 0 ? '_shL' : '_shR'] = sh;
      this[s < 0 ? '_elL' : '_elR'] = el;
    }

    /* pistol in the right hand (hidden by default), barrel along -Y of the arm */
    const gun = this._gun = pivotAt(this._elR, 0.7, -11.2, 0);
    put(gun, g.box, core.gun, [0, -2.4, 0], [1.5, 4.8, 1.3]);
    put(gun, g.box, core.gun, [-1.4, -0.4, 0], [2.4, 1.5, 1.1]);
    gun.visible = false;

    /* head: squashed sphere + chin + face panel + hair */
    const headPiv = this._head = pivotAt(torso, 0, HEAD_PIV, 0);
    const headC = pivotAt(headPiv, 0, HEAD_LIFT, 0);
    const hm = reg('skin', put(headC, g.head, M.skin, [0, 0, 0], [1, 0.97, 1]));
    outlineOf(hm, out);
    this._faceMat = new THREE.MeshBasicMaterial({ map: this._faces.normal, transparent: true, alphaTest: 0.06 });
    const face = put(headC, g.face, this._faceMat, [0, 0, 0], [1, 0.97, 1]);
    face.castShadow = false;
    buildHair(L.style, { g, head: headC, hair: M.hair, gloss: M.gloss, acc: M.accent, out, sway: this._sway });

    this._lists = lists;
    this._chest = chest;
  }

  setYaw(a) { this.group.rotation.y = -a; }

  setGun(visible) { this._gun.visible = !!visible; }

  setZombie(z) {
    z = !!z;
    if (z === this._zombie) return;
    this._zombie = z;
    const S = z ? this._zSet : this._hSet; // hair meshes untouched
    const L = this._lists;
    for (const m of L.skin) m.material = S.skin;
    for (const m of L.top) m.material = S.top;
    for (const m of L.bot) m.material = S.bottom;
    for (const m of L.botFlat) m.material = S.bottomFlat;
    for (const m of L.acc) m.material = S.accent;
    for (const m of L.wht) m.material = S.white;
    this._applyFace();
  }

  _applyFace() {
    const f = this._faces; // zombies never blink (texture bg = zombie skin tone)
    this._faceMat.map = this._zombie ? f.zombie : (this._closed ? f.blink : f.normal);
  }

  update(now, state = {}) {
    const { moving = false, attacking = false, stunned = false, airborne = false } = state;
    const t = now * 0.001, z = this._zombie, r = this._root, T = this._torso;

    // blink
    if (this._nextBlink < 0) this._nextBlink = now + 1000 + Math.random() * 3000;
    if (now >= this._nextBlink) {
      this._blinkUntil = now + 130;
      this._nextBlink = now + 2500 + Math.random() * 2500;
    }
    const closed = now < this._blinkUntil;
    if (closed !== this._closed) { this._closed = closed; this._applyFace(); }

    // gait phase (run ≈ 1.4 Hz)
    const p = t * (z ? 5.2 : 8.8) + this._phase;
    const sL = Math.sin(p), sR = Math.sin(p + Math.PI);
    let thL, thR, knL, knR, uaL, uaR, faL, faR;
    let axL = -0.12, axR = 0.12; // slight outward arm tilt

    if (airborne) { // jump tuck
      thL = thR = 0.55; knL = knR = -1.05;
      uaL = uaR = -0.2; faL = faR = 0.5;
      axL = -0.55; axR = 0.55;
    } else if (moving) {
      const amp = z ? 0.32 : 0.7;
      thL = sL * amp; thR = sR * amp;
      const knee = (ph) => -(0.12 + Math.max(0, Math.sin(ph - 0.6)) * (z ? 0.4 : 0.95));
      knL = knee(p); knR = knee(p + Math.PI);
      uaL = -sL * 0.5; uaR = -sR * 0.5;
      faL = 0.25 + Math.max(0, sL) * 0.4; faR = 0.25 + Math.max(0, sR) * 0.4;
    } else { // idle: micro-sway
      thL = thR = 0; knL = knR = -0.06;
      uaL = Math.sin(t * 1.6 + this._phase) * 0.04; uaR = -uaL;
      faL = faR = 0.25;
    }
    if (z && !airborne) { // zombie: arms raised forward
      uaL = 1.22 + Math.sin(t * 2.8 + this._phase) * 0.07;
      uaR = 1.3 + Math.cos(t * 2.4 + this._phase) * 0.07;
      faL = faR = 0.3; axL = axR = 0;
    }
    if (attacking) { // right-arm thrust (both for zombies)
      uaR = 1.5; faR = 0.08; axR = 0;
      if (z) { uaL = 1.5; faL = 0.08; axL = 0; }
    }

    this._hipL.rotation.z = thL; this._hipR.rotation.z = thR;
    this._kneeL.rotation.z = knL; this._kneeR.rotation.z = knR;
    this._shL.rotation.z = uaL; this._shR.rotation.z = uaR;
    this._shL.rotation.x = axL; this._shR.rotation.x = axR;
    this._elL.rotation.z = faL; this._elR.rotation.z = faR;

    // root bob + torso lean/twist
    r.position.y = airborne ? 0
      : moving ? Math.abs(Math.sin(p)) * (z ? 0.5 : 1.1)
      : Math.sin(t * 2.0 + this._phase) * 0.3;
    const lean = z ? -0.3 : attacking ? -0.16 : moving ? -0.1 : airborne ? 0.06 : 0;
    T.rotation.z = lean + (stunned ? Math.sin(t * 16) * 0.14 : 0);
    T.rotation.y = attacking && !z ? 0.3 : 0;
    T.rotation.x = (z && moving) ? Math.sin(t * 3 + this._phase) * 0.06 : 0;
    T.scale.y = 1 + (moving ? 0 : Math.sin(t * 1.9 + this._phase) * 0.01); // breathing

    // head: subtle idle turn / zombie tilt
    const H = this._head;
    if (z) { H.rotation.z = 0.2; H.rotation.x = 0.1; H.rotation.y = 0; }
    else {
      H.rotation.z = airborne ? -0.08 : 0;
      H.rotation.x = 0;
      H.rotation.y = moving ? 0 : Math.sin(t * 0.7 + this._phase) * 0.06;
    }

    // hair sway (pendulum on stored pivots, stronger while moving)
    const amp = (moving ? 0.14 : 0.05), w = moving ? 8.8 : 1.8;
    for (const s of this._sway) {
      s.o.rotation.x = s.base + Math.sin(t * w + this._phase + s.off) * amp * s.amp;
      s.o.rotation.z = (moving ? -0.1 : 0) + Math.cos(t * w * 0.9 + this._phase + s.off) * amp * 0.5 * s.amp;
    }
  }

  dispose() {
    this._faceMat.dispose(); // only per-rig resource
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
