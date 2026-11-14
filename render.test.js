'use strict';

// 用 Canvas 2D mock 在 Node 中跑通渲染管线，捕获绘制期运行时错误。
const E = require('./engine');
const R = require('./renderer');

function createGradientMock() {
  return { addColorStop() {} };
}

function createCtxMock() {
  const noop = () => {};
  return new Proxy({}, {
    get(target, prop) {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return createGradientMock;
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'canvas') return { width: 1600, height: 900 };
      if (prop in target) return target[prop];
      return typeof prop === 'string' ? noop : undefined;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
}

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log('  ✓', msg); }
  else { failed += 1; console.error('  ✗', msg); }
}

const ctx = createCtxMock();
const view = { renderer: R.createRenderer(), dt: 1 / 60 };

// 覆盖各类状态：ready、常规光束、超频、熄灯、触礁、入港、胜利/失败。
const game = E.createGame(42);
game.status = 'running';
for (let i = 0; i < 60 * 8; i += 1) {
  const active = game.ships.filter((s) => s.status === 'adrift' || s.status === 'lit');
  if (active.length) {
    const ship = active[0];
    game.input.aim = Math.atan2(ship.y - E.LIGHTHOUSE.y, ship.x - E.LIGHTHOUSE.x);
    game.input.spot = { x: ship.x - 120, y: ship.y + 60 };
    game.input.boost = i % 180 < 90;
  }
  E.step(game, 1 / 60);
  R.render(ctx, E, game, view);
}
assert(view.renderer.rain.length === 240, '雨线粒子按固定数量生成并逐帧更新');
assert(game.events.length > 0, '模拟期间产生了游戏事件');

// 强制覆盖熄灯与终局渲染分支
game.beam.blackout = true;
game.beam.on = false;
R.render(ctx, E, game, view);
game.beam.blackout = false;
game.beam.on = true;
game.ships[0].status = 'wrecked';
game.ships[1].status = 'rescued';
R.render(ctx, E, game, view);
assert(true, '熄灯、触礁、获救状态下渲染管线均无异常');

// 音频模块在无 window 的 Node 环境下应可安全加载（不实例化 AudioContext）
const audioApi = require('./audio');
assert(typeof audioApi.createAudio === 'function', 'audio.js 可在非浏览器环境加载且不立即访问 AudioContext');

console.log(`\n渲染测试结果：${passed} 通过，${failed} 失败\n`);
process.exit(failed ? 1 : 0);
