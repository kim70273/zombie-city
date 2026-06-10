import { TILE } from '../config.js';
import { T } from '../core/mapgen.js';
import { roundRect } from './renderer.js';
import { makeGunSprite, makeSyringeSprite } from './props.js';

// Screen-space HUD: timer, team counts, minimap, inventory, crate arrows,
// countdown, spectate banner. Drawn after the world pass on the same canvas.

const MINI_COLORS = {
  [T.GRASS]: '#4d7a48',
  [T.ROAD]: '#3c3c44',
  [T.SIDEWALK]: '#6a6a72',
  [T.FLOOR]: '#9a8a70',
  [T.WALL]: '#7a6a5a',
  [T.DOOR]: '#9a8a70',
  [T.TREE]: '#3d6a38',
  [T.BENCH]: '#6a6a72',
  [T.CAR]: '#3c3c44',
  [T.PLAZA]: '#5d8a52',
  [T.FURNITURE]: '#9a8a70',
};

export class Hud {
  constructor(map, isTouch) {
    this.map = map;
    this.isTouch = isTouch;
    this.size = isTouch ? 110 : 150;
    this.bake = document.createElement('canvas');
    this.bake.width = this.size;
    this.bake.height = this.size;
    const ctx = this.bake.getContext('2d');
    const sx = this.size / map.w;
    const sy = this.size / map.h;
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        ctx.fillStyle = MINI_COLORS[map.tileAt(x, y)] || '#4d7a48';
        ctx.fillRect(x * sx, y * sy, Math.ceil(sx), Math.ceil(sy));
      }
    }
    this.gun = makeGunSprite();
    this.syringe = makeSyringeSprite();
  }

  /**
   * @param data {remainingMs, players, npcs(zombie minimap dots), crates, selfPid,
   *              camX, camY, phase, countdownLeft, spectating, vaccineHint}
   */
  draw(ctx, vw, vh, data, now) {
    ctx.save();
    const pad = this.isTouch ? 8 : 14;

    // --- top bar ---
    const self = data.players.find((p) => p.pid === data.selfPid);
    const humans = data.players.filter((p) => p.alive && !p.isZombie && !p.removed).length;
    const zombies = data.players.filter((p) => p.alive && p.isZombie && !p.removed).length;
    const total = Math.floor(data.remainingMs / 1000);
    const mm = String(Math.floor(total / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    const barW = 250;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(ctx, vw / 2 - barW / 2, pad, barW, 38, 10);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const urgent = total <= 60 && data.phase === 'playing';
    ctx.fillStyle = urgent && Math.floor(now / 500) % 2 === 0 ? '#ff5a5a' : '#ffffff';
    ctx.font = 'bold 22px ui-monospace, monospace';
    ctx.fillText(`${mm}:${ss}`, vw / 2, pad + 19);
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#7ab8ff';
    ctx.textAlign = 'left';
    ctx.fillText(`🧑 ${humans}`, vw / 2 - barW / 2 + 14, pad + 19);
    ctx.fillStyle = '#8ee08a';
    ctx.textAlign = 'right';
    ctx.fillText(`🧟 ${zombies}`, vw / 2 + barW / 2 - 14, pad + 19);

    // --- minimap ---
    const ms = this.size;
    const mx = vw - ms - pad;
    const my = pad;
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    roundRect(ctx, mx - 3, my - 3, ms + 6, ms + 6, 6);
    ctx.fill();
    ctx.drawImage(this.bake, mx, my);
    ctx.globalAlpha = 1;
    const kx = ms / (this.map.w * TILE);
    const ky = ms / (this.map.h * TILE);
    for (const n of data.npcs) {
      if (!n.alive || !n.isZombie) continue;
      ctx.fillStyle = '#a03030';
      ctx.fillRect(mx + n.x * kx - 1, my + n.y * ky - 1, 2, 2);
    }
    for (const c of data.crates) {
      const pulse = (now / 400) % 1;
      ctx.strokeStyle = `rgba(255,210,74,${1 - pulse})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(mx + c.x * kx, my + c.y * ky, 2 + pulse * 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const p of data.players) {
      if (!p.alive || p.removed) continue;
      const isSelf = p.pid === data.selfPid;
      ctx.fillStyle = isSelf ? '#ffffff' : p.isZombie ? '#ff5a5a' : '#6ab0ff';
      ctx.beginPath();
      ctx.arc(mx + p.x * kx, my + p.y * ky, isSelf ? 3 : 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- inventory (bottom-right) ---
    if (self && self.alive && !self.isZombie) {
      const iy = vh - pad - 44;
      const ix = vw - pad - 170;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      roundRect(ctx, ix, iy, 170, 44, 10);
      ctx.fill();
      ctx.globalAlpha = self.hasGun ? 1 : 0.25;
      ctx.drawImage(this.gun, ix + 12, iy + 12, 30, 18);
      ctx.globalAlpha = 1;
      ctx.fillStyle = self.hasGun ? '#ffffff' : '#666';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`× ${self.ammo}`, ix + 48, iy + 22);
      ctx.globalAlpha = self.vaccines > 0 ? 1 : 0.25;
      ctx.drawImage(this.syringe, ix + 92, iy + 14, 28, 12);
      ctx.globalAlpha = 1;
      ctx.fillStyle = self.vaccines > 0 ? '#9fe8d2' : '#666';
      ctx.fillText(`× ${self.vaccines}`, ix + 126, iy + 22);
      if (data.vaccineHint) {
        ctx.fillStyle = '#9fe8d2';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(this.isTouch ? '💉 백신 버튼으로 치료!' : 'E — 백신 사용', vw / 2, vh - pad - 60);
      }
    } else if (self && self.alive && self.isZombie) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      const tip = this.isTouch ? '공격 버튼으로 물어뜯기!' : '클릭으로 물어뜯기!';
      ctx.font = 'bold 13px sans-serif';
      const tw = ctx.measureText(tip).width + 20;
      roundRect(ctx, vw / 2 - tw / 2, vh - pad - 34, tw, 26, 8);
      ctx.fill();
      ctx.fillStyle = '#8ee08a';
      ctx.textAlign = 'center';
      ctx.fillText(tip, vw / 2, vh - pad - 21);
    }

    // --- crate direction arrow ---
    const nearest = nearestCrate(data);
    if (nearest) {
      const dx = nearest.x - data.camX;
      const dy = nearest.y - data.camY;
      const off = Math.abs(dx) > vw / 2 - 30 || Math.abs(dy) > vh / 2 - 30;
      if (off) {
        const ang = Math.atan2(dy, dx);
        const r = Math.min(vw, vh) / 2 - 50;
        const ax = vw / 2 + Math.cos(ang) * r;
        const ay = vh / 2 + Math.sin(ang) * r;
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(ang);
        ctx.fillStyle = 'rgba(255,210,74,0.9)';
        ctx.beginPath();
        ctx.moveTo(12, 0);
        ctx.lineTo(-6, -8);
        ctx.lineTo(-6, 8);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#ffd24a';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        const dist = Math.round(Math.hypot(dx, dy) / TILE);
        ctx.fillText(`📦 ${dist}m`, ax, ay + 20);
      }
    }

    // --- countdown ---
    if (data.phase === 'countdown' && data.countdownLeft > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, vw, vh);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 90px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(data.countdownLeft), vw / 2, vh / 2 - 20);
      ctx.font = 'bold 20px sans-serif';
      ctx.fillStyle = self?.isZombie ? '#8ee08a' : '#7ab8ff';
      ctx.fillText(self?.isZombie ? '🧟 당신은 좀비! 모두를 감염시키세요!' : '🧑 살아남으세요! 좀비를 피해 도망치세요!',
        vw / 2, vh / 2 + 40);
    }

    // --- spectate banner ---
    if (data.spectating) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      roundRect(ctx, vw / 2 - 110, pad + 46, 220, 28, 8);
      ctx.fill();
      ctx.fillStyle = '#dddddd';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('👻 관전 중…', vw / 2, pad + 60);
    }

    ctx.restore();
  }
}

function nearestCrate(data) {
  let best = null;
  let bd = Infinity;
  for (const c of data.crates) {
    const d = Math.hypot(c.x - data.camX, c.y - data.camY);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
