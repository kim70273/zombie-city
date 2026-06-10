import { TILE, TICK_MS, SPEED, PLAYER_RADIUS, INTERP_DELAY_MS } from '../config.js';
import { createSim } from '../core/sim.js';
import { moveCircle, facingFrom } from '../core/movement.js';
import { bitGet } from '../net/codec.js';
import { EV } from '../core/events.js';

// Guest-side world mirror. A "shadow sim" (never stepped) provides the map,
// NPC looks, and initial positions; live state arrives via snapshots/keyframes/
// events. Remote entities interpolate 150ms in the past; the own player is
// locally predicted with the shared movement code and softly reconciled.

const BUF_MAX = 8;

export class GuestWorld {
  constructor(startPayload, selfPid) {
    const { mapSeed, roleSeed, durationMin, roster } = startPayload;
    this.shadow = createSim({ mapSeed, roleSeed, durationMin }, roster);
    this.map = this.shadow.map;
    this.selfPid = selfPid;
    this.durationMin = durationMin;
    this.phase = 'countdown';
    this.tick = 0;
    this.remainingMs = durationMin * 60000;
    this.remainingAt = performance.now();
    this.winner = null;
    this.endStats = null;

    this.players = new Map();
    for (const p of this.shadow.players) {
      if (!p) continue;
      this.players.set(p.pid, {
        pid: p.pid, name: p.name, look: p.look,
        x: p.x, y: p.y, facing: 0,
        isZombie: p.isZombie, alive: true, hasGun: false,
        ammo: 0, vaccines: 0, hp: p.hp,
        stunned: false, connected: true, removed: false,
        buf: [],
      });
    }
    this.npcs = new Map();
    for (const n of this.shadow.npcs) {
      this.npcs.set(n.id, {
        id: n.id, look: n.look,
        x: n.x, y: n.y, facing: 0,
        isZombie: false, alive: true,
        buf: [], lastSeenAt: 0,
      });
    }
    this.crates = [];
    this.projectiles = [];

    const self = this.shadow.players[selfPid];
    this.predX = self.x;
    this.predY = self.y;
    this.predFacing = 0;
    this.authX = self.x;
    this.authY = self.y;
  }

  get self() {
    return this.players.get(this.selfPid);
  }

  applySnapshot(snap) {
    const now = performance.now();
    this.phase = snap.phase;
    this.tick = snap.tick;
    this.remainingMs = snap.remainingMs;
    this.remainingAt = now;

    for (const sp of snap.players) {
      const m = this.players.get(sp.pid);
      if (!m) continue;
      Object.assign(m, {
        isZombie: sp.isZombie, alive: sp.alive, hasGun: sp.hasGun,
        ammo: sp.ammo, vaccines: sp.vaccines, hp: sp.hp,
        stunned: sp.stunned, connected: sp.connected, removed: sp.removed,
      });
      if (sp.pid === this.selfPid) {
        this.authX = sp.x;
        this.authY = sp.y;
      } else {
        pushBuf(m, now, sp.x, sp.y, sp.facing);
      }
      m.x = sp.x;
      m.y = sp.y;
    }

    // global NPC bitfields (drive minimap + team flips even outside AOI)
    for (const [id, n] of this.npcs) {
      if (id < snap.npcCount) {
        n.isZombie = bitGet(snap.npcZombie, id);
        n.alive = bitGet(snap.npcAlive, id);
      }
    }
    for (const sn of snap.npcs) {
      const n = this.npcs.get(sn.id);
      if (!n) continue;
      n.isZombie = sn.isZombie;
      n.alive = sn.alive;
      n.lastSeenAt = now;
      pushBuf(n, now, sn.x, sn.y, sn.facing);
      n.x = sn.x;
      n.y = sn.y;
    }

    this.crates = snap.crates;
    this.projectiles = snap.projectiles;
  }

  applyKeyframe(state) {
    const now = performance.now();
    this.phase = state.phase;
    this.tick = state.tick;
    this.remainingMs = state.remainingMs;
    this.remainingAt = now;
    for (const sp of state.players) {
      const m = this.players.get(sp.pid);
      if (!m) continue;
      Object.assign(m, {
        isZombie: sp.isZombie, alive: sp.alive, hasGun: sp.hasGun,
        ammo: sp.ammo, vaccines: sp.vaccines, hp: sp.hp,
        connected: sp.connected, removed: sp.removed,
      });
      if (sp.pid === this.selfPid) {
        this.authX = sp.x;
        this.authY = sp.y;
      } else {
        pushBuf(m, now, sp.x, sp.y, sp.facing);
      }
      m.x = sp.x;
      m.y = sp.y;
    }
    for (const sn of state.npcs) {
      const n = this.npcs.get(sn.id);
      if (!n) continue;
      n.isZombie = sn.isZombie;
      n.alive = sn.alive;
      n.lastSeenAt = now;
      pushBuf(n, now, sn.x, sn.y, sn.facing);
      n.x = sn.x;
      n.y = sn.y;
    }
    this.crates = state.crates;
  }

