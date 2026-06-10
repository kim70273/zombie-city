// Deterministic PRNG. Integer-only math → identical across browsers/Node.

export function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Independent stream derived from a base seed and a label. */
export function subRng(seed, label) {
  return mulberry32((seed ^ fnv1a(label)) | 0);
}

export function randInt(rng, min, maxExclusive) {
  return min + Math.floor(rng() * (maxExclusive - min));
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

/** In-place Fisher–Yates. Returns arr. */
export function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Weighted pick from [value, weight][] pairs. */
export function weightedPick(rng, pairs) {
  let total = 0;
  for (const [, w] of pairs) total += w;
  let r = rng() * total;
  for (const [v, w] of pairs) {
    r -= w;
    if (r < 0) return v;
  }
  return pairs[pairs.length - 1][0];
}
