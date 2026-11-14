'use strict';

// 无头验证：不依赖浏览器，直接对 engine.js 的物理与结算做断言。
const E = require('./engine');

let passed = 0;
let failed = 0;

function assert(cond, message) {
  if (cond) {
    passed += 1;
    console.log('  ✓', message);
  } else {
    failed += 1;
    console.error('  ✗', message);
  }
}

function runToEnd(controller) {
  const game = E.createGame(20261114);
  game.status = 'running';
  const dt = 1 / 60;
  let frames = 0;
  while (game.status === 'running' && frames < 20000) {
    if (controller) controller(game, dt);
    E.step(game, dt);
    frames += 1;
  }
  return game;
}

// 仅保留第一艘船的测试夹具：移除其余货船，方便验证单船交互。
function soloGame() {
  const game = E.createGame(20261114);
  game.ships = game.ships.slice(0, 1);
  game.status = 'running';
  return game;
}

function pointInObstacle(x, y, r) {
  for (const reef of E.REEFS) {
    const rr = reef.r + r + 26;
    if ((x - reef.x) ** 2 + (y - reef.y) ** 2 <= rr * rr) return true;
  }
  const ir = E.LIGHTHOUSE.islandR + r + 6;
  if ((x - E.LIGHTHOUSE.x) ** 2 + (y - E.LIGHTHOUSE.y) ** 2 <= ir * ir) return true;
  return false;

}

function clearPath(ship, ang) {
  for (let i = 1; i <= 14; i += 1) {
    const d = (620 * i) / 14;
    if (pointInObstacle(ship.x + Math.cos(ang) * d, ship.y + Math.sin(ang) * d, E.SHIP.hitR)) {
      return false;
    }
  }
  return true;
}

// 模拟熟练玩家的光束操作：光斑压在船前方的安全引导点上。
function pilotController(game) {
  const active = game.ships.filter((s) => s.status === 'adrift' || s.status === 'lit');
  if (active.length === 0) return;
  const ship = active[0];
  const portAng = Math.atan2(
    (E.PORT.yMin + E.PORT.yMax) / 2 - ship.y,
    E.PORT.mouthX - 6 - ship.x,
  );
  let chosen = portAng;
  for (const mag of [0, 0.25, 0.5, 0.75, 1.0, 1.25]) {
    const up = portAng + mag;
    const down = portAng - mag;
    chosen = clearPath(ship, up) ? up : clearPath(ship, down) ? down : up;
    if (clearPath(ship, chosen)) break;
  }
  const targetX = ship.x + Math.cos(chosen) * 220;
  const targetY = ship.y + Math.sin(chosen) * 220;
  game.input.aim = Math.atan2(targetY - E.LIGHTHOUSE.y, targetX - E.LIGHTHOUSE.x);
  game.input.spot = { x: targetX, y: targetY };
  game.input.boost = game.beam.energy > 30 && game.beam.heat < 78;
}

console.log('\n[1] 单船被光束成功引导进港');
{
  const game = soloGame();
  let everLit = false;
  let litFrames = 0;
  const dt = 1 / 60;
  while (game.status === 'running') {
    pilotController(game);
    E.step(game, dt);
    const ship = game.ships[0];
    if (ship.lit) { everLit = true; litFrames += 1; }
    if (ship.status === 'rescued' || ship.status === 'wrecked') break;
  }
  const ship = game.ships[0];
  assert(everLit && litFrames > 120, `船只至少被光束持续牵引 ${(litFrames / 60).toFixed(1)} 秒`);
  assert(ship.status === 'rescued', `单船成功入港（最终状态 ${ship.status}）`);
  assert(ship.x <= E.PORT.mouthX + 20 && ship.y > E.PORT.yMin && ship.y < E.PORT.yMax,
    `入港位置位于入口内 (${ship.x.toFixed(0)}, ${ship.y.toFixed(0)})`);
  assert(game.t < E.DURATION, `引导耗时 ${game.t.toFixed(1)} 秒，早于 90 秒时限`);
  assert(game.events.some((e) => e.type === 'rescued' && e.code === ship.code), '生成 rescued 事件');
}

console.log('\n[2] 无人操作时触礁，累计两艘即失败');
{
  const game = runToEnd(null);
  const wrecks = game.events.filter((e) => e.type === 'wrecked');
  assert(wrecks.length >= 2, `共发生 ${wrecks.length} 次触礁/失事`);
  assert(wrecks.some((e) => e.reason === 'reef'), '至少一次为礁石碰撞');
  assert(game.status === 'lost' && game.endReason === 'wreck',
    `游戏以触礁规则失败（${game.endReason}）`);
  assert(game.t < E.DURATION, `失败发生在 ${game.t.toFixed(1)} 秒，未拖到时间结束`);
}

console.log('\n[3] 完整救援：90 秒内引导至少四艘船进港');
{
  const game = runToEnd(pilotController);
  const rescued = game.ships.filter((s) => s.status === 'rescued');
  assert(game.status === 'won' && game.endReason === 'goal',
    `达成救援目标胜利（${game.status}/${game.endReason}）`);
  assert(rescued.length >= E.RESCUE_GOAL, `${rescued.length} 艘货船成功入港，目标 ${E.RESCUE_GOAL} 艘`);
  assert(game.stats.wrecked < E.WRECK_LIMIT, `触礁 ${game.stats.wrecked} 艘，未达失败线`);
  assert(game.t < E.DURATION, `用时 ${game.t.toFixed(1)} 秒，剩余 ${game.timeLeft.toFixed(1)} 秒`);
  assert(game.events.filter((e) => e.type === 'rescued').length === rescued.length, '每艘入港船都有事件记录');
}

