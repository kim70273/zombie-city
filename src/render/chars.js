// ---------------------------------------------------------------------------
// chars.js — procedural chibi anime character sprites (Canvas 2D, no assets)
//
// Atlas layout: 6 cols x 4 rows of 64x80 cells (canvas 384x320).
//   rows  = facing dir: 0 down, 1 right, 2 left (mirror of right), 3 up
//   cols  = 0..3 walk cycle (col 1 doubles as idle), 4 blink, 5 attack
// Logical sprite is 32x40 px drawn at 2x scale onto each cell.
// Everything bakes lazily inside getAtlas() so this module can be imported
// in Node without touching `document`.
// ---------------------------------------------------------------------------

export const LOOKS = [
  { name: '트윈테일',      hair: '#ff9ecb', hairDark: '#e06aa3', outfit: '#ffffff', outfit2: '#3a4a8c', eye: '#4aa6e8' },
  { name: '단발 보브',     hair: '#9fe8d2', hairDark: '#5fc4a8', outfit: '#fff1d6', outfit2: '#ff8a7a', eye: '#e8983a' },
  { name: '긴 생머리',     hair: '#ffe08a', hairDark: '#e0b85a', outfit: '#cdb6f2', outfit2: '#ffffff', eye: '#9a6ae8' },
  { name: '높은 포니테일', hair: '#7ab8ff', hairDark: '#4a86d8', outfit: '#ffffff', outfit2: '#ff5a5a', eye: '#3ec89a' },
  { name: '짧은 머리',     hair: '#4a4a5a', hairDark: '#2e2e3a', outfit: '#555a66', outfit2: '#aaddee', eye: '#6a8ad8' },
  { name: '만두머리',      hair: '#b07a4a', hairDark: '#8a5a32', outfit: '#ff6a6a', outfit2: '#ffd24a', eye: '#d8893a' },
  { name: '사이드포니',    hair: '#c9a6ff', hairDark: '#a07ae0', outfit: '#6a8ad8', outfit2: '#ffd86a', eye: '#e87ab8' },
  { name: '웨이브 긴머리', hair: '#ff7a5a', hairDark: '#d85a3a', outfit: '#2f6a6a', outfit2: '#fff1d6', eye: '#3aa8c8' },
];

const TAU = Math.PI * 2;
const PI = Math.PI;
const INK = '#2e2630'; // soft near-black for eye/face line work

// ---------------------------------------------------------------------------
// color utils
// ---------------------------------------------------------------------------
function hex2rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgb2hex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
// 35%-darkened tone for outlines / shading
function darken(hex, f = 0.35) {
  const [r, g, b] = hex2rgb(hex);
  return rgb2hex(r * (1 - f), g * (1 - f), b * (1 - f));
}
function lighten(hex, f = 0.3) {
  const [r, g, b] = hex2rgb(hex);
  return rgb2hex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f);
}
// desaturate toward luminance grey (for muted citizen NPCs)
function mute(hex, amt = 0.4) {
  const [r, g, b] = hex2rgb(hex);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return rgb2hex(r + (lum - r) * amt, g + (lum - g) * amt, b + (lum - b) * amt);
}
// outfit tint for zombies: multiply x0.8 then overlay rgba(120,160,120,0.15)
function zombify(hex) {
  const [r, g, b] = hex2rgb(hex);
  const f = (v, o) => v * 0.8 * 0.85 + o * 0.15;
  return rgb2hex(f(r, 120), f(g, 160), f(b, 120));
}

