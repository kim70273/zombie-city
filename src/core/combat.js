import {
  TILE, TICK_MS, PLAYER_RADIUS,
  LUNGE_RANGE, LUNGE_CONE_COS, LUNGE_COOLDOWN_TICKS, LUNGE_IMPULSE, LUNGE_DURATION_TICKS,
  INFECT_STUN_TICKS, CURE_IMMUNE_TICKS,
  BULLET_SPEED, BULLET_RANGE, GUN_COOLDOWN_TICKS, BULLET_HIT_RADIUS,
  ZNPC_HP, ZPLAYER_HP, ZPLAYER_REGEN_TICKS, ZPLAYER_REGEN_AFTER_HIT, GUN_KNOCKBACK,
  VACCINE_RANGE,
} from '../config.js';
import { EV } from './events.js';
import { queryGrid } from './grid.js';
import { moveCircle } from './movement.js';

const DT = TICK_MS / 1000;

export const BTN = { ATTACK: 1, SHOOT: 2, USE: 4, JUMP: 8 };

export function aimVec(aimDir) {
  const a = (aimDir / 256) * Math.PI * 2;
  return { dx: Math.cos(a), dy: Math.sin(a) };
}

/** Resolve a player's action buttons for this tick (host-side). */
export function applyPlayerActions(sim, p, npcGrid, events) {
  const btn = p.input.buttons | 0;
  const pressed = btn & ~p.prevButtons;
  p.prevButtons = btn;
  if (!p.alive || sim.tick < p.stunUntil) return;
  const { dx, dy } = aimVec(p.input.aimDir | 0);

  if (p.isZombie) {
    if ((btn & BTN.ATTACK) && sim.tick >= p.attackCdUntil) {
      p.attackCdUntil = sim.tick + LUNGE_COOLDOWN_TICKS;
      p.lungeUntil = sim.tick + LUNGE_DURATION_TICKS;
      p.lungeDx = dx;
      p.lungeDy = dy;
      events.push({ t: EV.LUNGE, pid: p.pid });
      resolveLungeHits(sim, p, dx, dy, npcGrid, events);
    }
    return;
  }

  // human actions
  if ((btn & BTN.SHOOT) && p.hasGun && p.ammo > 0 && sim.tick >= p.gunCdUntil) {
    p.gunCdUntil = sim.tick + GUN_COOLDOWN_TICKS;
    p.ammo--;
    sim.projectiles.push({
      x: p.x + dx * (PLAYER_RADIUS + 2),
      y: p.y + dy * (PLAYER_RADIUS + 2),
      dx, dy, traveled: 0, ownerPid: p.pid,
    });
    events.push({ t: EV.SHOT, pid: p.pid, x: p.x | 0, y: p.y | 0, dx: +dx.toFixed(3), dy: +dy.toFixed(3) });
  }

  if ((pressed & BTN.USE) && p.vaccines > 0) {
    const target = nearestZombieTarget(sim, p, npcGrid);
    if (target) {
      p.vaccines--;
      p.stats.cures++;
      if (target.pid !== undefined) curePlayer(sim, target, p.pid, events);
      else cureNpc(sim, target, p.pid, events);
    }
  }
}

function resolveLungeHits(sim, p, dx, dy, npcGrid, events) {
  const hitOne = (e) => {
    const ex = e.x - p.x, ey = e.y - p.y;
    const d = Math.hypot(ex, ey);
    if (d > LUNGE_RANGE + PLAYER_RADIUS) return false;
    if (d > 1 && (ex * dx + ey * dy) / d < LUNGE_CONE_COS) return false;
    return true;
  };
  // human players
  for (const v of sim.players) {
    if (!v || v === p || !v.alive || v.isZombie || v.removedAtTick !== null) continue;
    if (sim.tick < v.immuneUntil) continue;
    if (hitOne(v)) infectPlayer(sim, v, p.pid, events);
  }
  // citizen NPCs
  queryGrid(npcGrid, p.x, p.y, LUNGE_RANGE + TILE, (n) => {
    if (n.isZombie || !n.alive) return;
    if (hitOne(n)) infectNpc(sim, n, p.pid, events);
  });
}

function nearestZombieTarget(sim, p, npcGrid) {
  // zombie players preferred over zombie NPCs
  let best = null;
  let bestD = VACCINE_RANGE;
  for (const z of sim.players) {
    if (!z || !z.alive || !z.isZombie || z.removedAtTick !== null) continue;
    const d = Math.hypot(z.x - p.x, z.y - p.y);
    if (d < bestD) { bestD = d; best = z; }
  }
  if (best) return best;
  bestD = VACCINE_RANGE;
  queryGrid(npcGrid, p.x, p.y, VACCINE_RANGE + TILE, (n) => {
    if (!n.isZombie || !n.alive) return;
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    if (d < bestD) { bestD = d; best = n; }
  });
  return best;
}

// ---------- conversions ----------

