'use strict';

const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

  const url = 'file://' + path.join(__dirname, 'index.html');
  await page.goto(url);
  await page.waitForSelector('#overlay:not(.hidden)');
  await page.screenshot({ path: 'shot-start.png' });

  await page.click('#primary-btn');
  await page.waitForFunction(() => document.body.dataset.state === 'running');

  // 暂停状态机：确认暂停后倒计时被冻结。
  const timerBefore = await page.locator('#timer').textContent();
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => document.body.dataset.state === 'paused');
  await page.waitForTimeout(400);
  const timerPaused = await page.locator('#timer').textContent();
  assertOk(timerBefore === timerPaused, '暂停后倒计时冻结');
  await page.screenshot({ path: 'shot-pause-early.png' });
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => document.body.dataset.state === 'running');

  // 注入与 Node 仿真同源的领航辅助：把鼠标移动到船前方的安全引导点，
  // 间歇性按住空格，验证真实浏览器里的光束牵引与入港结算。
  await page.evaluate(() => {
    const E = window.ENGINE;
    window.__pilot = { active: true };
    window.__pilotTick = function pilotTick(game) {
      if (!window.__pilot.active) return { boost: false };
      const active = game.ships.filter((s) => s.status === 'adrift' || s.status === 'lit');
      if (!active.length) return { boost: false };
      const ship = active[0];
      const hitR = E.SHIP.hitR;
      const blocked = (x, y) => {
        for (const reef of E.REEFS) {
          const rr = reef.r + hitR + 26;
          if ((x - reef.x) ** 2 + (y - reef.y) ** 2 <= rr * rr) return true;
        }
        return false;
      };
      const clear = (ang) => {
        for (let i = 1; i <= 14; i += 1) {
          const d = (620 * i) / 14;
          if (blocked(ship.x + Math.cos(ang) * d, ship.y + Math.sin(ang) * d)) return false;
        }
        return true;
      };
      const portAng = Math.atan2(
        (E.PORT.yMin + E.PORT.yMax) / 2 - ship.y,
        E.PORT.mouthX - 6 - ship.x,
      );
      let chosen = portAng;
      for (const mag of [0, 0.25, 0.5, 0.75, 1, 1.25]) {
        const up = portAng + mag;
        const down = portAng - mag;
        chosen = clear(up) ? up : clear(down) ? down : up;
        if (clear(chosen)) break;
      }
      return {
        x: ship.x + Math.cos(chosen) * 220,
        y: ship.y + Math.sin(chosen) * 220,
        boost: game.beam.energy > 30 && game.beam.heat < 78,
      };
    };
  });

  const canvas = page.locator('#sea');
  const box = await canvas.boundingBox();
  let capturedMid = false;
  for (let i = 0; i < 60 * 45 && await page.evaluate(() => document.body.dataset.state) === 'running'; i += 1) {
    const move = await page.evaluate(() => {
      // 通过主循环暴露的当前游戏实例读取状态（在下面挂载）。
      return window.__game ? window.__pilotTick(window.__game) : null;
    });
    if (move && Number.isFinite(move.x) && Number.isFinite(move.y)) {
      const sx = box.x + (move.x / 1600) * box.width;
      const sy = box.y + (move.y / 900) * box.height;
      await page.mouse.move(sx, sy);
      if (move.boost) await page.keyboard.down('Space');
      else await page.keyboard.up('Space');
    }
    await page.waitForTimeout(16);
    if (!capturedMid && i === 60 * 6) {
      await page.screenshot({ path: 'shot-beam.png' });
      capturedMid = true;
    }
  }
  await page.keyboard.up('Space');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shot-result.png' });

  const finalState = await page.evaluate(() => document.body.dataset.state);
  const endStats = await page.evaluate(() => ({
    rescued: document.getElementById('rescued-count').textContent,
    wrecked: document.getElementById('wrecked-count').textContent,
    title: document.getElementById('overlay-title').textContent,
  }));

  // 暂停分支
  if (finalState === 'running') {
    await page.keyboard.press('KeyP');
    await page.waitForSelector('#overlay:not(.hidden)');
  }
  await page.screenshot({ path: 'shot-paused.png' });

  console.log('终局 =', finalState, JSON.stringify(endStats));
  assertOk(finalState === 'won', '浏览器内真实跑通完整救援胜利');
  assertOk(parseInt(endStats.rescued, 10) >= 4, '页面 HUD 显示至少 4 艘入港');

  // 重试按钮
  await page.click('#primary-btn');
  await page.waitForFunction(() => document.body.dataset.state === 'running');
  const retryHud = await page.evaluate(() => document.getElementById('rescued-count').textContent);
  assertOk(retryHud.startsWith('0'), '点击“再次点亮”后状态正确重置');

  console.log('页面错误 =', errors.length ? errors : '无');
  await browser.close();
  if (errors.length) process.exit(1);
  console.log('浏览器端到端测试通过');
})().catch((err) => {
  console.error('浏览器测试失败：', err.message);
  process.exit(1);
});

function assertOk(cond, msg) {
  if (cond) console.log('  ✓', msg);
  else { console.error('  ✗', msg); process.exit(1); }
}
