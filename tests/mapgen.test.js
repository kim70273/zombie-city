import { describe, it, expect } from 'vitest';
import { generateMap, hashTiles, T } from '../src/core/mapgen.js';
import { DURATIONS, DURATION_CHOICES, TILE } from '../src/config.js';

describe('mapgen determinism', () => {
  it('same seed → identical tiles across two generations, all tiers', () => {
    for (const d of DURATION_CHOICES) {
      const a = generateMap(0xC0FFEE, d);
      const b = generateMap(0xC0FFEE, d);
      expect(a.seedUsed).toBe(b.seedUsed);
      expect(hashTiles(a)).toBe(hashTiles(b));
      expect(a.spawns).toEqual(b.spawns);
    }
  });
});

describe('mapgen invariants (20 random seeds × all tiers)', () => {
  const seeds = Array.from({ length: 20 }, (_, i) => (i * 2654435761) | 0);

  for (const d of DURATION_CHOICES) {
    it(`tier ${d}min: size, buildings, doors, spawns, connectivity`, () => {
      for (const seed of seeds) {
        const map = generateMap(seed, d);
        expect(map.w).toBe(DURATIONS[d].tiles);
        expect(map.h).toBe(DURATIONS[d].tiles);
        expect(map.buildings.length).toBeGreaterThan(5);

        for (const b of map.buildings) {
          expect(b.doors.length).toBeGreaterThanOrEqual(1);
          for (const door of b.doors) {
            expect(map.tileAt(door.tx, door.ty)).toBe(T.DOOR);
            // a door connects ≥1 interior floor and ≥1 outside walkable tile
            const nbrs = [
              [door.tx + 1, door.ty], [door.tx - 1, door.ty],
              [door.tx, door.ty + 1], [door.tx, door.ty - 1],
            ];
            const hasFloor = nbrs.some(([x, y]) => map.tileAt(x, y) === T.FLOOR || map.tileAt(x, y) === T.FURNITURE);
            const hasOutside = nbrs.some(([x, y]) => !map.solid(x, y) && map.tileAt(x, y) !== T.FLOOR);
            expect(hasFloor).toBe(true);
            expect(hasOutside).toBe(true);
          }
        }

        // 10 spawn points, walkable, pairwise reasonably spread
        expect(map.spawns.length).toBe(10);
        for (const s of map.spawns) expect(map.solid(s.tx, s.ty)).toBe(false);

        // buildingAt: interior floor maps to its building, road is outdoors
        const b0 = map.buildings[0];
        const ix = b0.x + 1, iy = b0.y + 1;
        if (map.tileAt(ix, iy) === T.FLOOR) {
          expect(map.buildingAt(ix * TILE + 16, iy * TILE + 16)).toBe(b0.id);
        }
        expect(map.buildingAt(map.spawns[0].tx * TILE + 16, map.spawns[0].ty * TILE + 16)).toBe(-1);
      }
    });
  }

  it('connectivity: ≥85% of walkable tiles reachable from spawn 0', () => {
    const map = generateMap(424242, 10);
    let walkable = 0;
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) if (!map.solid(x, y)) walkable++;
    }
    // BFS
    const seen = new Set();
    const q = [[map.spawns[0].tx, map.spawns[0].ty]];
    seen.add(map.spawns[0].ty * map.w + map.spawns[0].tx);
    let reach = 0;
    while (q.length) {
      const [x, y] = q.pop();
      reach++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        const k = ny * map.w + nx;
        if (seen.has(k) || map.solid(nx, ny)) continue;
        seen.add(k);
        q.push([nx, ny]);
      }
    }
    expect(reach / walkable).toBeGreaterThanOrEqual(0.85);
  });
});
