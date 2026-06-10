import { describe, it, expect } from 'vitest';
import { createSim, stepSim } from '../src/core/sim.js';
import { BTN } from '../src/core/combat.js';
import { encodeSnapshot, decodeSnapshot } from '../src/net/codec.js';
import { remainingMs } from '../src/core/sim.js';
import { COUNTDOWN_TICKS, JUMP_VEL, GRAVITY } from '../src/config.js';

function makeSim() {
  const sim = createSim({ mapSeed: 42, roleSeed: 1, durationMin: 5 },
    [{ pid: 0, name: 'a', look: 0 }, { pid: 1, name: 'b', look: 1 }]);
  for (let i = 0; i < COUNTDOWN_TICKS; i++) stepSim(sim);
  return sim;
}

describe('jump physics', () => {
  it('rises then lands back at z=0 within expected airtime', () => {
    const sim = makeSim();
    const p = sim.players[0];
    p.input = { moveX: 0, moveY: 0, buttons: BTN.JUMP, aimDir: 0, seq: 1 };
    stepSim(sim);
    p.input = { moveX: 0, moveY: 0, buttons: 0, aimDir: 0, seq: 2 };
    expect(p.z).toBeGreaterThan(0);
    let peak = 0;
    let ticks = 0;
    while (p.z > 0 && ticks < 100) {
      peak = Math.max(peak, p.z);
      stepSim(sim);
      ticks++;
    }
    expect(p.z).toBe(0);
    const expectAir = (2 * JUMP_VEL) / GRAVITY / 0.05; // ticks
    expect(ticks).toBeGreaterThan(expectAir * 0.6);
    expect(ticks).toBeLessThan(expectAir * 1.6);
    expect(peak).toBeGreaterThan(15);
    expect(peak).toBeLessThan(40);
  });

  it('cannot double-jump while airborne', () => {
    const sim = makeSim();
    const p = sim.players[0];
    p.input = { moveX: 0, moveY: 0, buttons: BTN.JUMP, aimDir: 0, seq: 1 };
    stepSim(sim);
    const vzAfterFirst = p.vz;
    for (let i = 0; i < 3; i++) stepSim(sim); // holding jump while in the air
    expect(p.vz).toBeLessThan(vzAfterFirst); // gravity only — no re-boost
  });

  it('z replicates through the snapshot codec', () => {
    const sim = makeSim();
    sim.players[1].z = 21.4;
    const s = decodeSnapshot(encodeSnapshot(sim, 1, remainingMs(sim), sim.players[0].x, sim.players[0].y));
    const sp = s.players.find((p) => p.pid === 1);
    expect(Math.abs(sp.z - 21.4)).toBeLessThanOrEqual(0.5);
  });
});
