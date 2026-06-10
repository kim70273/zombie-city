// Mobile-guest smoke: desktop host + iPhone-sized touch guest. Screenshots only.
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'fs';

const BASE = process.argv[2] || 'http://localhost:5173/zombie-city/';
mkdirSync('shots', { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const mobile = await browser.newContext({ ...devices['iPhone 13'], userAgent: devices['iPhone 13'].userAgent });

const host = await desktop.newPage();
await host.goto(BASE, { waitUntil: 'networkidle' });
await host.fill('input[type=text]', '데스크탑방장');
await host.click('button:has-text("방 만들기")');
await host.waitForSelector('.room-code', { timeout: 30000 });
const code = (await host.textContent('.room-code')).trim();
console.log('CODE', code);

const guest = await mobile.newPage();
const errs = [];
guest.on('pageerror', (e) => errs.push(e.message));
await guest.goto(BASE, { waitUntil: 'networkidle' });
await guest.screenshot({ path: 'shots/m1-home.png' });
const inputs = guest.locator('input');
await inputs.nth(0).fill('모바일냥');
await inputs.nth(1).fill(code);
await guest.tap('button:has-text("입장하기")');
await guest.waitForSelector('.room-code', { timeout: 30000 });
await guest.screenshot({ path: 'shots/m2-lobby.png' });
await guest.tap('button:has-text("준비")');
await host.click('.duration-row >> button:has-text("5분")');
await host.waitForSelector('.row >> button:has-text("게임 시작"):not([disabled])');
await host.click('.row >> button:has-text("게임 시작")');
await guest.waitForTimeout(5000);
await guest.screenshot({ path: 'shots/m3-game.png' });
console.log('MOBILE ERRORS:', JSON.stringify(errs.slice(0, 5)));
await browser.close();
console.log(errs.length ? 'MOBILE SMOKE: errors found' : 'MOBILE SMOKE OK');
