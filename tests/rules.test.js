import { describe, it, expect } from 'vitest';
import { zombieCountFor, assignRoles, evaluateWin } from '../src/core/rules.js';

describe('zombieCountFor (spec rule 2)', () => {
  it('matches the spec table for 2..10 players', () => {
    expect(zombieCountFor(2)).toBe(1);
    expect(zombieCountFor(3)).toBe(1);
    expect(zombieCountFor(4)).toBe(2);
    expect(zombieCountFor(5)).toBe(2);
    expect(zombieCountFor(6)).toBe(2);
    expect(zombieCountFor(7)).toBe(3);
    expect(zombieCountFor(8)).toBe(3);
    expect(zombieCountFor(9)).toBe(3);
    expect(zombieCountFor(10)).toBe(3);
  });
});

describe('assignRoles', () => {
  it('is deterministic for the same seed', () => {
    const pids = [0, 1, 2, 3, 4, 5, 6];
    expect(assignRoles(pids, 12345)).toEqual(assignRoles(pids, 12345));
  });
  it('picks the right count and valid pids', () => {
    for (let n = 2; n <= 10; n++) {
      const pids = Array.from({ length: n }, (_, i) => i);
      const z = assignRoles(pids, n * 7919);
      expect(z.length).toBe(zombieCountFor(n));
      expect(new Set(z).size).toBe(z.length);
      for (const pid of z) expect(pids).toContain(pid);
    }
  });
  it('differs across seeds (sanity)', () => {
    const pids = Array.from({ length: 10 }, (_, i) => i);
    const sets = new Set();
    for (let s = 0; s < 30; s++) sets.add(assignRoles(pids, s).join(','));
    expect(sets.size).toBeGreaterThan(3);
  });
});

function fakeSim({ players, tick = 100, endsAtTick = 1000 }) {
  return {
    tick,
    endsAtTick,
    players: players.map((p, i) => ({
      pid: i, alive: true, isZombie: false, removedAtTick: null, ...p,
    })),
  };
}

describe('evaluateWin (spec rules 8–9)', () => {
  it('null while both teams alive and time remains', () => {
    expect(evaluateWin(fakeSim({ players: [{ isZombie: true }, {}] }))).toBe(null);
  });
  it('zombie win when all players are zombies', () => {
    expect(evaluateWin(fakeSim({ players: [{ isZombie: true }, { isZombie: true }] }))).toBe('zombie');
  });
  it('human win when last zombie player is killed', () => {
    expect(evaluateWin(fakeSim({ players: [{ isZombie: true, alive: false }, {}] }))).toBe('human');
  });
  it('human win when last zombie player is cured (counts as human)', () => {
    expect(evaluateWin(fakeSim({ players: [{ isZombie: false }, {}] }))).toBe('human');
  });
  it('human win at timer expiry with a human alive', () => {
    expect(evaluateWin(fakeSim({ players: [{ isZombie: true }, {}], tick: 1000 }))).toBe('human');
  });
  it('last-tick infection beats the timer (zombie win)', () => {
    expect(evaluateWin(fakeSim({ players: [{ isZombie: true }, { isZombie: true }], tick: 1000 }))).toBe('zombie');
  });
  it('removed players are excluded: all humans left → zombie win', () => {
    expect(evaluateWin(fakeSim({ players: [{ isZombie: true }, { removedAtTick: 50 }] }))).toBe('zombie');
  });
  it('dead humans count as eliminated humans → zombie win', () => {
    expect(evaluateWin(fakeSim({ players: [{ isZombie: true }, { alive: false }] }))).toBe('zombie');
  });
  it('empty/abandoned room → aborted', () => {
    expect(evaluateWin(fakeSim({ players: [{ removedAtTick: 1 }, { removedAtTick: 2 }] }))).toBe('aborted');
  });
});
