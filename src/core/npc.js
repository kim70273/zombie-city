import {
  TILE, SPEED, NPC_RADIUS, NPC_THINK_EVERY, TICK_MS,
  CITIZEN_FLEE_RADIUS, CITIZEN_FLEE_EXIT_RADIUS, CITIZEN_FLEE_EXIT_TICKS,
  ZNPC_AGGRO_RADIUS, ZNPC_DEAGGRO_RADIUS, ZNPC_LOSE_SIGHT_TICKS,
  ZNPC_ATTACK_RANGE, ZNPC_ATTACK_COOLDOWN_TICKS, NPC_CONTACT_INFECT_DIST,
  STUCK_CHECK_TICKS, STUCK_MIN_DISP, STUCK_DETOUR_TICKS,
} from '../config.js';
import { moveCircle, facingFrom } from './movement.js';
import { nearestInGrid } from './grid.js';
import { randInt } from './rng.js';
import { EV } from './events.js';
import { infectPlayer } from './combat.js';

const DT = TICK_MS / 1000;

export function makeNpc(id, tx, ty, look) {
  return {
    id, look,
    x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2,
    prevX: 0, prevY: 0, facing: 0,
    isZombie: false, alive: true, hp: 0,
    state: 'idle', vx: 0, vy: 0,
    wpX: 0, wpY: 0, hasWp: false,
    idleUntil: 0, fleeCalm: 0, blockedTicks: 0,
    targetPid: -1, lastSeenTick: 0,
    attackCdUntil: 0, screamCdUntil: 0,
    stuckTick: 0, stuckX: 0, stuckY: 0, detourUntil: 0, detourDx: 0, detourDy: 0,
  };
}

/** visibility: same building interior, or both outdoors (-1). O(1). */
export function visible(map, ax, ay, bx, by) {
  return map.buildingAt(ax, ay) === map.buildingAt(bx, by);
}

/**
 * Advance one NPC by one tick. Full decisions run only on this NPC's think
 * bucket (id % 3); integration runs every tick.
 */
export function stepNpc(sim, npc, zombieGrid, events) {
  if (!npc.alive) return;
  const think = sim.tick % NPC_THINK_EVERY === npc.id % NPC_THINK_EVERY;
  if (npc.isZombie) stepZombieNpc(sim, npc, think, events);
  else stepCitizen(sim, npc, zombieGrid, think, events);
  integrate(sim, npc);
}

// ---------- citizen ----------

function stepCitizen(sim, npc, zombieGrid, think, events) {
  if (think) {
    // panic scan: nearest zombie (player or NPC) in flee radius, visible
    const threat = nearestZombie(sim, zombieGrid, npc.x, npc.y, CITIZEN_FLEE_RADIUS);
    if (threat) {
      if (npc.state !== 'flee' && sim.tick >= npc.screamCdUntil) {
        events.push({ t: EV.SCREAM, id: npc.id });
        npc.screamCdUntil = sim.tick + 100; // 5s
      }
      npc.state = 'flee';
      npc.fleeCalm = 0;
      const d = Math.hypot(npc.x - threat.x, npc.y - threat.y) || 1;
      npc.vx = ((npc.x - threat.x) / d) * SPEED.citizenFlee * TILE;
      npc.vy = ((npc.y - threat.y) / d) * SPEED.citizenFlee * TILE;
    } else if (npc.state === 'flee') {
      const far = nearestZombie(sim, zombieGrid, npc.x, npc.y, CITIZEN_FLEE_EXIT_RADIUS);
      if (!far) {
        npc.fleeCalm += NPC_THINK_EVERY;
        if (npc.fleeCalm >= CITIZEN_FLEE_EXIT_TICKS) {
          npc.state = 'idle';
          npc.idleUntil = sim.tick + randInt(sim.rngFn, 20, 60);
          npc.vx = npc.vy = 0;
        }
      } else npc.fleeCalm = 0;
    }
  }

  if (npc.state === 'flee') {
    if (npc.blockedTicks >= 4) {
      // wall in the way: rotate flee direction ±60°
      const a = Math.atan2(npc.vy, npc.vx) + (sim.rngFn() < 0.5 ? 1 : -1) * (Math.PI / 3);
      const s = SPEED.citizenFlee * TILE;
      npc.vx = Math.cos(a) * s;
      npc.vy = Math.sin(a) * s;
      npc.blockedTicks = 0;
    }
    return;
  }

  if (npc.state === 'idle') {
    npc.vx = npc.vy = 0;
    if (sim.tick >= npc.idleUntil && think) pickWanderTarget(sim, npc);
    return;
  }

  // wander: head to waypoint
  if (npc.state === 'wander') {
    const dx = npc.wpX - npc.x;
    const dy = npc.wpY - npc.y;
    const d = Math.hypot(dx, dy);
    if (d < TILE * 0.4 || npc.blockedTicks >= 8) {
      npc.state = 'idle';
      npc.idleUntil = sim.tick + randInt(sim.rngFn, 20, 80); // 1–4s
      npc.vx = npc.vy = 0;
      npc.blockedTicks = 0;
      return;
    }
    npc.vx = (dx / d) * SPEED.citizen * TILE;
    npc.vy = (dy / d) * SPEED.citizen * TILE;
  }
}

