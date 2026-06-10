import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TILE } from '../config.js';
import { T } from '../core/mapgen.js';
import { ChunkCache } from '../render/tilemap.js';

// Static procedural 3D city. 2D sim coords (x, y) map to 3D (x, 0, y);
// ground is the XZ plane, +Y up, 1 tile = 32 world units.
// Cel-shaded (MeshToonMaterial, 2-step gradient) anime-urban look.
// Buildings come in two kinds (mapgen b.kind): multi-story 'apartment'
// (windows grid, parapet, rooftop structure) and single-story 'shop'
// (storefront glass band + neon strip).

export const FLOOR_H = 88;          // one story (~75-unit characters fit)
export const WALL_HEIGHT = FLOOR_H; // legacy alias — single-story wall height

const CHUNK_TILES = 16;
const CHUNK_WORLD = CHUNK_TILES * TILE; // 512 world units = 512 px canvas
const HALF = TILE / 2;
const ROOF_THICKNESS = 6;
const DOOR_CLEAR = 64;          // open door gap height; lintel fills gap→roof
const PARAPET_H = 6;            // apartment roof edge ring
const AWNING_Y = 72;            // door awning sits just above the door gap
const FADE_TARGET = 0.18;       // opacity of the building the camera target is in
const FADE_SPEED = 6;           // lerp factor per second
const BORDER_MARGIN = 2000;     // dark apron beyond map edges

// 8 wall palettes (b.palette): cream, terracotta, sage, dusty blue,
// blush pink, light grey, sand, mint — mixed subtly with roofColor.
const WALL_PALETTES = [
  '#f2e8d8', '#d8845f', '#a8b89a', '#8fa8c0',
  '#e8b4b8', '#c8c8cc', '#d8c49a', '#a8d8c0',
];
const WINDOW_GLASS = '#bfe0f2';
const WINDOW_GLOW = '#9fd0ee';
const WINDOW_FRAME = '#4a4a55';
const AWNING_COLOR = '#3a2418';
const BORDER_COLOR = '#2e4a36'; // dark parkland beyond the city — blends with fog, no black void
const NEON_COLORS = ['#ff5a8a', '#5ad8ff', '#ffd24a', '#8aff5a'];
const CAR_COLORS = ['#f2a7b3', '#a7c8f2', '#b8e6b8', '#f2d8a7', '#d8b8f2', '#f2f2f2'];
const SOFA_COLORS = ['#c2655c', '#b8884e', '#7a9461'];

/** Cheap deterministic position hash (same scheme tilemap.js uses). */
function posHash(x, y) {
  return (((x * 73856093) ^ (y * 19349663)) >>> 0);
}

