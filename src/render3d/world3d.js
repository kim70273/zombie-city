import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TILE } from '../config.js';
import { T } from '../core/mapgen.js';
import { ChunkCache } from '../render/tilemap.js';

// Static procedural 3D city. 2D sim coords (x, y) map to 3D (x, 0, y);
// ground is the XZ plane, +Y up, 1 tile = 32 world units.
// Cel-shaded (MeshToonMaterial, 2-step gradient) anime-urban look.

export const WALL_HEIGHT = 64; // 2 tiles

const CHUNK_TILES = 16;
const CHUNK_WORLD = CHUNK_TILES * TILE; // 512 world units = 512 px canvas
const HALF = TILE / 2;
const ROOF_THICKNESS = 6;
const LINTEL_HEIGHT = 40;       // solid band above each door gap
const AWNING_Y = WALL_HEIGHT * 0.55;
const FADE_TARGET = 0.18;       // opacity of the building the camera target is in
const FADE_SPEED = 6;           // lerp factor per second
const BORDER_MARGIN = 2000;     // dark apron beyond map edges

const WALL_MIX_BASE = '#f2e8d8'; // warm cream — keeps walls lively, not drab
const AWNING_COLOR = '#3a2418';
const BORDER_COLOR = '#101018';
const NEON_COLORS = ['#ff5a8a', '#5ad8ff', '#ffd24a', '#8aff5a'];
const CAR_COLORS = ['#f2a7b3', '#a7c8f2', '#b8e6b8', '#f2d8a7', '#d8b8f2', '#f2f2f2'];

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
    this.buildingFx = new Map(); // id → { mats:[wall,roof], roof, opacity, target }
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
        tex.magFilter = THREE.NearestFilter;
        tex.colorSpace = THREE.SRGBColorSpace;
        // baked colors stay exact — unlit material, flat ground gains nothing from toon
        const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex }));
        mesh.position.set(cx * CHUNK_WORLD + CHUNK_WORLD / 2, 0, cy * CHUNK_WORLD + CHUNK_WORLD / 2);
        mesh.name = `chunk_${cx}_${cy}`;
        this.root.add(mesh);
      }
    }
  }

  // ------------------------------------------------------------- buildings

  _buildBuildings() {
    const { map } = this;
    const wallUnit = new THREE.BoxGeometry(TILE, WALL_HEIGHT, TILE);
    const lintelUnit = new THREE.BoxGeometry(TILE, LINTEL_HEIGHT, TILE);
    const awningNS = new THREE.BoxGeometry(24, 4, 16); // door faces ±Z
    const awningEW = new THREE.BoxGeometry(16, 4, 24); // door faces ±X
    const awningParts = [];
    const neon = []; // { len, x, z, rotY, color }
    const mixBase = new THREE.Color(WALL_MIX_BASE);
    const hsl = { h: 0, s: 0, l: 0 };

    for (const b of map.buildings) {
      const parts = [];
      for (let ty = b.y; ty < b.y + b.h; ty++) {
        for (let tx = b.x; tx < b.x + b.w; tx++) {
          const edge = tx === b.x || ty === b.y || tx === b.x + b.w - 1 || ty === b.y + b.h - 1;
          if (!edge) continue;
          const t = map.tileAt(tx, ty);
          if (t === T.WALL) {
            parts.push(wallUnit.clone().translate(tx * TILE + HALF, WALL_HEIGHT / 2, ty * TILE + HALF));
          } else if (t === T.DOOR) { // open gap + lintel so the wall ring reads connected
            parts.push(lintelUnit.clone()
              .translate(tx * TILE + HALF, WALL_HEIGHT - LINTEL_HEIGHT / 2, ty * TILE + HALF));
          }
        }
      }
      if (parts.length === 0) continue;

      // lively cel-shaded wall tint: roofColor 50% into warm cream, saturation boost
      const wallColor = mixBase.clone().lerp(new THREE.Color(b.roofColor), 0.5);
      wallColor.getHSL(hsl);
      wallColor.setHSL(hsl.h, Math.min(1, hsl.s * 1.25 + 0.04), hsl.l);
      const wallMat = this._toon(wallColor, { transparent: true, opacity: 1 });
      const walls = new THREE.Mesh(mergeGeometries(parts), wallMat);
      walls.name = `walls_${b.id}`;
      this.root.add(walls);

      const roofMat = this._toon(b.roofColor, { transparent: true, opacity: 1 });
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(b.w * TILE, ROOF_THICKNESS, b.h * TILE), roofMat);
      roof.position.set(b.x * TILE + b.w * HALF, WALL_HEIGHT + ROOF_THICKNESS / 2, b.y * TILE + b.h * HALF);
      roof.name = `roof_${b.id}`;
      this.root.add(roof);

      this.buildingFx.set(b.id, { mats: [wallMat, roofMat], roof, opacity: 1, target: 1 });

      // door awnings (jut outward — helps players spot entrances)
      let streetSide = null;
      for (const d of b.doors) {
        let dx = 0, dz = 0;
        if (d.ty === b.y) dz = -1;
        else if (d.ty === b.y + b.h - 1) dz = 1;
        else if (d.tx === b.x) dx = -1;
        else dx = 1;
        if (!streetSide) streetSide = { dx, dz };
        const base = dz !== 0 ? awningNS : awningEW;
        awningParts.push(base.clone().translate(
          d.tx * TILE + HALF + dx * 20, AWNING_Y, d.ty * TILE + HALF + dz * 20));
      }

      // neon accent strip along the top edge of the street-facing (first-door) wall
      const sd = streetSide || { dx: 0, dz: 1 };
      const horizontal = sd.dz !== 0; // strip runs along X
      neon.push({
        len: (horizontal ? b.w : b.h) * TILE - 12,
        x: b.x * TILE + b.w * HALF + sd.dx * (b.w * HALF + 1.5),
        z: b.y * TILE + b.h * HALF + sd.dz * (b.h * HALF + 1.5),
        rotY: horizontal ? 0 : Math.PI / 2,
        color: NEON_COLORS[posHash(b.x, b.y) % NEON_COLORS.length],
      });
    }

    if (awningParts.length > 0) {
      const awnings = new THREE.Mesh(mergeGeometries(awningParts), this._toon(AWNING_COLOR));
      awnings.name = 'awnings';
      this.root.add(awnings);
    }
    this._buildNeonStrips(neon);
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
      p.set(n.x, WALL_HEIGHT - 5, n.z);
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
    const trees = [], benches = [], cars = [], tables = [];
    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        switch (map.tileAt(tx, ty)) {
          case T.TREE: trees.push(tx, ty); break;
          case T.BENCH: benches.push(tx, ty); break;
          case T.CAR: // left tile of the 2-tile pair (same detection as tilemap.js)
            if (map.tileAt(tx - 1, ty) !== T.CAR) cars.push(tx, ty);
            break;
          case T.FURNITURE:
            if (map.tileAt(tx - 1, ty) !== T.FURNITURE) tables.push(tx, ty);
            break;
          default: break;
        }
      }
    }
    this._buildTrees(trees);
    this._buildCars(cars);
    this._buildBenches(benches);
    this._buildTables(tables);
  }

  /** geometry is pre-translated to its local offset; same matrix drives all parts. */
  _instanced(geometry, material, count, name) {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
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

  _buildTables(list) {
    const n = list.length / 2;
    if (n === 0) return;
    const geo = new THREE.BoxGeometry(56, 16, 24);
    geo.translate(0, 8, 0);
    const mesh = this._instanced(geo, this._toon('#a87848'), n, 'tables');
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      m.makeTranslation(list[i * 2] * TILE + TILE, 0, list[i * 2 + 1] * TILE + HALF);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------- per-frame

  /**
   * Fade walls+roof of the building the camera target is inside.
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
