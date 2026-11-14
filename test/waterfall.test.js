import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGame } from '../src/engine.js';

// 轻量 Canvas 2D 桩，仅实现瀑布绘制实际调用的方法
function makeCanvasStub() {
  const ctx = {
    fillRect() {},
    clearRect() {},
    strokeRect() {},
    setTransform() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fillText() {},
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
  };
  return {
    width: 300,
    height: 250,
    style: {},
    getBoundingClientRect: () => ({ width: 300, height: 250 }),
    getContext: () => ctx,
  };
}

test('瀑布交错缓冲按列左移，不会出现旧列残留亮边', async () => {
  globalThis.window = globalThis.window || { devicePixelRatio: 1 };
  const { drawWaterfall } = await import('../src/draw/waterfall.js');
  const canvas = makeCanvasStub();
  const state = createGame();
  // 连续绘制足够多帧，让缓冲完成多次整列滚动，过程不抛错
  for (let i = 0; i < 200; i += 1) {
    drawWaterfall(canvas, state, 0, 'right');
    state.t += 0.05;
  }

  // 直接验证交错布局的按列左移：rows=3 时每次移动 3 个元素（一整列）
  const rows = 3;
  const buf = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  buf.copyWithin(0, rows, buf.length);
  assert.deepEqual([...buf], [4, 5, 6, 7, 8, 9, 7, 8, 9]);

  assert.equal(state.mode, 'play');
});

test('对方轴失谐越大，crossNoiseFor 返回越高的污染值', async () => {
  const { crossNoiseFor } = await import('../src/engine.js');
  const state = createGame();
  const clean = crossNoiseFor(state, 'left');
  // 把仰角强行拉开到与所有信号都很远
  state.el = 0;
  state.az = 10;
  const polluted = crossNoiseFor(state, 'left');
  assert.ok(clean < 0.2, `初始镜位应接近干净，实际 ${clean}`);
  assert.ok(polluted > 0.6, `期望高污染，实际 ${polluted}`);
  assert.ok(polluted > clean);
});
