import { describe, it, expect } from 'vitest';
import { createSim, stepSim } from '../src/core/sim.js';
import { BTN } from '../src/core/combat.js';
import { EV } from '../src/core/events.js';
import { TILE, COUNTDOWN_TICKS } from '../src/config.js';
import { mulberry32 } from '../src/core/rng.js';

// Headless full-match: 6 bots play a 5-minute match (6000 ticks) per seed.
// Humans flee zombies and shoot/cure when armed; zombies chase and attack.

function botInputs(sim, rng) {
  for (const p of sim.players) {
    if (!p || !p.alive) continue;
    let mx = 0, my = 0, buttons = 0, aimDir = 0;

    if (p.isZombie) {
      const target = nearestHuman(sim, p);
      if (target) {
        const dx = target.x - p.x, dy = target.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        mx = dx / d;
        my = dy / d;
        aimDir = angleToAim(dx, dy);
        if (d < TILE * 1.2) buttons |= BTN.ATTACK;
      } else {
        mx = rng() * 2 - 1;
        my = rng() * 2 - 1;
      }
    } else {
      const threat = nearestZombieEntity(sim, p);
      if (threat) {
        const dx = p.x - threat.x, dy = p.y - threat.y;
        const d = Math.hypot(dx, dy) || 1;
        mx = dx / d;
        my = dy / d;
        const tdx = threat.x - p.x, tdy = threat.y - p.y;
        aimDir = angleToAim(tdx, tdy);
        if (p.hasGun && p.ammo > 0 && d < TILE * 8) buttons |= BTN.SHOOT;
        if (p.vaccines > 0 && d < TILE * 1.1) buttons |= BTN.USE;
      } else {
        // wander toward crates if any, else random
        const c = sim.crates[0];
        if (c) {
          const dx = c.x - p.x, dy = c.y - p.y;
          const d = Math.hypot(dx, dy) || 1;
          mx = dx / d; my = dy / d;
        } else {
          mx = rng() * 2 - 1;
          my = rng() * 2 - 1;
        }
      }
    }
    p.input = { moveX: mx, moveY: my, buttons, aimDir, seq: sim.tick };
  }
}

function nearestHuman(sim, from) {
  let best = null, bd = Infinity;
  for (const p of sim.players) {
    if (!p || !p.alive || p.isZombie || p.removedAtTick !== null) continue;
    const d = Math.hypot(p.x - from.x, p.y - from.y);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

function nearestZombieEntity(sim, from) {
  let best = null, bd = TILE * 12;
  for (const p of sim.players) {
    if (!p || !p.alive || !p.isZombie || p.removedAtTick !== null) continue;
    const d = Math.hypot(p.x - from.x, p.y - from.y);
    if (d < bd) { bd = d; best = p; }
  }
  for (const n of sim.npcs) {
    if (!n.alive || !n.isZombie) continue;
    const d = Math.hypot(n.x - from.x, n.y - from.y);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

function angleToAim(dx, dy) {
  let a = Math.atan2(dy, dx);
  if (a < 0) a += Math.PI * 2;
  return Math.round((a / (Math.PI * 2)) * 256) & 255;
}

describe('headless bot match (5min, 6 players)', () => {
  const seeds = [11, 222, 3333, 44444, 555555, 6666666, 777, 88, 9, 1010];

  for (const seed of seeds) {
    it(`seed ${seed}: completes with a valid winner and consistent state`, () => {
      const sim = createSim({ mapSeed: seed, roleSeed: seed * 31 + 7, durationMin: 5 },
        Array.from({ length: 6 }, (_, i) => ({ pid: i, name: 'B' + i, look: i })));
      const rng = mulberry32(seed ^ 0xBEEF);
      const allEvents = [];
      const maxTicks = COUNTDOWN_TICKS + 5 * 60 * 20 + 10;
      let infectionEvents = 0;

      for (let t = 0; t < maxTicks && sim.phase !== 'ended'; t++) {
        botInputs(sim, rng);
        const evs = stepSim(sim);
        allEvents.push(...evs);

        if (t % 200 === 0) {
          // invariants
          for (const p of sim.players) {
            if (!p) continue;
            expect(Number.isFinite(p.x), 'player x finite').toBe(true);
            expect(Number.isFinite(p.y), 'player y finite').toBe(true);
            expect(p.x).toBeGreaterThanOrEqual(0);
            expect(p.y).toBeGreaterThanOrEqual(0);
            expect(p.x).toBeLessThanOrEqual(sim.map.w * TILE);
            expect(p.y).toBeLessThanOrEqual(sim.map.h * TILE);
          }
          for (const n of sim.npcs) {
            if (!n.alive) continue;
            expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
          }
        }
      }

      expect(sim.phase).toBe('ended');
      expect(['zombie', 'human']).toContain(sim.winner);

      // event log consistency: every player infection event matches a zombie flip
      infectionEvents = allEvents.filter((e) => e.t === EV.PLAYER_INFECTED).length;
      const cureEvents = allEvents.filter((e) => e.t === EV.PLAYER_CURED).length;
      const initialZombies = 2; // 6 players → 2 zombies
      const finalZombies = sim.players.filter((p) => p && p.isZombie).length;
      expect(finalZombies).toBe(initialZombies + infectionEvents - cureEvents);

      // NPC count conserved (NPCs never spawn mid-game; only die)
      expect(sim.npcs.length).toBe(40);
      const endEv = allEvents.find((e) => e.t === EV.MATCH_END);
      expect(endEv.winner).toBe(sim.winner);
      expect(endEv.stats.length).toBe(6);
    });
  }

  it('zombies eventually convert citizens near them (NPC infection works)', () => {
    const sim = createSim({ mapSeed: 99, roleSeed: 1, durationMin: 5 },
      Array.from({ length: 4 }, (_, i) => ({ pid: i, name: 'B' + i, look: i })));
    const rng = mulberry32(4242);
    // teleport a zombie player next to a citizen and mash attack
    const z = sim.players.find((p) => p && p.isZombie);
    for (let i = 0; i < COUNTDOWN_TICKS; i++) stepSim(sim);
    let infected = 0;
    for (let t = 0; t < 600 && !infected; t++) {
      const c = sim.npcs.find((n) => n.alive && !n.isZombie);
      z.x = c.x + 8;
      z.y = c.y;
      const dx = c.x - z.x, dy = c.y - z.y;
      z.input = { moveX: 0, moveY: 0, buttons: BTN.ATTACK, aimDir: angleToAim(dx || 1, dy), seq: t };
      botInputs(sim, rng); // others
      z.input = { moveX: 0, moveY: 0, buttons: BTN.ATTACK, aimDir: angleToAim(dx || 1, dy), seq: t };
      const evs = stepSim(sim);
      infected += evs.filter((e) => e.t === EV.NPC_INFECTED).length;
    }
    expect(infected).toBeGreaterThan(0);
    expect(sim.npcs.some((n) => n.isZombie)).toBe(true);
  });
});
