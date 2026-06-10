import Peer from 'peerjs';
import {
  MAX_PLAYERS, PROTO_VERSION, PEER_CONFIG, SNAPSHOT_EVERY, KEYFRAME_EVERY,
  RECONNECT_GRACE_TICKS, INPUT_STALE_MS,
} from '../config.js';
import { MSG } from './protocol.js';
import { genRoomCode, peerIdForCode, genToken } from './rooms.js';
import { encodeSnapshot, decodeInput, KIND } from './codec.js';
import { remainingMs } from '../core/sim.js';
import { botInput } from '../core/bots.js';
import { mulberry32 } from '../core/rng.js';

// Host-side session: owns the PeerJS listener, lobby roster, input intake,
// and event/snapshot fan-out. The sim itself lives outside (game loop).

export class HostSession {
  constructor({ name, look, callbacks }) {
    this.cb = callbacks;
    this.phase = 'lobby';
    this.code = null;
    this.peer = null;
    this.sim = null;
    this.snapSeq = 0;
    this.durationMin = 10;
    // pid 0 = host
    this.roster = [{ pid: 0, name, look, ready: true, connected: true, isHost: true }];
    this.guests = new Map(); // peerId → guest
    this.byPid = new Map();  // pid → guest
    this.inputs = new Map(); // pid → {frame, at}
    this.botPids = new Set();
    this.botRng = mulberry32((Math.random() * 0xffffffff) >>> 0);
    this.destroyed = false;
  }

  addBot() {
    if (this.phase !== 'lobby' || this.roster.length >= MAX_PLAYERS) return;
    let pid = 1;
    while (this.roster.some((r) => r.pid === pid)) pid++;
    let n = 1;
    while (this.roster.some((r) => r.name === `컴퓨터${n}`)) n++;
    this.botPids.add(pid);
    this.roster.push({
      pid, name: `컴퓨터${n}`, look: (this.botRng() * 8) | 0,
      ready: true, connected: true, isHost: false, isBot: true,
    });
    this.broadcastRoster();
  }

  removeBot(pid) {
    if (this.phase !== 'lobby' || !this.botPids.has(pid)) return;
    this.botPids.delete(pid);
    this.roster = this.roster.filter((r) => r.pid !== pid);
    this.broadcastRoster();
  }

  open(attempt = 0) {
    const code = genRoomCode();
    const peer = new Peer(peerIdForCode(code), PEER_CONFIG);
    this.peer = peer;
    peer.on('open', () => {
      if (this.destroyed) return;
      this.code = code;
      this.cb.onRoomReady?.(code);
    });
    peer.on('connection', (conn) => this.handleConnection(conn));
    peer.on('error', (err) => {
      if (this.destroyed) return;
      if (err.type === 'unavailable-id' && attempt < 3) {
        this.open(attempt + 1);
      } else if (!this.code) {
        this.cb.onError?.('signal', err);
      } else {
        // transient errors after open (e.g. failed guest handshake) — ignore
        if (err.type === 'network' || err.type === 'server-error') this.cb.onError?.('network', err);
      }
    });
    peer.on('disconnected', () => {
      if (!this.destroyed) {
        try { peer.reconnect(); } catch { /* signaling gone; existing P2P links keep working */ }
      }
    });
  }

  handleConnection(conn) {
    if (conn.label === 'state') {
      conn.on('open', () => {
        if (conn.dataChannel) conn.dataChannel.binaryType = 'arraybuffer';
      });
      conn.on('data', (data) => this.handleStateData(conn.peer, data));
      conn.on('close', () => { /* ctrl close drives lifecycle */ });
      const g = this.guests.get(conn.peer);
      if (g) g.state = conn;
      else this.guests.set(conn.peer, { state: conn, pid: -1 });
      return;
    }
    // ctrl
    conn.on('data', (msg) => this.handleCtrl(conn, msg));
    conn.on('close', () => this.handleGuestGone(conn.peer));
    conn.on('error', () => this.handleGuestGone(conn.peer));
  }

