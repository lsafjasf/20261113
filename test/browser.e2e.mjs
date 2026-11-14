import { chromium } from 'playwright';
import { LOCK_HOLD_SECONDS } from '../src/constants.js';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = 'http://127.0.0.1:8791/index.html';

const server = spawn('python3', ['-m', 'http.server', '8791'], {
  cwd: process.cwd(),
  stdio: 'ignore',
});
await sleep(800);

const browser = await chromium.launch();

async function newPage(debug = false) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(BASE);
  if (debug) await page.check('#debugSwitch');
  await page.click('#startBtn');
  await page.waitForFunction(() => window.__DUAL_MIRROR__?.getState()?.mode === 'play');
  return { page, errors };
}

// 用浏览器内真实键盘通道做伺服：按住对应键直到镜位进入容差并保持
async function servoLock(page, signalId) {
  const result = await page.evaluate(async (id) => {
    const state = window.__DUAL_MIRROR__.getState();
    const input = window.__DUAL_MIRROR__.getInput();
    const sig = state.signals.find((s) => s.id === id);
    if (state.band !== sig.band) {
      const { shiftBand } = await import('/src/engine.js');
      while (state.band !== sig.band) shiftBand(state, 1);
    }
    const need = Math.max(state.gain, sig.requiredGain + 5);
    return { band: state.band, needGain: need, sig: { az: sig.az, el: sig.el, id: sig.id } };
  }, signalId);

  // 增益（左玩家 W）
  if ((await page.evaluate(() => window.__DUAL_MIRROR__.getState().gain)) < result.needGain - 1) {
    await page.keyboard.down('KeyW');
    await page.waitForFunction(
      (n) => window.__DUAL_MIRROR__.getState().gain >= n,
      result.needGain,
    );
    await page.keyboard.up('KeyW');
  }

  // 双轴伺服：同时操作方位（A/D）与仰角（↑/↓），顶住风暴保持 2 秒
  let held = 0;
  let last = Date.now();
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    const m = await page.evaluate((tg) => {
      const s = window.__DUAL_MIRROR__.getState();
      const azDiff = (tg.az - s.az + 540) % 360 - 180;
      const elDiff = tg.el - s.el;
      const sig = s.signals.find((x) => x.id === tg.id);
      const phase = (s.t + sig.blink.phase) % sig.blink.period;
      const blinking = phase < sig.blink.period * sig.blink.duty;
      return {
        azDiff,
        elDiff,
        mode: s.mode,
        locked: sig.locked,
        blinking,
        hold: s.lock.hold,
      };
    }, result.sig);
    if (m.locked || m.mode !== 'play') return m;

    const keys = {
      KeyA: m.azDiff < -1.5,
      KeyD: m.azDiff > 1.5,
      ArrowUp: m.elDiff > 1.2,
      ArrowDown: m.elDiff < -1.2,
    };
    for (const [k, on] of Object.entries(keys)) {
      if (on) await page.keyboard.down(k);
      else await page.keyboard.up(k);
    }
    await page.waitForTimeout(60);
    const now = Date.now();
    // 几何入容差且信号正处于闪烁可见窗口，保持计时才有效
    const inTol =
      Math.abs(m.azDiff) <= 8 && Math.abs(m.elDiff) <= 6 && m.blinking;
    held = inTol ? held + (now - last) / 1000 : 0;
    last = now;
    // 以引擎自身的保持计时为准（它已正确处理闪烁中断）
    if (m.hold >= LOCK_HOLD_SECONDS || m.locked) break;
  }
  for (const k of ['KeyA', 'KeyD', 'ArrowUp', 'ArrowDown']) await page.keyboard.up(k);
  return page.evaluate((id) => {
    const s = window.__DUAL_MIRROR__.getState();
    return { mode: s.mode, locked: s.signals.find((x) => x.id === id).locked, lockCount: s.lockCount };
  }, signalId);
}

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
  if (!cond) failures += 1;
};

// 场景 1：方位与仰角协同校正，锁定一个真异常
{
  const { page, errors } = await newPage();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'screenshots/e2e-1-idle.png' });
  const r = await servoLock(page, 'R2');
  check('协同校正后 R2 锁定', r.locked === true, JSON.stringify(r));
  check('仍处于进行态', r.mode === 'play');
  const coop = await page.evaluate(() => window.__DUAL_MIRROR__.getState().coopCount);
  check('记录到双人协同次数', coop >= 1, `coop=${coop}`);
  check('无控制台错误', errors.length === 0, errors.join(' | '));
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/e2e-1-aligned.png' });
  await page.close();
}

// 场景 2：电池耗尽失败（增益拉满后空转）
{
  const { page } = await newPage();
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__DUAL_MIRROR__.getState().gain >= 100);
  await page.keyboard.up('KeyW');
  await page.waitForSelector('#result:not(.hidden)', { timeout: 60000 });
  const out = await page.evaluate(() => {
    const s = window.__DUAL_MIRROR__.getState();
    return { mode: s.mode, reason: s.failReason, battery: s.battery, title: document.getElementById('resultTitle').textContent };
  });
  check('电池耗尽结局', out.mode === 'lost' && out.reason === 'battery', JSON.stringify(out));
  check('电池显示 0%', Math.round(out.battery) === 0);
  check('结算标题为电池耗尽', out.title === '电池耗尽');
  await page.screenshot({ path: 'screenshots/e2e-2-battery.png' });
  await page.close();
}

// 场景 3：三目标胜利
{
  const { page, errors } = await newPage();
  for (const id of ['R1', 'R2', 'R3']) {
    const r = await servoLock(page, id);
    check(`${id} 完成锁定`, r.locked === true, JSON.stringify(r));
  }
  await page.waitForSelector('#result:not(.hidden)', { timeout: 5000 });
  const out = await page.evaluate(() => {
    const s = window.__DUAL_MIRROR__.getState();
    return {
      mode: s.mode,
      locks: s.lockCount,
      battery: s.battery,
      title: document.getElementById('resultTitle').textContent,
    };
  });
  check('三目标胜利', out.mode === 'won' && out.locks === 3, JSON.stringify(out));
  check('胜利结算标题正确', out.title === '三个异常全部锁定');
  check('胜利时仍有余电', out.battery > 0);
  check('全程无控制台错误', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: 'screenshots/e2e-3-win.png' });
  await page.close();
}

// 场景 4：错锁两次诱饵失败
{
  const { page } = await newPage();
  for (const id of ['D1', 'D2']) {
    await servoLock(page, id);
  }
  await page.waitForSelector('#result:not(.hidden)', { timeout: 30000 });
  const out = await page.evaluate(() => {
    const s = window.__DUAL_MIRROR__.getState();
    return { mode: s.mode, reason: s.failReason, wrong: s.wrongCount };
  });
  check('两次错锁任务无效', out.mode === 'lost' && out.reason === 'wrong' && out.wrong === 2, JSON.stringify(out));
  await page.screenshot({ path: 'screenshots/e2e-4-wrong.png' });
  await page.close();
}

// 场景 5：调试模式开关有明确标注
{
  const { page } = await newPage(true);
  const label = await page.textContent('#modeLabel');
  const badge = await page.$('.debug-badge');
  check('调试模式被清楚标注', label.includes('单人调试') && Boolean(badge), label);
  await page.screenshot({ path: 'screenshots/e2e-5-debug.png' });
  await page.close();
}

await browser.close();
server.kill();
console.log(failures === 0 ? '\nALL E2E PASSED' : `\n${failures} E2E FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
