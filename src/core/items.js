import {
  TILE, DURATIONS,
  CRATE_INTERVAL_TICKS, CRATE_5MIN_DROP_TICK, CRATE_FALL_TICKS,
  CRATE_PICKUP_RADIUS, CRATE_MIN_DIST_CRATE, CRATE_MIN_DIST_PLAYER,
  CRATE_WEIGHTS, GUN_PICKUP_AMMO, AMMO_PICKUP, AMMO_CAP, VACCINE_CAP,
} from '../config.js';
import { EV } from './events.js';
import { randInt, weightedPick } from './rng.js';

/** match ticks (relative to playing start) at which crate waves drop */
export function crateDropTicks(durationMin) {
  const endTick = durationMin * 60 * 20;
  if (durationMin === 5) return [CRATE_5MIN_DROP_TICK];
  const out = [];
  for (let t = CRATE_INTERVAL_TICKS; t < endTick; t += CRATE_INTERVAL_TICKS) out.push(t);
  return out;
}

export function stepCrates(sim, events) {
  const matchTick = sim.tick - sim.startTick;
  if (sim.dropTicks.includes(matchTick)) spawnWave(sim, events);

  for (let i = sim.crates.length - 1; i >= 0; i--) {
    const c = sim.crates[i];
    if (sim.tick === c.landTick) events.push({ t: EV.CRATE_LANDED, id: c.id });
    if (sim.tick < c.landTick) continue;
    // walk-over pickup (humans only)
    for (const p of sim.players) {
      if (!p || !p.alive || p.isZombie || p.removedAtTick !== null) continue;
      if (Math.hypot(p.x - c.x, p.y - c.y) > CRATE_PICKUP_RADIUS + TILE * 0.35) continue;
      for (const item of c.items) giveItem(p, item);
      events.push({ t: EV.ITEM_PICKED, pid: p.pid, crateId: c.id, items: c.items.slice() });
      c.items.length = 0;
      break;
    }
    if (c.items.length === 0) sim.crates.splice(i, 1);
  }
}

function giveItem(p, item) {
  if (item === 'gun') {
    p.ammo = Math.min(AMMO_CAP, p.ammo + (p.hasGun ? AMMO_PICKUP : GUN_PICKUP_AMMO));
    p.hasGun = true;
  } else if (item === 'ammo') {
    p.ammo = Math.min(AMMO_CAP, p.ammo + AMMO_PICKUP);
  } else if (item === 'vaccine') {
    p.vaccines = Math.min(VACCINE_CAP, p.vaccines + 1);
  }
}

function spawnWave(sim, events) {
  const tier = DURATIONS[sim.settings.durationMin] || DURATIONS[10];
  const count = tier.cratesPerDrop;
  let waveHasVaccine = false;
  const wave = [];
  for (let i = 0; i < count; i++) {
    const items = [];
    const slots = sim.rngFn() < 0.5 ? 1 : 2;
    for (let s = 0; s < slots; s++) {
      const item = weightedPick(sim.rngFn, CRATE_WEIGHTS);
      items.push(item);
      if (item === 'vaccine') waveHasVaccine = true;
    }
    wave.push(items);
  }
  if (!waveHasVaccine && wave.length) wave[0][0] = 'vaccine'; // comeback item must always enter the economy
  for (const items of wave) {
    const spot = findDropSpot(sim);
    if (!spot) continue;
    const c = {
      id: sim.nextCrateId++,
      x: spot.tx * TILE + TILE / 2,
      y: spot.ty * TILE + TILE / 2,
      landTick: sim.tick + CRATE_FALL_TICKS,
      items,
    };
    sim.crates.push(c);
    events.push({ t: EV.CRATE_INCOMING, id: c.id, x: c.x | 0, y: c.y | 0, landTick: c.landTick });
  }
}

function findDropSpot(sim) {
  const map = sim.map;
  for (let tries = 0; tries < 50; tries++) {
    const tx = randInt(sim.rngFn, 2, map.w - 2);
    const ty = randInt(sim.rngFn, 2, map.h - 2);
    if (map.solid(tx, ty)) continue;
    if (map.buildingAt(tx * TILE + 16, ty * TILE + 16) !== -1) continue; // outdoors only
    const farFromCrates = sim.crates.every(
      (c) => Math.hypot(c.x / TILE - tx, c.y / TILE - ty) >= CRATE_MIN_DIST_CRATE
    );
    if (!farFromCrates) continue;
    const farFromPlayers = sim.players.every(
      (p) => !p || !p.alive || Math.hypot(p.x / TILE - tx, p.y / TILE - ty) >= CRATE_MIN_DIST_PLAYER
    );
    if (!farFromPlayers) continue;
    return { tx, ty };
  }
  return null;
}
