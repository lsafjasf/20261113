import { setupCanvas, COLORS } from './common.js';
import { blinkState } from '../signals.js';
import { angleDistance } from '../constants.js';

// 每个瀑布维护滚动缓冲，按帧向左滚动
const buffers = new WeakMap();

function getBuffer(canvas, cols, rows) {
  let buf = buffers.get(canvas);
  if (!buf || buf.cols !== cols || buf.rows !== rows) {
    buf = {
      cols,
      rows,
      data: new Float32Array(cols * rows),
    };
    buffers.set(canvas, buf);
  }
  return buf;
}

// axis: 'left' 左镜（受仰角偏差污染，琥珀色），'right' 右镜（受方位偏差污染，青色）
export function drawWaterfall(canvas, state, crossNoise, axis) {
  const { ctx, w, h } = setupCanvas(canvas);
  const rows = 3; // L / S / X 三个频段行
  const cols = 64;
  const buf = getBuffer(canvas, cols, rows);

  // 左移一列（交错布局，每列占 rows 个元素），新列写入末尾
  buf.data.copyWithin(0, rows, buf.data.length);
  const colStart = (cols - 1) * rows;

  const alignment = nearestUnlocked(state);

  for (let band = 0; band < rows; band += 1) {
    let v = 0;
    // 该频段上可见、增益足够的信号贡献强度
    for (const signal of state.signals) {
      if (signal.locked || signal.band !== band) continue;
      const blink = blinkState(signal, state.t);
      if (!blink.active || state.gain < signal.requiredGain) continue;
      const err =
        angleDistance(state.az, signal.az) +
        Math.abs(state.el - signal.el);
      const focus = Math.max(0, 1 - err / 30);
      const margin = Math.min(1, (state.gain - signal.requiredGain + 10) / 50);
      v = Math.max(v, (0.35 + 0.65 * margin) * focus);
    }
    // 底噪：增益越高底噪越大；再叠加对方轴的失谐污染
    const floor = 0.06 + state.noise * 0.22 + crossNoise * 0.6;
    const flicker = Math.random() * 0.08;
    buf.data[colStart + band] = Math.min(1, v * (1 - crossNoise * 0.7) + floor + flicker);
  }

  // 绘制
  const cw = w / cols;
  const rh = h / rows;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#060d10';
  ctx.fillRect(0, 0, w, h);

  const base = axis === 'left'
    ? [242, 182, 107] // 琥珀
    : [111, 227, 224]; // 青

  for (let c = 0; c < cols; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      const v = buf.data[c * rows + r];
      const a = 0.08 + v * 0.92;
      ctx.fillStyle = `rgba(${base[0]},${base[1]},${base[2]},${a.toFixed(3)})`;
      ctx.fillRect(c * cw, r * rh, Math.ceil(cw), rh + 1);
    }
  }

  // 频段分隔线与标签
  ctx.strokeStyle = 'rgba(120,160,150,0.18)';
  ctx.fillStyle = COLORS.dim;
  ctx.font = '10px monospace';
  for (let r = 1; r < rows; r += 1) {
    ctx.beginPath();
    ctx.moveTo(0, r * rh);
    ctx.lineTo(w, r * rh);
    ctx.stroke();
  }
  ctx.fillText('L', 4, 14);
  ctx.fillText('S', 4, rh + 14);
  ctx.fillText('X', 4, rh * 2 + 14);

  // 当前频段高亮行
  ctx.strokeStyle = axis === 'left' ? COLORS.amber : COLORS.cyan;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(1, state.band * rh + 1, w - 2, rh - 2);

  // 失谐严重时覆盖一层噪点遮罩提示“难以辨认”
  if (crossNoise > 0.55) {
    ctx.fillStyle = `rgba(4,10,12,${((crossNoise - 0.55) * 0.7).toFixed(2)})`;
    ctx.fillRect(0, 0, w, h);
  }
}

function nearestUnlocked(state) {
  let best = null;
  for (const signal of state.signals) {
    if (signal.locked) continue;
    const d = angleDistance(state.az, signal.az) + Math.abs(state.el - signal.el);
    if (!best || d < best.d) best = { signal, d };
  }
  return best;
}
