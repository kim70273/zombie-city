// ---------------------------------------------------------------------------
// props.js — procedural prop sprites (Canvas 2D, no assets)
//
// Every make* returns a baked canvas drawn at 2x scale (same convention as
// chars.js: 1 logical px == 2 canvas px). Baking is lazy + cached so the
// module can be imported in Node without touching `document`.
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const PI = Math.PI;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function hex2rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgb2hex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
function darken(hex, f = 0.35) {
  const [r, g, b] = hex2rgb(hex);
  return rgb2hex(r * (1 - f), g * (1 - f), b * (1 - f));
}
function lighten(hex, f = 0.3) {
  const [r, g, b] = hex2rgb(hex);
  return rgb2hex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f);
}
function rr(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function fillRR(ctx, x, y, w, h, r, fill, outline) {
  rr(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (outline) {
    ctx.strokeStyle = outline;
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }
}
function fillCircle(ctx, x, y, r, fill, outline) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
  if (outline) {
    ctx.strokeStyle = outline;
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }
}
function line(ctx, x1, y1, x2, y2, color, lw = 0.6, alpha = 1) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

// lazy bake + cache; w/h in logical px (canvas is 2x)
const cache = new Map();
function baked(key, w, h, draw) {
  let c = cache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = w * 2;
    c.height = h * 2;
    const ctx = c.getContext('2d');
    ctx.scale(2, 2);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    draw(ctx);
    cache.set(key, c);
  }
  return c;
}

// ---------------------------------------------------------------------------
// props
// ---------------------------------------------------------------------------

/** 10x6 cute pistol */
export function makeGunSprite() {
  return baked('gun', 10, 6, (ctx) => {
    fillRR(ctx, 0.6, 1.9, 8.2, 2.0, 0.7, '#3a3a44', '#22222a'); // body
    fillRR(ctx, 0.6, 0.7, 8.6, 1.7, 0.6, '#5a5a66', '#3a3a44'); // slide
    fillRR(ctx, 2.2, 3.4, 2.1, 2.3, 0.6, '#3a3a44', '#22222a'); // grip
    line(ctx, 1.4, 1.3, 7.8, 1.3, '#7a7a88', 0.5, 0.9);          // slide shine
    fillCircle(ctx, 9.0, 1.5, 0.45, '#8a8a98');                  // muzzle
    // trigger guard
    ctx.strokeStyle = '#22222a';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.arc(5.4, 3.9, 0.9, 0.2, PI - 0.2);
    ctx.stroke();
  });
}

/** 16x14 supply crate with red-cross panel */
export function makeCrateSprite() {
  return baked('crate', 16, 14, (ctx) => {
    fillRR(ctx, 0.6, 1.0, 14.8, 12.4, 1.4, '#b08a5a', darken('#b08a5a'));
    // plank lines
    line(ctx, 1.2, 5.2, 15.0, 5.2, '#8a653c', 0.5, 0.7);
    line(ctx, 1.2, 9.4, 15.0, 9.4, '#8a653c', 0.5, 0.7);
    // straps
    fillRR(ctx, 2.0, 1.0, 2.0, 12.4, 0.5, '#7a5836', '#5c4128');
    fillRR(ctx, 12.0, 1.0, 2.0, 12.4, 0.5, '#7a5836', '#5c4128');
    // red-cross panel
    fillRR(ctx, 5.6, 4.4, 4.8, 4.8, 0.8, '#f4efe6', '#c9bca6');
    ctx.fillStyle = '#e04040';
    ctx.fillRect(7.4, 5.2, 1.2, 3.2);
    ctx.fillRect(6.4, 6.2, 3.2, 1.2);
    // top highlight
    line(ctx, 1.6, 1.7, 14.4, 1.7, lighten('#b08a5a', 0.35), 0.6, 0.8);
  });
}

