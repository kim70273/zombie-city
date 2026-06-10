import { TILE } from '../config.js';
import { spriteDir } from '../core/movement.js';
import { ChunkCache } from './tilemap.js';
import { Effects } from './effects.js';
import { getAtlas, drawCharacter } from './chars.js';
import { makeCrateSprite, makeParachuteSprite, makeGunSprite, makeBulletSprite } from './props.js';
import { CRATE_FALL_TICKS } from '../config.js';

// World renderer: camera, chunked tiles, y-sorted entities, roofs, effects.
// HUD is drawn separately (hud.js) in screen space.

export class Renderer {
  constructor(canvas, map) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = map;
    this.chunks = new ChunkCache(map);
    this.effects = new Effects();
    this.crate = makeCrateSprite();
    this.parachute = makeParachuteSprite();
    this.gun = makeGunSprite();
    this.bullet = makeBulletSprite();
    this.roofAlpha = new Map();
    this.anim = new Map(); // entity key → {x, y, t, moving, blinkAt, attackUntil}
    this.lastNow = performance.now();
    this.camX = 0;
    this.camY = 0;
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.canvas.width = Math.round(this.canvas.clientWidth * dpr);
    this.canvas.height = Math.round(this.canvas.clientHeight * dpr);
    this.ctx.imageSmoothingEnabled = false;
  }

  animState(key, x, y, now) {
    let a = this.anim.get(key);
    if (!a) {
      a = { x, y, t: now, moving: false, blinkAt: now + 1500 + Math.random() * 3000, attackUntil: 0 };
      this.anim.set(key, a);
    }
    const dt = Math.max(1, now - a.t);
    const sp = Math.hypot(x - a.x, y - a.y) / dt * 1000;
    a.moving = sp > 8;
    a.x = x;
    a.y = y;
    a.t = now;
    return a;
  }

  triggerAttack(key, now) {
    const a = this.anim.get(key);
    if (a) a.attackUntil = now + 220;
  }

  colFor(a, now) {
    if (now < a.attackUntil) return 5;
    if (a.moving) return Math.floor(now / 125) % 4;
    if (now > a.blinkAt) {
      if (now > a.blinkAt + 130) a.blinkAt = now + 1800 + Math.random() * 3200;
      return 4;
    }
    return 1;
  }

  /**
   * @param view {players, npcs, crates, projectiles, phase}
   * @param cam {x, y} world target (clamped here)
   * @param selfPid for highlighting
   */
  draw(view, cam, now, selfPid) {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const vw = this.canvas.width / dpr;
    const vh = this.canvas.height / dpr;
    const mapW = this.map.w * TILE;
    const mapH = this.map.h * TILE;
    const dtSec = Math.min(0.1, (now - this.lastNow) / 1000);
    this.lastNow = now;

    this.camX = mapW <= vw ? mapW / 2 : Math.max(vw / 2, Math.min(mapW - vw / 2, cam.x));
    this.camY = mapH <= vh ? mapH / 2 : Math.max(vh / 2, Math.min(mapH - vh / 2, cam.y));
    const ox = this.camX - vw / 2;
    const oy = this.camY - vh / 2;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#14141e';
    ctx.fillRect(0, 0, vw, vh);
    ctx.translate(-Math.round(ox), -Math.round(oy));

    // 1. ground
    this.chunks.drawVisible(ctx, ox, oy, ox + vw, oy + vh);

    // 2. crates (ground layer)
    for (const c of view.crates) {
      const falling = c.ticksToLand > 0;
      // landing shadow
      const shScale = falling ? 0.4 + 0.6 * (1 - c.ticksToLand / CRATE_FALL_TICKS) : 1;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(c.x, c.y + 4, 14 * shScale, 6 * shScale, 0, 0, Math.PI * 2);
      ctx.fill();
      if (falling) {
        const alt = (c.ticksToLand / CRATE_FALL_TICKS) * 300;
        ctx.drawImage(this.parachute, c.x - this.parachute.width / 2, c.y - alt - 36 - this.parachute.height / 2);
        ctx.drawImage(this.crate, c.x - this.crate.width / 2, c.y - alt - this.crate.height);
      } else {
        const pulse = 6 + Math.sin(now / 250) * 2;
        ctx.strokeStyle = 'rgba(255,210,74,0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 16 + pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.drawImage(this.crate, c.x - this.crate.width / 2, c.y - this.crate.height + 4);
      }
    }

    // 3. entities y-sorted
    const ents = [];
    for (const n of view.npcs) {
      if (!n.alive) continue;
      if (n.x < ox - 64 || n.x > ox + vw + 64 || n.y < oy - 80 || n.y > oy + vh + 80) continue;
      ents.push({ kind: 'n', e: n });
    }
    for (const p of view.players) {
      if (!p.alive || p.removed) continue;
      ents.push({ kind: 'p', e: p });
    }
    ents.sort((a, b) => a.e.y - b.e.y);

    for (const { kind, e } of ents) {
      const key = kind + e[kind === 'p' ? 'pid' : 'id'];
      const a = this.animState(key, e.x, e.y, now);
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      ctx.ellipse(e.x, e.y + 2, 9, 4, 0, 0, Math.PI * 2);
      ctx.fill();

      const atlas = getAtlas(e.look ?? 0, !!e.isZombie, kind === 'n');
      const dir = spriteDir(e.facing ?? 0);
      drawCharacter(ctx, atlas, dir, this.colFor(a, now), e.x, e.y + 4);

      if (kind === 'p') {
        // gun overlay for armed humans
        if (e.hasGun && !e.isZombie) {
          const gx = dir === 1 ? 8 : dir === 2 ? -8 : 6;
          ctx.save();
          ctx.translate(e.x + gx, e.y - 12);
          if (dir === 2) ctx.scale(-1, 1);
          ctx.drawImage(this.gun, -this.gun.width / 2, -this.gun.height / 2);
          ctx.restore();
        }
        // stun stars
        if (e.stunned) {
          for (let s = 0; s < 3; s++) {
            const ang = now / 200 + (s * Math.PI * 2) / 3;
            ctx.fillStyle = '#ffd24a';
            ctx.beginPath();
            ctx.arc(e.x + Math.cos(ang) * 12, e.y - 42 + Math.sin(ang) * 3, 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        // name tag
        const name = e.name || '';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        const tw = ctx.measureText(name).width + 8;
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        roundRect(ctx, e.x - tw / 2, e.y - 56, tw, 13, 4);
        ctx.fill();
        ctx.fillStyle = e.pid === selfPid ? '#ffd24a' : e.isZombie ? '#b8e8b0' : '#ffffff';
        ctx.fillText(name, e.x, e.y - 46);
        if (!e.connected && !e.removed) {
          ctx.fillStyle = '#ffaa00';
          ctx.fillText('연결 끊김…', e.x, e.y - 60);
        }
        // zombie player hp pips
        if (e.isZombie && e.hp > 0) {
          for (let i = 0; i < 4; i++) {
            ctx.fillStyle = i < e.hp ? '#7ad87a' : 'rgba(0,0,0,0.35)';
            ctx.fillRect(e.x - 14 + i * 8, e.y - 42, 6, 3);
          }
        }
      }
    }

    // 4. projectiles
    for (const pr of view.projectiles) {
      ctx.drawImage(this.bullet, pr.x - 2, pr.y - 12);
    }

    // 5. roofs (fade when the camera target is inside)
    const selfB = this.map.buildingAt(cam.x, cam.y);
    for (const b of this.map.buildings) {
      const bx = b.x * TILE;
      const by = b.y * TILE;
      const bw = b.w * TILE;
      const bh = b.h * TILE;
      if (bx > ox + vw || by > oy + vh || bx + bw < ox || by + bh < oy) continue;
      const target = b.id === selfB ? 0.15 : 1;
      let alpha = this.roofAlpha.get(b.id) ?? 1;
      alpha += (target - alpha) * Math.min(1, 5 * dtSec);
      this.roofAlpha.set(b.id, alpha);
      if (alpha < 0.02) continue;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = b.roofColor;
      ctx.fillRect(bx, by, bw, bh);
      // two-tone shading: lighter upper slope
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      if (bw >= bh) ctx.fillRect(bx, by, bw, bh / 2);
      else ctx.fillRect(bx, by, bw / 2, bh);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 2;
      ctx.strokeRect(bx + 1, by + 1, bw - 2, bh - 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      if (bw >= bh) {
        ctx.moveTo(bx + 4, by + bh / 2);
        ctx.lineTo(bx + bw - 4, by + bh / 2);
      } else {
        ctx.moveTo(bx + bw / 2, by + 4);
        ctx.lineTo(bx + bw / 2, by + bh - 4);
      }
      ctx.stroke();
      // door awnings so entrances are findable from outside
      ctx.fillStyle = 'rgba(40,24,16,0.65)';
      for (const d of b.doors) {
        ctx.fillRect(d.tx * TILE + 4, d.ty * TILE + 4, TILE - 8, TILE - 8);
        ctx.fillStyle = '#ffd24a';
        ctx.fillRect(d.tx * TILE + TILE / 2 - 2, d.ty * TILE + TILE / 2 - 2, 4, 4);
        ctx.fillStyle = 'rgba(40,24,16,0.65)';
      }
      ctx.globalAlpha = 1;
    }

    // 6. effects
    this.effects.draw(ctx, now);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
