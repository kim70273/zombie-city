import { ROOM_PREFIX, ROOM_CODE_LEN, ROOM_ALPHABET } from '../config.js';

export function genRoomCode(randFn) {
  const rand = randFn || defaultRand;
  let code = '';
  for (let i = 0; i < ROOM_CODE_LEN; i++) {
    code += ROOM_ALPHABET[Math.floor(rand() * ROOM_ALPHABET.length) % ROOM_ALPHABET.length];
  }
  return code;
}

function defaultRand() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const u = new Uint32Array(1);
    crypto.getRandomValues(u);
    return u[0] / 4294967296;
  }
  return Math.random();
}

export function normalizeCode(input) {
  const code = String(input || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== ROOM_CODE_LEN) return null;
  for (const ch of code) if (!ROOM_ALPHABET.includes(ch)) return null;
  return code;
}

export function peerIdForCode(code) {
  return ROOM_PREFIX + code;
}

export function genToken(randFn) {
  const rand = randFn || defaultRand;
  let t = '';
  for (let i = 0; i < 16; i++) t += ROOM_ALPHABET[Math.floor(rand() * ROOM_ALPHABET.length)];
  return t;
}