console.log('\n[4] 时间结束仍未达标则失败');
{
  // 清空礁石并把船放到安全开阔水域，光束故意偏离，专门验证倒计时分支。
  const game = (() => {
    const g = E.createGame(20261114);
    E.REEFS.length = 0;
    g.ships.forEach((s, i) => { s.spawnT = i * 2; });
    g.status = 'running';
    return g;
  })();
  const dt = 1 / 60;
  while (game.status === 'running') {
    for (const ship of game.ships) keepInSafeZone(ship);
    game.input.aim = Math.PI * 0.15;
    game.input.boost = false; // 普通亮度，避免发电机先于倒计时触发失败。
    game.input.spot = null;
    E.step(game, dt);
  }
  E.REEFS.push(
    { x: 700, y: 150, r: 62 }, { x: 940, y: 250, r: 56 }, { x: 1130, y: 168, r: 48 },
    { x: 720, y: 848, r: 56 }, { x: 1180, y: 800, r: 42 },
  );
  assert(game.status === 'lost' && game.endReason === 'timeout',
    `90 秒结束且未救满四艘时失败（${game.endReason}）`);
  assert(Math.abs(game.timeLeft) < 0.02, `倒计时归零（剩余 ${game.timeLeft.toFixed(2)} 秒）`);
  assert(game.stats.rescued < E.RESCUE_GOAL, `仅 ${game.stats.rescued} 艘入港，未达目标`);
}

console.log('\n[5] 发电机反复耗尽，熄灯达到上限即失败');
{
  const game = (() => {
    const g = E.createGame(20261114);
    E.REEFS.length = 0;
    g.status = 'running';
    return g;
  })();
  const dt = 1 / 60;
  while (game.status === 'running') {
    for (const ship of game.ships) keepInSafeZone(ship);
    game.input.aim = Math.PI * 0.15;
    game.input.boost = true; // 持续超频，电量与温度反复触顶。
    game.input.spot = null;
    E.step(game, dt);
  }
  E.REEFS.push(
    { x: 700, y: 150, r: 62 }, { x: 940, y: 250, r: 56 }, { x: 1130, y: 168, r: 48 },
    { x: 720, y: 848, r: 56 }, { x: 1180, y: 800, r: 42 },
  );
  assert(game.beam.blackoutCount >= E.BLACKOUT_LIMIT,
    `反复触顶累计 ${game.beam.blackoutCount} 次熄灯，达到 ${E.BLACKOUT_LIMIT} 次上限`);
  assert(game.status === 'lost' && game.endReason === 'blackout',
    `能量管理彻底失败后游戏结束（${game.status}/${game.endReason}）`);
}

function keepInSafeZone(ship) {
  if (ship.status === 'waiting' || ship.status === 'rescued' || ship.status === 'wrecked') return;
  ship.x = Math.max(760, Math.min(E.WORLD.w - 120, ship.x));
  ship.y = Math.max(140, Math.min(E.WORLD.h - 140, ship.y));
  if (ship.x <= 762 || ship.x >= E.WORLD.w - 122) ship.vx *= -0.4;
  if (ship.y <= 142 || ship.y >= E.WORLD.h - 142) ship.vy *= -0.4;
}

console.log('\n[6] 熄灯恢复后灯塔重新点亮并恢复牵引');
{
  const game = (() => {
    const g = E.createGame(7);
    E.REEFS.length = 0;
    g.status = 'running';
    return g;
  })();
  const dt = 1 / 60;
  let sawBlackout = false;
  let relitAndLit = false;
  while (game.status === 'running') {
    for (const ship of game.ships) keepInSafeZone(ship);
    const targetShip = game.ships.find((s) => s.status === 'adrift' || s.status === 'lit');
    if (targetShip) {
      game.input.aim = Math.atan2(targetShip.y - E.LIGHTHOUSE.y, targetShip.x - E.LIGHTHOUSE.x);
    }
    game.input.boost = true;
    game.input.spot = null;
    E.step(game, dt);
    if (game.beam.blackout) sawBlackout = true;
    if (sawBlackout && !game.beam.blackout && game.beam.on) {
      if (targetShip && E.beamHit(game, targetShip)) relitAndLit = true;
    }
    if (relitAndLit) break;
  }
  E.REEFS.push(
    { x: 700, y: 150, r: 62 }, { x: 940, y: 250, r: 56 }, { x: 1130, y: 168, r: 48 },
    { x: 720, y: 848, r: 56 }, { x: 1180, y: 800, r: 42 },
  );
  assert(sawBlackout, '测试过程中确实进入过熄灯保护');
  assert(relitAndLit, '恢复供电后 beam.on=true 且光束能再次罩住货船');
}

console.log(`\n结果：${passed} 通过，${failed} 失败\n`);
process.exit(failed === 0 ? 0 : 1);
