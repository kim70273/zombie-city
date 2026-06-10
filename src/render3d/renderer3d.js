import * as THREE from 'three';
import { TILE, CRATE_FALL_TICKS } from '../config.js';
import { CityWorld } from './world3d.js';
import { CharacterFactory } from './chars3d.js';
import { Effects3D } from './effects3d.js';

// Third-person 3D renderer. Keeps the same view-model contract as the old 2D
// renderer (draw(view, cam, now, selfPid) + effects/triggerAttack/anim/camX/camY)
// so the rest of the app is unchanged. 2D sim (x, y) → 3D (x, 0, y).

const NPC_RENDER_RADIUS = 1100;
const NPC_RENDER_MAX = 70;
const RIG_EXPIRE_MS = 4000;

export class Renderer3D {
  constructor(canvas, map) {
    this.canvas = canvas;
    this.map = map;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(this.dpr);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87c8ec);
    this.scene.fog = new THREE.Fog(0x87c8ec, 900, 2400);

    const hemi = new THREE.HemisphereLight(0xcfeaff, 0x9a8f7a, 1.0);
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
    sun.position.set(600, 1000, 350);
    this.scene.add(hemi, sun, new THREE.AmbientLight(0xffffff, 0.25));

    this.world = new CityWorld(this.scene, map);
    this.factory = new CharacterFactory();
    this.effects = new Effects3D(this.scene);

    this.camera = new THREE.PerspectiveCamera(58, 1, 4, 4000);
    this.camPos = new THREE.Vector3();
    this.camInit = false;

