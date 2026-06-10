import { describe, it, expect } from 'vitest';
import { createSim, stepSim } from '../src/core/sim.js';
import { crateDropTicks } from '../src/core/items.js';
import { infectPlayer, curePlayer } from '../src/core/combat.js';
import { EV } from '../src/core/events.js';
import { COUNTDOWN_TICKS, ZPLAYER_HP, CURE_IMMUNE_TICKS } from '../src/config.js';

function roster(n) {
  return Array.from({ length: n }, (_, i) => ({ pid: i, name: 'P' + i, look: i % 8 }));
}

function makeSim(n = 4, durationMin = 5, seed = 777) {
  return createSim({ mapSeed: seed, roleSeed: seed ^ 99, durationMin }, roster(n));
}

describe('createSim', () => {
  it('spawns roster with the correct zombie count and NPCs', () => {
    const sim = makeSim(6, 10);
    const players = sim.players.filter(Boolean);
    expect(players.length).toBe(6);
    expect(players.filter((p) => p.isZombie).length).toBe(2);
    expect(sim.npcs.length).toBe(70);
    for (const n of sim.npcs) {
      expect(n.isZombie).toBe(false);
      expect(Number.isFinite(n.x)).toBe(true);
    }
  });

  it('countdown phase transitions to playing', () => {
    const sim = makeSim();
    for (let i = 0; i < COUNTDOWN_TICKS; i++) stepSim(sim);
    expect(sim.phase).toBe('playing');
  });
});

describe('infection / cure mechanics', () => {
  it('infectPlayer flips team, sets hp, respects immunity', () => {
    const sim = makeSim();
    const human = sim.players.find((p) => p && !p.isZombie);
    const ev = [];
    infectPlayer(sim, human, 0, ev);
    expect(human.isZombie).toBe(true);
    expect(human.hp).toBe(ZPLAYER_HP);
    expect(ev[0].t).toBe(EV.PLAYER_INFECTED);

    curePlayer(sim, human, 1, ev);
    expect(human.isZombie).toBe(false);
    // immune right after cure
    const ev2 = [];
    infectPlayer(sim, human, 0, ev2);
    expect(human.isZombie).toBe(false);
    expect(ev2.length).toBe(0);
    // immunity expires
    sim.tick += CURE_IMMUNE_TICKS + 1;
    infectPlayer(sim, human, 0, ev2);
    expect(human.isZombie).toBe(true);
  });
});

describe('crate schedule (spec rule 7)', () => {
  it('5-min mode gets one drop at 2:30; longer modes every 5:00', () => {
    expect(crateDropTicks(5)).toEqual([150 * 20]);
    expect(crateDropTicks(10)).toEqual([6000]);
    expect(crateDropTicks(20)).toEqual([6000, 12000, 18000]);
    expect(crateDropTicks(30)).toEqual([6000, 12000, 18000, 24000, 30000]);
    expect(crateDropTicks(50)).toEqual([6000, 12000, 18000, 24000, 30000, 36000, 42000, 48000, 54000]);
  });
});

describe('win conditions inside stepSim', () => {
  it('zombie win when every player is infected', () => {
    const sim = makeSim(3);
    for (let i = 0; i < COUNTDOWN_TICKS; i++) stepSim(sim);
    const ev = [];
    for (const p of sim.players) if (p && !p.isZombie) infectPlayer(sim, p, 0, ev);
    const events = stepSim(sim);
    expect(sim.phase).toBe('ended');
    expect(sim.winner).toBe('zombie');
    expect(events.some((e) => e.t === EV.MATCH_END)).toBe(true);
  });

  it('human win when zombie players die', () => {
    const sim = makeSim(3);
    for (let i = 0; i < COUNTDOWN_TICKS; i++) stepSim(sim);
    for (const p of sim.players) if (p && p.isZombie) p.alive = false;
    stepSim(sim);
    expect(sim.winner).toBe('human');
  });

  it('human win on timeout', () => {
    const sim = makeSim(2, 5);
    sim.tick = sim.endsAtTick;
    sim.phase = 'playing';
    stepSim(sim);
    expect(sim.winner).toBe('human');
  });
});
