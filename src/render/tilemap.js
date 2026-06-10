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
    // tiny deterministic rand stream per tile
    let s = h | 1;
    const rnd = () => {
      s = Math.imul(s ^ (s >>> 13), 0x5bd1e995);
      return ((s >>> 8) & 0xffff) / 0x10000;
    };
    switch (t) {
      case T.GRASS: {
        // multi-tone speckle + rare flowers
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = ['#7dbd72', '#63a05c', '#86c87a'][(rnd() * 3) | 0];
          ctx.fillRect(px + rnd() * 28, py + rnd() * 28, 2 + rnd() * 2, 2 + rnd() * 2);
        }
        if (rnd() < 0.05) {
          ctx.fillStyle = rnd() < 0.5 ? '#ffd2e0' : '#fff6c8';
          ctx.fillRect(px + 8 + rnd() * 16, py + 8 + rnd() * 16, 3, 3);
          ctx.fillStyle = '#e8b830';
          ctx.fillRect(px + 9 + rnd() * 14, py + 9 + rnd() * 14, 1, 1);
        }
        break;
      }
      case T.ROAD: {
        // asphalt grain
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.10)';
          ctx.fillRect(px + rnd() * 30, py + rnd() * 30, 1.5 + rnd() * 2, 1.5 + rnd() * 2);
        }
        // worn lane dash
        if ((h & 15) === 0) {
          ctx.fillStyle = 'rgba(216,208,168,0.8)';
          ctx.fillRect(px + 6, py + 14, 10, 3);
        }
        break;
      }
      case T.SIDEWALK: {
        // beveled slab: light top-left, dark bottom-right
        ctx.fillStyle = 'rgba(255,255,255,0.13)';
        ctx.fillRect(px, py, TILE, 2);
        ctx.fillRect(px, py, 2, TILE);
        ctx.fillStyle = 'rgba(0,0,0,0.16)';
        ctx.fillRect(px, py + TILE - 2, TILE, 2);
        ctx.fillRect(px + TILE - 2, py, 2, TILE);
        if (rnd() < 0.12) { // crack
          ctx.strokeStyle = 'rgba(0,0,0,0.12)';
          ctx.beginPath();
          ctx.moveTo(px + rnd() * 20, py + rnd() * 28);
          ctx.lineTo(px + 10 + rnd() * 20, py + rnd() * 28);
          ctx.stroke();
        }
        break;
      }
      case T.FLOOR: {
        // wood planks
        const plank = (my % 2) * 8;
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.fillRect(px, py + ((plank + 8) % 16), TILE, 1);
        ctx.fillRect(px, py + ((plank + 24) % 32), TILE, 1);
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(px, py + 3, TILE, 1);
        if (rnd() < 0.2) {
          ctx.fillStyle = 'rgba(120,80,40,0.18)';
          ctx.beginPath();
          ctx.ellipse(px + 6 + rnd() * 20, py + 6 + rnd() * 20, 1.6, 1.0, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
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
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(px + 4, py + 4, TILE - 8, 2);
        ctx.fillStyle = '#ffd24a';
        ctx.fillRect(px + TILE - 10, py + 14, 3, 3);
        break;
      case T.PLAZA: {
        // herringbone-ish paving
        ctx.strokeStyle = 'rgba(0,0,0,0.09)';
        ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath();
        if ((mx + my) % 2 === 0) { ctx.moveTo(px, py); ctx.lineTo(px + TILE, py + TILE); }
        else { ctx.moveTo(px + TILE, py); ctx.lineTo(px, py + TILE); }
        ctx.stroke();
        break;
      }
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