    this.rigs = new Map();    // key → {rig, tag, lastSeen, zombie, gun, yawCur, anim:{x,y,t,moving}, attackUntil}
    this.anim = this.rigsAnimProxy();
    this.crateObjs = new Map();
    this.bullets = [];
    this.shadowGeo = new THREE.CircleGeometry(10, 18);
    this.shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 });
    this.crateGeo = null;
    this.camX = 0;
    this.camY = 0;
    this.resize();
  }

  /** main.js reads renderer.anim.get(key)?.moving — provide a tiny proxy. */
  rigsAnimProxy() {
    const rigs = this.rigs;
    return { get: (key) => rigs.get(key)?.anim };
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  triggerAttack(key, now) {
    const r = this.rigs.get(key);
    if (r) r.attackUntil = now + 220;
  }

  ensureRig(key, e, isNpc, now) {
    let r = this.rigs.get(key);
    if (!r) {
      const rig = this.factory.create({ look: e.look ?? 0, zombie: !!e.isZombie, muted: isNpc });
      const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.5;
      rig.group.add(shadow);
      this.scene.add(rig.group);
      r = {
        rig, lastSeen: now, zombie: !!e.isZombie, gun: false,
        yawCur: 0, attackUntil: 0,
        anim: { x: e.x, y: e.y, t: now, moving: false },
        tag: null,
      };
      this.rigs.set(key, r);
    }
    return r;
  }

  updateTag(r, e) {
    const sig = `${e.name}|${e.isZombie ? 1 : 0}|${e.isZombie ? e.hp : 0}|${e.connected === false ? 1 : 0}`;
    if (r.tagSig === sig) return;
    r.tagSig = sig;
    if (r.tag) {
      r.rig.group.remove(r.tag);
      r.tag.material.map.dispose();
      r.tag.material.dispose();
    }
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext('2d');
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    const tw = Math.min(240, ctx.measureText(e.name).width + 24);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.roundRect(128 - tw / 2, 6, tw, 36, 10);
    ctx.fill();
    ctx.fillStyle = e.isZombie ? '#b8e8b0' : '#ffffff';
    ctx.fillText(e.name, 128, 33);
    if (e.connected === false) {
      ctx.fillStyle = '#ffaa00';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText('연결 끊김…', 128, 58);
    } else if (e.isZombie && e.hp > 0) {
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i < e.hp ? '#7ad87a' : 'rgba(0,0,0,0.4)';
        ctx.fillRect(98 + i * 16, 48, 13, 7);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sprite.scale.set(44, 11, 1);
    sprite.position.y = 64;
    r.rig.group.add(sprite);
    r.tag = sprite;
  }

  syncEntity(key, e, isNpc, now, selfPid, camYaw, dtSec) {
    const r = this.ensureRig(key, e, isNpc, now);
    r.lastSeen = now;
    r.rig.group.visible = true;
    r.rig.group.position.set(e.x, 0, e.y);

    // movement detection (drives walk anim + footstep sfx via anim proxy)
    const dt = Math.max(1, now - r.anim.t);
    const sp = Math.hypot(e.x - r.anim.x, e.y - r.anim.y) / dt * 1000;
    r.anim.moving = sp > 8;
    r.anim.x = e.x;
    r.anim.y = e.y;
    r.anim.t = now;

    // zombie/gun state
    if (r.zombie !== !!e.isZombie) {
      r.zombie = !!e.isZombie;
      r.rig.setZombie(r.zombie);
    }
    const gun = !isNpc && !!e.hasGun && !e.isZombie;
    if (r.gun !== gun) {
      r.gun = gun;
      r.rig.setGun(gun);
    }

    // yaw: players use replicated camera yaw; NPCs use 8-dir facing
    let target;
    if (!isNpc) {
      target = e.pid === selfPid ? camYaw : (e.yaw ?? 0) / 256 * Math.PI * 2;
    } else {
      target = Math.PI / 2 + (e.facing ?? 0) * Math.PI / 4;
    }
    let d = ((target - r.yawCur + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    r.yawCur += d * Math.min(1, 14 * dtSec);
    r.rig.setYaw(r.yawCur);

    r.rig.update(now, {
      moving: r.anim.moving,
      attacking: now < r.attackUntil,
      stunned: !!e.stunned,
    });

    if (!isNpc) this.updateTag(r, e);
  }

  syncCrates(view, now) {
    const seen = new Set();
    for (const c of view.crates) {
      seen.add(c.id);
      let o = this.crateObjs.get(c.id);
      if (!o) {
        if (!this.crateGeo) {
          this.crateGeo = {
            box: new THREE.BoxGeometry(20, 16, 20),
            boxMat: new THREE.MeshToonMaterial({ color: 0xb08a5a }),
            chute: new THREE.ConeGeometry(22, 18, 10, 1, true),
            chuteMat: new THREE.MeshToonMaterial({ color: 0xff7a7a, side: THREE.DoubleSide }),
            ring: new THREE.TorusGeometry(16, 1.6, 6, 24),
            ringMat: new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true }),
          };
        }
        const g = new THREE.Group();
        const box = new THREE.Mesh(this.crateGeo.box, this.crateGeo.boxMat);
        box.position.y = 8;
        const cross = new THREE.Mesh(
          new THREE.BoxGeometry(21, 5, 5),
          new THREE.MeshToonMaterial({ color: 0xe05a5a })
        );
        cross.position.y = 12;
        const chute = new THREE.Mesh(this.crateGeo.chute, this.crateGeo.chuteMat);
        chute.position.y = 34;
        const ring = new THREE.Mesh(this.crateGeo.ring, this.crateGeo.ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 1;
        g.add(box, cross, chute, ring);
        g.position.set(c.x, 0, c.y);
        this.scene.add(g);
        o = { g, chute, ring };
        this.crateObjs.set(c.id, o);
      }
      const falling = c.ticksToLand > 0;
      const alt = falling ? (c.ticksToLand / CRATE_FALL_TICKS) * 320 : 0;
      o.g.position.set(c.x, alt, c.y);
      o.chute.visible = falling;
      o.ring.visible = !falling;
      if (!falling) {
        const pulse = (now / 400) % 1;
        o.ring.scale.setScalar(1 + pulse * 0.7);
        o.ring.material.opacity = 1 - pulse;
      }
    }
    for (const [id, o] of this.crateObjs) {
      if (!seen.has(id)) {
        this.scene.remove(o.g);
        this.crateObjs.delete(id);
      }
    }
  }

  syncBullets(view) {
    while (this.bullets.length < view.projectiles.length) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(2.6, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffe88a })
      );
      this.scene.add(m);
      this.bullets.push(m);
    }
    for (let i = 0; i < this.bullets.length; i++) {
      const pr = view.projectiles[i];
      this.bullets[i].visible = !!pr;
      if (pr) this.bullets[i].position.set(pr.x, 24, pr.y);
    }
  }

  draw(view, cam, now, selfPid) {
    const dtSec = Math.min(0.1, (now - (this.lastNow || now)) / 1000);
    this.lastNow = now;
    this.camX = cam.x;
    this.camY = cam.y;
    const camYaw = cam.yaw ?? 0;

    // players
    const seen = new Set();
    for (const p of view.players) {
      if (!p.alive || p.removed) continue;
      const key = 'p' + p.pid;
      seen.add(key);
      this.syncEntity(key, p, false, now, selfPid, camYaw, dtSec);
    }
    // npcs: nearest first, capped
    const npcs = [];
    for (const n of view.npcs) {
      if (!n.alive) continue;
      const d = Math.hypot(n.x - cam.x, n.y - cam.y);
      if (d <= NPC_RENDER_RADIUS) npcs.push([d, n]);
    }
    npcs.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < Math.min(NPC_RENDER_MAX, npcs.length); i++) {
      const n = npcs[i][1];
      const key = 'n' + n.id;
      seen.add(key);
      this.syncEntity(key, n, true, now, selfPid, camYaw, dtSec);
    }
    // hide/expire unseen rigs
    for (const [key, r] of this.rigs) {
      if (seen.has(key)) continue;
      r.rig.group.visible = false;
      if (now - r.lastSeen > RIG_EXPIRE_MS) {
        this.scene.remove(r.rig.group);
        r.rig.dispose();
        if (r.tag) {
          r.tag.material.map.dispose();
          r.tag.material.dispose();
        }
        this.rigs.delete(key);
      }
    }

    this.syncCrates(view, now);
    this.syncBullets(view);
    this.effects.update(now);

    // building fade for the camera target
    this.world.update(this.map.buildingAt(cam.x, cam.y), dtSec);

    // third-person camera
    const pitch = Math.max(-0.12, Math.min(0.6, cam.pitch ?? 0.3));
    const fx = Math.cos(camYaw);
    const fz = Math.sin(camYaw);
    const dist = 185;
    const dXZ = dist * Math.cos(pitch);
    const target = new THREE.Vector3(
      cam.x - fx * dXZ,
      40 + dist * Math.sin(pitch) + 24,
      cam.y - fz * dXZ
    );
    if (!this.camInit) {
      this.camPos.copy(target);
      this.camInit = true;
    } else {
      this.camPos.lerp(target, Math.min(1, 14 * dtSec));
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(cam.x + fx * 60, 30, cam.y + fz * 60);

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    for (const [, r] of this.rigs) {
      this.scene.remove(r.rig.group);
      r.rig.dispose();
    }
    this.rigs.clear();
    for (const [, o] of this.crateObjs) this.scene.remove(o.g);
    this.crateObjs.clear();
    this.effects.dispose();
    this.world.dispose();
    this.factory.dispose();
    this.shadowGeo.dispose();
    this.shadowMat.dispose();
    this.renderer.dispose();
  }
}
