import { TILE } from '../config.js';
import { BTN } from './combat.js';
import { visible } from './npc.js';

// Host-side controllers for "컴퓨터" (bot) players. Pure & headless: given the
// sim and a bot player, produce an InputFrame each tick. Bot memory lives on
// the player object (host only; never replicated).

export function botInput(sim, p, rng) {
  const mem = p.botMem || (p.botMem = { wx: p.x, wy: p.y, until: 0 });
  let mx = 0;
  let my = 0;
  let buttons = 0;
  let aim = { x: 1, y: 0 };

  if (p.isZombie) {
    // hunt the nearest human player; build an NPC army when no player is near
    const target = nearestHumanPlayer(sim, p, 16 * TILE) || nearestCitizen(sim, p, 8 * TILE);
    if (target) {
      const d = dist(p, target);
      aim = dir(p, target);
      mx = aim.x;
      my = aim.y;
      if (d < TILE * 1.1) buttons |= BTN.ATTACK;
    } else {
      ({ mx, my } = wander(sim, p, mem, rng));
    }
  } else {
    const threat = nearestZombieEntity(sim, p, 9 * TILE);
    if (threat) {
      const d = dist(p, threat);
      aim = dir(p, threat);
      if (p.vaccines > 0 && d < TILE * 1.1) {
        buttons |= BTN.USE;
      }
      if (p.hasGun && p.ammo > 0 && d < TILE * 9) {
        buttons |= BTN.SHOOT;
        // hold ground while shooting at range; back away when close
        if (d < TILE * 4) { mx = -aim.x; my = -aim.y; }
      } else {
        // flee with a slight tangent so walls don't trap us
        const t = rng() < 0.5 ? 1 : -1;
        mx = -aim.x - aim.y * 0.4 * t;
        my = -aim.y + aim.x * 0.4 * t;
      }
    } else {
      const crate = nearestCrate(sim, p);
      if (crate && dist(p, crate) > TILE * 0.5) {
        const v = dir(p, crate);
        mx = v.x;
        my = v.y;
      } else {
        ({ mx, my } = wander(sim, p, mem, rng));
      }
    }
  }

  const len = Math.hypot(mx, my);
  if (len > 1) { mx /= len; my /= len; }
  let a = Math.atan2(aim.y, aim.x);
  if (a < 0) a += Math.PI * 2;
  return {
    moveX: mx, moveY: my, buttons,
    aimDir: Math.round((a / (Math.PI * 2)) * 256) & 255,
    seq: sim.tick & 0xffff,
  };
}

function wander(sim, p, mem, rng) {
  if (sim.tick >= mem.until || dist(p, { x: mem.wx, y: mem.wy }) < TILE) {
    for (let i = 0; i < 8; i++) {
      const tx = ((p.x / TILE) | 0) + Math.floor(rng() * 21) - 10;
      const ty = ((p.y / TILE) | 0) + Math.floor(rng() * 21) - 10;
      if (!sim.map.solid(tx, ty)) {
        mem.wx = tx * TILE + TILE / 2;
        mem.wy = ty * TILE + TILE / 2;
        break;
      }
    }
    mem.until = sim.tick + 40 + Math.floor(rng() * 60); // 2–5s
  }
  const v = dir(p, { x: mem.wx, y: mem.wy });
  return { mx: v.x, my: v.y };
}

function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function dir(a, b) {
  const d = dist(a, b) || 1;
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
}

function nearestHumanPlayer(sim, from, r) {
  let best = null;
  let bd = r;
  for (const p of sim.players) {
    if (!p || p === from || !p.alive || p.isZombie || p.removedAtTick !== null) continue;
    const d = dist(from, p);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

function nearestCitizen(sim, from, r) {
  let best = null;
  let bd = r;
  for (const n of sim.npcs) {
    if (!n.alive || n.isZombie) continue;
    const d = dist(from, n);
    if (d < bd && visible(sim.map, from.x, from.y, n.x, n.y)) { bd = d; best = n; }
  }
  return best;
}

function nearestZombieEntity(sim, from, r) {
  let best = null;
  let bd = r;
  for (const p of sim.players) {
    if (!p || !p.alive || !p.isZombie || p.removedAtTick !== null) continue;
    const d = dist(from, p);
    if (d < bd) { bd = d; best = p; }
  }
  for (const n of sim.npcs) {
    if (!n.alive || !n.isZombie) continue;
    const d = dist(from, n);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

function nearestCrate(sim, from) {
  let best = null;
  let bd = Infinity;
  for (const c of sim.crates) {
    if (sim.tick < c.landTick) continue;
    const d = dist(from, c);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