export function infectPlayer(sim, victim, by, events) {
  if (victim.isZombie || !victim.alive || sim.tick < victim.immuneUntil) return;
  victim.isZombie = true;
  victim.hp = ZPLAYER_HP;
  victim.stunUntil = sim.tick + INFECT_STUN_TICKS;
  if (typeof by === 'number' && sim.players[by]) sim.players[by].stats.infections++;
  events.push({ t: EV.PLAYER_INFECTED, victim: victim.pid, by });
}

export function infectNpc(sim, npc, by, events) {
  if (npc.isZombie || !npc.alive) return;
  npc.isZombie = true;
  npc.hp = ZNPC_HP;
  npc.state = 'idle';
  npc.targetPid = -1;
  npc.idleUntil = sim.tick + INFECT_STUN_TICKS;
  if (typeof by === 'number' && sim.players[by]) sim.players[by].stats.infections++;
  events.push({ t: EV.NPC_INFECTED, id: npc.id, by });
}

export function curePlayer(sim, z, by, events) {
  z.isZombie = false;
  z.hp = 0;
  z.immuneUntil = sim.tick + CURE_IMMUNE_TICKS;
  z.stunUntil = sim.tick + 6; // brief cure stagger
  events.push({ t: EV.PLAYER_CURED, pid: z.pid, by });
}

export function cureNpc(sim, n, by, events) {
  n.isZombie = false;
  n.hp = 0;
  n.state = 'idle';
  n.targetPid = -1;
  n.idleUntil = sim.tick + 20;
  events.push({ t: EV.NPC_CURED, id: n.id, by });
}

export function killPlayer(sim, z, by, events) {
  z.alive = false;
  if (typeof by === 'number' && sim.players[by]) sim.players[by].stats.kills++;
  events.push({ t: EV.PLAYER_KILLED, pid: z.pid, by });
}

export function killNpc(sim, n, by, events) {
  n.alive = false;
  if (typeof by === 'number' && sim.players[by]) sim.players[by].stats.kills++;
  events.push({ t: EV.NPC_KILLED, id: n.id, by });
}

// ---------- projectiles ----------

export function stepProjectiles(sim, npcGrid, events) {
  const stepLen = BULLET_SPEED * TILE * DT; // px per tick
  const sub = 8; // sub-sample px for tunneling safety
  for (let i = sim.projectiles.length - 1; i >= 0; i--) {
    const pr = sim.projectiles[i];
    let remaining = stepLen;
    let dead = false;
    while (remaining > 0 && !dead) {
      const step = Math.min(sub, remaining);
      pr.x += pr.dx * step;
      pr.y += pr.dy * step;
      pr.traveled += step;
      remaining -= step;
      const tx = (pr.x / TILE) | 0;
      const ty = (pr.y / TILE) | 0;
      if (sim.map.bulletSolid(tx, ty)) { dead = true; break; }
      // zombie players
      for (const z of sim.players) {
        if (!z || !z.alive || !z.isZombie || z.removedAtTick !== null) continue;
        if (Math.hypot(z.x - pr.x, z.y - pr.y) < BULLET_HIT_RADIUS + PLAYER_RADIUS * 0.5) {
          z.hp--;
          z.lastHitTick = sim.tick;
          const k = moveCircle(sim.map, z.x, z.y, pr.dx * GUN_KNOCKBACK, pr.dy * GUN_KNOCKBACK, PLAYER_RADIUS);
          z.x = k.x; z.y = k.y;
          events.push({ t: EV.HIT, kind: 'p', id: z.pid, hp: z.hp });
          if (z.hp <= 0) killPlayer(sim, z, pr.ownerPid, events);
          dead = true;
          break;
        }
      }
      if (dead) break;
      // zombie NPCs
      let hitNpc = null;
      queryGrid(npcGrid, pr.x, pr.y, BULLET_HIT_RADIUS + TILE, (n) => {
        if (hitNpc || !n.isZombie || !n.alive) return;
        if (Math.hypot(n.x - pr.x, n.y - pr.y) < BULLET_HIT_RADIUS) hitNpc = n;
      });
      if (hitNpc) {
        hitNpc.hp--;
        events.push({ t: EV.HIT, kind: 'n', id: hitNpc.id, hp: hitNpc.hp });
        if (hitNpc.hp <= 0) killNpc(sim, hitNpc, pr.ownerPid, events);
        dead = true;
      }
      if (pr.traveled >= BULLET_RANGE) dead = true;
    }
    if (dead) sim.projectiles.splice(i, 1);
  }
}

/** zombie player slow HP regen out of combat */
export function stepRegen(sim) {
  for (const p of sim.players) {
    if (!p || !p.alive || !p.isZombie) continue;
    if (p.hp >= ZPLAYER_HP) continue;
    if (sim.tick - p.lastHitTick < ZPLAYER_REGEN_AFTER_HIT) continue;
    if (sim.tick - p.lastRegenTick >= ZPLAYER_REGEN_TICKS) {
      p.hp++;
      p.lastRegenTick = sim.tick;
    }
  }
}
