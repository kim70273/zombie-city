import { describe, it, expect } from 'vitest';
import { encodeInput, decodeInput, encodeSnapshot, decodeSnapshot, bitGet } from '../src/net/codec.js';
import { createSim, stepSim, remainingMs } from '../src/core/sim.js';
import { mulberry32 } from '../src/core/rng.js';
import { POS_QUANT, COUNTDOWN_TICKS } from '../src/config.js';

describe('input codec', () => {
  it('round-trips 500 random frames', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const frame = {
        seq: (rng() * 65536) | 0,
        tick: (rng() * 1e6) | 0,
        moveX: rng() * 2 - 1,
        moveY: rng() * 2 - 1,
        buttons: (rng() * 8) | 0,
        aimDir: (rng() * 256) | 0,
      };
      const pid = (rng() * 10) | 0;
      const d = decodeInput(encodeInput(pid, frame));
      expect(d.pid).toBe(pid);
      expect(d.seq).toBe(frame.seq);
      expect(d.tick).toBe(frame.tick);
      expect(Math.abs(d.moveX - frame.moveX)).toBeLessThan(1 / 100);
      expect(Math.abs(d.moveY - frame.moveY)).toBeLessThan(1 / 100);
      expect(d.buttons).toBe(frame.buttons);
      expect(d.aimDir).toBe(frame.aimDir);
    }
  });
});

describe('snapshot codec', () => {
  it('round-trips a live sim snapshot within quantization error', () => {
    const sim = createSim({ mapSeed: 1234, roleSeed: 55, durationMin: 5 },
      Array.from({ length: 6 }, (_, i) => ({ pid: i, name: 'P' + i, look: i })));
    for (let i = 0; i < COUNTDOWN_TICKS + 100; i++) stepSim(sim);
    // make some state interesting
    sim.npcs[3].isZombie = true;
    sim.npcs[5].alive = false;
    sim.players[2].hasGun = true;
    sim.players[2].ammo = 12;
    sim.crates.push({ id: 1, x: 333.25, y: 444.5, landTick: sim.tick + 30, items: ['gun', 'vaccine'] });
    sim.projectiles.push({ x: 100, y: 200, dx: 1, dy: 0, traveled: 0, ownerPid: 0 });

    const center = sim.players[0];
    const buf = encodeSnapshot(sim, 77, remainingMs(sim), center.x, center.y);
    expect(buf.byteLength).toBeLessThan(1400);
    const s = decodeSnapshot(buf);

    expect(s.seq).toBe(77);
    expect(s.tick).toBe(sim.tick);
    expect(s.phase).toBe('playing');
    expect(s.players.length).toBe(6);
    for (const sp of s.players) {
      const p = sim.players[sp.pid];
      expect(Math.abs(sp.x - p.x)).toBeLessThanOrEqual(1 / POS_QUANT + 1e-9);
      expect(Math.abs(sp.y - p.y)).toBeLessThanOrEqual(1 / POS_QUANT + 1e-9);
      expect(sp.isZombie).toBe(p.isZombie);
      expect(sp.alive).toBe(p.alive);
      expect(sp.hasGun).toBe(p.hasGun);
      expect(sp.ammo).toBe(p.ammo);
    }
    expect(s.npcCount).toBe(sim.npcs.length);
    expect(bitGet(s.npcZombie, 3)).toBe(true);
    expect(bitGet(s.npcZombie, 4)).toBe(false);
    expect(bitGet(s.npcAlive, 5)).toBe(false);
    expect(bitGet(s.npcAlive, 6)).toBe(true);

    // AOI npcs all decode near their sim positions
    for (const sn of s.npcs) {
      const n = sim.npcs[sn.id];
      expect(Math.abs(sn.x - n.x)).toBeLessThanOrEqual(1 / POS_QUANT + 1e-9);
      expect(sn.isZombie).toBe(n.isZombie);
    }

    expect(s.crates.length).toBe(1);
    expect(s.crates[0].items.sort()).toEqual(['gun', 'vaccine']);
    expect(s.crates[0].ticksToLand).toBe(30);
    expect(s.projectiles.length).toBe(1);
    expect(Math.abs(s.projectiles[0].x - 100)).toBeLessThanOrEqual(0.25);
  });

  it('guest mirror tracks authoritative positions through encode→decode over time', () => {
    const sim = createSim({ mapSeed: 777, roleSeed: 3, durationMin: 5 },
      Array.from({ length: 4 }, (_, i) => ({ pid: i, name: 'P' + i, look: i })));
    const rng = mulberry32(1);
    for (let t = 0; t < COUNTDOWN_TICKS + 400; t++) {
      for (const p of sim.players) {
        if (!p) continue;
        p.input = { moveX: rng() * 2 - 1, moveY: rng() * 2 - 1, buttons: 0, aimDir: 0, seq: t };
      }
      stepSim(sim);
      if (t % 2 === 0) {
        const s = decodeSnapshot(encodeSnapshot(sim, t, remainingMs(sim), sim.players[1].x, sim.players[1].y));
        for (const sp of s.players) {
          const p = sim.players[sp.pid];
          expect(Math.abs(sp.x - p.x)).toBeLessThanOrEqual(0.25 + 1e-9);
          expect(Math.abs(sp.y - p.y)).toBeLessThanOrEqual(0.25 + 1e-9);
        }
      }
    }
  });
});