function pickWanderTarget(sim, npc) {
  const map = sim.map;
  const rng = sim.rngFn;
  // 10%: visit a nearby building interior (via its door); else outdoor stroll
  if (rng() < 0.1) {
    const b = nearestBuildingWithin(map, npc.x, npc.y, 15 * TILE);
    if (b) {
      const door = b.doors[0];
      npc.wpX = door.tx * TILE + TILE / 2;
      npc.wpY = door.ty * TILE + TILE / 2;
      npc.state = 'wander';
      npc.hasWp = true;
      return;
    }
  }
  for (let i = 0; i < 8; i++) {
    const tx = ((npc.x / TILE) | 0) + randInt(rng, -12, 13);
    const ty = ((npc.y / TILE) | 0) + randInt(rng, -12, 13);
    if (!map.solid(tx, ty)) {
      npc.wpX = tx * TILE + TILE / 2;
      npc.wpY = ty * TILE + TILE / 2;
      npc.state = 'wander';
      npc.hasWp = true;
      return;
    }
  }
  npc.idleUntil = sim.tick + 20;
}

function nearestBuildingWithin(map, x, y, r) {
  let best = null;
  let bestD = r * r;
  for (const b of map.buildings) {
    const cx = (b.x + b.w / 2) * TILE;
    const cy = (b.y + b.h / 2) * TILE;
    const d = (cx - x) * (cx - x) + (cy - y) * (cy - y);
    if (d < bestD && b.doors.length) { bestD = d; best = b; }
  }
  return best;
}

/** nearest visible zombie entity (player or NPC) within r, from prebuilt grid */
function nearestZombie(sim, zombieGrid, x, y, r) {
  const res = nearestInGrid(zombieGrid, x, y, r, (e) => visible(sim.map, x, y, e.x, e.y));
  return res ? res.e : null;
}

// ---------- zombie NPC ----------

