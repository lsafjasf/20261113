import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  alignmentInfo,
  candidateAt,
  clearInput,
  createGame,
  lockProgress,
  setInput,
  shiftBand,
  update,
} from '../src/engine.js';
import { AZ_TOLERANCE, EL_TOLERANCE, LOCK_HOLD_SECONDS } from '../src/constants.js';
import { blinkState, generateSignals } from '../src/signals.js';
import { freshGame, servoToSignal, step } from './helpers.js';

// 推进时间直到指定信号进入闪烁可见窗口
function waitForActive(state, signal, maxSeconds = 12) {
  const start = state.t;
  while (state.t - start < maxSeconds) {
    if (blinkState(signal, state.t).active) return;
    update(state, 0.05);
  }
  throw new Error('信号始终未进入可见窗口');
}

test('固定 seed 生成完全一致的三组真信号与两组诱饵', () => {
  const a = generateSignals(20261113);
  const b = generateSignals(20261113);
  assert.deepEqual(a, b);
  const reals = a.filter((s) => s.kind === 'real');
  const decoys = a.filter((s) => s.kind === 'decoy');
  assert.equal(reals.length, 3);
  assert.equal(decoys.length, 2);
  assert.deepEqual([...new Set(reals.map((s) => s.band))].sort(), [0, 1, 2]);
});

test('只有单轴进入容差时不会锁定，双轴同时进入并保持两秒才锁定', () => {
  const state = freshGame();
  const target = state.signals.find((s) => s.id === 'R2');
  state.band = target.band;
  state.gain = target.requiredGain + 10;
  waitForActive(state, target);

  // 仅方位对准
  state.az = target.az;
  state.el = target.el + EL_TOLERANCE + 10;
  step(state, 2.5);
  assert.equal(target.locked, false);
  assert.equal(lockProgress(state), 0);

  // 双轴都进入容差（在容差边界上），并由玩家持续顶住风暴
  state.az = target.az + AZ_TOLERANCE - 1;
  state.el = target.el + EL_TOLERANCE - 1;
  const info = alignmentInfo(state);
  assert.equal(info.azWithin && info.elWithin, true);
  assert.ok(candidateAt(state));

  // 模拟两侧同时按键纠正，保持不足 2 秒不锁定
  let held = 0;
  const holdStart = state.t;
  while (state.t - holdStart < LOCK_HOLD_SECONDS - 0.5) {
    const azDiff = (target.az - state.az + 540) % 360 - 180;
    setInput(state, 'azRight', azDiff > 0.5);
    setInput(state, 'azLeft', azDiff < -0.5);
    setInput(state, 'elUp', target.el - state.el > 0.5);
    setInput(state, 'elDown', target.el - state.el < -0.5);
    update(state, 0.05);
    if (candidateAt(state)) held += 0.05;
  }
  assert.equal(target.locked, false);
  assert.ok(held > 1);
  assert.ok(lockProgress(state) > 0.4);

  // 继续保持满 2 秒后锁定成功
  while (!target.locked && state.mode === 'play') {
    const azDiff = (target.az - state.az + 540) % 360 - 180;
    setInput(state, 'azRight', azDiff > 0.5);
    setInput(state, 'azLeft', azDiff < -0.5);
    setInput(state, 'elUp', target.el - state.el > 0.5);
    setInput(state, 'elDown', target.el - state.el < -0.5);
    update(state, 0.05);
  }
  assert.equal(target.locked, true);
  assert.equal(state.lockCount, 1);
  assert.equal(state.wrongCount, 0);
  clearInput(state);
});

