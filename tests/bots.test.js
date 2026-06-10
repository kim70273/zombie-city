import { describe, it, expect } from 'vitest';
import { createSim, stepSim } from '../src/core/sim.js';
import { botInput } from '../src/core/bots.js';
import { mulberry32 } from '../src/core/rng.js';
import { COUNTDOWN_TICKS } from '../src/config.js';

// 컴퓨터(봇) 컨트롤러가 풀매치를 완주시키는지 — 호스트 1명 + 봇 N명 시나리오.

describe('bot-driven full match', () => {
  for (const [seed, bots] of [[31, 3], [77, 5], [1234, 9]]) {
    it(`seed ${seed}, host+${bots} bots: completes with a valid winner`, () => {
      const roster = Array.from({ length: bots + 1 }, (_, i) => ({
        pid: i, name: i === 0 ? '방장' : `컴퓨터${i}`, look: i % 8,
      }));
      const sim = createSim({ mapSeed: seed, roleSeed: seed * 13 + 1, durationMin: 5 }, roster);
      const rng = mulberry32(seed ^ 0xB07);
      const maxTicks = COUNTDOWN_TICKS + 5 * 60 * 20 + 10;

      for (let t = 0; t < maxTicks && sim.phase !== 'ended'; t++) {
        // every player (host stand-in included) is bot-driven
        for (const p of sim.players) {
          if (p && p.alive) p.input = botInput(sim, p, rng);
        }
        stepSim(sim);
        if (t % 500 === 0) {
          for (const p of sim.players) {
            if (p) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
          }
        }
      }
      expect(sim.phase).toBe('ended');
      expect(['zombie', 'human']).toContain(sim.winner);
    });
  }

  it('bot inputs are always valid frames', () => {
    const sim = createSim({ mapSeed: 5, roleSeed: 5, durationMin: 5 },
      [{ pid: 0, name: 'a', look: 0 }, { pid: 1, name: 'b', look: 1 }]);
    const rng = mulberry32(9);
    for (let i = 0; i < COUNTDOWN_TICKS + 200; i++) {
      for (const p of sim.players) {
        if (!p) continue;
        const f = botInput(sim, p, rng);
        expect(Math.hypot(f.moveX, f.moveY)).toBeLessThanOrEqual(1.0001);
        expect(f.aimDir).toBeGreaterThanOrEqual(0);
        expect(f.aimDir).toBeLessThanOrEqual(255);
        p.input = f;
      }
      stepSim(sim);
    }
  });
});
