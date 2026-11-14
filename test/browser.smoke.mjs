import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const pageUrl = 'http://127.0.0.1:8791/index.html';
const server = spawn('python3', ['-m', 'http.server', '8791'], {
  cwd: process.cwd(),
  stdio: 'ignore',
});
await sleep(800);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(pageUrl);
await page.waitForSelector('#startBtn');
await page.click('#startBtn');
await page.waitForSelector('#radar');
await page.waitForTimeout(800);

const state = await page.evaluate(() => window.__DUAL_MIRROR__.getState());
console.log('mode=', state.mode, 'az=', state.az.toFixed(1), 'battery=', state.battery.toFixed(1));

// 同时按下两侧按键：左玩家 D，右玩家 ArrowUp
await page.keyboard.down('KeyD');
await page.keyboard.down('ArrowUp');
await page.waitForTimeout(500);
const moving = await page.evaluate(() => {
  const s = window.__DUAL_MIRROR__.getState();
  return { az: s.az, el: s.el, azRight: s.input.azRight, elUp: s.input.elUp };
});
await page.keyboard.up('KeyD');
await page.keyboard.up('ArrowUp');

// 频段切换
await page.keyboard.press('Comma');
const band = await page.evaluate(() => window.__DUAL_MIRROR__.getState().band);

console.log('simul=', JSON.stringify(moving), 'band=', band);
if (errors.length) {
  console.error('CONSOLE ERRORS:', errors);
  process.exit(1);
}
if (!moving.azRight || !moving.elUp) {
  console.error('双人同时按键未被同时识别');
  process.exit(1);
}
if (band !== 2) {
  console.error('逗号应从 L 循环到 X，实际 band=', band);
  process.exit(1);
}
await page.screenshot({ path: 'screenshots/smoke.png' });
console.log('SMOKE OK');
await browser.close();
server.kill();