// ---------------------------------------------------------------------------
// tiny path helpers (logical px coords; ctx pre-scaled by 2)
// ---------------------------------------------------------------------------
function circleSub(c, x, y, r) {
  c.moveTo(x + r, y);
  c.arc(x, y, r, 0, TAU);
}
function ellipseSub(c, x, y, rx, ry, rot = 0) {
  c.moveTo(x + Math.cos(rot) * rx, y + Math.sin(rot) * rx);
  c.ellipse(x, y, rx, ry, rot, 0, TAU);
}
function rrSub(c, x, y, w, h, r) {
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
// fill + 1px outline (stroke straddles edge -> crisp thin rim at 2x bake)
function shape(ctx, fill, outline, build) {
  ctx.beginPath();
  build(ctx);
  ctx.fillStyle = fill;
  ctx.fill();
  if (outline) {
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
// outline for COMPOUND shapes: stamp the union silhouette in outline color
// around 8 offsets, then fill the union itself (avoids inner stroke seams)
const OFF8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
function silhouette(ctx, fill, outline, build) {
  for (const [ox, oy] of OFF8) {
    ctx.save();
    ctx.translate(ox * 0.55, oy * 0.55);
    ctx.beginPath();
    build(ctx);
    ctx.fillStyle = outline;
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  build(ctx);
  ctx.fillStyle = fill;
  ctx.fill();
}
function stroked(ctx, color, lw, alpha, build) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  build(ctx);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// palette resolution (look + zombie/muted variants)
// ---------------------------------------------------------------------------
function resolvePalette(look, zombie, muted) {
  const idx = ((look % LOOKS.length) + LOOKS.length) % LOOKS.length;
  const L = LOOKS[idx];
  let hair = L.hair, hairDark = L.hairDark, outfit = L.outfit, outfit2 = L.outfit2;
  if (muted) {
    hair = mute(hair); hairDark = mute(hairDark);
    outfit = mute(outfit); outfit2 = mute(outfit2);
  }
  if (zombie) {
    outfit = zombify(outfit); outfit2 = zombify(outfit2);
  }
  return {
    look: idx, zombie, muted,
    hair, hairDark, outfit, outfit2,
    eye: L.eye,
    skin: zombie ? '#a8d8a0' : '#ffe3d0',
    skinShade: zombie ? '#8cc08a' : '#f5c9b0',
    hairOut: darken(hair, 0.35),
    hairShine: lighten(hair, 0.38),
  };
}

// walk-cycle per-frame logical offsets (col 0..3); col 1 doubles as idle
const WALK = [
  { legL: 0, legR: 0, armL: 0, armR: 0, head: 0 },
  { legL: -2, legR: 1, armL: 1, armR: -1, head: -1 },
  { legL: 0, legR: 0, armL: 0, armR: 0, head: 0 },
  { legL: 1, legR: -2, armL: -1, armR: 1, head: -1 },
];

// ---------------------------------------------------------------------------
// body parts
// ---------------------------------------------------------------------------
function drawLegs(ctx, P, F) {
  const out = darken(P.skin, 0.35);
  const shoe = darken(P.outfit2, 0.25);
  const shoeOut = darken(shoe, 0.35);
  for (const [x, dy] of [[11.3, F.legL], [17.7, F.legR]]) {
    const y = 34.5 + dy;
    shape(ctx, P.skin, out, (c) => rrSub(c, x, y, 3, 5, 1.2));
    // sock line
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 0.4, y + 2.5, 2.2, 0.7);
    ctx.restore();
    // shoe
    shape(ctx, shoe, shoeOut, (c) => rrSub(c, x - 0.1, y + 3.2, 3.2, 1.9, 0.9));
  }
}

function drawBody(ctx, P) {
  const out = darken(P.outfit, 0.35);
  const bodyPath = (c) => rrSub(c, 10, 22.5, 12, 12.8, 3.4);
  shape(ctx, P.outfit, out, bodyPath);
  // per-look outfit accents, clipped to the torso
  ctx.save();
  ctx.beginPath();
  bodyPath(ctx);
  ctx.clip();
  const A = P.outfit2;
  const AD = darken(A, 0.3);
  ctx.fillStyle = A;
  switch (P.look) {
    case 0: // sailor: navy collar V + skirt hem + red ribbon
      ctx.fillRect(10, 22.5, 12, 2.2);
      ctx.beginPath();
      ctx.moveTo(12.6, 22.5); ctx.lineTo(19.4, 22.5); ctx.lineTo(16, 27.6);
      ctx.closePath(); ctx.fill();
      ctx.fillRect(10, 33.2, 12, 2.1);
      ctx.fillStyle = '#ff5a5a';
      ctx.fillRect(15.2, 25.6, 1.6, 1.6);
      break;
    case 1: // hoodie: coral hood band, kangaroo pocket, drawstrings
      ctx.fillRect(10, 22.5, 12, 1.7);
      shape(ctx, A, AD, (c) => rrSub(c, 13, 30.6, 6, 3.2, 1.1));
      stroked(ctx, AD, 0.6, 1, (c) => {
        c.moveTo(14.8, 24.4); c.lineTo(14.8, 27.2);
        c.moveTo(17.2, 24.4); c.lineTo(17.2, 27.2);
      });
      break;
    case 2: // lavender dress: white hem + collar + buttons
      ctx.fillRect(10, 32.4, 12, 2.9);
      ctx.fillRect(13.6, 22.5, 4.8, 1.6);
      circleFill(ctx, 16, 26.3, 0.55, '#ffffff');
      circleFill(ctx, 16, 28.8, 0.55, '#ffffff');
      break;
    case 3: // track top: red side stripes + zipper
      ctx.fillRect(10, 22.5, 2.1, 12.8);
      ctx.fillRect(19.9, 22.5, 2.1, 12.8);
      stroked(ctx, darken(P.outfit, 0.22), 0.6, 1, (c) => {
        c.moveTo(16, 23); c.lineTo(16, 34.5);
      });
      break;
    case 4: // blazer: light-blue inner shirt V + lapel lines
      ctx.beginPath();
      ctx.moveTo(13, 22.5); ctx.lineTo(19, 22.5); ctx.lineTo(16, 29.2);
      ctx.closePath(); ctx.fill();
      stroked(ctx, darken(P.outfit, 0.3), 0.6, 1, (c) => {
        c.moveTo(13, 22.8); c.lineTo(16, 29);
        c.moveTo(19, 22.8); c.lineTo(16, 29);
      });
      break;
    case 5: // red top: yellow hem + two buttons
      ctx.fillRect(10, 33, 12, 2.3);
      circleFill(ctx, 16, 26.2, 0.7, A);
      circleFill(ctx, 16, 29.4, 0.7, A);
      break;
    case 6: // overalls: yellow shirt band + blue straps + buttons
      ctx.fillRect(10, 22.5, 12, 3.4);
      ctx.fillStyle = P.outfit;
      ctx.fillRect(12.4, 22.5, 1.8, 4);
      ctx.fillRect(17.8, 22.5, 1.8, 4);
      circleFill(ctx, 13.3, 26, 0.55, A);
      circleFill(ctx, 18.7, 26, 0.55, A);
      break;
    case 7: // teal coat: cream scarf + knot + hem line
      ctx.fillRect(10, 22.5, 12, 2.9);
      shape(ctx, A, darken(A, 0.25), (c) => rrSub(c, 14.7, 25, 2.6, 3.6, 1));
      stroked(ctx, darken(P.outfit, 0.25), 0.6, 1, (c) => {
        c.moveTo(10.5, 33.6); c.lineTo(21.5, 33.6);
      });
      break;
  }
  ctx.restore();
}

function circleFill(ctx, x, y, r, color) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
}

function armShape(ctx, P, x, y, w, h, horizontal = false) {
  const skinOut = darken(P.skin, 0.35);
  const slvOut = darken(P.outfit, 0.35);
  shape(ctx, P.skin, skinOut, (c) => rrSub(c, x, y, w, h, Math.min(w, h) * 0.45));
  if (horizontal) {
    shape(ctx, P.outfit, slvOut, (c) => rrSub(c, x, y, Math.min(4.2, w * 0.55), h, h * 0.45));
  } else {
    shape(ctx, P.outfit, slvOut, (c) => rrSub(c, x, y, w, Math.min(3.4, h * 0.55), w * 0.45));
  }
}

function drawArms(ctx, P, F, dir, attack, aDx, aDy) {
  if (attack) {
    // arms reach toward facing
    if (dir === 0) {
      armShape(ctx, P, 7.6, 26.5, 3, 7.5);
      armShape(ctx, P, 21.4, 26.5, 3, 7.5);
    } else if (dir === 1) {
      armShape(ctx, P, 7.4, 24.3, 3, 5.8);           // far arm tucked
      armShape(ctx, P, 20.8, 25.2, 8.6, 3, true);    // reach forward
    } else { // dir 3 up: both arms raised
      armShape(ctx, P, 7.2, 20.8, 3, 5.6);
      armShape(ctx, P, 21.8, 20.8, 3, 5.6);
    }
    return;
  }
  armShape(ctx, P, 7.2 + aDx, 23.8 + F.armL + aDy, 3, 6.2);
  armShape(ctx, P, 21.8 + aDx, 23.8 + F.armR + aDy, 3, 6.2);
}

function drawHead(ctx, P, hdx, hdy) {
  const cx = 16 + hdx, cy = 12 + hdy;
  shape(ctx, P.skin, darken(P.skin, 0.35), (c) => ellipseSub(c, cx, cy, 11, 10.5, 0));
  // under-chin shade line
  stroked(ctx, P.skinShade, 1, 1, (c) => c.arc(cx, cy, 9.6, PI * 0.38, PI * 0.62));
}

// ---------------------------------------------------------------------------
// face (the money shot)
// ---------------------------------------------------------------------------
function drawEye(ctx, P, ex, ey, rx, blink) {
  if (blink) {
    // cute closed `^` arc
    stroked(ctx, INK, 0.9, 1, (c) => c.arc(ex, ey + 0.9, rx * 0.95, PI * 1.12, PI * 1.88));
    return;
  }
  const ry = rx * 1.4;
  const iris = P.zombie ? '#e03030' : P.eye;
  shape(ctx, INK, null, (c) => ellipseSub(c, ex, ey, rx + 0.45, ry + 0.45, 0)); // dark outline
  shape(ctx, P.zombie ? '#d8c8c8' : '#ffffff', null, (c) => ellipseSub(c, ex, ey, rx, ry, 0)); // sclera
  // iris: vertical gradient, top ~20% darker
  const g = ctx.createLinearGradient(0, ey - ry, 0, ey + ry);
  g.addColorStop(0, darken(iris, 0.22));
  g.addColorStop(0.55, iris);
  g.addColorStop(1, lighten(iris, 0.18));
  ctx.beginPath();
  ctx.ellipse(ex, ey + 0.25, rx - 0.55, ry - 0.55, 0, 0, TAU);
  ctx.fillStyle = g;
  ctx.fill();
  // pupil
  shape(ctx, P.zombie ? '#7a1010' : darken(iris, 0.62), null,
    (c) => ellipseSub(c, ex, ey + 0.8, rx * 0.42, ry * 0.46, 0));
  // sparkle highlights (the anime magic: double dots)
  if (P.zombie) {
    ctx.save(); ctx.globalAlpha = 0.6;
    circleFill(ctx, ex - 0.7, ey - 1.0, 0.5, '#ffffff');
    ctx.restore();
  } else {
    circleFill(ctx, ex - 0.85, ey - 1.25, 0.8, '#ffffff');
    ctx.save(); ctx.globalAlpha = 0.95;
    circleFill(ctx, ex + 0.95, ey + 1.35, 0.48, '#ffffff');
    ctx.restore();
  }
}

function drawBlush(ctx, x, y) {
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.ellipse(x, y, 1.6, 1.05, 0, 0, TAU);
  ctx.fillStyle = '#ff9eae';
  ctx.fill();
  ctx.restore();
}

function drawStitch(ctx, x, y) {
  // cute 2px cheek stitch for zombies
  stroked(ctx, '#5a8a5a', 0.55, 0.95, (c) => {
    c.moveTo(x, y); c.lineTo(x + 1.9, y + 1.2);
    c.moveTo(x + 0.45, y + 1.0); c.lineTo(x + 0.95, y + 0.15);
    c.moveTo(x + 1.05, y + 1.45); c.lineTo(x + 1.55, y + 0.55);
  });
}

function drawFace(ctx, P, dir, hdx, hdy, blink, attack) {
  const cx = 16 + hdx, cy = 12 + hdy;
  if (dir === 0) {
    drawEye(ctx, P, cx - 4.6, cy + 2.6, 2.5, blink);
    drawEye(ctx, P, cx + 4.6, cy + 2.6, 2.5, blink);
    drawBlush(ctx, cx - 7.7, cy + 5.5);
    drawBlush(ctx, cx + 7.7, cy + 5.5);
    if (attack) {
      shape(ctx, '#a14848', darken('#a14848', 0.3), (c) => ellipseSub(c, cx, cy + 6.6, 1.15, 1.45, 0));
    } else {
      stroked(ctx, '#c96f6f', 0.8, 1, (c) => c.arc(cx, cy + 5.8, 1.6, PI * 0.18, PI * 0.82));
    }
    if (P.zombie) drawStitch(ctx, cx + 6.2, cy + 3.0);
  } else {
    // right profile: single eye + small mouth toward facing
    drawEye(ctx, P, cx + 4.4, cy + 2.6, 2.3, blink);
    drawBlush(ctx, cx + 1.4, cy + 5.4);
    if (attack) {
      shape(ctx, '#a14848', darken('#a14848', 0.3), (c) => ellipseSub(c, cx + 6.5, cy + 5.7, 0.95, 1.2, 0));
    } else {
      stroked(ctx, '#c96f6f', 0.8, 1, (c) => c.arc(cx + 6.2, cy + 5.2, 1.05, PI * 0.15, PI * 0.85));
    }
    if (P.zombie) drawStitch(ctx, cx - 0.2, cy + 3.4);
  }
}

// ---------------------------------------------------------------------------
// hair — back layer (style mass behind the head/body)
// dir here is only 0 (down) or 1 (right); left is baked as a mirror.
// ---------------------------------------------------------------------------
function drawHairBack(ctx, P, dir, hdx, hdy) {
  const cx = 16 + hdx, cy = 12 + hdy;
  const H = P.hair, HD = P.hairDark, O = P.hairOut;

  // base cap behind the head (shows as a rim around the skull)
  shape(ctx, H, O, (c) => ellipseSub(c, cx, cy - 0.4, 11.8, 10.7, 0));

  switch (P.look) {
    case 0: { // twin-tail teardrops + tie dots
      const tie = lighten(P.outfit2, 0.3);
      const tails = dir === 0
        ? [[-1, cx - 11.0, cy + 8.2, -0.26], [1, cx + 11.0, cy + 8.2, 0.26]]
        : [[-1, cx - 10.6, cy + 7.6, 0.30]]; // profile: tail swings behind
      for (const [sgn, tx, ty, rot] of tails) {
        silhouette(ctx, H, O, (c) => {
          ellipseSub(c, tx, ty, 3.1, 7.2, rot);
          circleSub(c, tx + sgn * 1.2, ty + 7.4, 1.9); // curled tip
        });
        stroked(ctx, HD, 0.7, 0.55, (c) => {
          c.moveTo(tx - sgn * 0.6, ty - 5.2);
          c.quadraticCurveTo(tx + sgn * 1.6, ty, tx + sgn * 0.6, ty + 5.6);
        });
        shape(ctx, tie, darken(tie, 0.35), (c) => circleSub(c, tx + sgn * 0.4, cy + 1.3, 1.35));
      }
      break;
    }
    case 1: { // bob: side panels + inward curls
      const dx = dir === 1 ? -0.9 : 0;
      silhouette(ctx, H, O, (c) => {
        rrSub(c, cx - 12.3 + dx, cy - 5, 4.6, 12.5, 2.2);
        rrSub(c, cx + 7.7 + dx, cy - 5, 4.6, 12.5, 2.2);
        circleSub(c, cx - 10 + dx, cy + 7.6, 2.4);
        circleSub(c, cx + 10 + dx, cy + 7.6, 2.4);
      });
      stroked(ctx, HD, 0.6, 0.5, (c) => {
        c.arc(cx - 10 + dx, cy + 6.8, 1.6, 0.3, 1.6);
        c.moveTo(cx + 11 + dx, cy + 6.8);
        c.arc(cx + 10 + dx, cy + 6.8, 1.6, 1.5, 2.8);
      });
      break;
    }
    case 2: { // long straight fall behind body
      const dx = dir === 1 ? -1 : 0;
      silhouette(ctx, H, O, (c) => {
        rrSub(c, cx - 11.5 + dx, cy - 2, 23, 20, 6);
        circleSub(c, cx - 10.8 + dx, cy + 15.5, 2.6);
        circleSub(c, cx + 10.8 + dx, cy + 15.5, 2.6);
      });
      stroked(ctx, HD, 0.6, 0.35, (c) => {
        c.moveTo(cx - 7 + dx, cy + 4); c.lineTo(cx - 7.6 + dx, cy + 15);
        c.moveTo(cx + 7 + dx, cy + 4); c.lineTo(cx + 7.6 + dx, cy + 15);
      });
      break;
    }
    case 3: { // high ponytail
      const tie = P.outfit2;
      if (dir === 0) {
        // tuft peeking over the crown
        shape(ctx, H, O, (c) => ellipseSub(c, cx + 4.8, cy - 9.4, 4.0, 2.0, 0.45));
      } else {
        // profile: tail swings to the back, flowing down
        silhouette(ctx, H, O, (c) => {
          ellipseSub(c, cx - 9.6, cy - 1.5, 3.2, 7.6, 0.55);
          circleSub(c, cx - 12.2, cy + 5.2, 2.2);
        });
        stroked(ctx, HD, 0.7, 0.55, (c) => {
          c.moveTo(cx - 7.4, cy - 6.5);
          c.quadraticCurveTo(cx - 11.5, cy - 1.5, cx - 11.6, cy + 4);
        });
        shape(ctx, tie, darken(tie, 0.35), (c) => circleSub(c, cx - 7.2, cy - 8.8, 1.4));
      }
      break;
    }
    case 4: { // short messy spikes around the skull
      const shift = dir === 1 ? 0.18 : 0;
      const angs = [-3.05, -2.55, -2.05, -1.55, -1.05, -0.55, -0.08];
      silhouette(ctx, H, O, (c) => {
        for (const a0 of angs) {
          const a = a0 + shift;
          const tx = cx + Math.cos(a) * 12.8;
          const ty = cy - 0.6 + Math.sin(a) * 11.8;
          c.moveTo(cx + Math.cos(a - 0.26) * 9.8, cy - 0.6 + Math.sin(a - 0.26) * 9.2);
          c.lineTo(tx, ty);
          c.lineTo(cx + Math.cos(a + 0.26) * 9.8, cy - 0.6 + Math.sin(a + 0.26) * 9.2);
          c.closePath();
        }
      });
      break;
    }
    case 5: { // double buns
      const buns = dir === 0
        ? [[cx - 7.7, cy - 8.3, 3.2], [cx + 7.7, cy - 8.3, 3.2]]
        : [[cx - 7.9, cy - 8.0, 3.3], [cx + 5.3, cy - 8.6, 2.8]];
      for (const [bx, by, br] of buns) {
        shape(ctx, H, O, (c) => circleSub(c, bx, by, br));
        stroked(ctx, P.hairShine, 0.7, 0.8, (c) => c.arc(bx, by, br - 1.1, -2.4, -0.9));
        stroked(ctx, HD, 0.7, 0.7, (c) => c.arc(bx, by + br * 0.45, br * 0.62, 0.5, 2.6));
      }
      break;
    }
    case 6: { // side ponytail (right side when facing down)
      const tie = P.outfit2;
      if (dir === 0) {
        silhouette(ctx, H, O, (c) => {
          ellipseSub(c, cx + 11.2, cy + 6.8, 3.0, 7.4, -0.30);
          circleSub(c, cx + 13.0, cy + 13.2, 2.0);
        });
        stroked(ctx, HD, 0.7, 0.55, (c) => {
          c.moveTo(cx + 10.4, cy + 1.2);
          c.quadraticCurveTo(cx + 13.4, cy + 6.5, cx + 12.4, cy + 12);
        });
        shape(ctx, tie, darken(tie, 0.35), (c) => circleSub(c, cx + 11.5, cy - 0.4, 1.3));
      } else {
        silhouette(ctx, H, O, (c) => {
          ellipseSub(c, cx - 10.0, cy + 4.5, 3.0, 7.2, 0.35);
          circleSub(c, cx - 12.6, cy + 10.6, 1.9);
        });
        shape(ctx, tie, darken(tie, 0.35), (c) => circleSub(c, cx - 11.4, cy - 1.6, 1.3));
      }
      break;
    }
    case 7: { // wavy long: bumpy silhouette
      const dx = dir === 1 ? -1 : 0;
      silhouette(ctx, H, O, (c) => {
        rrSub(c, cx - 11.8 + dx, cy - 2, 23.6, 15, 6);
        circleSub(c, cx - 11.2 + dx, cy + 7, 3.2);
        circleSub(c, cx + 11.2 + dx, cy + 7, 3.2);
        circleSub(c, cx - 7.2 + dx, cy + 15, 3.6);
        circleSub(c, cx + 7.2 + dx, cy + 15, 3.6);
        circleSub(c, cx + dx, cy + 16.5, 3.8);
      });
      stroked(ctx, HD, 0.6, 0.4, (c) => {
        c.moveTo(cx - 8 + dx, cy + 3);
        c.quadraticCurveTo(cx - 10.5 + dx, cy + 8, cx - 8.5 + dx, cy + 13.5);
        c.moveTo(cx + 8 + dx, cy + 3);
        c.quadraticCurveTo(cx + 10.5 + dx, cy + 8, cx + 8.5 + dx, cy + 13.5);
      });
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// hair — front layer (scallop bangs + shine + side locks)
// ---------------------------------------------------------------------------
function bangsPath(c, cx, cy, s) {
  const t = cy - 10.7; // hair top
  c.moveTo(cx - 11.5, cy + 0.6);
  c.quadraticCurveTo(cx - 12.3, t + 1.2, cx - 6.2 + s * 0.5, t - 0.4);
  c.quadraticCurveTo(cx + s, t - 0.8, cx + 6.2 + s * 0.5, t - 0.4);
  c.quadraticCurveTo(cx + 12.3, t + 1.2, cx + 11.5, cy + 0.6);
  // scallop hairline, right -> left (anchors are cusps, controls bow down)
  c.quadraticCurveTo(cx + 10.8 + s * 0.6, cy + 2.6, cx + 7.3 + s, cy - 2.5);
  c.quadraticCurveTo(cx + 4.9 + s, cy + 1.3, cx + 2.4 + s, cy - 2.9);
  c.quadraticCurveTo(cx + s * 0.5, cy + 1.5, cx - 2.4 + s, cy - 2.9);
  c.quadraticCurveTo(cx - 4.9 + s, cy + 1.3, cx - 7.3 + s, cy - 2.5);
  c.quadraticCurveTo(cx - 10.8 + s * 0.6, cy + 2.6, cx - 11.5, cy + 0.6);
  c.closePath();
}

function drawHairFront(ctx, P, dir, hdx, hdy) {
  const cx = 16 + hdx, cy = 12 + hdy;
  const H = P.hair, HD = P.hairDark, O = P.hairOut;
  const s = dir === 1 ? 1.6 : 0; // asymmetric sweep toward facing in profile

  // side locks framing the face (style-dependent)
  const lockL = P.look === 2 || P.look === 7 || P.look === 6;
  const lockR = P.look === 2 || P.look === 7;
  const ldx = dir === 1 ? -0.8 : 0;
  if (lockL) shape(ctx, H, O, (c) => rrSub(c, cx - 12.4 + ldx, cy - 3, 3.0, 9, 1.5));
  if (lockR) shape(ctx, H, O, (c) => rrSub(c, cx + 9.4 + ldx, cy - 3, 3.0, 9, 1.5));

  // bangs
  shape(ctx, H, O, (c) => bangsPath(c, cx, cy, s));

  // strand separation hints at two cusps
  stroked(ctx, HD, 0.6, 0.5, (c) => {
    c.moveTo(cx + 2.4 + s, cy - 2.9); c.lineTo(cx + 1.9 + s, cy - 5.6);
    c.moveTo(cx - 2.4 + s, cy - 2.9); c.lineTo(cx - 2.9 + s, cy - 5.6);
  });

  // 1px lighter shine arc
  stroked(ctx, P.hairShine, 0.9, 0.75, (c) => c.arc(cx, cy + 1, 8.8, -2.4, -0.78));
}

// ---------------------------------------------------------------------------
// hair — up-facing (back of the head dominates; no face)
// ---------------------------------------------------------------------------
function drawHairUp(ctx, P, hdx, hdy) {
  const cx = 16 + hdx, cy = 12 + hdy;
  const H = P.hair, HD = P.hairDark, O = P.hairOut;

  // masses that sit BEHIND when seen from the back (drawn before the cap)
  if (P.look === 1) {
    shape(ctx, H, O, (c) => rrSub(c, cx - 11.2, cy - 2, 22.4, 11.8, 5));
  }
  if (P.look === 4) {
    const angs = [-3.05, -2.45, -1.85, -1.25, -0.65, -0.08, 0.45, 2.7];
    silhouette(ctx, H, O, (c) => {
      for (const a of angs) {
        c.moveTo(cx + Math.cos(a - 0.26) * 9.8, cy - 0.4 + Math.sin(a - 0.26) * 9.2);
        c.lineTo(cx + Math.cos(a) * 12.8, cy - 0.4 + Math.sin(a) * 11.8);
        c.lineTo(cx + Math.cos(a + 0.26) * 9.8, cy - 0.4 + Math.sin(a + 0.26) * 9.2);
        c.closePath();
      }
    });
  }

  // full back-of-head cap
  shape(ctx, H, O, (c) => ellipseSub(c, cx, cy - 0.3, 11.6, 11.0, 0));
  // hair whorl
  stroked(ctx, HD, 0.7, 0.55, (c) => c.arc(cx + 1.2, cy - 4.5, 2.1, -0.6, 2.4));

  switch (P.look) {
    case 0: { // twin tails toward camera
      const tie = lighten(P.outfit2, 0.3);
      for (const sgn of [-1, 1]) {
        const tx = cx + sgn * 11.0, ty = cy + 8.2;
        silhouette(ctx, H, O, (c) => {
          ellipseSub(c, tx, ty, 3.1, 7.2, sgn * 0.26);
          circleSub(c, tx + sgn * 1.2, ty + 7.4, 1.9);
        });
        shape(ctx, tie, darken(tie, 0.35), (c) => circleSub(c, cx + sgn * 10.2, cy + 0.6, 1.35));
      }
      break;
    }
    case 1: // bob cut edge
      stroked(ctx, HD, 0.7, 0.8, (c) => {
        c.moveTo(cx - 9.4, cy + 7.0);
        c.quadraticCurveTo(cx, cy + 9.4, cx + 9.4, cy + 7.0);
      });
      break;
    case 2: // long fall covers the back
      silhouette(ctx, H, O, (c) => {
        rrSub(c, cx - 11.3, cy - 1, 22.6, 22, 6);
        circleSub(c, cx - 10.6, cy + 18.5, 2.6);
        circleSub(c, cx + 10.6, cy + 18.5, 2.6);
      });
      stroked(ctx, HD, 0.6, 0.35, (c) => {
        c.moveTo(cx - 6.5, cy + 4); c.lineTo(cx - 7.1, cy + 18);
        c.moveTo(cx + 6.5, cy + 4); c.lineTo(cx + 7.1, cy + 18);
      });
      break;
    case 3: { // high ponytail down the back
      silhouette(ctx, H, O, (c) => {
        ellipseSub(c, cx + 0.5, cy + 3.5, 3.6, 8.6, 0.06);
        circleSub(c, cx + 1.5, cy + 12.5, 2.4);
      });
      stroked(ctx, P.hairShine, 0.7, 0.7, (c) => {
        c.moveTo(cx - 1.4, cy - 3);
        c.quadraticCurveTo(cx - 2.6, cy + 4, cx - 0.8, cy + 10.5);
      });
      shape(ctx, P.outfit2, darken(P.outfit2, 0.35), (c) => circleSub(c, cx, cy - 8.6, 1.7));
      break;
    }
    case 5: { // buns from behind
      for (const sgn of [-1, 1]) {
        const bx = cx + sgn * 7.7, by = cy - 8.3;
        shape(ctx, H, O, (c) => circleSub(c, bx, by, 3.2));
        stroked(ctx, HD, 0.7, 0.7, (c) => c.arc(bx, by + 1.4, 2.0, 0.5, 2.6));
      }
      break;
    }
    case 6: { // side tail appears on the mirrored side from behind
      silhouette(ctx, H, O, (c) => {
        ellipseSub(c, cx - 11.2, cy + 6.8, 3.0, 7.4, 0.30);
        circleSub(c, cx - 13.0, cy + 13.2, 2.0);
      });
      shape(ctx, P.outfit2, darken(P.outfit2, 0.35), (c) => circleSub(c, cx - 10.4, cy + 0.2, 1.3));
      break;
    }
    case 7: // wavy mass over the back
      silhouette(ctx, H, O, (c) => {
        rrSub(c, cx - 11.6, cy - 1, 23.2, 16, 6);
        circleSub(c, cx - 11.0, cy + 9, 3.2);
        circleSub(c, cx + 11.0, cy + 9, 3.2);
        circleSub(c, cx - 7.2, cy + 17, 3.6);
        circleSub(c, cx + 7.2, cy + 17, 3.6);
        circleSub(c, cx, cy + 18.5, 3.8);
      });
      break;
  }

  // top shine
  stroked(ctx, P.hairShine, 0.9, 0.7, (c) => c.arc(cx, cy + 0.5, 9.0, -2.45, -0.7));
}

// ---------------------------------------------------------------------------
// one sprite cell (logical 32x40, ctx pre-scaled x2 and translated to cell)
// ---------------------------------------------------------------------------
function drawSprite(ctx, P, dir, col) {
  const attack = col === 5;
  const blink = col === 4;
  const F = attack ? WALK[0] : WALK[col <= 3 ? col : 1];
  const fx = dir === 1 ? 1 : 0;
  const fy = dir === 0 ? 1 : (dir === 3 ? -1 : 0);
  const hdx = attack ? fx : 0; // attack: head leans 1px toward facing
  const hdy = F.head + (P.zombie ? 1 : 0) + (attack ? fy : 0); // zombie hunch
  const shamble = P.zombie && col <= 3; // zombie walk: arms forward
  const aDx = shamble ? fx * 2 : 0;
  const aDy = shamble ? fy * 2 : 0;

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (dir === 3) {
    drawLegs(ctx, P, F);
    drawBody(ctx, P);
    drawArms(ctx, P, F, dir, attack, aDx, aDy);
    drawHead(ctx, P, hdx, hdy);
    drawHairUp(ctx, P, hdx, hdy);
  } else {
    drawHairBack(ctx, P, dir, hdx, hdy);
    drawLegs(ctx, P, F);
    drawBody(ctx, P);
    drawArms(ctx, P, F, dir, attack, aDx, aDy);
    drawHead(ctx, P, hdx, hdy);
    drawFace(ctx, P, dir, hdx, hdy, blink, attack);
    drawHairFront(ctx, P, dir, hdx, hdy);
  }
}

// ---------------------------------------------------------------------------
// atlas baking + public API
// ---------------------------------------------------------------------------
const CELL_W = 64, CELL_H = 80, COLS = 6, ROWS = 4;
const atlasCache = new Map();

function bakeAtlas(look, zombie, muted) {
  const canvas = document.createElement('canvas');
  canvas.width = CELL_W * COLS;   // 384
  canvas.height = CELL_H * ROWS;  // 320
  const ctx = canvas.getContext('2d');
  const P = resolvePalette(look, zombie, muted);

  // bake rows 0 (down), 1 (right), 3 (up)
  for (const dir of [0, 1, 3]) {
    for (let col = 0; col < COLS; col++) {
      ctx.save();
      ctx.translate(col * CELL_W, dir * CELL_H);
      ctx.scale(2, 2);
      drawSprite(ctx, P, dir, col);
      ctx.restore();
    }
  }
  // row 2 (left) = horizontal mirror of row 1 (right)
  ctx.imageSmoothingEnabled = false;
  for (let col = 0; col < COLS; col++) {
    ctx.save();
    ctx.translate(col * CELL_W + CELL_W, 2 * CELL_H);
    ctx.scale(-1, 1);
    ctx.drawImage(canvas, col * CELL_W, CELL_H, CELL_W, CELL_H, 0, 0, CELL_W, CELL_H);
    ctx.restore();
  }

  return {
    canvas,
    cellW: CELL_W,
    cellH: CELL_H,
    frame(dir, col) {
      return { sx: col * CELL_W, sy: dir * CELL_H, sw: CELL_W, sh: CELL_H };
    },
  };
}

/**
 * Bake (and cache) a character sprite atlas.
 * @param {number} look 0..7
 * @param {boolean} zombie undead-idol variant
 * @param {boolean} muted desaturated citizen variant (combines with zombie)
 */
export function getAtlas(look, zombie = false, muted = false) {
  const key = `${look}|${zombie ? 1 : 0}|${muted ? 1 : 0}`;
  let atlas = atlasCache.get(key);
  if (!atlas) {
    atlas = bakeAtlas(look, zombie, muted);
    atlasCache.set(key, atlas);
  }
  return atlas;
}

/**
 * Draw a character cell with the feet anchored at world (x, y).
 * ctx is assumed to be already translated/scaled by the camera.
 * scale 1 -> 32x40 logical px on screen.
 */
export function drawCharacter(ctx, atlas, dir, col, x, y, scale = 1) {
  const f = atlas.frame(dir, col);
  const w = 32 * scale, h = 40 * scale;
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(atlas.canvas, f.sx, f.sy, f.sw, f.sh, Math.round(x - w / 2), Math.round(y - h), w, h);
  ctx.imageSmoothingEnabled = prev;
}
