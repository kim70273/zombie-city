import { TILE, DURATIONS } from '../config.js';
import { mulberry32, randInt, pick } from './rng.js';

// Deterministic procedural city. The host shares only a 32-bit seed; every
// client regenerates the identical map locally (integer-friendly math only).

export const T = {
  GRASS: 0, ROAD: 1, SIDEWALK: 2, FLOOR: 3, WALL: 4, DOOR: 5,
  TREE: 6, BENCH: 7, CAR: 8, PLAZA: 9, FURNITURE: 10,
};

const SOLID_LUT = new Uint8Array(16);
for (const t of [T.WALL, T.TREE, T.BENCH, T.CAR, T.FURNITURE]) SOLID_LUT[t] = 1;
// bullets pass over benches (waist-high)
const BULLET_SOLID_LUT = SOLID_LUT.slice();
BULLET_SOLID_LUT[T.BENCH] = 0;

export const ROOF_COLORS = ['#c96f5f', '#7a8aa0', '#8aa07a', '#b09a6a', '#9a7ab0'];

/**
 * @returns map object:
 *  { w, h, tiles: Uint8Array, buildingId: Int16Array (-1 outdoors, interior floor only),
 *    buildings: [{id,x,y,w,h,doors:[{tx,ty}],roofColor}], spawns: [{tx,ty}] (10, spread),
 *    npcSpawns: [{tx,ty}], seedUsed, solid(tx,ty), bulletSolid(tx,ty), tileAt(tx,ty),
 *    buildingAt(px,py) }
 */
export function generateMap(seed, durationMin) {
  const tier = DURATIONS[durationMin] || DURATIONS[10];
  for (let attempt = 0; attempt < 10; attempt++) {
    const s = (seed + attempt) | 0;
    const map = tryGenerate(s, tier);
    if (map) return map;
  }
  // pathological seed: last attempt without the connectivity bar (still playable)
  return tryGenerate((seed + 10) | 0, tier, true);
}

