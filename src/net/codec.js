import { AOI_HALF, AOI_MAX_NPCS, POS_QUANT } from '../config.js';

// Binary state-channel codec (pure; vitest-able).
// Little-endian DataView throughout.
// Input frame (G→H, 12B):  u8 kind=1 | u8 pid | u16 seq | u32 tick | i8 mx | i8 my | u8 buttons | u8 aimDir
// Snapshot   (H→G, varlen): u8 kind=2 | u8 phase | u16 seq | u32 tick | u32 remainingMs
//   u8 playerCount, per player (12B):
//     u8 pid | u16 qx | u16 qy | u8 facing | u8 flags(zombie1|alive2|gun4|stun8|conn16) | u8 ammo | u8 vacc | u8 hp | u16 _
//   u16 npcCount, zombie bitfield, alive bitfield
//   u8 aoiCount, per NPC (8B): u16 id | u16 qx | u16 qy | u8 flags(zombie1|alive2) | u8 facing
//   u8 crateCount, per crate (8B): u8 id | u16 qx | u16 qy | u8 itemsMask(gun1|ammo2|vacc4) | u16 ticksToLand
//   u8 projCount, per projectile (4B): u16 qx | u16 qy

export const KIND = { INPUT: 1, SNAPSHOT: 2 };

const q = (v) => Math.max(0, Math.min(65535, Math.round(v * POS_QUANT)));
const dq = (v) => v / POS_QUANT;

export function encodeInput(pid, frame) {
  const buf = new ArrayBuffer(12);
  const dv = new DataView(buf);
  dv.setUint8(0, KIND.INPUT);
  dv.setUint8(1, pid);
  dv.setUint16(2, frame.seq & 0xffff, true);
  dv.setUint32(4, frame.tick >>> 0, true);
  dv.setInt8(8, Math.max(-127, Math.min(127, Math.round(frame.moveX * 127))));
  dv.setInt8(9, Math.max(-127, Math.min(127, Math.round(frame.moveY * 127))));
  dv.setUint8(10, frame.buttons & 0xff);
  dv.setUint8(11, frame.aimDir & 0xff);
  return buf;
}

export function decodeInput(buf) {
  const dv = new DataView(buf);
  return {
    pid: dv.getUint8(1),
    seq: dv.getUint16(2, true),
    tick: dv.getUint32(4, true),
    moveX: dv.getInt8(8) / 127,
    moveY: dv.getInt8(9) / 127,
    buttons: dv.getUint8(10),
    aimDir: dv.getUint8(11),
  };
}

const PHASE_NUM = { countdown: 0, playing: 1, ended: 2 };
const PHASE_NAME = ['countdown', 'playing', 'ended'];

/**
 * Encode an AOI-filtered snapshot for a guest centered at (cx, cy).
 * @param sim host sim
 * @param snapSeq u16 rolling sequence
 * @param remainingMs match countdown
 */
export function encodeSnapshot(sim, snapSeq, remainingMs, cx, cy) {
  const players = sim.players.filter(Boolean);
  const npcs = sim.npcs;
  // AOI NPCs, nearest first, capped
  const inBox = [];
  for (const n of npcs) {
    if (!n.alive) continue;
    const dx = Math.abs(n.x - cx);
    const dy = Math.abs(n.y - cy);
    if (dx <= AOI_HALF && dy <= AOI_HALF) inBox.push(n);
  }
  if (inBox.length > AOI_MAX_NPCS) {
    inBox.sort((a, b) =>
      (a.x - cx) ** 2 + (a.y - cy) ** 2 - ((b.x - cx) ** 2 + (b.y - cy) ** 2));
    inBox.length = AOI_MAX_NPCS;
  }
  const crates = sim.crates;
  const projs = sim.projectiles;
  const bitBytes = Math.ceil(npcs.length / 8);
  const size = 12 + 1 + players.length * 12 + 2 + bitBytes * 2 +
    1 + inBox.length * 8 + 1 + crates.length * 8 + 1 + Math.min(projs.length, 255) * 4;
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  let o = 0;
  dv.setUint8(o++, KIND.SNAPSHOT);
  dv.setUint8(o++, PHASE_NUM[sim.phase] ?? 1);
  dv.setUint16(o, snapSeq & 0xffff, true); o += 2;
  dv.setUint32(o, sim.tick >>> 0, true); o += 4;
  dv.setUint32(o, remainingMs >>> 0, true); o += 4;

  dv.setUint8(o++, players.length);
  for (const p of players) {
    dv.setUint8(o++, p.pid);
    dv.setUint16(o, q(p.x), true); o += 2;
    dv.setUint16(o, q(p.y), true); o += 2;
    dv.setUint8(o++, p.facing & 7);
    dv.setUint8(o++,
      (p.isZombie ? 1 : 0) | (p.alive ? 2 : 0) | (p.hasGun ? 4 : 0) |
      (sim.tick < p.stunUntil ? 8 : 0) | (p.connected ? 16 : 0) |
      (p.removedAtTick !== null ? 32 : 0));
    dv.setUint8(o++, p.ammo);
    dv.setUint8(o++, p.vaccines);
    dv.setUint8(o++, Math.max(0, p.hp));
    dv.setUint8(o++, (p.input?.aimDir ?? 0) & 0xff); // camera yaw for 3D body orientation
    dv.setUint8(o++, 0);
  }

  dv.setUint16(o, npcs.length, true); o += 2;
  const zombieOff = o;
  for (let i = 0; i < npcs.length; i++) {
    if (npcs[i].isZombie) dv.setUint8(zombieOff + (i >> 3), dv.getUint8(zombieOff + (i >> 3)) | (1 << (i & 7)));
  }
  o += bitBytes;
  const aliveOff = o;
  for (let i = 0; i < npcs.length; i++) {
    if (npcs[i].alive) dv.setUint8(aliveOff + (i >> 3), dv.getUint8(aliveOff + (i >> 3)) | (1 << (i & 7)));
  }
  o += bitBytes;

  dv.setUint8(o++, inBox.length);
  for (const n of inBox) {
    dv.setUint16(o, n.id, true); o += 2;
    dv.setUint16(o, q(n.x), true); o += 2;
    dv.setUint16(o, q(n.y), true); o += 2;
    dv.setUint8(o++, (n.isZombie ? 1 : 0) | (n.alive ? 2 : 0));
    dv.setUint8(o++, n.facing & 7);
  }

  dv.setUint8(o++, crates.length);
  for (const c of crates) {
    dv.setUint8(o++, c.id & 0xff);
    dv.setUint16(o, q(c.x), true); o += 2;
    dv.setUint16(o, q(c.y), true); o += 2;
    let mask = 0;
    for (const it of c.items) mask |= it === 'gun' ? 1 : it === 'ammo' ? 2 : 4;
    dv.setUint8(o++, mask);
    dv.setUint16(o, Math.max(0, Math.min(65535, c.landTick - sim.tick)), true); o += 2;
  }

  const pCount = Math.min(projs.length, 255);
  dv.setUint8(o++, pCount);
  for (let i = 0; i < pCount; i++) {
    dv.setUint16(o, q(projs[i].x), true); o += 2;
    dv.setUint16(o, q(projs[i].y), true); o += 2;
  }
  return buf;
}

