import { TILE } from '../config.js';
import { T } from '../core/mapgen.js';
import { makeTreeSprite, makeCarSprite, makeBenchSprite, makeFurnitureSprite } from './props.js';

// Static map → 16×16-tile chunk canvases (512px), baked on demand, LRU-cached.

const CHUNK_TILES = 16;
const CHUNK_PX = CHUNK_TILES * TILE;
const LRU_MAX = 60;

const BASE_COLORS = {
  [T.GRASS]: '#6fae66',
  [T.ROAD]: '#4a4a52',
  [T.SIDEWALK]: '#9a9aa2',
  [T.FLOOR]: '#d8c8a8',
  [T.WALL]: '#7a6a5a',
  [T.DOOR]: '#c8a070',
  [T.TREE]: '#6fae66',
  [T.BENCH]: '#9a9aa2',
  [T.CAR]: '#4a4a52',
  [T.PLAZA]: '#b5c9a3',
  [T.FURNITURE]: '#d8c8a8',
};

export class ChunkCache {
  /** opts.props=false → bake ground colors only (3D mode places real meshes for props) */
  constructor(map, opts = {}) {
    this.map = map;
    this.props = opts.props !== false;
    this.cache = new Map();
    this.tree = makeTreeSprite();
    this.bench = makeBenchSprite();
    this.furniture = makeFurnitureSprite();
    this.cars = Array.from({ length: 6 }, (_, i) => makeCarSprite(i));
  }

  get(cx, cy) {
    const key = cx * 4096 + cy;
    let c = this.cache.get(key);
    if (c) {
      this.cache.delete(key);
      this.cache.set(key, c); // refresh LRU order
      return c;
    }
    c = this.bake(cx, cy);
    this.cache.set(key, c);
    if (this.cache.size > LRU_MAX) this.cache.delete(this.cache.keys().next().value);
    return c;
  }

  bake(cx, cy) {
    const { map } = this;
    const canvas = document.createElement('canvas');
    canvas.width = CHUNK_PX;
    canvas.height = CHUNK_PX;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    for (let ty = 0; ty < CHUNK_TILES; ty++) {
      for (let tx = 0; tx < CHUNK_TILES; tx++) {
        const mx = cx * CHUNK_TILES + tx;
        const my = cy * CHUNK_TILES + ty;
        const t = mx < map.w && my < map.h ? map.tileAt(mx, my) : T.GRASS;
        const px = tx * TILE;
        const py = ty * TILE;
        ctx.fillStyle = BASE_COLORS[t] || '#6fae66';
        ctx.fillRect(px, py, TILE, TILE);
        this.detail(ctx, t, px, py, mx, my);
      }
    }
    return canvas;
  }

  detail(ctx, t, px, py, mx, my) {
    const { map } = this;
    const h = (mx * 73856093) ^ (my * 19349663); // cheap position hash for variety
    switch (t) {
      case T.GRASS:
        if ((h & 7) === 0) {
          ctx.fillStyle = '#7dbd72';
          ctx.fillRect(px + (h >> 3 & 23), py + (h >> 8 & 23), 3, 3);
        }
        break;
      case T.ROAD: {
        // lane dashes on horizontal/vertical road centers
        ctx.fillStyle = '#5a5a64';
        if ((h & 15) === 0) ctx.fillRect(px + 6, py + 14, 8, 2);
        break;
      }
      case T.SIDEWALK:
        ctx.strokeStyle = 'rgba(0,0,0,0.08)';
        ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
        break;
      case T.FLOOR:
        ctx.fillStyle = 'rgba(0,0,0,0.06)';
        ctx.fillRect(px, py + (my % 2 ? 15 : 0), TILE, 1);
        break;
      case T.WALL: {
        ctx.fillStyle = '#6a5a4c';
        ctx.fillRect(px, py + TILE - 6, TILE, 6);
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fillRect(px, py, TILE, 2);
        break;
      }
      case T.DOOR:
        ctx.fillStyle = '#8a6038';
        ctx.fillRect(px + 4, py + 4, TILE - 8, TILE - 8);
        ctx.fillStyle = '#ffd24a';
        ctx.fillRect(px + TILE - 10, py + 14, 3, 3);
        break;
      case T.PLAZA:
        ctx.strokeStyle = 'rgba(0,0,0,0.06)';
        ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
        break;
      case T.TREE:
        if (!this.props) break;
        ctx.drawImage(this.tree, px + TILE / 2 - this.tree.width / 4, py + TILE - this.tree.height / 2 - 4,
          this.tree.width / 2, this.tree.height / 2);
        break;
      case T.BENCH:
        if (!this.props) break;
        ctx.drawImage(this.bench, px, py + 8, TILE, TILE / 2);
        break;
      case T.CAR: {
        if (!this.props) break;
        // draw once per 2-tile pair (left tile of the pair)
        const leftIsCar = mx > 0 && map.tileAt(mx - 1, my) === T.CAR;
        if (!leftIsCar) {
          const sprite = this.cars[Math.abs(h) % 6];
          ctx.drawImage(sprite, px, py + 2, TILE * 2, TILE - 4);
        }
        break;
      }
      case T.FURNITURE: {
        if (!this.props) break;
        const leftIsF = mx > 0 && map.tileAt(mx - 1, my) === T.FURNITURE;
        if (!leftIsF) ctx.drawImage(this.furniture, px, py, TILE * 2, TILE);
        break;
      }
      default:
        break;
    }
  }

  /** Draw all chunks overlapping the viewport (world coords already on ctx). */
  drawVisible(ctx, x0, y0, x1, y1) {
    const c0x = Math.max(0, Math.floor(x0 / CHUNK_PX));
    const c0y = Math.max(0, Math.floor(y0 / CHUNK_PX));
    const c1x = Math.min(Math.ceil(this.map.w / CHUNK_TILES) - 1, Math.floor(x1 / CHUNK_PX));
    const c1y = Math.min(Math.ceil(this.map.h / CHUNK_TILES) - 1, Math.floor(y1 / CHUNK_PX));
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        ctx.drawImage(this.get(cx, cy), cx * CHUNK_PX, cy * CHUNK_PX);
      }
    }
  }
}
