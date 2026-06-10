// ---------------------------------------------------------------------------
// gallery.js — dev-only debug gallery for chars.js / props.js
// 모든 룩 x (인간/좀비) x 방향 x 컬럼 그리드 + 프롭 일람 + 라이브 애니메이션 스트립
// ---------------------------------------------------------------------------
import { LOOKS, getAtlas, drawCharacter } from './render/chars.js';
import {
  makeGunSprite, makeCrateSprite, makeParachuteSprite, makeTreeSprite,
  makeCarSprite, makeBenchSprite, makeFurnitureSprite, makeGhostSprite,
  makeSyringeSprite, makeBulletSprite,
} from './render/props.js';

const app = document.getElementById('app');

const DIR_NAMES = ['하', '우', '좌', '상'];
const COL_NAMES = ['걷기0', '걷기1·대기', '걷기2', '걷기3', '깜빡', '공격'];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ---------------------------------------------------------------------------
// 1) 캐릭터 아틀라스 그리드 (look 0–7 x 인간/좀비 x dir 0–3 x col 0–5, 2배 확대)
// ---------------------------------------------------------------------------
app.appendChild(el('h2', null, '1. 캐릭터 시트 — 8룩 × 인간/좀비 × 4방향 × 6프레임'));

for (let look = 0; look < LOOKS.length; look++) {
  for (const zombie of [false, true]) {
    const title = el('div', 'row-title');
    title.innerHTML = `룩 ${look} <b>${LOOKS[look].name}</b> — ` +
      (zombie ? '<span class="zombie">좀비</span>' : '인간');
    app.appendChild(title);

    const atlas = getAtlas(look, zombie, false);
    const grid = el('div', 'grid');
    for (let dir = 0; dir < 4; dir++) {
      for (let col = 0; col < 6; col++) {
        const cell = el('div', 'cell');
        const cv = document.createElement('canvas');
        cv.width = atlas.cellW * 2;   // 2배 확대 (128x160)
        cv.height = atlas.cellH * 2;
        const ctx = cv.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        const f = atlas.frame(dir, col);
        ctx.drawImage(atlas.canvas, f.sx, f.sy, f.sw, f.sh, 0, 0, cv.width, cv.height);
        cell.appendChild(cv);
        cell.appendChild(el('div', 'label', `${DIR_NAMES[dir]} · ${COL_NAMES[col]}`));
        grid.appendChild(cell);
      }
    }
    app.appendChild(grid);
  }
}

// ---------------------------------------------------------------------------
// 2) 프롭 일람 (2배 확대)
// ---------------------------------------------------------------------------
app.appendChild(el('h2', null, '2. 프롭'));

const props = [
  ['권총', makeGunSprite()],
  ['보급 상자', makeCrateSprite()],
  ['낙하산', makeParachuteSprite()],
  ['나무', makeTreeSprite()],
  ...[0, 1, 2, 3, 4, 5].map((i) => [`자동차 ${i}`, makeCarSprite(i)]),
  ['벤치', makeBenchSprite()],
  ['테이블', makeFurnitureSprite()],
  ['유령', makeGhostSprite()],
  ['주사기', makeSyringeSprite()],
  ['총알', makeBulletSprite()],
];

const propGrid = el('div', 'grid props');
for (const [name, sprite] of props) {
  const cell = el('div', 'cell');
  const cv = document.createElement('canvas');
  cv.width = sprite.width * 2;
  cv.height = sprite.height * 2;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sprite, 0, 0, cv.width, cv.height);
  cell.appendChild(cv);
  cell.appendChild(el('div', 'label', name));
  propGrid.appendChild(cell);
}
app.appendChild(propGrid);

// ---------------------------------------------------------------------------
// 3) 라이브 애니메이션 — 8룩 정면 걷기 + 깜빡임 (8fps), 아래 줄은 좀비 비틀걸음
// ---------------------------------------------------------------------------
app.appendChild(el('h2', null, '3. 라이브 애니메이션 — 걷기 + 깜빡임 (8fps)'));

const animWrap = el('div');
animWrap.id = 'anim-wrap';
const SPACING = 76;
const animCv = document.createElement('canvas');
animCv.width = LOOKS.length * SPACING + 16;
animCv.height = 240;
const actx = animCv.getContext('2d');
actx.imageSmoothingEnabled = false;
animWrap.appendChild(animCv);
app.appendChild(animWrap);

const humanAtlases = LOOKS.map((_, i) => getAtlas(i, false, false));
const zombieAtlases = LOOKS.map((_, i) => getAtlas(i, true, false));

function tick(t) {
  actx.fillStyle = '#1b1b28';
  actx.fillRect(0, 0, animCv.width, animCv.height);
  // 바닥 라인
  actx.fillStyle = '#262638';
  actx.fillRect(0, 102, animCv.width, 3);
  actx.fillRect(0, 218, animCv.width, 3);

  const walkCol = Math.floor(t / 125) % 4;          // 8fps 걷기
  for (let i = 0; i < LOOKS.length; i++) {
    const x = 46 + i * SPACING;
    // 인간: 룩마다 깜빡임 타이밍을 어긋나게
    const blinkH = ((t + i * 420) % 2800) < 150;
    drawCharacter(actx, humanAtlases[i], 0, blinkH ? 4 : walkCol, x, 102, 2);
    // 좀비: 반 박자 느린 비틀걸음
    const zCol = Math.floor(t / 165 + i) % 4;
    const blinkZ = ((t + i * 530) % 3600) < 150;
    drawCharacter(actx, zombieAtlases[i], 0, blinkZ ? 4 : zCol, x, 218, 2);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
