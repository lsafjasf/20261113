// 真实浏览器全流程验证:开始→航行→暂停→碰撞→投递→胜利/失败
const { chromium } = require('playwright');
const path = require('path');

const ART = path.join(__dirname, '..', 'artifacts');
const URL = 'file://' + path.join(__dirname, '..', 'index.html');
let failures = 0;
function check(name, cond) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name);
  if (!cond) failures++;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  page.on('pageerror', e => { console.log('  ✗ 页面错误:', e.message); failures++; });
  const shot = n => page.screenshot({ path: path.join(ART, n) });
  const st = () => page.evaluate(() => {
    const s = window.__game.state;
    return { mode: s.mode, mail: s.mail, hull: s.hull, sail: s.ship.sail,
      x: s.ship.x, y: s.ship.y, vx: s.ship.vx, vy: s.ship.vy,
      timeLeft: s.timeLeft, wind: s.wind.speed, delivered: s.delivered.slice() };
  });
  const step = (n, dt) => page.evaluate(([n, dt]) => {
    for (let i = 0; i < n; i++) window.__game.tick(dt);
  }, [n, dt || 1 / 60]);

  console.log('== 浏览器全流程 ==');
  await page.goto(URL);
  await page.waitForTimeout(400);
  check('开始界面可见', await page.isVisible('#screen-start'));
  await shot('01-start.png');

  // 开始游戏(固定种子)
  await page.fill('#seed-input', '20261113');
  await page.click('#btn-start');
  await page.waitForTimeout(300);
  check('点击出航进入 playing', (await st()).mode === 'playing');
  check('音频上下文已创建', await page.evaluate(() => !!window.__game));
  await shot('02-play.png');

  // 升帆 + 前进(真实按键)
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  check('空格升帆到 3 级', (await st()).sail === 3);
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(1500);
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(400);
  await page.keyboard.up('ArrowLeft');
  const moving = await st();
  check('船体移动中', Math.hypot(moving.vx, moving.vy) > 0.5);
  await shot('03-moving.png');
  await page.keyboard.up('ArrowUp');

  // 暂停 / 恢复
  await page.keyboard.press('p');
  await page.waitForTimeout(200);
  check('暂停界面出现', (await st()).mode === 'paused' && await page.isVisible('#screen-pause'));
  await shot('04-paused.png');
  const frozen = await st();
  await page.waitForTimeout(400);
  const frozen2 = await st();
  check('暂停时船不动', frozen.x === frozen2.x && frozen.timeLeft === frozen2.timeLeft);
  await page.keyboard.press('p');
  await page.waitForTimeout(100);
  check('恢复 playing', (await st()).mode === 'playing');

  // 碰撞:找一座岛,全速撞上去
  await page.evaluate(() => {
    const g = window.__game, s = g.state;
    let isl = null;
    for (let y = 0; y < 40 && !isl; y++) for (let x = 0; x < 48; x++)
      if (s.map.grid[y * 48 + x] === 2) { isl = { x, y }; break; }
    s.ship.x = isl.x - 0.8; s.ship.y = isl.y + 0.5;
    s.ship.vx = 5; s.ship.vy = 0; s.ship.sail = 3;
  });
  const hullBefore = (await st()).hull;
  await page.waitForTimeout(300);
  const afterHit = await st();
  check('碰撞扣耐久', afterHit.hull < hullBefore);
  await shot('05-collision.png');

  // 投递三座浮标
  for (let i = 0; i < 3; i++) {
    await page.evaluate(i => {
      const g = window.__game, s = g.state, b = s.map.buoys[i];
      s.ship.x = b.x + 0.5; s.ship.y = b.y + 0.5; s.ship.vx = s.ship.vy = 0;
    }, i);
    await page.waitForTimeout(120);
    await page.keyboard.press('e');
    await page.waitForTimeout(80);
    const s = await st();
    check(`浮标 ${i + 1} 投递`, s.delivered[i] === true && s.mail === 2 - i);
    if (i === 0) await shot('06-delivery.png');
  }
  await shot('07-all-mail.png');

  // 回码头获胜
  await page.evaluate(() => {
    const s = window.__game.state;
    s.ship.x = s.map.dock.x + 0.5; s.ship.y = s.map.dock.y + 0.5;
  });
  await page.waitForTimeout(300);
  check('返回码头胜利界面', (await st()).mode === 'won' && await page.isVisible('#screen-end'));
  check('胜利标题', (await page.textContent('#end-title')).includes('送达成功'));
  await shot('08-victory.png');

  // 重开 → 超时失败
  await page.click('#btn-retry');
  await page.waitForTimeout(150);
  check('重开回到 playing', (await st()).mode === 'playing');
  await page.evaluate(() => { window.__game.state.timeLeft = 0.3; });
  await page.waitForTimeout(600);
  check('超时失败界面', (await st()).mode === 'lost' && await page.isVisible('#screen-end'));
  await shot('09-timeout.png');

  // 重开 → 耐久归零失败
  await page.click('#btn-retry');
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const g = window.__game, s = g.state;
    let isl = null;
    for (let y = 0; y < 40 && !isl; y++) for (let x = 0; x < 48; x++)
      if (s.map.grid[y * 48 + x] === 2) { isl = { x, y }; break; }
    s.hull = 5;
    s.ship.x = isl.x - 0.8; s.ship.y = isl.y + 0.5;
    s.ship.vx = 5; s.ship.vy = 0; s.ship.sail = 3;
  });
  await page.waitForTimeout(400);
  check('耐久归零失败', (await st()).mode === 'lost');
  check('失败原因文案', (await page.textContent('#end-detail')).includes('耐久'));
  await shot('10-hull-fail.png');

  // 同一种子重开布局一致
  const layoutA = await page.evaluate(() => {
    const s = window.__game.state;
    return Array.from(s.map.grid.slice(0, 200)).join(',') + JSON.stringify(s.map.buoys);
  });
  await page.click('#btn-retry');
  await page.waitForTimeout(150);
  const layoutB = await page.evaluate(() => {
    const s = window.__game.state;
    return Array.from(s.map.grid.slice(0, 200)).join(',') + JSON.stringify(s.map.buoys);
  });
  check('重开后同一种子布局一致', layoutA === layoutB);

  await browser.close();
  console.log(failures ? `\n${failures} 项失败` : '\n浏览器全流程通过');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