function stepZombieNpc(sim, npc, think, events) {
  const map = sim.map;

  if (think) {
    // (re)acquire target: nearest living human player, visible, in aggro radius
    let best = -1;
    let bestD2 = ZNPC_AGGRO_RADIUS * ZNPC_AGGRO_RADIUS;
    for (const p of sim.players) {
      if (!p || !p.alive || p.isZombie || p.removedAtTick !== null) continue;
      const dx = p.x - npc.x, dy = p.y - npc.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2 && visible(map, npc.x, npc.y, p.x, p.y)) { bestD2 = d2; best = p.pid; }
    }
    if (best >= 0) {
      npc.targetPid = best;
      npc.lastSeenTick = sim.tick;
      npc.state = 'chase';
    } else if (npc.state === 'chase') {
      const t = sim.players[npc.targetPid];
      const lost = !t || !t.alive || t.isZombie || t.removedAtTick !== null ||
        Math.hypot(t.x - npc.x, t.y - npc.y) > ZNPC_DEAGGRO_RADIUS ||
        (!visible(map, npc.x, npc.y, t.x, t.y) && sim.tick - npc.lastSeenTick > ZNPC_LOSE_SIGHT_TICKS);
      if (t && visible(map, npc.x, npc.y, t.x, t.y)) npc.lastSeenTick = sim.tick;
      if (lost) {
        npc.state = 'idle';
        npc.targetPid = -1;
        npc.idleUntil = sim.tick + randInt(sim.rngFn, 40, 100); // 2–5s
        npc.vx = npc.vy = 0;
      }
    }
  }

  if (npc.state === 'chase') {
    const t = sim.players[npc.targetPid];
    if (!t) { npc.state = 'idle'; return; }
    const s = SPEED.zombieNpcChase * TILE;
    let gx = t.x, gy = t.y;
    // door waypoint: different rooms → head for the connecting door
    const myB = map.buildingAt(npc.x, npc.y);
    const tB = map.buildingAt(t.x, t.y);
    if (myB !== tB) {
      const via = myB !== -1 ? map.buildings[myB] : (tB !== -1 ? map.buildings[tB] : null);
      if (via && via.doors.length) {
        let door = via.doors[0];
        let bd = Infinity;
        for (const d of via.doors) {
          const ddx = d.tx * TILE + 16 - npc.x, ddy = d.ty * TILE + 16 - npc.y;
          const dd = ddx * ddx + ddy * ddy;
          if (dd < bd) { bd = dd; door = d; }
        }
        gx = door.tx * TILE + TILE / 2;
        gy = door.ty * TILE + TILE / 2;
      }
    }
    // stuck detection → perpendicular detour
    if (sim.tick < npc.detourUntil) {
      npc.vx = npc.detourDx * s;
      npc.vy = npc.detourDy * s;
    } else {
      if (sim.tick - npc.stuckTick >= STUCK_CHECK_TICKS) {
        const disp = Math.hypot(npc.x - npc.stuckX, npc.y - npc.stuckY);
        if (disp < STUCK_MIN_DISP) {
          const a = Math.atan2(gy - npc.y, gx - npc.x) + (sim.rngFn() < 0.5 ? 1 : -1) * Math.PI / 2;
          npc.detourDx = Math.cos(a);
          npc.detourDy = Math.sin(a);
          npc.detourUntil = sim.tick + STUCK_DETOUR_TICKS;
        }
        npc.stuckTick = sim.tick;
        npc.stuckX = npc.x;
        npc.stuckY = npc.y;
      }
      const d = Math.hypot(gx - npc.x, gy - npc.y) || 1;
      npc.vx = ((gx - npc.x) / d) * s;
      npc.vy = ((gy - npc.y) / d) * s;
    }

    // attack / contact infection
    if (t.alive && !t.isZombie && sim.tick >= npc.attackCdUntil) {
      const d = Math.hypot(t.x - npc.x, t.y - npc.y);
      if (d < Math.max(ZNPC_ATTACK_RANGE, NPC_CONTACT_INFECT_DIST + 8)) {
        npc.attackCdUntil = sim.tick + ZNPC_ATTACK_COOLDOWN_TICKS;
        infectPlayer(sim, t, 'n:' + npc.id, events);
      }
    }
    return;
  }

  // shamble
  if (npc.state === 'idle') {
    npc.vx = npc.vy = 0;
    if (sim.tick >= npc.idleUntil && think) {
      const rng = sim.rngFn;
      for (let i = 0; i < 6; i++) {
        const tx = ((npc.x / TILE) | 0) + randInt(rng, -6, 7);
        const ty = ((npc.y / TILE) | 0) + randInt(rng, -6, 7);
        if (!sim.map.solid(tx, ty)) {
          npc.wpX = tx * TILE + TILE / 2;
          npc.wpY = ty * TILE + TILE / 2;
          npc.state = 'wander';
          break;
        }
      }
      if (npc.state === 'idle') npc.idleUntil = sim.tick + 40;
    }
  } else if (npc.state === 'wander' || npc.state === 'flee') {
    const dx = npc.wpX - npc.x, dy = npc.wpY - npc.y;
    const d = Math.hypot(dx, dy);
    if (d < TILE * 0.4 || npc.blockedTicks >= 8) {
      npc.state = 'idle';
      npc.idleUntil = sim.tick + randInt(sim.rngFn, 40, 100);
      npc.vx = npc.vy = 0;
      npc.blockedTicks = 0;
    } else {
      const s = SPEED.zombieNpc * TILE;
      npc.vx = (dx / d) * s;
      npc.vy = (dy / d) * s;
    }
  }
}

// ---------- shared integration ----------

function integrate(sim, npc) {
  npc.prevX = npc.x;
  npc.prevY = npc.y;
  if (npc.vx === 0 && npc.vy === 0) { npc.blockedTicks = 0; return; }
  const wantX = npc.vx * DT;
  const wantY = npc.vy * DT;
  const res = moveCircle(sim.map, npc.x, npc.y, wantX, wantY, NPC_RADIUS);
  const moved = Math.hypot(res.x - npc.x, res.y - npc.y);
  const wanted = Math.hypot(wantX, wantY);
  npc.blockedTicks = wanted > 0 && moved < wanted * 0.3 ? npc.blockedTicks + 1 : 0;
  npc.x = res.x;
  npc.y = res.y;
  npc.facing = facingFrom(npc.vx, npc.vy, npc.facing);
}