function tryGenerate(seed, tier, force = false) {
  const rng = mulberry32(seed);
  const w = tier.tiles;
  const h = tier.tiles;
  const tiles = new Uint8Array(w * h).fill(T.GRASS);
  const buildingId = new Int16Array(w * h).fill(-1);
  const at = (x, y) => tiles[y * w + x];
  const set = (x, y, t) => { tiles[y * w + x] = t; };
  const inB = (x, y) => x >= 0 && y >= 0 && x < w && y < h;

  // --- 1. road lattice (positions of road span starts) ---
  const roadXs = lattice(rng, w);
  const roadYs = lattice(rng, h);
  const stampRoad = (isX, pos, width) => {
    for (let i = 0; i < width; i++) {
      for (let j = 0; j < (isX ? h : w); j++) {
        if (isX) set(pos + i, j, T.ROAD);
        else set(j, pos + i, T.ROAD);
      }
    }
  };
  roadXs.forEach(([x, wd]) => stampRoad(true, x, wd));
  roadYs.forEach(([y, wd]) => stampRoad(false, y, wd));

  // sidewalks: 1-tile border around roads
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (at(x, y) !== T.GRASS) continue;
      const nearRoad =
        (inB(x - 1, y) && at(x - 1, y) === T.ROAD) || (inB(x + 1, y) && at(x + 1, y) === T.ROAD) ||
        (inB(x, y - 1) && at(x, y - 1) === T.ROAD) || (inB(x, y + 1) && at(x, y + 1) === T.ROAD);
      if (nearRoad) set(x, y, T.SIDEWALK);
    }
  }

  // --- 2. blocks between roads ---
  const xSpans = blockSpans(roadXs, w);
  const ySpans = blockSpans(roadYs, h);
  const buildings = [];

  for (const [bx0, bx1] of xSpans) {
    for (const [by0, by1] of ySpans) {
      const bw = bx1 - bx0 + 1;
      const bh = by1 - by0 + 1;
      if (bw < 4 || bh < 4) continue;
      const isPark = rng() < 0.15 || bw < 8 || bh < 8;
      if (isPark) {
        stampPark(rng, tiles, w, bx0, by0, bw, bh);
      } else {
        packBuildings(rng, tiles, buildingId, w, h, buildings, bx0 + 1, by0 + 1, bw - 2, bh - 2);
      }
    }
  }

  // --- 6/7. doors + furniture (after all buildings placed) ---
  for (const b of buildings) {
    placeDoors(rng, tiles, w, h, b);
    placeFurniture(rng, tiles, w, b);
  }

  // --- 7b. building flavor (kind/floors/palette) — fixed point in the rng
  // stream right after the doors/furniture loop so every client consumes
  // the rng in the identical order.
  for (const b of buildings) {
    b.kind = (b.w >= 6 && b.h >= 6 && rng() < 0.4) ? 'apartment' : 'shop';
    b.floors = b.kind === 'apartment' ? 2 + Math.floor(rng() * 3) : 1; // apartments 2–4
    b.palette = Math.floor(rng() * 8); // world3d maps this to wall color schemes
  }

  // --- 8. parked cars on roads beside sidewalks ---
  stampCars(rng, tiles, w, h);

  const map = {
    w, h, tiles, buildingId, buildings, seedUsed: seed,
    spawns: [], npcSpawns: [],
    tileAt(tx, ty) { return inB(tx, ty) ? tiles[ty * w + tx] : T.WALL; },
    solid(tx, ty) { return !inB(tx, ty) || SOLID_LUT[tiles[ty * w + tx]] === 1; },
    bulletSolid(tx, ty) { return !inB(tx, ty) || BULLET_SOLID_LUT[tiles[ty * w + tx]] === 1; },
    /** building interior id at px coords, -1 = outdoors (walls/doors count as outdoors) */
    buildingAt(px, py) {
      const tx = (px / TILE) | 0;
      const ty = (py / TILE) | 0;
      return inB(tx, ty) ? buildingId[ty * w + tx] : -1;
    },
  };

  // --- 9. spawns ---
  const walkable = [];
  const sidewalks = [];
  const floors = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = at(x, y);
      if (SOLID_LUT[t]) continue;
      walkable.push(y * w + x);
      if (t === T.SIDEWALK) sidewalks.push(y * w + x);
      if (t === T.FLOOR) floors.push(y * w + x);
    }
  }
  if (sidewalks.length < 20) return null;

  const innerSidewalks = sidewalks.filter((i) => {
    const x = i % w, y = (i / w) | 0;
    return x >= 4 && y >= 4 && x < w - 4 && y < h - 4;
  });
  map.spawns = farthestPoints(rng, innerSidewalks.length >= 20 ? innerSidewalks : sidewalks, w, 10);
  const outdoor = walkable.filter((i) => {
    const t = tiles[i];
    return t !== T.FLOOR && t !== T.DOOR && t !== T.ROAD; // NPCs hang out on sidewalks/grass/plaza
  });
  const npcSpawnIdx = [];
  for (let i = 0; i < 400; i++) {
    const src = rng() < 0.3 && floors.length > 0 ? floors : outdoor;
    npcSpawnIdx.push(pick(rng, src));
  }
  map.npcSpawns = npcSpawnIdx.map((i) => ({ tx: i % w, ty: (i / w) | 0 }));

  // --- 10. connectivity validation: ≥85% of walkable reachable from spawn 0 ---
  if (!force) {
    const reach = floodCount(map, map.spawns[0], walkable.length);
    if (reach < walkable.length * 0.85) return null;
  }
  return map;
}

function lattice(rng, size) {
  const spans = [];
  let x = 2;
  let idx = 0;
  while (x < size - 8) {
    const major = idx % 3 === 0;
    spans.push([x, major ? 4 : 3]);
    x += (major ? 4 : 3) + 14 + randInt(rng, 0, 7); // block pitch ~16–22
    idx++;
  }
  return spans;
}

/** Open intervals between road+sidewalk spans → [start, end] inclusive block rects. */
function blockSpans(roads, size) {
  const spans = [];
  let prevEnd = -1; // end of previous road span (inclusive)
  for (const [pos, wd] of roads) {
    const start = prevEnd + 2;       // skip sidewalk tile after previous road
    const end = pos - 2;             // skip sidewalk tile before this road
    if (end - start >= 3) spans.push([start, end]);
    prevEnd = pos + wd - 1;
  }
  const tail = [prevEnd + 2, size - 2];
  if (tail[1] - tail[0] >= 3) spans.push(tail);
  return spans;
}

