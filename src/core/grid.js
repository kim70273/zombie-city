import { GRID_CELL } from '../config.js';

// Spatial hash, rebuilt each tick (≤ ~210 entities — rebuild is cheaper than bookkeeping).

export function buildGrid(entities) {
  const cells = new Map();
  for (const e of entities) {
    if (!e || e.alive === false) continue;
    const key = cellKey(e.x, e.y);
    let arr = cells.get(key);
    if (!arr) cells.set(key, (arr = []));
    arr.push(e);
  }
  return cells;
}

function cellKey(x, y) {
  return ((x / GRID_CELL) | 0) * 100000 + ((y / GRID_CELL) | 0);
}

/** Visit every entity in cells overlapping the circle (cheap AABB over cells). */
export function queryGrid(cells, x, y, r, visit) {
  const cx0 = ((x - r) / GRID_CELL) | 0;
  const cx1 = ((x + r) / GRID_CELL) | 0;
  const cy0 = ((y - r) / GRID_CELL) | 0;
  const cy1 = ((y + r) / GRID_CELL) | 0;
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cy = cy0; cy <= cy1; cy++) {
      const arr = cells.get(cx * 100000 + cy);
      if (arr) for (const e of arr) visit(e);
    }
  }
}

/** Nearest entity within r satisfying pred. Returns {e, d2} or null. */
export function nearestInGrid(cells, x, y, r, pred) {
  let best = null;
  let bestD2 = r * r;
  queryGrid(cells, x, y, r, (e) => {
    if (pred && !pred(e)) return;
    const dx = e.x - x;
    const dy = e.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = e;
    }
  });
  return best ? { e: best, d2: bestD2 } : null;
}