test('保持期间信号闪烁熄灭会中断并重置计时', () => {
  const state = freshGame();
  const target = state.signals.find((s) => s.id === 'R2');
  state.band = target.band;
  state.gain = target.requiredGain + 10;
  waitForActive(state, target);
  state.az = target.az;
  state.el = target.el;
  const holdStart = state.t;
  while (state.t - holdStart < 1) {
    const azDiff = (target.az - state.az + 540) % 360 - 180;
    setInput(state, 'azRight', azDiff > 0.5);
    setInput(state, 'azLeft', azDiff < -0.5);
    setInput(state, 'elUp', target.el - state.el > 0.5);
    setInput(state, 'elDown', target.el - state.el < -0.5);
    update(state, 0.05);
  }
  clearInput(state);
  const mid = lockProgress(state);
  assert.ok(mid > 0);
  // 直接把闪烁相位推到关闭窗口
  target.blink.phase = (target.blink.period * target.blink.duty - state.t + target.blink.period) % target.blink.period;
  step(state, 0.2);
  assert.equal(lockProgress(state), 0);
});

test('方位与仰角协同校正：伺服在风暴下完成一次真信号锁定', () => {
  const state = freshGame();
  const target = state.signals.find((s) => s.id === 'R2');
  const mode = servoToSignal(state, target);
  assert.equal(mode, 'play');
  assert.equal(target.locked, true);
  assert.equal(state.lockCount, 1);
  assert.ok(state.coopCount >= 1);
});

test('连续错锁两个诱饵判定任务无效', () => {
  const state = freshGame();
  const d1 = state.signals.find((s) => s.id === 'D1');
  servoToSignal(state, d1);
  assert.equal(state.wrongCount, 1);
  assert.equal(state.mode, 'play');
  const d2 = state.signals.find((s) => s.id === 'D2');
  servoToSignal(state, d2);
  assert.equal(state.wrongCount, 2);
  assert.equal(state.mode, 'lost');
  assert.equal(state.failReason, 'wrong');
});

test('电池耗尽失败：高增益空转会在胜利前断电', () => {
  const state = freshGame();
  setInput(state, 'gainUp', true);
  for (let i = 0; i < 60 && state.gain < 100; i += 1) update(state, 0.05);
  clearInput(state);
  assert.equal(state.gain, 100);
  step(state, 200, 0.1);
  assert.equal(state.mode, 'lost');
  assert.equal(state.failReason, 'battery');
  assert.equal(state.battery, 0);
});

test('三目标胜利：依次锁定全部真异常', () => {
  const state = freshGame();
  for (const id of ['R1', 'R2', 'R3']) {
    const target = state.signals.find((s) => s.id === id);
    servoToSignal(state, target);
    assert.equal(target.locked, true, `${id} 应被锁定`);
  }
  assert.equal(state.mode, 'won');
  assert.equal(state.lockCount, 3);
  assert.ok(state.battery > 0);
  assert.ok(state.timeLeft > 0);
});

test('风暴持续把镜位推离中心，需要输入纠正', () => {
  const idle = freshGame();
  step(idle, 6, 0.1);
  const moved = Math.abs(idle.az - 152) + Math.abs(idle.el - 48);
  assert.ok(moved > 1, '无操作时风暴应产生可测偏移');

  const held = freshGame();
  const before = { az: held.az, el: held.el };
  setInput(held, 'azLeft', true);
  setInput(held, 'elUp', true);
  step(held, 6, 0.1);
  const drift = Math.abs(held.az - before.az) + Math.abs(held.el - before.el);
  assert.ok(drift > 1);
});

test('频段不匹配时信号不可被锁定', () => {
  const state = freshGame();
  const target = state.signals.find((s) => s.id === 'R2');
  state.gain = target.requiredGain + 10;
  state.az = target.az;
  state.el = target.el;
  state.band = (target.band + 1) % 3;
  step(state, 2.5);
  assert.equal(target.locked, false);
  assert.equal(candidateAt(state), null);
});

test('局时结束且未锁定三个目标时，风暴抵达判定失败', () => {
  const state = freshGame();
  // 直接推进到时间耗尽
  state.t = 109.9;
  step(state, 0.5, 0.05);
  assert.equal(state.mode, 'lost');
  assert.equal(state.failReason, 'timeout');
  assert.equal(state.timeLeft, 0);
});