export function decodeSnapshot(buf) {
  const dv = new DataView(buf);
  let o = 0;
  o++; // kind
  const phase = PHASE_NAME[dv.getUint8(o++)] || 'playing';
  const seq = dv.getUint16(o, true); o += 2;
  const tick = dv.getUint32(o, true); o += 4;
  const remainingMs = dv.getUint32(o, true); o += 4;

  const playerCount = dv.getUint8(o++);
  const players = [];
  for (let i = 0; i < playerCount; i++) {
    const pid = dv.getUint8(o++);
    const x = dq(dv.getUint16(o, true)); o += 2;
    const y = dq(dv.getUint16(o, true)); o += 2;
    const facing = dv.getUint8(o++);
    const flags = dv.getUint8(o++);
    const ammo = dv.getUint8(o++);
    const vaccines = dv.getUint8(o++);
    const hp = dv.getUint8(o++);
    const yaw = dv.getUint8(o++);
    o += 1;
    players.push({
      pid, x, y, facing, yaw, ammo, vaccines, hp,
      isZombie: !!(flags & 1), alive: !!(flags & 2), hasGun: !!(flags & 4),
      stunned: !!(flags & 8), connected: !!(flags & 16), removed: !!(flags & 32),
    });
  }

  const npcCount = dv.getUint16(o, true); o += 2;
  const bitBytes = Math.ceil(npcCount / 8);
  const npcZombie = new Uint8Array(buf, o, bitBytes).slice(); o += bitBytes;
  const npcAlive = new Uint8Array(buf, o, bitBytes).slice(); o += bitBytes;

  const aoiCount = dv.getUint8(o++);
  const npcs = [];
  for (let i = 0; i < aoiCount; i++) {
    const id = dv.getUint16(o, true); o += 2;
    const x = dq(dv.getUint16(o, true)); o += 2;
    const y = dq(dv.getUint16(o, true)); o += 2;
    const flags = dv.getUint8(o++);
    const facing = dv.getUint8(o++);
    npcs.push({ id, x, y, facing, isZombie: !!(flags & 1), alive: !!(flags & 2) });
  }

  const crateCount = dv.getUint8(o++);
  const crates = [];
  for (let i = 0; i < crateCount; i++) {
    const id = dv.getUint8(o++);
    const x = dq(dv.getUint16(o, true)); o += 2;
    const y = dq(dv.getUint16(o, true)); o += 2;
    const mask = dv.getUint8(o++);
    const ticksToLand = dv.getUint16(o, true); o += 2;
    const items = [];
    if (mask & 1) items.push('gun');
    if (mask & 2) items.push('ammo');
    if (mask & 4) items.push('vaccine');
    crates.push({ id, x, y, items, ticksToLand });
  }

  const projCount = dv.getUint8(o++);
  const projectiles = [];
  for (let i = 0; i < projCount; i++) {
    const x = dq(dv.getUint16(o, true)); o += 2;
    const y = dq(dv.getUint16(o, true)); o += 2;
    projectiles.push({ x, y });
  }

  return { phase, seq, tick, remainingMs, players, npcCount, npcZombie, npcAlive, npcs, crates, projectiles };
}

export const bitGet = (arr, i) => !!(arr[i >> 3] & (1 << (i & 7)));
