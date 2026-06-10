import * as THREE from 'three';

// Transient 3D effects. Same spawn(type, x, y, data) API as the old 2D Effects
// so main.js needs no changes. 2D (x, y) → 3D (x, 0, y).

function makeStarTexture(color) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.translate(32, 32);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = i % 2 === 0 ? 28 : 10;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeTextTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 48px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeGhostTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f4f4fa';
  ctx.beginPath();
  ctx.arc(32, 26, 18, Math.PI, 0);
  ctx.lineTo(50, 50);
  for (let i = 0; i < 4; i++) ctx.arc(50 - 9 - i * 9, 50, 4.5, 0, Math.PI, (i % 2 === 0));
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#333';
  ctx.beginPath();
  ctx.arc(25, 26, 3, 0, Math.PI * 2);
  ctx.arc(39, 26, 3, 0, Math.PI * 2);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Effects3D {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.tex = null; // lazy
  }

  textures() {
    if (!this.tex) {
      this.tex = {
        starWhite: makeStarTexture('#ffffff'),
        starGold: makeStarTexture('#ffe08a'),
        starMint: makeStarTexture('#aaeeff'),
        flash: makeStarTexture('#fff6c8'),
        bang: makeTextTexture('!', '#ff5a5a'),
        ghost: makeGhostTexture(),
      };
    }
    return this.tex;
  }

  spawn(type, x, y, data = {}) {
    const T = this.textures();
    const ttl = { infect: 550, cure: 850, death: 1400, muzzle: 90, scream: 800, lunge: 160, hit: 140 }[type] || 400;
    const e = { type, born: performance.now(), ttl, objs: [] };
    const add = (obj) => { this.scene.add(obj); e.objs.push(obj); return obj; };

    switch (type) {
      case 'infect': {
        const ring = add(new THREE.Mesh(
          new THREE.TorusGeometry(8, 1.6, 6, 24),
          new THREE.MeshBasicMaterial({ color: 0x7ad87a, transparent: true })
        ));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(x, 3, y);
        e.ring = ring;
        break;
      }
      case 'cure': {
        e.sprites = [];
        for (let i = 0; i < 7; i++) {
          const s = add(new THREE.Sprite(new THREE.SpriteMaterial({
            map: [T.starWhite, T.starGold, T.starMint][i % 3], transparent: true,
          })));
          s.scale.setScalar(7);
          s.position.set(x + (Math.random() - 0.5) * 16, 12 + Math.random() * 8, y + (Math.random() - 0.5) * 16);
          s.userData.vy = 22 + Math.random() * 14;
          e.sprites.push(s);
        }
        break;
      }
      case 'death': {
        const g = add(new THREE.Sprite(new THREE.SpriteMaterial({ map: T.ghost, transparent: true })));
        g.scale.setScalar(16);
        g.position.set(x, 18, y);
        e.ghost = g;
        for (let i = 0; i < 5; i++) {
          const p = add(new THREE.Mesh(
            new THREE.SphereGeometry(4, 6, 5),
            new THREE.MeshBasicMaterial({ color: 0xe6e6ea, transparent: true })
          ));
          const a = (i / 5) * Math.PI * 2;
          p.position.set(x + Math.cos(a) * 7, 8, y + Math.sin(a) * 7);
          p.userData.dir = a;
          e.objs.push(p);
        }
        break;
      }
      case 'muzzle': {
        const s = add(new THREE.Sprite(new THREE.SpriteMaterial({ map: T.flash, transparent: true })));
        s.scale.setScalar(14);
        s.position.set(x, data.h ?? 24, y);
        break;
      }
      case 'scream': {
        const s = add(new THREE.Sprite(new THREE.SpriteMaterial({ map: T.bang, transparent: true })));
        s.scale.setScalar(12);
        s.position.set(x, 52, y);
        e.bang = s;
        break;
      }
      case 'hit': {
        const s = add(new THREE.Mesh(
          new THREE.SphereGeometry(4, 8, 6),
          new THREE.MeshBasicMaterial({ color: 0xff5a5a, transparent: true })
        ));
        s.position.set(x, 26, y);
        e.hitMesh = s;
        break;
      }
      case 'lunge':
      default:
        break;
    }
    if (e.objs.length) this.list.push(e);
  }

  update(now) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      const k = (now - e.born) / e.ttl;
      if (k >= 1) {
        for (const o of e.objs) {
          this.scene.remove(o);
          o.material?.dispose?.();
          o.geometry?.dispose?.();
        }
        this.list.splice(i, 1);
        continue;
      }
      switch (e.type) {
        case 'infect':
          e.ring.scale.setScalar(1 + k * 2.6);
          e.ring.material.opacity = 1 - k;
          break;
        case 'cure':
          for (const s of e.sprites) {
            s.position.y += s.userData.vy * 0.016;
            s.material.opacity = 1 - k;
            s.material.rotation += 0.08;
          }
          break;
        case 'death':
          e.ghost.position.y = 18 + k * 34;
          e.ghost.material.opacity = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
          for (const o of e.objs) {
            if (o === e.ghost) continue;
            o.position.x += Math.cos(o.userData.dir) * 0.5;
            o.position.z += Math.sin(o.userData.dir) * 0.5;
            o.material.opacity = Math.max(0, 0.9 - k * 2);
          }
          break;
        case 'scream':
          e.bang.position.y = 52 + k * 10;
          e.bang.material.opacity = 1 - k;
          break;
        case 'hit':
          e.hitMesh.scale.setScalar(1 + k * 2);
          e.hitMesh.material.opacity = 1 - k;
          break;
        default:
          for (const o of e.objs) if (o.material) o.material.opacity = 1 - k;
          break;
      }
    }
  }

  dispose() {
    for (const e of this.list) {
      for (const o of e.objs) {
        this.scene.remove(o);
        o.material?.dispose?.();
        o.geometry?.dispose?.();
      }
    }
    this.list = [];
    if (this.tex) for (const t of Object.values(this.tex)) t.dispose();
  }
}
