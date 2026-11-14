import { blinkState } from '../signals.js';
import { setupCanvas, COLORS } from './common.js';

// 极坐标：方位 0° 在顶部(N)顺时针，仰角映射为半径（0° 在外缘，90° 在中心）
function polar(cx, cy, r, az, el) {
  const rad = (az - 90) * (Math.PI / 180);
  const radius = r * (1 - el / 90);
  return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
}

export function drawRadar(canvas, state) {
  const { ctx, w, h } = setupCanvas(canvas);
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2 - 18;

  ctx.clearRect(0, 0, w, h);

  // 背景圆盘
  const bg = ctx.createRadialGradient(cx, cy, 10, cx, cy, r);
  bg.addColorStop(0, '#072018');
  bg.addColorStop(1, '#04100c');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // 仰角同心圆（15/30/45/60/75）
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (const el of [15, 30, 45, 60, 75]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * (1 - el / 90), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = COLORS.dim;
    ctx.font = '10px monospace';
    ctx.fillText(`${el}°`, cx + 4, cy - r * (1 - el / 90) - 3);
  }

  // 方位十字与斜十字
  ctx.strokeStyle = COLORS.grid;
  for (let deg = 0; deg < 360; deg += 30) {
    const [x, y] = polar(cx, cy, r, deg, 0);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  // 方位标签 N/E/S/W
  ctx.fillStyle = COLORS.text;
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  for (const [deg, label] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) {
    const [x, y] = polar(cx, cy, r + 11, deg, 0);
    ctx.fillText(label, x, y + 4);
  }
  ctx.textAlign = 'start';

  // 扫描余晖（缓慢旋转的扇形）
  const sweep = (state.t * 0.9) % (Math.PI * 2);
  const grad = ctx.createConicGradient
    ? ctx.createConicGradient(sweep - 0.5, cx, cy)
    : null;
  if (grad) {
    grad.addColorStop(0, 'rgba(127,224,168,0.28)');
    grad.addColorStop(0.12, 'rgba(127,224,168,0.05)');
    grad.addColorStop(0.2, 'rgba(127,224,168,0)');
    grad.addColorStop(1, 'rgba(127,224,168,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 信号回波
  for (const signal of state.signals) {
    const blink = blinkState(signal, state.t);
    const [x, y] = polar(cx, cy, r, signal.az, signal.el);
    if (signal.locked) {
      drawLocked(ctx, x, y);
      continue;
    }
    if (!blink.active) {
      // 熄灭时只留极淡的定位圈
      ctx.strokeStyle = 'rgba(120,160,150,0.12)';
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.stroke();
      continue;
    }
    const enoughGain = state.gain >= signal.requiredGain;
    const bandMatch = signal.band === state.band;
    const alpha = enoughGain ? 0.95 : 0.4;
    if (signal.kind === 'real') {
      // 真异常：双峰（两个并列光点）
      ctx.fillStyle = bandMatch
        ? `rgba(127,224,168,${alpha})`
        : `rgba(127,224,168,${alpha * 0.55})`;
      ctx.beginPath();
      ctx.arc(x - 4, y, 3.2, 0, Math.PI * 2);
      ctx.arc(x + 4, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = COLORS.green;
      ctx.shadowBlur = bandMatch ? 12 : 4;
      ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      // 诱饵：单峰（一个红点）
      ctx.fillStyle = bandMatch
        ? `rgba(239,122,114,${alpha})`
        : `rgba(239,122,114,${alpha * 0.5})`;
      ctx.beginPath();
      ctx.arc(x, y, 3.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 当前波束：从中心指向镜位的十字准线
  const [bx, by] = polar(cx, cy, r, state.az, state.el);
  ctx.strokeStyle = COLORS.amber;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.strokeRect(bx - 7, by - 7, 14, 14);
  ctx.beginPath();
  ctx.moveTo(bx - 11, by);
  ctx.lineTo(bx + 11, by);
  ctx.moveTo(bx, by - 11);
  ctx.lineTo(bx, by + 11);
  ctx.stroke();

  // 镜位读数标签
  ctx.fillStyle = COLORS.amber;
  ctx.font = '11px monospace';
  ctx.fillText(`${state.az.toFixed(1)}°`, bx + 10, by - 6);
  ctx.fillText(`EL ${state.el.toFixed(1)}°`, bx + 10, by + 8);

  // 边缘文字
  ctx.fillStyle = COLORS.dim;
  ctx.font = '10px monospace';
  ctx.fillText('RANGE 90°', w - 78, 18);
  ctx.fillText('SWEEP ' + Math.round((sweep * 180) / Math.PI) + '°', w - 80, h - 10);
  ctx.fillText('AZ → EL', 8, h - 10);
}

function drawLocked(ctx, x, y) {
  ctx.strokeStyle = COLORS.green;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = COLORS.green;
  ctx.font = 'bold 11px monospace';
  ctx.fillText('LOCK', x - 14, y - 15);
}