  /** Discrete events: flip team/alive immediately (snapshots confirm later). */
  applyEvents(evs) {
    for (const e of evs) {
      switch (e.t) {
        case EV.PLAYER_INFECTED: {
          const m = this.players.get(e.victim);
          if (m) { m.isZombie = true; }
          break;
        }
        case EV.PLAYER_CURED: {
          const m = this.players.get(e.pid);
          if (m) m.isZombie = false;
          break;
        }
        case EV.PLAYER_KILLED: {
          const m = this.players.get(e.pid);
          if (m) m.alive = false;
          break;
        }
        case EV.NPC_INFECTED: {
          const n = this.npcs.get(e.id);
          if (n) n.isZombie = true;
          break;
        }
        case EV.NPC_CURED: {
          const n = this.npcs.get(e.id);
          if (n) n.isZombie = false;
          break;
        }
        case EV.NPC_KILLED: {
          const n = this.npcs.get(e.id);
          if (n) n.alive = false;
          break;
        }
        case EV.MATCH_END:
          this.phase = 'ended';
          this.winner = e.winner;
          this.endStats = e.stats;
          break;
        default:
          break;
      }
    }
  }

  /** Local prediction for the own player (called every rAF). */
  framePredict(input, dtMs, _now) {
    const m = this.self;
    if (!m || !m.alive || this.phase !== 'playing') return;
    if (!m.stunned) {
      let mx = input.moveX;
      let my = input.moveY;
      const len = Math.hypot(mx, my);
      if (len > 1) { mx /= len; my /= len; }
      const speed = (m.isZombie ? SPEED.zombiePlayer : SPEED.human) * TILE;
      const res = moveCircle(this.map, this.predX, this.predY, mx * speed * (dtMs / 1000), my * speed * (dtMs / 1000), PLAYER_RADIUS);
      this.predX = res.x;
      this.predY = res.y;
      if (len > 0.05) this.predFacing = facingFrom(mx, my, this.predFacing);
    }
    // reconcile toward authoritative
    const ex = this.authX - this.predX;
    const ey = this.authY - this.predY;
    const err = Math.hypot(ex, ey);
    if (err > 64) {
      this.predX = this.authX;
      this.predY = this.authY;
    } else if (err > 0.5) {
      this.predX += ex * 0.12;
      this.predY += ey * 0.12;
    }
  }

  /** Interpolated world view at render time. */
  sample(now) {
    const t = now - INTERP_DELAY_MS;
    const players = [];
    for (const m of this.players.values()) {
      if (m.removed) continue;
      let x = m.x, y = m.y, facing = m.facing;
      if (m.pid === this.selfPid) {
        x = this.predX; y = this.predY; facing = this.predFacing;
      } else {
        const s = sampleBuf(m.buf, t);
        if (s) { x = s.x; y = s.y; facing = s.facing; }
      }
      players.push({ ...m, x, y, facing });
    }
    const npcs = [];
    const showAll = this.phase === 'countdown';
    for (const n of this.npcs.values()) {
      if (!n.alive) continue;
      if (!showAll && (!n.lastSeenAt || now - n.lastSeenAt > 1200)) continue;
      const s = sampleBuf(n.buf, t);
      npcs.push({ ...n, x: s ? s.x : n.x, y: s ? s.y : n.y, facing: s ? s.facing : n.facing });
    }
    return {
      players, npcs,
      crates: this.crates,
      projectiles: this.projectiles,
      remainingMs: Math.max(0, this.remainingMs - (now - this.remainingAt)),
      phase: this.phase,
      tick: this.tick,
    };
  }

  hudRemainingMs(now) {
    return Math.max(0, this.remainingMs - (now - this.remainingAt));
  }
}

function pushBuf(m, t, x, y, facing) {
  m.buf.push({ t, x, y, facing });
  if (m.buf.length > BUF_MAX) m.buf.shift();
}

function sampleBuf(buf, t) {
  if (buf.length === 0) return null;
  if (t <= buf[0].t) return buf[0];
  for (let i = buf.length - 1; i >= 0; i--) {
    if (buf[i].t <= t) {
      const a = buf[i];
      const b = buf[i + 1];
      if (!b) return a; // newer than newest: hold (freeze beats rubber-banding)
      const k = Math.min(1, (t - a.t) / Math.max(1, b.t - a.t));
      return {
        x: a.x + (b.x - a.x) * k,
        y: a.y + (b.y - a.y) * k,
        facing: b.facing,
      };
    }
  }
  return buf[buf.length - 1];
}