/** 20x12 striped parachute canopy */
export function makeParachuteSprite() {
  return baked('chute', 20, 12, (ctx) => {
    const canopy = () => {
      ctx.beginPath();
      ctx.moveTo(0.8, 9.6);
      ctx.quadraticCurveTo(0.4, 2.2, 10, 0.8);
      ctx.quadraticCurveTo(19.6, 2.2, 19.2, 9.6);
      // scalloped bottom edge
      ctx.quadraticCurveTo(16.9, 8.0, 14.6, 9.6);
      ctx.quadraticCurveTo(12.3, 8.0, 10.0, 9.6);
      ctx.quadraticCurveTo(7.7, 8.0, 5.4, 9.6);
      ctx.quadraticCurveTo(3.1, 8.0, 0.8, 9.6);
      ctx.closePath();
    };
    canopy();
    ctx.fillStyle = '#f4f0e8';
    ctx.fill();
    // soft red stripes
    ctx.save();
    canopy();
    ctx.clip();
    ctx.fillStyle = '#ff7a7a';
    for (let i = 0; i < 5; i += 2) {
      const x = 0.8 + i * 3.68;
      ctx.fillRect(x, 0, 3.68, 12);
    }
    // top sheen
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(10, 2.6, 7, 1.8, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    canopy();
    ctx.strokeStyle = '#c05050';
    ctx.lineWidth = 0.7;
    ctx.stroke();
  });
}

/** ~24x30 tree: trunk + two stacked foliage circles */
export function makeTreeSprite() {
  return baked('tree', 24, 30, (ctx) => {
    fillRR(ctx, 10, 18.5, 4, 10.8, 1.2, '#8a6248', darken('#8a6248'));
    line(ctx, 11, 20, 11, 27.5, '#6a4a34', 0.5, 0.7);
    fillCircle(ctx, 12, 13.5, 8.8, '#5a9a4a', darken('#5a9a4a', 0.3));
    fillCircle(ctx, 12, 7.8, 6.6, '#7ac85a', darken('#7ac85a', 0.3));
    // leaf shine + dots
    ctx.save();
    ctx.strokeStyle = lighten('#7ac85a', 0.4);
    ctx.lineWidth = 0.8;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(12, 8.4, 4.6, -2.5, -1.0);
    ctx.stroke();
    ctx.restore();
    fillCircle(ctx, 7.6, 14.8, 0.7, '#4a8040');
    fillCircle(ctx, 15.8, 16.2, 0.7, '#4a8040');
    fillCircle(ctx, 11.0, 12.0, 0.7, '#8ad86a');
  });
}

const CAR_COLORS = ['#ff9eae', '#ffd29e', '#fff0a0', '#a8e0b0', '#a0c8f0', '#d8b8f0'];

/** 64x32 (2x1 tiles) cute rounded car; colorIndex 0..5 */
export function makeCarSprite(colorIndex = 0) {
  const i = ((colorIndex % CAR_COLORS.length) + CAR_COLORS.length) % CAR_COLORS.length;
  return baked(`car${i}`, 64, 32, (ctx) => {
    const body = CAR_COLORS[i];
    const out = darken(body, 0.4);
    // cabin
    fillRR(ctx, 15, 3, 30, 16, 5.5, body, out);
    // window band
    fillRR(ctx, 17.5, 5, 25, 8.5, 3, '#4a5a78', '#36435c');
    ctx.save();
    rr(ctx, 17.5, 5, 25, 8.5, 3);
    ctx.clip();
    ctx.fillStyle = '#8ab0d0';
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(19, 13.5); ctx.lineTo(24, 5); ctx.lineTo(28.5, 5); ctx.lineTo(21.5, 13.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // window pillar
    ctx.fillStyle = body;
    ctx.fillRect(29, 4.5, 2.4, 9.5);
    // body
    fillRR(ctx, 2, 11, 60, 15, 6, body, out);
    line(ctx, 5, 14, 59, 14, lighten(body, 0.4), 0.8, 0.85); // top shine
    line(ctx, 4, 22.5, 60, 22.5, darken(body, 0.18), 0.8, 0.8); // lower shade
    // door seam + handle
    line(ctx, 30.5, 12, 30.5, 24, out, 0.5, 0.6);
    fillRR(ctx, 33, 15.5, 3.5, 1.4, 0.6, darken(body, 0.25));
    // wheels
    for (const wx of [14, 50]) {
      fillCircle(ctx, wx, 26, 5, '#2e2e38', '#1c1c24');
      fillCircle(ctx, wx, 26, 2.1, '#9a9aa8');
      fillCircle(ctx, wx - 0.7, 25.3, 0.7, '#c8c8d4');
    }
    // lights
    fillCircle(ctx, 60.2, 15.5, 1.6, '#fff2b0', '#d8c070');
    fillRR(ctx, 2.6, 14.4, 1.8, 2.4, 0.7, '#ff6a6a', '#c04848');
  });
}

/** 32x16 two-tone wood bench */
export function makeBenchSprite() {
  return baked('bench', 32, 16, (ctx) => {
    // legs first
    fillRR(ctx, 3.5, 9.5, 3, 6, 0.8, '#6a4e34', darken('#6a4e34'));
    fillRR(ctx, 25.5, 9.5, 3, 6, 0.8, '#6a4e34', darken('#6a4e34'));
    // backrest bar + seat slats (two-tone)
    fillRR(ctx, 1.5, 1.0, 29, 2.6, 1.1, '#9a7448', darken('#9a7448'));
    fillRR(ctx, 1.5, 4.4, 29, 3.2, 1.2, '#b08a5a', darken('#b08a5a'));
    fillRR(ctx, 1.5, 8.2, 29, 3.2, 1.2, '#9a7448', darken('#9a7448'));
    // wood grain + highlight
    line(ctx, 4, 5.4, 28, 5.4, lighten('#b08a5a', 0.3), 0.5, 0.7);
    line(ctx, 7, 9.6, 25, 9.6, darken('#9a7448', 0.2), 0.5, 0.6);
    // bolts
    fillCircle(ctx, 5, 6, 0.5, '#6a4e34');
    fillCircle(ctx, 27, 6, 0.5, '#6a4e34');
  });
}

/** 64x32 (2x1 tiles) wooden table */
export function makeFurnitureSprite() {
  return baked('table', 64, 32, (ctx) => {
    // legs peeking below the top
    fillRR(ctx, 6, 20, 5, 10.5, 1.2, '#8a6a4a', darken('#8a6a4a'));
    fillRR(ctx, 53, 20, 5, 10.5, 1.2, '#8a6a4a', darken('#8a6a4a'));
    // table top
    fillRR(ctx, 2, 4, 60, 18, 4.5, '#c89a6a', darken('#c89a6a'));
    // side edge shade
    fillRR(ctx, 2, 17.5, 60, 4.5, 2.2, '#a87e50');
    rr(ctx, 2, 4, 60, 18, 4.5);
    ctx.strokeStyle = darken('#c89a6a');
    ctx.lineWidth = 0.7;
    ctx.stroke();
    // grain lines + sheen
    line(ctx, 7, 9, 57, 9, '#a87e50', 0.5, 0.6);
    line(ctx, 10, 13, 54, 13, '#a87e50', 0.5, 0.45);
    line(ctx, 6, 6.4, 58, 6.4, lighten('#c89a6a', 0.35), 0.7, 0.8);
    // a tiny mug on top for charm
    fillRR(ctx, 44, 8.5, 4.2, 4.6, 1.1, '#e86a6a', darken('#e86a6a'));
    ctx.strokeStyle = darken('#e86a6a');
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.arc(49.2, 10.8, 1.4, -PI / 2, PI / 2);
    ctx.stroke();
  });
}

/** 10x12 cute white ghost blob (death effect) */
export function makeGhostSprite() {
  return baked('ghost', 10, 12, (ctx) => {
    const body = () => {
      ctx.beginPath();
      ctx.moveTo(0.9, 10.8);
      ctx.lineTo(0.9, 5.2);
      ctx.arc(5, 5.2, 4.1, PI, 0);
      ctx.lineTo(9.1, 10.8);
      // wavy bottom: 3 scallops
      ctx.quadraticCurveTo(8.4, 9.2, 7.05, 10.8);
      ctx.quadraticCurveTo(6.35, 9.2, 5.0, 10.8);
      ctx.quadraticCurveTo(4.3, 9.2, 2.95, 10.8);
      ctx.quadraticCurveTo(2.25, 9.2, 0.9, 10.8);
      ctx.closePath();
    };
    body();
    ctx.fillStyle = '#f8f8ff';
    ctx.fill();
    body();
    ctx.strokeStyle = '#b8b8cc';
    ctx.lineWidth = 0.6;
    ctx.stroke();
    // side shade
    line(ctx, 8.2, 5.2, 8.2, 9.4, '#d8d8e8', 0.6, 0.8);
    // face: two dot eyes + tiny o mouth + blush
    fillCircle(ctx, 3.6, 5.4, 0.7, '#2e2630');
    fillCircle(ctx, 6.4, 5.4, 0.7, '#2e2630');
    fillCircle(ctx, 3.85, 5.15, 0.22, '#ffffff');
    fillCircle(ctx, 6.65, 5.15, 0.22, '#ffffff');
    ctx.save();
    ctx.globalAlpha = 0.45;
    fillCircle(ctx, 2.4, 6.6, 0.6, '#ff9eae');
    fillCircle(ctx, 7.6, 6.6, 0.6, '#ff9eae');
    ctx.restore();
    ctx.strokeStyle = '#2e2630';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.arc(5, 7.0, 0.55, 0, TAU);
    ctx.stroke();
  });
}

/** 10x4 vaccine syringe with mint liquid */
export function makeSyringeSprite() {
  return baked('syringe', 10, 4, (ctx) => {
    line(ctx, 0.3, 2, 2.2, 2, '#9aa0a8', 0.5);                    // needle
    fillRR(ctx, 2.2, 0.7, 5.4, 2.6, 0.8, '#eef4f4', '#a8b4b8');   // barrel
    fillRR(ctx, 2.7, 1.15, 3.3, 1.7, 0.5, '#7ee0b8', '#54c094');  // mint liquid
    ctx.fillStyle = '#8a92a0';                                     // flange
    ctx.fillRect(7.3, 0.5, 0.8, 3.0);
    fillRR(ctx, 8.1, 1.3, 1.6, 1.4, 0.4, '#8a92a0', '#6a7280');   // plunger
    line(ctx, 3.0, 1.1, 6.4, 1.1, '#ffffff', 0.4, 0.8);            // glass shine
  });
}

/** 4x4 yellow-white glow dot */
export function makeBulletSprite() {
  return baked('bullet', 4, 4, (ctx) => {
    const g = ctx.createRadialGradient(2, 2, 0.2, 2, 2, 2);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.45, '#ffe89e');
    g.addColorStop(1, 'rgba(255, 216, 110, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 4);
  });
}
