// 无浏览器环境下的短局验证：模拟两位玩家“同时”按键，
// 驾驶沉箱穿过狭窄竖井、收集三个样本舱并返回入口。
import { createGame, makeInput, startGame, stepGame, MAP, TUNE } from '../src/engine.js';

const WAYPOINTS = [
  [420, 314], // 样本舱 0（A 舱）
  [800, 230], // 竖井入口缺口
  [800, 868], // 穿过狭窄竖井进入横洞
  [1100, 868], // 进入 B 舱
  [1100, 700],
  [1235, 700],
  [1235, 744], // 样本舱 2（下岩台）
  [1130, 700], // 绕到两块岩台左端之外
  [1130, 470], // 抬升越过下岩台
  [1255, 470],
  [1255, 504], // 样本舱 1（上岩台）
  [1255, 470],
  [1100, 470],
  [1100, 868], // 回横洞
  [800, 868],
  [800, 230], // 原路升出竖井
  [600, 170], // 先离开竖井右/左壁，进入 A 舱开阔水域
  [98, 62], // 回入口停靠（入口框 y[30,96]）
];

function near(g, wp, tol) {
  return Math.abs(g.hull.x - wp[0]) <= tol && Math.abs(g.hull.y - wp[1]) <= tol;
}

function run() {
  const g = createGame();
  startGame(g);
  const input = makeInput();
  const dt = 1 / 60;
  const maxTime = 90;
  let wpIndex = 0;
  let bothSidesFrames = 0;
  let p1Frames = 0;
  let p2Frames = 0;
  let enteredShaft = false;
  let lastPos = { x: g.hull.x, y: g.hull.y };
  let stuckTimer = 0;

  while (g.time < maxTime && g.state === 'playing') {
    const h = g.hull;
    const [tx, ty] = WAYPOINTS[wpIndex];
    const ex = tx - h.x;
    const ey = ty - h.y;
    const TOL = 26;

    // 玩家一：横向。远距用 W/S 主推，近距用 A/D 喷口，冲过头时反向刹车。
    if (Math.abs(ex) > TOL) {
      const toward = ex > 0;
      const vToward = toward ? h.vx : -h.vx;
      const overshoot = vToward * 0.32 > Math.abs(ex);
      if (overshoot) {
        if (toward) input.p1.left = true;
        else input.p1.right = true;
      } else if (Math.abs(ex) > 180) {
        if (toward) input.p1.mainF = true;
        else input.p1.mainR = true;
      } else {
        if (toward) input.p1.right = true;
        else input.p1.left = true;
      }
    } else if (Math.abs(h.vx) > 40) {
      if (h.vx > 0) input.p1.left = true;
      else input.p1.right = true;
    }

    // 玩家二：纵向（方向键），逻辑与横向对称。
    if (Math.abs(ey) > TOL) {
      const toward = ey > 0;
      const vToward = toward ? h.vy : -h.vy;
      const overshoot = vToward * 0.32 > Math.abs(ey);
      if (overshoot) {
        if (toward) input.p2.up = true;
        else input.p2.down = true;
      } else if (toward) input.p2.down = true;
      else input.p2.up = true;
    } else if (Math.abs(h.vy) > 35) {
      if (h.vy > 0) input.p2.up = true;
      else input.p2.down = true;
    }

    const p1Active = Object.values(input.p1).some(Boolean);
    const p2Active = Object.values(input.p2).some(Boolean);
    if (p1Active) p1Frames += 1;
    if (p2Active) p2Frames += 1;
    if (p1Active && p2Active) bothSidesFrames += 1;
    if (h.x > MAP.shaft.x && h.x < MAP.shaft.x + MAP.shaft.w && h.y > 300) enteredShaft = true;

    stepGame(g, input, dt);

    // 复位按键，模拟逐帧轮询
    Object.keys(input.p1).forEach((k) => (input.p1[k] = false));
    Object.keys(input.p2).forEach((k) => (input.p2[k] = false));

    if (near(g, WAYPOINTS[wpIndex], TOL)) wpIndex += 1;
    if (wpIndex >= WAYPOINTS.length) {
      // 停船等待停靠判定
      for (let i = 0; i < 120 && g.state === 'playing'; i++) {
        const hh = g.hull;
        if (Math.abs(hh.vx) > 30) {
          if (hh.vx > 0) input.p1.left = true;
          else input.p1.right = true;
        }
        if (Math.abs(hh.vy) > 30) {
          if (hh.vy > 0) input.p2.up = true;
          else input.p2.down = true;
        }
        stepGame(g, input, dt);
        Object.keys(input.p1).forEach((k) => (input.p1[k] = false));
        Object.keys(input.p2).forEach((k) => (input.p2[k] = false));
      }
      break;
    }

    const moved = Math.hypot(h.x - lastPos.x, h.y - lastPos.y);
    stuckTimer = moved < 0.05 ? stuckTimer + dt : 0;
    lastPos = { x: h.x, y: h.y };
    if (stuckTimer > 4) {
      console.error(`卡在航点 ${wpIndex}，位置 (${h.x.toFixed(0)}, ${h.y.toFixed(0)})`);
      break;
    }
  }

  const h = g.hull;
  const e = MAP.entrance;
  const reachedEntrance =
    h.x - TUNE.hullW / 2 < e.x + e.w &&
    h.x + TUNE.hullW / 2 > e.x &&
    h.y - TUNE.hullH / 2 < e.y + e.h &&
    h.y + TUNE.hullH / 2 > e.y;
  const results = [
    ['抵达入口停靠区', reachedEntrance || g.state === 'won'],
    ['胜利状态', g.state === 'won'],
    ['三个样本舱全部回收', g.collected === 3],
    ['进入并穿过狭窄竖井', enteredShaft],
    ['双人同侧同时输入帧>0', bothSidesFrames > 0],
    ['玩家一有效操作帧>60', p1Frames > 60],
    ['玩家二有效操作帧>60', p2Frames > 60],
    ['船体耐久未归零', h.hp > 0],
    ['氧气未归零', h.oxygen > 0],
    ['电池未归零', h.battery > 0],
    ['90 秒内完成', g.time < 90],
  ];

  console.log('=== 《双舵沉箱》自动短局验证 ===');
  console.log(`用时: ${g.time.toFixed(1)}s  状态: ${g.state}  航点: ${wpIndex}/${WAYPOINTS.length}`);
  console.log(`样本: ${g.collected}/3  碰撞: ${g.stats.hits} 次, 损伤 ${g.stats.damageTaken.toFixed(1)}`);
  console.log(`HP ${h.hp.toFixed(1)}  氧气 ${h.oxygen.toFixed(1)}  电池 ${h.battery.toFixed(1)}`);
  console.log(`同时输入帧: ${bothSidesFrames}  P1帧 ${p1Frames}  P2帧 ${p2Frames}`);
  if (g.loseReason) console.log(`失败原因: ${g.loseReason}`);
  let failed = 0;
  for (const [name, ok] of results) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) failed += 1;
  }
  if (failed) {
    console.error(`\n${failed} 项验证失败`);
    process.exit(1);
  }
  console.log('\n全部验证通过。');
}

run();