function stampPark(rng, tiles, w, x0, y0, bw, bh) {
  const set = (x, y, t) => { tiles[y * w + x] = t; };
  const at = (x, y) => tiles[y * w + x];
  // cross paths through the middle
  const cx = x0 + (bw >> 1);
  const cy = y0 + (bh >> 1);
  for (let x = x0; x < x0 + bw; x++) set(x, cy, T.PLAZA);
  for (let y = y0; y < y0 + bh; y++) set(cx, y, T.PLAZA);
  // trees, min spacing 3
  const target = Math.max(1, ((bw * bh) / 18) | 0);
  const placed = [];
  for (let n = 0, tries = 0; n < target && tries < target * 12; tries++) {
    const x = x0 + randInt(rng, 0, bw);
    const y = y0 + randInt(rng, 0, bh);
    if (at(x, y) !== T.GRASS) continue;
    if (placed.some(([px, py]) => Math.abs(px - x) < 3 && Math.abs(py - y) < 3)) continue;
    set(x, y, T.TREE);
    placed.push([x, y]);
    n++;
  }
  // a few benches along the paths
  const benches = randInt(rng, 2, 5);
  for (let n = 0, tries = 0; n < benches && tries < 20; tries++) {
    const x = x0 + randInt(rng, 1, Math.max(2, bw - 1));
    const y = cy + (rng() < 0.5 ? -1 : 1);
    if (y <= y0 || y >= y0 + bh - 1) continue;
    if (at(x, y) === T.GRASS) { set(x, y, T.BENCH); n++; }
  }
}

function packBuildings(rng, tiles, buildingId, w, h, buildings, x0, y0, bw, bh) {
  let y = y0;
  while (y + 4 <= y0 + bh) {
    const rowH = Math.min(4 + randInt(rng, 0, 5), 8, y0 + bh - y);
    if (rowH < 4) break;
    let x = x0;
    while (x + 4 <= x0 + bw) {
      const bWidth = Math.min(4 + randInt(rng, 0, 7), 10, x0 + bw - x);
      if (bWidth < 4) break;
      if (rng() < 0.8) {
        const id = buildings.length;
        const b = { id, x, y, w: bWidth, h: rowH, doors: [], roofColor: pick(rng, ROOF_COLORS) };
        for (let ty = y; ty < y + rowH; ty++) {
          for (let tx = x; tx < x + bWidth; tx++) {
            const edge = tx === x || ty === y || tx === x + bWidth - 1 || ty === y + rowH - 1;
            tiles[ty * w + tx] = edge ? T.WALL : T.FLOOR;
            if (!edge) buildingId[ty * w + tx] = id;
          }
        }
        buildings.push(b);
      } else if (rng() < 0.6) {
        // yard with a tree
        const tx = x + (bWidth >> 1);
        const ty = y + (rowH >> 1);
        if (tiles[ty * w + tx] === T.GRASS) tiles[ty * w + tx] = T.TREE;
      }
      x += bWidth + 1;
    }
    y += rowH + 2;
  }
}

function placeDoors(rng, tiles, w, h, b) {
  // candidate sides in deterministic order; door 1 on a random side, 50% second door
  const sides = ['S', 'N', 'E', 'W'];
  const first = randInt(rng, 0, 4);
  const wantTwo = rng() < 0.5;
  for (let k = 0; k < 4 && b.doors.length < (wantTwo ? 2 : 1); k++) {
    const side = sides[(first + k) % 4];
    const d = doorOnSide(rng, tiles, w, h, b, side);
    if (d) b.doors.push(d);
  }
  // absolute guarantee: bore a door mid-south
  if (b.doors.length === 0) {
    const tx = b.x + (b.w >> 1);
    const ty = b.y + b.h - 1;
    tiles[ty * w + tx] = T.DOOR;
    clearOutside(tiles, w, h, tx, ty + 1);
    b.doors.push({ tx, ty });
  }
}

