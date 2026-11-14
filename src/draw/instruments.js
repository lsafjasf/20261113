import { setupCanvas, COLORS } from './common.js';
import { AZ_TOLERANCE, EL_TOLERANCE } from '../constants.js';

// 方位刻度条：以当前镜位为中心的局部窗口，显示目标容差窗
export function drawAzScale(canvas, state, target) {
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#081114';
  ctx.fillRect(0, 0, w, h);

  const span = 60; // 左右各 30°
  const toX = (az) => {
    let d = (az - state.az + 540) % 360 - 180;
    return w / 2 + (d / span) * (w / 2);
  };

  // 网格与刻度
  ctx.strokeStyle = 'rgba(120,170,160,0.15)';
  ctx.fillStyle = COLORS.dim;
  ctx.font = '9px monospace';
  for (let deg = -30; deg <= 30; deg += 3) {
    const x = w / 2 + (deg / span) * (w / 2);
    const major = deg % 9 === 0;
    ctx.beginPath();
    ctx.moveTo(x, h - 26);
    ctx.lineTo(x, h - (major ? 40 : 32));
    ctx.stroke();
    if (major) {
      const label = Math.round((state.az + deg + 360) % 360);
      ctx.fillText(String(label).padStart(3, '0'), x - 12, 16);
    }
  }

  // 目标容差窗
  if (target) {
    const x1 = toX(target.signal.az - AZ_TOLERANCE);
    const x2 = toX(target.signal.az + AZ_TOLERANCE);
    ctx.fillStyle = target.azWithin
      ? 'rgba(127,224,168,0.18)'
      : 'rgba(242,182,107,0.14)';
    ctx.fillRect(x1, 24, x2 - x1, h - 50);
  }

  // 当前镜位指针
  ctx.strokeStyle = COLORS.amber;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w / 2, 26);
  ctx.lineTo(w / 2 - 6, h - 30);
  ctx.lineTo(w / 2 + 6, h - 30);
  ctx.closePath();
  ctx.stroke();

  ctx.fillStyle = COLORS.dim;
  ctx.font = '10px monospace';
  ctx.fillText('6°', 6, h - 6);
  if (target) {
    const d = ((target.signal.az - state.az + 540) % 360) - 180;
    ctx.fillStyle = target.azWithin ? COLORS.green : COLORS.amber;
    ctx.fillText(`${d >= 0 ? '+' : ''}${d.toFixed(2)}°`, w - 58, h - 6);
  }
  ctx.fillStyle = COLORS.dim;
  ctx.fillText('A 方位 D', w / 2 - 24, h - 6);
}

// 增益分段条
export function drawGainMeter(canvas, state) {
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const ratio = (state.gain - 20) / 80;
  const segments = 24;
  const gap = 3;
  const sw = (w - gap * (segments - 1)) / segments;
  const active = Math.round(ratio * segments);
  for (let i = 0; i < segments; i += 1) {
    const x = i * (sw + gap);
    if (i < active) {
      const hot = ratio > 0.75 && i > segments * 0.7;
      ctx.fillStyle = hot ? '#d9a14f' : COLORS.green;
    } else {
      ctx.fillStyle = 'rgba(120,160,150,0.12)';
    }
    ctx.fillRect(x, 6, sw, h - 12);
  }
  ctx.fillStyle = COLORS.dim;
  ctx.font = '10px monospace';
  ctx.fillText(`噪声 ${Math.round(state.noise * 100)}%`, w - 62, 12);
}

// 仰角半圆表
export function drawElGauge(canvas, state, target) {
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h - 18;
  const r = Math.min(w / 2 - 24, h - 26);
  const angleFor = (el) => Math.PI - (el / 90) * Math.PI;

  // 弧轨
  ctx.strokeStyle = 'rgba(120,170,160,0.18)';
  ctx.lineWidth = 1.5;
  for (let el = 0; el <= 90; el += 15) {
    const a = angleFor(el);
    const x1 = cx + Math.cos(a) * (r - 8);
    const y1 = cy + Math.sin(a) * (r - 8);
    const x2 = cx + Math.cos(a) * (r + 2);
    const y2 = cy + Math.sin(a) * (r + 2);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.fillStyle = COLORS.dim;
    ctx.font = '9px monospace';
    ctx.fillText(`${el}°`, cx + Math.cos(a) * (r + 12) - 8, cy + Math.sin(a) * (r + 12) + 3);
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 0);
  ctx.stroke();

  // 目标容差弧
  if (target) {
    const a1 = angleFor(target.signal.el + EL_TOLERANCE);
    const a2 = angleFor(target.signal.el - EL_TOLERANCE);
    ctx.strokeStyle = target.elWithin ? COLORS.green : COLORS.cyan;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 4, a1, a2);
    ctx.stroke();
    ctx.lineWidth = 1.5;
  }

  // 指针
  const a = angleFor(state.el);
  ctx.strokeStyle = COLORS.cyan;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(a) * (r - 10), cy + Math.sin(a) * (r - 10));
  ctx.stroke();
  ctx.fillStyle = COLORS.cyan;
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = COLORS.dim;
  ctx.font = '10px monospace';
  if (target) {
    const d = state.el - target.signal.el;
    ctx.fillStyle = target.elWithin ? COLORS.green : COLORS.cyan;
    ctx.fillText(`${d >= 0 ? '+' : ''}${d.toFixed(2)}°/s`, 8, 14);
  }
  ctx.fillStyle = COLORS.dim;
  ctx.fillText('↑ 仰角 ↓', w / 2 - 24, h - 4);
}

// 信号电平分段条
export function drawLevelMeter(canvas, state, level) {
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const segments = 28;
  const gap = 3;
  const sw = (w - gap * (segments - 1)) / segments;
  const active = Math.round(level * segments);
  for (let i = 0; i < segments; i += 1) {
    const x = i * (sw + gap);
    ctx.fillStyle = i < active
      ? (i > segments * 0.75 ? COLORS.amber : COLORS.cyan)
      : 'rgba(120,160,150,0.1)';
    ctx.fillRect(x, 5, sw, h - 10);
  }
}
