import { describe, it, expect } from 'vitest';
import { facingFrom, spriteDir, moveCircle } from '../src/core/movement.js';
import { generateMap } from '../src/core/mapgen.js';
import { TILE } from '../src/config.js';

describe('facingFrom (screen coords, +y down)', () => {
  it('maps the 8 cardinal/diagonal movement vectors correctly', () => {
    expect(facingFrom(0, 1)).toBe(0);    // down
    expect(facingFrom(-1, 1)).toBe(1);   // down-left
    expect(facingFrom(-1, 0)).toBe(2);   // left
    expect(facingFrom(-1, -1)).toBe(3);  // up-left
    expect(facingFrom(0, -1)).toBe(4);   // up
    expect(facingFrom(1, -1)).toBe(5);   // up-right
    expect(facingFrom(1, 0)).toBe(6);    // right
    expect(facingFrom(1, 1)).toBe(7);    // down-right
  });
  it('falls back when idle', () => {
    expect(facingFrom(0, 0, 5)).toBe(5);
  });
  it('sprite dirs: right-mover renders right-facing, left-mover left-facing', () => {
    expect(spriteDir(facingFrom(1, 0))).toBe(1);  // right
    expect(spriteDir(facingFrom(-1, 0))).toBe(2); // left
    expect(spriteDir(facingFrom(0, 1))).toBe(0);  // down
    expect(spriteDir(facingFrom(0, -1))).toBe(3); // up
  });
});

describe('moveCircle', () => {
  const map = generateMap(123, 5);
  it('never ends up inside a solid tile (random walk)', () => {
    const s = map.spawns[0];
    let x = s.tx * TILE + 16;
    let y = s.ty * TILE + 16;
    let seed = 1;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 5000; i++) {
      const r = moveCircle(map, x, y, (rnd() * 2 - 1) * 8, (rnd() * 2 - 1) * 8, 11.2);
      x = r.x;
      y = r.y;
      expect(map.solid((x / TILE) | 0, (y / TILE) | 0)).toBe(false);
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
    }
  });
  it('clamps to map bounds', () => {
    const r = moveCircle(map, 20, 20, -500, -500, 11.2);
    expect(r.x).toBeGreaterThanOrEqual(11.2);
    expect(r.y).toBeGreaterThanOrEqual(11.2);
  });
});
