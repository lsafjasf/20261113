// 逻辑边界条件：失败、资源、暂停、重开与双人耦合。
import { createGame, makeInput, startGame, restartGame, stepGame, togglePause, TUNE, MAP } from '../src/engine.js';

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures += 1;
}

function drainTo(g, field, value) {
  g.hull[field] = value;
}

// 1. 氧气耗尽 -> 失败
{
  const g = createGame();
  startGame(g);
  drainTo(g, 'oxygen', 0.001);
  stepGame(g, makeInput(), 1 / 60);
  check('氧气归零进入失败态', g.state === 'lost' && g.loseReason === 'oxygen');
}

// 2. 碰撞掉血，耐久归零 -> 失败
{
  const g = createGame();
  startGame(g);
  g.hull.hp = 1;
  g.hull.hitCooldown = 0;
  // 高速撞向左墙
  g.hull.x = 30;
  g.hull.vx = -320;
  stepGame(g, makeInput(), 1 / 60);
  check('高速碰撞产生损伤', g.stats.hits >= 1 && g.hull.hp <= 1);
  if (g.hull.hp > 0) {
    g.hull.hp = 1;
    g.hull.hitCooldown = 0;
    g.hull.x = 30;
    g.hull.vx = -320;
    stepGame(g, makeInput(), 1 / 60);
  }
  check('耐久归零进入失败态', g.state === 'lost' && g.loseReason === 'hull');
}

// 3. 电池耗尽后推进失效
{
  const g = createGame();
  startGame(g);
  g.hull.battery = 0;
  const input = makeInput();
  input.p1.mainF = true;
  input.p2.up = true;
  const vx0 = g.hull.vx;
  stepGame(g, input, 1 / 60);
  check('电池耗尽时主推不产生横向加速度', g.hull.vx === vx0);
  check('电池耗尽时浮力泵不工作', g.power.pumpUp === 0);
}

// 4. 暂停时世界冻结
{
  const g = createGame();
  startGame(g);
  const t0 = g.time;
  togglePause(g);
  stepGame(g, makeInput(), 1 / 60);
  check('暂停时 step 不推进时间', g.time === t0 && g.state === 'paused');
  togglePause(g);
  stepGame(g, makeInput(), 1 / 60);
  check('恢复后时间继续', g.time > t0);
}

// 5. 快速重开完全重置
{
  const g = createGame();
  startGame(g);
  g.hull.hp = 40;
  g.collected = 2;
  g.samples[0].taken = true;
  restartGame(g);
  check('重开后耐久/样本/位置重置', g.hull.hp === TUNE.hpMax && g.collected === 0 && g.samples.every((s) => !s.taken));
  check('重开后回到出生点', g.hull.x === MAP.spawn.x && g.hull.y === MAP.spawn.y);
}

// 6. 只有玩家二（只能上下）无法横向穿越竖井
{
  const g = createGame();
  startGame(g);
  const input = makeInput();
  const x0 = g.hull.x;
  input.p2.down = true;
  for (let i = 0; i < 120; i++) stepGame(g, input, 1 / 60);
  check('仅玩家二操作时横向位置基本不变', Math.abs(g.hull.x - x0) < 4);
}

// 7. 只有玩家一（只能横向）无法上升，且会被动下沉
{
  const g = createGame();
  startGame(g);
  const input = makeInput();
  input.p1.mainF = true;
  const y0 = g.hull.y;
  for (let i = 0; i < 120; i++) stepGame(g, input, 1 / 60);
  check('仅玩家一操作时持续下沉（无法调浮力）', g.hull.y > y0 + 30);
}

// 8. 取样回复氧气且播放事件
{
  const g = createGame();
  startGame(g);
  g.hull.oxygen = 40;
  g.hull.x = MAP.samples[0].x;
  g.hull.y = MAP.samples[0].y;
  stepGame(g, makeInput(), 1 / 60);
  check('接触样本舱自动回收并回氧', g.collected === 1 && g.hull.oxygen > 40);
  check('取样事件入队', g.events.some((e) => e.type === 'pickup'));
}

if (failures) {
  console.error(`\n${failures} 项边界测试失败`);
  process.exit(1);
}
console.log('\n全部边界测试通过。');