  handleCtrl(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case MSG.JOIN_REQ: return this.handleJoin(conn, msg);
      case MSG.READY: return this.setReady(conn.peer, !!msg.ready);
      case MSG.LOOK: return this.setLook(conn.peer, msg.look | 0);
      case MSG.PING: return void conn.send({ t: MSG.PONG, t0: msg.t0 });
      default: break;
    }
    // JSON input fallback (guest whose state channel failed)
    if (msg.t === 'in') {
      const g = this.guests.get(conn.peer);
      if (g && g.pid >= 0) {
        this.inputs.set(g.pid, { frame: msg.f, at: performance.now() });
        g.degraded = true;
      }
    }
  }

  handleJoin(conn, msg) {
    if (msg.proto !== PROTO_VERSION) return conn.send({ t: MSG.JOIN_DENY, reason: 'version' });

    // reconnect path
    if (msg.resumeToken) {
      const g = [...this.byPid.values()].find((x) => x.token === msg.resumeToken);
      if (g && this.phase === 'playing') {
        const old = g.peerId;
        this.guests.delete(old);
        g.peerId = conn.peer;
        g.ctrl = conn;
        g.state = this.guests.get(conn.peer)?.state || null;
        this.guests.set(conn.peer, g);
        g.connected = true;
        const sp = this.sim?.players[g.pid];
        if (sp && sp.removedAtTick === null) {
          sp.connected = true;
          sp.disconnectedAtTick = null;
          conn.send({
            t: MSG.JOIN_ACK, pid: g.pid, token: g.token, name: g.name,
            settings: { durationMin: this.durationMin }, roster: this.publicRoster(), phase: this.phase,
            resume: this.startPayload,
          });
          conn.send({ t: MSG.KEYFRAME, tick: this.sim.tick, state: this.keyframeState() });
          this.entryByPid(g.pid).connected = true;
          this.broadcastRoster();
          return;
        }
      }
      return conn.send({ t: MSG.JOIN_DENY, reason: 'started' });
    }

    if (this.phase !== 'lobby') return conn.send({ t: MSG.JOIN_DENY, reason: 'started' });
    if (this.roster.length >= MAX_PLAYERS) return conn.send({ t: MSG.JOIN_DENY, reason: 'full' });

    // allocate pid + dedupe name
    let pid = 1;
    while (this.roster.some((r) => r.pid === pid)) pid++;
    let name = String(msg.name || '플레이어').slice(0, 12) || '플레이어';
    let finalName = name;
    let n = 2;
    while (this.roster.some((r) => r.name === finalName)) finalName = `${name} (${n++})`;

    const token = genToken();
    const guest = {
      peerId: conn.peer, pid, name: finalName, token,
      ctrl: conn, state: this.guests.get(conn.peer)?.state || null,
      connected: true, degraded: false,
    };
    this.guests.set(conn.peer, guest);
    this.byPid.set(pid, guest);
    this.roster.push({ pid, name: finalName, look: msg.look | 0, ready: false, connected: true, isHost: false });

    conn.send({
      t: MSG.JOIN_ACK, pid, token, name: finalName,
      settings: { durationMin: this.durationMin }, roster: this.publicRoster(), phase: this.phase,
    });
    this.broadcastRoster();
  }

  handleGuestGone(peerId) {
    const g = this.guests.get(peerId);
    if (!g || g.pid < 0) return;
    g.connected = false;
    const entry = this.entryByPid(g.pid);
    if (this.phase === 'lobby') {
      this.roster = this.roster.filter((r) => r.pid !== g.pid);
      this.byPid.delete(g.pid);
      this.guests.delete(peerId);
      this.broadcastRoster();
    } else if (this.phase === 'playing') {
      if (entry) entry.connected = false;
      const sp = this.sim?.players[g.pid];
      if (sp) {
        sp.connected = false;
        sp.disconnectedAtTick = this.sim.tick;
      }
      this.broadcastRoster();
    }
    this.cb.onRosterChange?.(this.publicRoster());
  }

  entryByPid(pid) {
    return this.roster.find((r) => r.pid === pid);
  }

  setReady(peerId, ready) {
    const g = this.guests.get(peerId);
    if (!g) return;
    const e = this.entryByPid(g.pid);
    if (e) e.ready = ready;
    this.broadcastRoster();
  }

  setLook(peerId, look) {
    const g = this.guests.get(peerId);
    if (!g) return;
    const e = this.entryByPid(g.pid);
    if (e) e.look = ((look % 8) + 8) % 8;
    this.broadcastRoster();
  }

  setHostLook(look) {
    this.roster[0].look = ((look % 8) + 8) % 8;
    this.broadcastRoster();
  }

  setDuration(min) {
    this.durationMin = min;
    this.broadcastCtrl({ t: MSG.SETTINGS, durationMin: min });
    this.cb.onSettings?.(min);
  }

  publicRoster() {
    return this.roster.map((r) => ({ ...r }));
  }

  broadcastRoster() {
    this.broadcastCtrl({ t: MSG.ROSTER, roster: this.publicRoster() });
    this.cb.onRosterChange?.(this.publicRoster());
  }

  broadcastCtrl(msg) {
    for (const g of this.byPid.values()) {
      if (g.ctrl && g.ctrl.open) {
        try { g.ctrl.send(msg); } catch { /* conn died; close handler cleans up */ }
      }
    }
  }

  canStart() {
    return this.roster.length >= 2 && this.roster.filter((r) => !r.isHost).every((r) => r.ready);
  }

  /** Build start payload; caller creates the sim from it. */
  buildStart() {
    const mapSeed = (Math.random() * 0xffffffff) >>> 0;
    const roleSeed = (Math.random() * 0xffffffff) >>> 0;
    const payload = {
      t: MSG.START, mapSeed, roleSeed, durationMin: this.durationMin,
      roster: this.roster.map((r) => ({ pid: r.pid, name: r.name, look: r.look })),
    };
    this.startPayload = payload;
    this.phase = 'playing';
    this.broadcastCtrl(payload);
    return payload;
  }

  attachSim(sim) {
    this.sim = sim;
  }

  handleStateData(peerId, data) {
    const g = this.guests.get(peerId);
    if (!g || g.pid === -1 || g.pid === undefined) return;
    const accept = (buf) => {
      if (buf.byteLength < 12) return;
      const dv = new DataView(buf);
      if (dv.getUint8(0) !== KIND.INPUT) return;
      const frame = decodeInput(buf);
      if (frame.pid !== g.pid) return; // spoof guard
      const prev = this.inputs.get(g.pid);
      if (prev && prev.frame.seq !== undefined) {
        const diff = (frame.seq - prev.frame.seq) & 0xffff;
        if (diff === 0 || diff > 32768) return; // stale/dup
      }
      this.inputs.set(g.pid, { frame, at: performance.now() });
    };
    if (data instanceof ArrayBuffer) accept(data);
    else if (ArrayBuffer.isView(data)) accept(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    else if (typeof Blob !== 'undefined' && data instanceof Blob) data.arrayBuffer().then(accept);
  }

  /** Pull latest guest inputs into the sim (call right before stepSim). */
  collectInputs() {
    const now = performance.now();
    // bot players think host-side
    if (this.sim && this.sim.phase === 'playing') {
      for (const pid of this.botPids) {
        const p = this.sim.players[pid];
        if (p && p.alive && p.removedAtTick === null) p.input = botInput(this.sim, p, this.botRng);
      }
    }
    for (const [pid, rec] of this.inputs) {
      const p = this.sim.players[pid];
      if (!p) continue;
      const stale = now - rec.at > INPUT_STALE_MS;
      p.input = {
        moveX: stale ? 0 : rec.frame.moveX,
        moveY: stale ? 0 : rec.frame.moveY,
        buttons: stale ? 0 : rec.frame.buttons,
        aimDir: rec.frame.aimDir,
        seq: rec.frame.seq,
      };
    }
    // reconnect grace expiry
    for (const p of this.sim.players) {
      if (!p || p.removedAtTick !== null) continue;
      if (!p.connected && p.disconnectedAtTick !== null &&
          this.sim.tick - p.disconnectedAtTick > RECONNECT_GRACE_TICKS) {
        p.removedAtTick = this.sim.tick;
      }
    }
  }

  /** Fan out events/snapshots/keyframes (call right after stepSim). */
  afterTick(events) {
    if (events.length) this.broadcastCtrl({ t: MSG.EVENTS, tick: this.sim.tick, evs: events });
    const rm = remainingMs(this.sim);
    if (this.sim.tick % SNAPSHOT_EVERY === 0) {
      this.snapSeq = (this.snapSeq + 1) & 0xffff;
      for (const g of this.byPid.values()) {
        if (!g.connected) continue;
        const p = this.sim.players[g.pid];
        if (!p) continue;
        if (g.state && g.state.open && !g.degraded) {
          try { g.state.send(encodeSnapshot(this.sim, this.snapSeq, rm, p.x, p.y)); } catch { /* next tick */ }
        }
      }
    }
    const kfTick = this.sim.tick % KEYFRAME_EVERY === 0;
    const degradedTick = this.sim.tick % 4 === 0;
    if (kfTick || degradedTick) {
      const state = this.keyframeState();
      for (const g of this.byPid.values()) {
        if (!g.connected || !g.ctrl || !g.ctrl.open) continue;
        const needsNow = g.degraded || !(g.state && g.state.open);
        if (kfTick || (degradedTick && needsNow)) {
          try { g.ctrl.send({ t: MSG.KEYFRAME, tick: this.sim.tick, state }); } catch { /* ignore */ }
        }
      }
    }
    if (this.sim.phase === 'ended') this.phase = 'ended';
  }

  keyframeState() {
    const sim = this.sim;
    return {
      tick: sim.tick,
      phase: sim.phase,
      remainingMs: remainingMs(sim),
      players: sim.players.filter(Boolean).map((p) => ({
        pid: p.pid, x: Math.round(p.x * 4) / 4, y: Math.round(p.y * 4) / 4, facing: p.facing,
        z: Math.round(p.z || 0),
        yaw: (p.input?.aimDir ?? 0) & 0xff,
        isZombie: p.isZombie, alive: p.alive, hasGun: p.hasGun,
        ammo: p.ammo, vaccines: p.vaccines, hp: p.hp,
        connected: p.connected, removed: p.removedAtTick !== null,
      })),
      npcs: sim.npcs.map((n) => ({
        id: n.id, x: Math.round(n.x), y: Math.round(n.y), facing: n.facing,
        isZombie: n.isZombie, alive: n.alive,
      })),
      crates: sim.crates.map((c) => ({
        id: c.id, x: c.x, y: c.y, items: c.items.slice(),
        ticksToLand: Math.max(0, c.landTick - sim.tick),
      })),
    };
  }

  rematch() {
    this.phase = 'lobby';
    this.sim = null;
    this.startPayload = null;
    this.inputs.clear();
    // drop disconnected players from roster; bots stay; reset ready
    this.roster = this.roster.filter((r) => r.isHost || r.isBot || this.byPid.get(r.pid)?.connected);
    for (const r of this.roster) if (!r.isHost && !r.isBot) r.ready = false;
    for (const [pid, g] of [...this.byPid]) {
      if (!g.connected) this.byPid.delete(pid);
    }
    this.broadcastCtrl({ t: MSG.REMATCH });
    this.broadcastRoster();
  }

  destroy() {
    this.destroyed = true;
    this.broadcastCtrl({ t: MSG.BYE });
    try { this.peer?.destroy(); } catch { /* already gone */ }
  }
}
