import {
  TILE, TICK_MS, COUNTDOWN_TICKS, SPEED, PLAYER_RADIUS,
  ZPLAYER_HP, LUNGE_IMPULSE,
} from '../config.js';
import { mulberry32, subRng } from './rng.js';
import { generateMap } from './mapgen.js';
import { assignRoles } from './rules.js';
import { evaluateWin } from './rules.js';
import { buildGrid } from './grid.js';
import { moveCircle, facingFrom } from './movement.js';
import { makeNpc, stepNpc } from './npc.js';
import { applyPlayerActions, stepProjectiles, stepRegen } from './combat.js';
import { stepCrates, crateDropTicks } from './items.js';
import { EV } from './events.js';
import { DURATIONS } from '../config.js';

const DT = TICK_MS / 1000;

/**
 * @param {{mapSeed:number, roleSeed:number, durationMin:number}} settings
 * @param {{pid:number, name:string, look:number}[]} roster
 */
export function createSim(settings, roster) {
  const map = generateMap(settings.mapSeed, settings.durationMin);
  const sim = {
    phase: 'countdown',
    tick: 0,
    startTick: COUNTDOWN_TICKS,
    endsAtTick: COUNTDOWN_TICKS + settings.durationMin * 60 * 20,
    settings,
    map,
    players: [],
    npcs: [],
    crates: [],
    projectiles: [],
    nextCrateId: 0,
    winner: null,
    dropTicks: crateDropTicks(settings.durationMin),
    rngFn: subRng(settings.mapSeed, 'sim'),
  };

  const zombiePids = new Set(assignRoles(roster.map((r) => r.pid), settings.roleSeed));
  for (const r of roster) {
    const spawn = map.spawns[r.pid % map.spawns.length];
    const p = makePlayer(r, spawn, zombiePids.has(r.pid));
    sim.players[r.pid] = p;
  }

  const tier = DURATIONS[settings.durationMin] || DURATIONS[10];
  const npcRng = subRng(settings.mapSeed, 'npcs');
  for (let i = 0; i < tier.npcs; i++) {
    const s = map.npcSpawns[(npcRng() * map.npcSpawns.length) | 0];
    sim.npcs.push(makeNpc(i, s.tx, s.ty, (npcRng() * 8) | 0));
  }
  return sim;
}

function makePlayer(r, spawn, isZombie) {
  return {
    pid: r.pid,
    name: r.name,
    look: r.look | 0,
    x: spawn.tx * TILE + TILE / 2,
    y: spawn.ty * TILE + TILE / 2,
    prevX: 0, prevY: 0,
    facing: 0,
    isZombie,
    alive: true,
    hp: isZombie ? ZPLAYER_HP : 0,
    connected: true,
    removedAtTick: null,
    disconnectedAtTick: null,
    hasGun: false, ammo: 0, vaccines: 0,
    attackCdUntil: 0, gunCdUntil: 0, stunUntil: 0, immuneUntil: 0,
    lungeUntil: 0, lungeDx: 0, lungeDy: 0,
    lastHitTick: -10000, lastRegenTick: 0,
    input: { moveX: 0, moveY: 0, buttons: 0, aimDir: 0, seq: 0 },
    prevButtons: 0,
    stats: { infections: 0, kills: 0, cures: 0, survivedTicks: 0 },
  };
}

/**
 * Advance the sim by one fixed tick. Host-only (guests mirror via snapshots).
 * @returns {object[]} events emitted this tick
 */
export function stepSim(sim) {
  const events = [];
  if (sim.phase === 'ended') return events;

  if (sim.phase === 'countdown') {
    sim.tick++;
    if (sim.tick >= sim.startTick) sim.phase = 'playing';
    return events;
  }

  // grids for this tick
  const aliveNpcs = sim.npcs.filter((n) => n.alive);
  const npcGrid = buildGrid(aliveNpcs);
  const zombieEntities = [];
  for (const n of aliveNpcs) if (n.isZombie) zombieEntities.push(n);
  for (const p of sim.players) if (p && p.alive && p.isZombie && p.removedAtTick === null) zombieEntities.push(p);
  const zombieGrid = buildGrid(zombieEntities);

  // players: actions + movement
  for (const p of sim.players) {
    if (!p || !p.alive || p.removedAtTick !== null) continue;
    p.prevX = p.x;
    p.prevY = p.y;
    applyPlayerActions(sim, p, npcGrid, events);

    if (sim.tick < p.stunUntil) continue;
    let mx = p.input.moveX;
    let my = p.input.moveY;
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; } // host-side clamp (no speed hacks)
    const speed = (p.isZombie ? SPEED.zombiePlayer : SPEED.human) * TILE;
    let vx = mx * speed;
    let vy = my * speed;
    if (sim.tick < p.lungeUntil) {
      vx += p.lungeDx * LUNGE_IMPULSE * TILE;
      vy += p.lungeDy * LUNGE_IMPULSE * TILE;
    }
    if (vx !== 0 || vy !== 0) {
      const res = moveCircle(sim.map, p.x, p.y, vx * DT, vy * DT, PLAYER_RADIUS);
      p.x = res.x;
      p.y = res.y;
      p.facing = facingFrom(mx, my, p.facing);
    }
  }

  // NPCs
  for (const n of sim.npcs) stepNpc(sim, n, zombieGrid, events);

  // projectiles / crates / regen
  stepProjectiles(sim, npcGrid, events);
  stepCrates(sim, events);
  stepRegen(sim);

  // stats
  for (const p of sim.players) {
    if (p && p.alive && !p.isZombie && p.removedAtTick === null) p.stats.survivedTicks++;
  }

  sim.tick++;

  const winner = evaluateWin(sim);
  if (winner) {
    sim.phase = 'ended';
    sim.winner = winner;
    events.push({
      t: EV.MATCH_END,
      winner,
      stats: sim.players.filter(Boolean).map((p) => ({
        pid: p.pid, name: p.name,
        infections: p.stats.infections, kills: p.stats.kills, cures: p.stats.cures,
        survivedSec: Math.round(p.stats.survivedTicks / 20),
        isZombie: p.isZombie, alive: p.alive,
      })),
    });
  }
  return events;
}

/** remaining match time in ms (for HUD/snapshots) */
export function remainingMs(sim) {
  return Math.max(0, (sim.endsAtTick - Math.max(sim.tick, sim.startTick)) * TICK_MS);
}
