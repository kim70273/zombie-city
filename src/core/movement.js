import { TILE } from '../config.js';

// Axis-separated circle-vs-tile collision. Produces wall sliding for free.
// Positions are px floats; the map's solid() answers per-tile collision.
// Shared by host sim AND guest local prediction — keep this file pure.

/**
 * Move a circle of radius r by (dx, dy) against solid tiles.
 * Mutates nothing; returns final {x, y}.
 */
export function moveCircle(map, x, y, dx, dy, r) {
  let nx = x + dx;
  if (dx !== 0) nx = resolveAxis(map, nx, y, r, dx > 0, true);
  let ny = y + dy;
  if (dy !== 0) ny = resolveAxis(map, nx, ny, r, dy > 0, false);
  // clamp inside map bounds
  const maxX = map.w * TILE - r;
  const maxY = map.h * TILE - r;
  return {
    x: nx < r ? r : nx > maxX ? maxX : nx,
    y: ny < r ? r : ny > maxY ? maxY : ny,
  };
}

function resolveAxis(map, x, y, r, positive, isX) {
  const x0 = Math.floor((x - r) / TILE);
  const x1 = Math.floor((x + r - 0.001) / TILE);
  const y0 = Math.floor((y - r) / TILE);
  const y1 = Math.floor((y + r - 0.001) / TILE);
  let pos = isX ? x : y;
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      if (!map.solid(tx, ty)) continue;
      if (isX) {
        // only clamp if the circle vertically overlaps this tile
        if (y + r <= ty * TILE || y - r >= (ty + 1) * TILE) continue;
        pos = positive ? Math.min(pos, tx * TILE - r) : Math.max(pos, (tx + 1) * TILE + r);
      } else {
        if (x + r <= tx * TILE || x - r >= (tx + 1) * TILE) continue;
        pos = positive ? Math.min(pos, ty * TILE - r) : Math.max(pos, (ty + 1) * TILE + r);
      }
    }
  }
  return pos;
}

/** 8-way facing index from a movement/aim vector (0 down, then 1 DL, 2 left, 3 UL, 4 up, 5 UR, 6 right, 7 DR). */
export function facingFrom(dx, dy, fallback = 0) {
  if (dx === 0 && dy === 0) return fallback;
  const a = Math.atan2(dy, dx); // -PI..PI, +y is down; down = PI/2
  return Math.round((a - Math.PI / 2) / (Math.PI / 4)) & 7;
}

/** Collapse 8-way facing to 4-way sprite dir: 0 down, 1 right, 2 left, 3 up. */
export function spriteDir(facing) {
  return [0, 2, 2, 3, 3, 3, 1, 1][facing & 7] ?? 0;
}