function doorOnSide(rng, tiles, w, h, b, side) {
  let tx, ty, ox, oy;
  if (side === 'S' || side === 'N') {
    tx = b.x + 1 + randInt(rng, 0, Math.max(1, b.w - 2));
    ty = side === 'S' ? b.y + b.h - 1 : b.y;
    ox = tx; oy = side === 'S' ? ty + 1 : ty - 1;
  } else {
    ty = b.y + 1 + randInt(rng, 0, Math.max(1, b.h - 2));
    tx = side === 'E' ? b.x + b.w - 1 : b.x;
    oy = ty; ox = side === 'E' ? tx + 1 : tx - 1;
  }
  if (ox < 0 || oy < 0 || ox >= w || oy >= h) return null;
  const outside = tiles[oy * w + ox];
  if (outside === T.WALL || outside === T.FLOOR) return null; // adjacent building — no door into walls
  if (SOLID_LUT[outside]) clearOutside(tiles, w, h, ox, oy);
  tiles[ty * w + tx] = T.DOOR;
  return { tx, ty };
}

function clearOutside(tiles, w, h, x, y) {
  if (x >= 0 && y >= 0 && x < w && y < h && SOLID_LUT[tiles[y * w + x]]) tiles[y * w + x] = T.GRASS;
}

function placeFurniture(rng, tiles, w, b) {
  if (b.w < 6 || b.h < 6) return;
  const count = 2 + randInt(rng, 0, 3); // 2–4 pieces — richer interiors
  for (let n = 0, tries = 0; n < count && tries < 24; tries++) {
    const tx = b.x + 2 + randInt(rng, 0, Math.max(1, b.w - 5));
    const ty = b.y + 2 + randInt(rng, 0, Math.max(1, b.h - 4));
    const nearDoor = b.doors.some((d) => Math.abs(d.tx - tx) <= 2 && Math.abs(d.ty - ty) <= 2);
    if (nearDoor) continue;
    if (tiles[ty * w + tx] === T.FLOOR && tiles[ty * w + tx + 1] === T.FLOOR) {
      tiles[ty * w + tx] = T.FURNITURE;
      tiles[ty * w + tx + 1] = T.FURNITURE;
      n++;
    }
  }
}

function stampCars(rng, tiles, w, h) {
  const at = (x, y) => tiles[y * w + x];
  let lastCar = -100;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 2; x++) {
      const i = y * w + x;
      if (at(x, y) !== T.ROAD || at(x + 1, y) !== T.ROAD) continue;
      const besideSidewalk = at(x, y - 1) === T.SIDEWALK || at(x, y + 1) === T.SIDEWALK;
      if (!besideSidewalk) continue;
      if (i - lastCar < 3 + 3 * w && i - lastCar >= 0) continue; // crude min spacing
      if (rng() < 0.06) {
        tiles[i] = T.CAR;
        tiles[i + 1] = T.CAR;
        lastCar = i;
      }
    }
  }
}

/** Farthest-point sampling over candidate tile indices. Returns [{tx,ty}]. */
function farthestPoints(rng, candidates, w, count) {
  const subset = [];
  for (let i = 0; i < Math.min(400, candidates.length); i++) subset.push(pick(rng, candidates));
  const chosen = [pick(rng, subset)];
  while (chosen.length < count) {
    let best = subset[0];
    let bestD = -1;
    for (const c of subset) {
      const cx = c % w, cy = (c / w) | 0;
      let minD = Infinity;
      for (const ch of chosen) {
        const hx = ch % w, hy = (ch / w) | 0;
        const d = (cx - hx) * (cx - hx) + (cy - hy) * (cy - hy);
        if (d < minD) minD = d;
      }
      if (minD > bestD) { bestD = minD; best = c; }
    }
    chosen.push(best);
  }
  return chosen.map((i) => ({ tx: i % w, ty: (i / w) | 0 }));
}

function floodCount(map, start, _walkableTotal) {
  const { w, h } = map;
  const seen = new Uint8Array(w * h);
  const q = [start.ty * w + start.tx];
  seen[q[0]] = 1;
  let count = 0;
  while (q.length) {
    const i = q.pop();
    count++;
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (seen[j] || map.solid(nx, ny)) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return count;
}

/** FNV-1a hash of the tile array — test helper for determinism checks. */
export function hashTiles(map) {
  let hsh = 0x811c9dc5;
  for (let i = 0; i < map.tiles.length; i++) {
    hsh ^= map.tiles[i];
    hsh = Math.imul(hsh, 0x01000193);
  }
  return hsh >>> 0;
}
