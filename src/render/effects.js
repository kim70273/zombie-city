import { makeGhostSprite } from './props.js';

// Transient world-space visual effects, spawned from sim events.

export class Effects {
  constructor() {
    this.list = [];
    this.ghost = null;
  }

  spawn(type, x, y, data = {}) {
    const ttl = { infect: 500, cure: 800, death: 1400, muzzle: 90, scream: 800, lunge: 150, hit: 120 }[type] || 400;
    this.list.push({ type, x, y, born: performance.now(), ttl, data });
  }

  draw(ctx, now) {
    if (!this.ghost) this.ghost = makeGhostSprite();
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      const k = (now - e.born) / e.ttl;
      if (k >= 1) { this.list.splice(i, 1); continue; }
      ctx.save();
      switch (e.type) {
        case 'infect': {
          ctx.strokeStyle = `rgba(122,216,122,${1 - k})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(e.x, e.y - 10, 4 + k * 24, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'cure': {
          for (let s = 0; s < 8; s++) {
            const a = (s / 8) * Math.PI * 2 + k * 2;
            const r = 6 + k * 14;
            const sx = e.x + Math.cos(a) * r;
            const sy = e.y - 12 - k * 16 + Math.sin(a) * r * 0.4;
            ctx.fillStyle = ['#ffffff', '#ffe08a', '#aaeeff'][s % 3];
            ctx.globalAlpha = 1 - k;
            star(ctx, sx, sy, 2.5);
          }
          ctx.globalAlpha = 1;
          break;
        }
        case 'death': {
          if (k < 0.35) {
            for (let s = 0; s < 6; s++) {
              const a = (s / 6) * Math.PI * 2;
              const r = 4 + (k / 0.35) * 10;
              ctx.fillStyle = `rgba(230,230,235,${1 - k / 0.35})`;
              ctx.beginPath();
              ctx.arc(e.x + Math.cos(a) * r, e.y - 8 + Math.sin(a) * r, 5 - (k / 0.35) * 2, 0, Math.PI * 2);
              ctx.fill();
            }
          } else {
            const gk = (k - 0.35) / 0.65;
            ctx.globalAlpha = 1 - gk;
            ctx.drawImage(this.ghost, e.x - this.ghost.width / 2, e.y - 18 - gk * 28);
            ctx.globalAlpha = 1;
          }
          break;
        }
        case 'muzzle': {
          ctx.fillStyle = k < 0.5 ? '#ffffff' : '#ffd24a';
          star(ctx, e.x, e.y, 6 * (1 - k));
          break;
        }
        case 'scream': {
          ctx.globalAlpha = 1 - k;
          ctx.fillStyle = '#ff5a5a';
          ctx.font = 'bold 16px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('!', e.x, e.y - 34 - k * 8);
          ctx.globalAlpha = 1;
          break;
        }
        case 'hit': {
          ctx.fillStyle = `rgba(255,90,90,${1 - k})`;
          ctx.beginPath();
          ctx.arc(e.x, e.y - 10, 3 + k * 6, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'lunge': {
          ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - k)})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(e.x, e.y - 8, 10 + k * 10, e.data.angle - 0.6, e.data.angle + 0.6);
          ctx.stroke();
          break;
        }
        default:
          break;
      }
      ctx.restore();
    }
  }
}

function star(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * 0.4;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}