/** 2-step toon ramp (dark 0.55 / bright 1.0) → crisp cel-shadow boundary. */
function makeGradientMap() {
  const data = new Uint8Array([140, 255]);
  const tex = new THREE.DataTexture(data, 2, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export class CityWorld {
  /**
   * @param {THREE.Scene} scene
   * @param {object} map  result of generateMap() (src/core/mapgen.js)
   * @param {{bakeGround?: boolean}} opts  bakeGround:false skips canvas texture
   *   baking so the world can be constructed headless (Node, no DOM).
   */
  constructor(scene, map, { bakeGround = true } = {}) {
    this.scene = scene;
    this.map = map;
    this.root = new THREE.Group();
    this.root.name = 'cityWorld';

    this.gradientMap = makeGradientMap();
    this.buildingFx = new Map(); // id → { mats:[wall,roof,glass?,frame?], roof, opacity, target }
    this._fading = new Set();    // building ids currently animating
    this._lastSelf = -1;

    this._buildBorder();
    if (bakeGround) this._buildGround();
    this._buildBuildings();
    this._buildProps();

    // static world: freeze local matrices
    this.root.traverse((o) => { o.updateMatrix(); o.matrixAutoUpdate = false; });
    scene.add(this.root);
  }

  _toon(color, extra = {}) {
    return new THREE.MeshToonMaterial({ color, gradientMap: this.gradientMap, ...extra });
  }

  // ---------------------------------------------------------------- ground

  _buildBorder() {
    const { w, h } = this.map;
    const geo = new THREE.PlaneGeometry(w * TILE + BORDER_MARGIN * 2, h * TILE + BORDER_MARGIN * 2);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: BORDER_COLOR }));
    mesh.position.set(w * HALF, -0.6, h * HALF); // slightly below chunks: no z-fighting
    mesh.name = 'border';
    this.root.add(mesh);
  }

  _buildGround() {
    const { map } = this;
    const cache = new ChunkCache(map, { props: false }); // ground colors only
    const cw = Math.ceil(map.w / CHUNK_TILES);
    const ch = Math.ceil(map.h / CHUNK_TILES);
    const geo = new THREE.PlaneGeometry(CHUNK_WORLD, CHUNK_WORLD);
    geo.rotateX(-Math.PI / 2);
    for (let cy = 0; cy < ch; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        const tex = new THREE.CanvasTexture(cache.get(cx, cy));
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.anisotropy = 4;
        // Lambert (not Basic) so the ground receives building/prop shadows
        const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
        mesh.receiveShadow = true;
        mesh.position.set(cx * CHUNK_WORLD + CHUNK_WORLD / 2, 0, cy * CHUNK_WORLD + CHUNK_WORLD / 2);
        mesh.name = `chunk_${cx}_${cy}`;
        this.root.add(mesh);
      }
    }
  }

  // ------------------------------------------------------------- buildings

  /** BoxGeometry with a constant vertex-color attribute (for merged multi-color meshes). */
  _coloredBox(w, h, d, color) {
    const g = new THREE.BoxGeometry(w, h, d);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = color.r;
      arr[i * 3 + 1] = color.g;
      arr[i * 3 + 2] = color.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  }

  /** Wall tint from palette index + roofColor; apartments urban, shops vivid. */
  _wallColor(b) {
    const idx = (b.palette ?? posHash(b.x, b.y)) & 7;
    const c = new THREE.Color(WALL_PALETTES[idx]).lerp(new THREE.Color(b.roofColor), 0.18);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    if (b.kind === 'apartment') c.setHSL(hsl.h, hsl.s * 0.65, Math.min(0.82, hsl.l * 1.04));
    else c.setHSL(hsl.h, Math.min(1, hsl.s * 1.3 + 0.05), hsl.l);
    return c;
  }

  _buildBuildings() {
    const { map } = this;
    const awningNS = new THREE.BoxGeometry(24, 4, 16); // door faces ±Z
    const awningEW = new THREE.BoxGeometry(16, 4, 24); // door faces ±X
    const awningParts = [];
    const trimParts = [];
    const neon = []; // { len, x, y, z, rotY, color }
    const wallUnits = new Map();  // floors → BoxGeometry (cache)
    const lintelUnits = new Map();
    const trimColor = new THREE.Color();

    for (const b of map.buildings) {
      const floors = Math.max(1, b.floors | 0 || 1);
      const topY = floors * FLOOR_H;
      if (!wallUnits.has(floors)) {
        const wg = new THREE.BoxGeometry(TILE, topY, TILE);
        wg.translate(0, topY / 2, 0);
        wallUnits.set(floors, wg);
        const lg = new THREE.BoxGeometry(TILE, topY - DOOR_CLEAR, TILE);
        lg.translate(0, (DOOR_CLEAR + topY) / 2, 0);
        lintelUnits.set(floors, lg);
      }
      const wallUnit = wallUnits.get(floors);
      const lintelUnit = lintelUnits.get(floors);

      const parts = [];
      for (let ty = b.y; ty < b.y + b.h; ty++) {
        for (let tx = b.x; tx < b.x + b.w; tx++) {
          const edge = tx === b.x || ty === b.y || tx === b.x + b.w - 1 || ty === b.y + b.h - 1;
          if (!edge) continue;
          const t = map.tileAt(tx, ty);
          if (t === T.WALL) {
            parts.push(wallUnit.clone().translate(tx * TILE + HALF, 0, ty * TILE + HALF));
          } else if (t === T.DOOR) { // open gap + lintel so the wall ring reads connected
            parts.push(lintelUnit.clone().translate(tx * TILE + HALF, 0, ty * TILE + HALF));
          }
        }
      }
      if (parts.length === 0) continue;

      const cx = b.x * TILE + b.w * HALF;
      const cz = b.y * TILE + b.h * HALF;
      const isApt = b.kind === 'apartment' && floors > 1;
      if (isApt) this._rooftopStructure(parts, b, cx, cz, topY);

      const wallColor = this._wallColor(b);
      const wallMat = this._toon(wallColor, { transparent: true, opacity: 1 });
      const walls = new THREE.Mesh(mergeGeometries(parts), wallMat);
      walls.castShadow = true;
      walls.receiveShadow = true;
      walls.name = `walls_${b.id}`;
      this.root.add(walls);

      // dark base trim around the bottom — grounds the building visually
      trimColor.copy(wallColor).multiplyScalar(0.5);
      trimParts.push(
        this._coloredBox(b.w * TILE + 4, 6, b.h * TILE + 4, trimColor).translate(cx, 3, cz));

      // roof slab (+ parapet ring for apartments), baked in world space
      const roofParts = [new THREE.BoxGeometry(b.w * TILE, ROOF_THICKNESS, b.h * TILE)
        .translate(cx, topY + ROOF_THICKNESS / 2, cz)];
      if (isApt) {
        const py = topY + ROOF_THICKNESS + PARAPET_H / 2;
        const wpx = b.w * TILE, hpz = b.h * TILE;
        roofParts.push(
          new THREE.BoxGeometry(wpx, PARAPET_H, 4).translate(cx, py, cz - hpz / 2 + 2),
          new THREE.BoxGeometry(wpx, PARAPET_H, 4).translate(cx, py, cz + hpz / 2 - 2),
          new THREE.BoxGeometry(4, PARAPET_H, hpz - 8).translate(cx - wpx / 2 + 2, py, cz),
          new THREE.BoxGeometry(4, PARAPET_H, hpz - 8).translate(cx + wpx / 2 - 2, py, cz),
        );
      }
      const roofMat = this._toon(b.roofColor, { transparent: true, opacity: 1 });
      const roof = new THREE.Mesh(mergeGeometries(roofParts), roofMat);
      roof.castShadow = true;
      roof.receiveShadow = true;
      roof.name = `roof_${b.id}`;
      this.root.add(roof);

      // street side = side of the first door (storefront/neon face)
      const d0 = b.doors[0];
      let sd = { dx: 0, dz: 1 };
      if (d0) {
        if (d0.ty === b.y) sd = { dx: 0, dz: -1 };
        else if (d0.ty === b.y + b.h - 1) sd = { dx: 0, dz: 1 };
        else if (d0.tx === b.x) sd = { dx: -1, dz: 0 };
        else sd = { dx: 1, dz: 0 };
      }

      // windows (apartment grid / shop storefront band)
      const fx = { mats: [wallMat, roofMat], roof, opacity: 1, target: 1 };
      this._buildWindows(b, floors, isApt, sd, fx);
      this.buildingFx.set(b.id, fx);

      // door awnings (jut outward — helps players spot entrances)
      for (const d of b.doors) {
        let dx = 0, dz = 0;
        if (d.ty === b.y) dz = -1;
        else if (d.ty === b.y + b.h - 1) dz = 1;
        else if (d.tx === b.x) dx = -1;
        else dx = 1;
        const base = dz !== 0 ? awningNS : awningEW;
        awningParts.push(base.clone().translate(
          d.tx * TILE + HALF + dx * 20, AWNING_Y, d.ty * TILE + HALF + dz * 20));
      }

      // neon accent strip along the top edge of the street-facing wall (shops only)
      if (!isApt) {
        const horizontal = sd.dz !== 0; // strip runs along X
        neon.push({
          len: (horizontal ? b.w : b.h) * TILE - 12,
          x: cx + sd.dx * (b.w * HALF + 1.5),
          y: topY - 5,
          z: cz + sd.dz * (b.h * HALF + 1.5),
          rotY: horizontal ? 0 : Math.PI / 2,
          color: NEON_COLORS[posHash(b.x, b.y) % NEON_COLORS.length],
        });
      }
    }

    if (awningParts.length > 0) {
      const awnings = new THREE.Mesh(mergeGeometries(awningParts), this._toon(AWNING_COLOR));
      awnings.castShadow = true;
      awnings.name = 'awnings';
      this.root.add(awnings);
    }
    if (trimParts.length > 0) {
      const trims = new THREE.Mesh(mergeGeometries(trimParts),
        this._toon(0xffffff, { vertexColors: true }));
      trims.castShadow = true;
      trims.name = 'baseTrims';
      this.root.add(trims);
    }
    this._buildNeonStrips(neon);
  }

  /** Apartment roof extras: stair house or water tank (hash-picked), wall-colored. */
  _rooftopStructure(parts, b, cx, cz, topY) {
    const h = posHash(b.x + 7, b.y + 3);
    const ox = cx + ((h >>> 2) & 1 ? 1 : -1) * Math.max(0, b.w * TILE / 2 - 40);
    const oz = cz + ((h >>> 3) & 1 ? 1 : -1) * Math.max(0, b.h * TILE / 2 - 36);
    const baseY = topY + ROOF_THICKNESS;
    if (h & 1) { // stair house
      parts.push(new THREE.BoxGeometry(44, 30, 36).translate(ox, baseY + 15, oz));
      parts.push(new THREE.BoxGeometry(50, 4, 42).translate(ox, baseY + 32, oz)); // flat cap
    } else {     // water tank on a low plinth
      parts.push(new THREE.BoxGeometry(30, 6, 30).translate(ox, baseY + 3, oz));
      parts.push(new THREE.CylinderGeometry(13, 13, 26, 10).translate(ox, baseY + 19, oz));
    }
  }

  /**
   * Window meshes for one building, merged into ≤2 meshes (frames + glass).
   * Apartments: per-floor grid on every exterior face (every other wall tile,
   * door columns skipped). Shops: wide storefront band(s) on the street face.
   */
  _buildWindows(b, floors, isApt, sd, fx) {
    const { map } = this;
    const glassParts = [];
    const frameParts = [];
    // unit geoms: face normal ±Z (NS) or ±X (EW)
    const glassNS = new THREE.BoxGeometry(16, 22, 1);
    const frameNS = new THREE.BoxGeometry(18, 24, 0.5);
    const glassEW = new THREE.BoxGeometry(1, 22, 16);
    const frameEW = new THREE.BoxGeometry(0.5, 24, 18);

    if (isApt) {
      const x0 = b.x * TILE, x1 = (b.x + b.w) * TILE;
      const z0 = b.y * TILE, z1 = (b.y + b.h) * TILE;
      for (let f = 0; f < floors; f++) {
        const wy = f * FLOOR_H + 44;
        for (let tx = b.x + 1; tx < b.x + b.w - 1; tx++) { // N + S faces (skip corners)
          if ((tx + b.y) & 1) continue;
          const wx = tx * TILE + HALF;
          if (map.tileAt(tx, b.y) === T.WALL) { // north (−Z)
            glassParts.push(glassNS.clone().translate(wx, wy, z0 - 0.8));
            frameParts.push(frameNS.clone().translate(wx, wy, z0 - 0.25));
          }
          if (map.tileAt(tx, b.y + b.h - 1) === T.WALL) { // south (+Z)
            glassParts.push(glassNS.clone().translate(wx, wy, z1 + 0.8));
            frameParts.push(frameNS.clone().translate(wx, wy, z1 + 0.25));
          }
        }
        for (let ty = b.y + 1; ty < b.y + b.h - 1; ty++) { // W + E faces
          if ((ty + b.x) & 1) continue;
          const wz = ty * TILE + HALF;
          if (map.tileAt(b.x, ty) === T.WALL) { // west (−X)
            glassParts.push(glassEW.clone().translate(x0 - 0.8, wy, wz));
            frameParts.push(frameEW.clone().translate(x0 - 0.25, wy, wz));
          }
          if (map.tileAt(b.x + b.w - 1, ty) === T.WALL) { // east (+X)
            glassParts.push(glassEW.clone().translate(x1 + 0.8, wy, wz));
            frameParts.push(frameEW.clone().translate(x1 + 0.25, wy, wz));
          }
        }
      }
    } else {
      // storefront: glass band over each contiguous wall run on the street face
      // (band y 20..48, slim box floating 0.8 off the wall, framed)
      const runs = [];
      if (sd.dz !== 0) {
        const ty = sd.dz < 0 ? b.y : b.y + b.h - 1;
        let s = -1;
        for (let tx = b.x + 1; tx <= b.x + b.w - 1; tx++) {
          const wall = tx < b.x + b.w - 1 && map.tileAt(tx, ty) === T.WALL;
          if (wall && s < 0) s = tx;
          if (!wall && s >= 0) { runs.push([s, tx - 1]); s = -1; }
        }
        const z = (sd.dz < 0 ? b.y * TILE : (b.y + b.h) * TILE) + sd.dz * 0.8;
        const zf = (sd.dz < 0 ? b.y * TILE : (b.y + b.h) * TILE) + sd.dz * 0.25;
        for (const [rs, re] of runs) {
          const len = (re - rs + 1) * TILE;
          if (len < TILE * 2) continue;
          const w = len - 10;
          const x = (rs * TILE + (re + 1) * TILE) / 2;
          glassParts.push(new THREE.BoxGeometry(w, 28, 1.2).translate(x, 34, z));
          frameParts.push(new THREE.BoxGeometry(w + 4, 32, 0.6).translate(x, 34, zf));
        }
      } else {
        const tx = sd.dx < 0 ? b.x : b.x + b.w - 1;
        let s = -1;
        for (let ty = b.y + 1; ty <= b.y + b.h - 1; ty++) {
          const wall = ty < b.y + b.h - 1 && map.tileAt(tx, ty) === T.WALL;
          if (wall && s < 0) s = ty;
          if (!wall && s >= 0) { runs.push([s, ty - 1]); s = -1; }
        }
        const x = (sd.dx < 0 ? b.x * TILE : (b.x + b.w) * TILE) + sd.dx * 0.8;
        const xf = (sd.dx < 0 ? b.x * TILE : (b.x + b.w) * TILE) + sd.dx * 0.25;
        for (const [rs, re] of runs) {
          const len = (re - rs + 1) * TILE;
          if (len < TILE * 2) continue;
          const d = len - 10;
          const z = (rs * TILE + (re + 1) * TILE) / 2;
          glassParts.push(new THREE.BoxGeometry(1.2, 28, d).translate(x, 34, z));
          frameParts.push(new THREE.BoxGeometry(0.6, 32, d + 4).translate(xf, 34, z));
        }
      }
    }

    if (frameParts.length > 0) {
      const frameMat = this._toon(WINDOW_FRAME, { transparent: true, opacity: 1 });
      const frames = new THREE.Mesh(mergeGeometries(frameParts), frameMat);
      frames.name = `winFrames_${b.id}`;
      this.root.add(frames);
      fx.mats.push(frameMat);
    }
    if (glassParts.length > 0) {
      const glassMat = new THREE.MeshStandardMaterial({
        color: WINDOW_GLASS, emissive: WINDOW_GLOW, emissiveIntensity: 0.35,
        roughness: 0.3, metalness: 0.1, transparent: true, opacity: 1,
      });
      const glass = new THREE.Mesh(mergeGeometries(glassParts), glassMat);
      glass.name = `winGlass_${b.id}`;
      this.root.add(glass);
      fx.mats.push(glassMat);
    }
  }

  /** Emissive-look signage strips (unlit MeshBasic) — ZZZ city-pop accent. */
  _buildNeonStrips(neon) {
    if (neon.length === 0) return;
    const geo = new THREE.BoxGeometry(1, 4, 3); // scaled per instance along X
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), neon.length);
    mesh.name = 'neonStrips';
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const axisY = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    neon.forEach((n, i) => {
      q.setFromAxisAngle(axisY, n.rotY);
      p.set(n.x, n.y, n.z);
      s.set(n.len, 1, 1);
      mesh.setMatrixAt(i, m.compose(p, q, s));
      mesh.setColorAt(i, c.set(n.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    this.root.add(mesh);
  }

  // ----------------------------------------------------------------- props

  _buildProps() {
    const { map } = this;
    const trees = [], benches = [], cars = [], furniture = [];
    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        switch (map.tileAt(tx, ty)) {
          case T.TREE: trees.push(tx, ty); break;
          case T.BENCH: benches.push(tx, ty); break;
          case T.CAR: // left tile of the 2-tile pair (same detection as tilemap.js)
            if (map.tileAt(tx - 1, ty) !== T.CAR) cars.push(tx, ty);
            break;
          case T.FURNITURE:
            if (map.tileAt(tx - 1, ty) !== T.FURNITURE) furniture.push(tx, ty);
            break;
          default: break;
        }
      }
    }
    this._buildTrees(trees);
    this._buildCars(cars);
    this._buildBenches(benches);
    this._buildFurniture(furniture);
  }

  /** geometry is pre-translated to its local offset; same matrix drives all parts. */
  _instanced(geometry, material, count, name) {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.castShadow = true;
    mesh.name = name;
    this.root.add(mesh);
    return mesh;
  }

  _buildTrees(list) {
    const n = list.length / 2;
    if (n === 0) return;
    const trunkGeo = new THREE.CylinderGeometry(3, 4, 14, 7);
    trunkGeo.translate(0, 7, 0);
    const folAGeo = new THREE.SphereGeometry(12, 10, 8);
    folAGeo.translate(0, 20, 0);
    const folBGeo = new THREE.SphereGeometry(8, 9, 7);
    folBGeo.translate(0, 30, 0);
    const meshes = [
      this._instanced(trunkGeo, this._toon('#7a5a3a'), n, 'treeTrunks'),
      this._instanced(folAGeo, this._toon('#4fae4f'), n, 'treeFoliageA'),
      this._instanced(folBGeo, this._toon('#7fd86a'), n, 'treeFoliageB'),
    ];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const axisY = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const tx = list[i * 2], ty = list[i * 2 + 1];
      const h = posHash(tx, ty);
      const scale = 0.85 + (h % 100) / 100 * 0.3;        // 0.85–1.15
      q.setFromAxisAngle(axisY, ((h >>> 8) % 628) / 100); // 0–2π
      p.set(tx * TILE + HALF, 0, ty * TILE + HALF);
      s.setScalar(scale);
      m.compose(p, q, s);
      for (const mesh of meshes) mesh.setMatrixAt(i, m);
    }
    for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
  }

  _buildCars(list) {
    const n = list.length / 2;
    if (n === 0) return;
    const bodyGeo = new RoundedBoxGeometry(56, 14, 26, 2, 4);
    bodyGeo.translate(0, 10, 0);
    const cabinGeo = new THREE.BoxGeometry(28, 10, 22);
    cabinGeo.translate(-2, 22, 0);
    const windowGeo = new THREE.BoxGeometry(29, 5, 23); // sticks past the cabin → window band
    windowGeo.translate(-2, 22.5, 0);
    const underGeo = new THREE.BoxGeometry(48, 6, 24);  // dark under-box instead of wheels
    underGeo.translate(0, 3, 0);
    const white = 0xffffff;
    const body = this._instanced(bodyGeo, this._toon(white), n, 'carBodies');
    const cabin = this._instanced(cabinGeo, this._toon(white), n, 'carCabins');
    const windows = this._instanced(windowGeo, this._toon('#2a3038'), n, 'carWindows');
    const under = this._instanced(underGeo, this._toon('#2c2c34'), n, 'carUnder');
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const tx = list[i * 2], ty = list[i * 2 + 1];
      // pair covers tiles tx..tx+1 → center between them; length runs along +X
      m.makeTranslation(tx * TILE + TILE, 0, ty * TILE + HALF);
      body.setMatrixAt(i, m);
      cabin.setMatrixAt(i, m);
      windows.setMatrixAt(i, m);
      under.setMatrixAt(i, m);
      c.set(CAR_COLORS[posHash(tx, ty) % CAR_COLORS.length]);
      body.setColorAt(i, c);
      cabin.setColorAt(i, c);
    }
    for (const mesh of [body, cabin, windows, under]) mesh.instanceMatrix.needsUpdate = true;
    body.instanceColor.needsUpdate = true;
    cabin.instanceColor.needsUpdate = true;
  }

  _buildBenches(list) {
    const n = list.length / 2;
    if (n === 0) return;
    const seatGeo = new THREE.BoxGeometry(28, 4, 10);
    seatGeo.translate(0, 8, 0);
    const legGeo = new THREE.BoxGeometry(24, 6, 8);
    legGeo.translate(0, 3, 0);
    const seat = this._instanced(seatGeo, this._toon('#b88a5a'), n, 'benchSeats');
    const legs = this._instanced(legGeo, this._toon('#6b6b75'), n, 'benchLegs');
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      m.makeTranslation(list[i * 2] * TILE + HALF, 0, list[i * 2 + 1] * TILE + HALF);
      seat.setMatrixAt(i, m);
      legs.setMatrixAt(i, m);
    }
    seat.instanceMatrix.needsUpdate = true;
    legs.instanceMatrix.needsUpdate = true;
  }

  /**
   * Interior furniture: each 2×1-tile FURNITURE pair becomes a hash-picked
   * variant (table / sofa / bookshelf / bed / potted plant). Geometries are
   * baked in world space and merged into one mesh per color bucket.
   */
  _buildFurniture(list) {
    const n = list.length / 2;
    if (n === 0) return;
    const buckets = new Map(); // colorKey → geometry[]
    const add = (color, geo) => {
      let arr = buckets.get(color);
      if (!arr) buckets.set(color, arr = []);
      arr.push(geo);
    };
    for (let i = 0; i < n; i++) {
      const tx = list[i * 2], ty = list[i * 2 + 1];
      const h = posHash(tx, ty);
      const cx = tx * TILE + TILE;   // pair center (covers tx..tx+1)
      const cz = ty * TILE + HALF;
      switch (h % 5) {
        case 0: { // wood table
          add('#a87848', new THREE.BoxGeometry(56, 4, 24).translate(cx, 16, cz));
          add('#8a5e38', new THREE.BoxGeometry(4, 14, 20).translate(cx - 24, 7, cz));
          add('#8a5e38', new THREE.BoxGeometry(4, 14, 20).translate(cx + 24, 7, cz));
          break;
        }
        case 1: { // sofa — seat + back + arms, warm fabric
          const c = SOFA_COLORS[(h >>> 4) % SOFA_COLORS.length];
          add(c, new THREE.BoxGeometry(56, 10, 20).translate(cx, 9, cz + 2));
          add(c, new THREE.BoxGeometry(56, 18, 8).translate(cx, 13, cz - 10));
          add(c, new THREE.BoxGeometry(8, 16, 20).translate(cx - 26, 8, cz + 2));
          add(c, new THREE.BoxGeometry(8, 16, 20).translate(cx + 26, 8, cz + 2));
          break;
        }
        case 2: { // bookshelf — tall body + darker shelf grooves
          add('#9a7048', new THREE.BoxGeometry(50, 58, 14).translate(cx, 29, cz));
          for (const sy of [16, 30, 44]) {
            add('#4e3a26', new THREE.BoxGeometry(46, 2.5, 15).translate(cx, sy, cz));
          }
          break;
        }
        case 3: { // bed — base + lighter mattress + pillow
          add('#7a5a3c', new THREE.BoxGeometry(58, 10, 30).translate(cx, 5, cz));
          add('#ded6c2', new THREE.BoxGeometry(54, 6, 26).translate(cx, 12, cz));
          add('#f6f2e6', new THREE.BoxGeometry(12, 4, 20).translate(cx - 20, 16, cz));
          break;
        }
        default: { // potted plant
          add('#b06a4a', new THREE.CylinderGeometry(8, 6.5, 12, 8).translate(cx, 6, cz));
          add('#4fae4f', new THREE.SphereGeometry(13, 9, 7).translate(cx, 26, cz));
          add('#7fd86a', new THREE.SphereGeometry(8, 8, 6).translate(cx + 6, 33, cz + 3));
          break;
        }
      }
    }
    for (const [color, geos] of buckets) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), this._toon(color));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `furniture_${color}`;
      this.root.add(mesh);
    }
  }

  // ------------------------------------------------------------- per-frame

  /**
   * Fade walls+roof+windows of the building the camera target is inside.
   * @param {number} selfBuildingId  map.buildingAt(px, py) of the target (-1 outdoors)
   * @param {number} dtSec
   */
  update(selfBuildingId, dtSec) {
    if (selfBuildingId !== this._lastSelf) {
      if (this.buildingFx.has(this._lastSelf)) this._fading.add(this._lastSelf);
      if (this.buildingFx.has(selfBuildingId)) this._fading.add(selfBuildingId);
      this._lastSelf = selfBuildingId;
    }
    if (this._fading.size === 0) return;
    const k = Math.min(1, FADE_SPEED * dtSec);
    for (const id of this._fading) {
      const fx = this.buildingFx.get(id);
      const target = id === selfBuildingId ? FADE_TARGET : 1;
      fx.opacity += (target - fx.opacity) * k;
      if (Math.abs(target - fx.opacity) < 0.01) fx.opacity = target;
      const faded = fx.opacity < 0.999;
      for (const mat of fx.mats) {
        mat.opacity = fx.opacity;
        mat.depthWrite = !faded; // nicer transparency while see-through
      }
      fx.roof.visible = fx.opacity >= 0.05;
      if (!faded && target === 1) this._fading.delete(id); // settled → stop animating
    }
  }

  // --------------------------------------------------------------- cleanup

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
          if (mat.map) mat.map.dispose();
          mat.dispose();
        }
      }
      if (o.isInstancedMesh) o.dispose();
    });
    this.gradientMap.dispose();
    this.buildingFx.clear();
    this._fading.clear();
  }
}
