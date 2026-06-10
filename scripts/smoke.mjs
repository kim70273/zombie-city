// E2E smoke: host+guest in one Chrome, real PeerJS P2P, screenshots to shots/.
// Usage: node scripts/smoke.mjs [baseUrl]
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const BASE = process.argv[2] || 'http://localhost:5173/zombie-city/';
mkdirSync('shots', { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });

const errors = { host: [], guest: [] };
function watch(page, key) {
  page.on('pageerror', (e) => errors[key].push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors[key].push('console: ' + m.text());
  });
}

const host = await ctx.newPage();
watch(host, 'host');
await host.goto(BASE, { waitUntil: 'networkidle' });
await host.screenshot({ path: 'shots/01-home.png' });

// gallery (dev-only page)
const gal = await ctx.newPage();
await gal.goto(BASE + 'gallery.html', { waitUntil: 'networkidle' }).catch(() => {});
await gal.waitForTimeout(800);
await gal.screenshot({ path: 'shots/00-gallery.png', fullPage: false }).catch(() => {});
await gal.close();

// host creates a room
await host.fill('input[type=text]', '방장냥');
await host.click('button:has-text("방 만들기")');
await host.waitForSelector('.room-code', { timeout: 30000 });
const code = (await host.textContent('.room-code')).trim();
console.log('ROOM CODE:', code);

// guest joins
const guest = await ctx.newPage();
watch(guest, 'guest');
await guest.goto(BASE, { waitUntil: 'networkidle' });
const inputs = guest.locator('input');
await inputs.nth(0).fill('게스트츄');
await inputs.nth(1).fill(code);
await guest.click('button:has-text("입장하기")');
await guest.waitForSelector('.room-code', { timeout: 30000 });
console.log('GUEST JOINED LOBBY');
await host.waitForTimeout(500);
await host.screenshot({ path: 'shots/02-lobby-host.png' });

// guest readies; host picks 5분 and starts
await guest.click('button:has-text("준비")');
await host.click('.duration-row >> button:has-text("5분")');
await host.waitForSelector('.row >> button:has-text("게임 시작"):not([disabled])', { timeout: 10000 });
await host.click('.row >> button:has-text("게임 시작")');
console.log('GAME STARTED');

// countdown (3s) + a few seconds of play with movement
await host.waitForTimeout(4500);
const hostPos0 = await host.evaluate(() => ({ x: window.__zc.sim.players[0].x, y: window.__zc.sim.players[0].y }));
const guestSelf0 = await guest.evaluate(() => ({ x: window.__zc.world.predX, y: window.__zc.world.predY }));
const guestSeesHost0 = await guest.evaluate(() => {
  const h = window.__zc.world.players.get(0);
  return { x: h.x, y: h.y };
});
await host.keyboard.down('w');
await guest.keyboard.down('d');
await host.waitForTimeout(2500);
await host.keyboard.up('w');
await host.keyboard.down('a');
await guest.keyboard.up('d');
await guest.keyboard.down('s');
await host.waitForTimeout(2500);
await host.keyboard.up('a');
await guest.keyboard.up('s');

const hostPos1 = await host.evaluate(() => ({ x: window.__zc.sim.players[0].x, y: window.__zc.sim.players[0].y }));
const guestSelf1 = await guest.evaluate(() => ({ x: window.__zc.world.predX, y: window.__zc.world.predY }));
const guestSeesHost1 = await guest.evaluate(() => {
  const h = window.__zc.world.players.get(0);
  return { x: h.x, y: h.y };
});
const guestAuthMoved = await guest.evaluate(() => {
  const w = window.__zc.world;
  return Math.hypot(w.authX - w.shadow.players[w.selfPid].x, w.authY - w.shadow.players[w.selfPid].y);
});
const dHost = Math.hypot(hostPos1.x - hostPos0.x, hostPos1.y - hostPos0.y);
const dGuestSelf = Math.hypot(guestSelf1.x - guestSelf0.x, guestSelf1.y - guestSelf0.y);
const dGuestSeesHost = Math.hypot(guestSeesHost1.x - guestSeesHost0.x, guestSeesHost1.y - guestSeesHost0.y);
console.log('HOST MOVED:', dHost.toFixed(1), 'GUEST PRED MOVED:', dGuestSelf.toFixed(1),
  'GUEST MIRROR OF HOST MOVED:', dGuestSeesHost.toFixed(1), 'GUEST AUTH MOVED (host accepted input):', guestAuthMoved.toFixed(1));
if (dHost < 30) { console.log('FAIL: host did not move'); process.exit(1); }
if (dGuestSelf < 30) { console.log('FAIL: guest prediction did not move'); process.exit(1); }
if (dGuestSeesHost < 30) { console.log('FAIL: snapshots not flowing to guest'); process.exit(1); }
if (guestAuthMoved < 30) { console.log('FAIL: guest input not reaching host'); process.exit(1); }

await host.screenshot({ path: 'shots/03-game-host.png' });
await guest.screenshot({ path: 'shots/04-game-guest.png' });

// verify the guest is actually receiving state: canvas should not be uniform
const guestPixels = await guest.evaluate(() => {
  const c = document.getElementById('game');
  const ctx2 = c.getContext('2d');
  const d = ctx2.getImageData(0, 0, Math.min(400, c.width), Math.min(400, c.height)).data;
  const set = new Set();
  for (let i = 0; i < d.length; i += 4) set.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  return set.size;
});
console.log('GUEST CANVAS DISTINCT COLORS:', guestPixels);

console.log('HOST ERRORS:', JSON.stringify(errors.host.slice(0, 10), null, 1));
console.log('GUEST ERRORS:', JSON.stringify(errors.guest.slice(0, 10), null, 1));
const fatal = [...errors.host, ...errors.guest].filter((e) => e.startsWith('pageerror'));
await browser.close();
if (guestPixels < 20) {
  console.log('FAIL: guest canvas looks blank');
  process.exit(1);
}
if (fatal.length) {
  console.log('FAIL: page errors detected');
  process.exit(1);
}
console.log('SMOKE OK');
