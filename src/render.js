// Canvas 2D 渲染：洞穴剖面、海水颗粒、样本舱、船体损伤、推进与浮力气泡。
import { WORLD, MAP, TUNE } from './engine.js';

export const VIEW = { w: 960, h: 720 };

// 海水漂浮颗粒只在渲染层维护，不参与游戏逻辑
let motes = null;

function ensureMotes() {
  if (motes) return;
  motes = [];
  for (let i = 0; i < 130; i++) {
    motes.push({
      x: Math.random() * WORLD.w,
      y: Math.random() * WORLD.h,
      r: 0.8 + Math.random() * 2.2,
      drift: 4 + Math.random() * 12,
      phase: Math.random() * Math.PI * 2,
    });
  }
}

export function cameraFor(hull) {
  const x = Math.max(0, Math.min(WORLD.w - VIEW.w, hull.x - VIEW.w / 2));
  const y = Math.max(0, Math.min(WORLD.h - VIEW.h, hull.y - VIEW.h / 2));
  return { x, y };
}

function drawWater(ctx, cam, time) {
  const grad = ctx.createLinearGradient(0, cam.y, 0, cam.y + VIEW.h);
  grad.addColorStop(0, '#0b2a3f');
  grad.addColorStop(0.55, '#071d2e');
  grad.addColorStop(1, '#04101b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);

  ensureMotes();
  ctx.save();
  for (const m of motes) {
    const sx = m.x - cam.x + Math.sin(time * 0.5 + m.phase) * 6;
    const sy = ((m.y - time * m.drift) % WORLD.h + WORLD.h) % WORLD.h - cam.y;
    if (sx < -10 || sx > VIEW.w + 10 || sy < -10 || sy > VIEW.h + 10) continue;
    ctx.globalAlpha = 0.12 + 0.18 * (0.5 + 0.5 * Math.sin(time + m.phase));
    ctx.fillStyle = '#7fd4e8';
    ctx.beginPath();
    ctx.arc(sx, sy, m.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawRocks(ctx, cam) {
  for (const s of MAP.solids) {
    const x = s.x - cam.x;
    const y = s.y - cam.y;
    if (x + s.w < 0 || x > VIEW.w || y + s.h < 0 || y > VIEW.h) continue;
    const grad = ctx.createLinearGradient(x, y, x, y + s.h);
    grad.addColorStop(0, '#3a4653');
    grad.addColorStop(0.4, '#2a343f');
    grad.addColorStop(1, '#1a222b');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, s.w, s.h);
    // 岩石边缘高光与纹理
    ctx.strokeStyle = 'rgba(127, 212, 232, 0.18)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, s.w - 2, s.h - 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    for (let i = 8; i < s.w - 6; i += 26) {
      ctx.beginPath();
      ctx.moveTo(x + i, y + 5);
      ctx.lineTo(x + i + 10, y + Math.min(18, s.h - 6));
      ctx.stroke();
    }
  }
}

function drawEntrance(ctx, cam) {
  const e = MAP.entrance;
  ctx.save();
  ctx.strokeStyle = 'rgba(120, 230, 180, 0.9)';
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 8]);
  ctx.strokeRect(e.x - cam.x, e.y - cam.y, e.w, e.h);
  ctx.setLineDash([]);
  ctx.fillStyle = '#9ff5cf';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText('入口 / 停靠点', e.x - cam.x, e.y - cam.y - 8);
  ctx.restore();
}

function drawSamples(ctx, cam, samples, time) {
  for (const s of samples) {
    if (s.taken) continue;
    const x = s.x - cam.x;
    const y = s.y - cam.y + Math.sin(time * 2 + s.id) * 3;
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowColor = '#ffd76b';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#f4b740';
    ctx.beginPath();
    ctx.arc(0, 0, s.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff3cf';
    ctx.fillRect(-3, -7, 6, 14);
    ctx.fillStyle = '#8a5a12';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(s.id + 1), 0, 4);
    ctx.restore();
  }
}

function drawHull(ctx, cam, g) {
  const h = g.hull;
  const x = h.x - cam.x;
  const y = h.y - cam.y;
  const hw = TUNE.hullW / 2;
  const hh = TUNE.hullH / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(h.angle);

  // 舱灯光锥（电量为零时熄灭）
  if (h.battery > 0) {
    const beam = ctx.createRadialGradient(0, 0, 6, 0, 0, 230);
    beam.addColorStop(0, 'rgba(255, 244, 190, 0.22)');
    beam.addColorStop(1, 'rgba(255, 244, 190, 0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 230, -0.5, 0.5);
    ctx.closePath();
    ctx.fill();
  }

  // 船体外壳，受击闪红，耐久越低越偏暗红
  const dmgRatio = 1 - h.hp / TUNE.hpMax;
  const body = h.hitFlash > 0 ? '#ff6b5e' : `rgb(${60 + dmgRatio * 120}, ${120 - dmgRatio * 50}, 150)`;
  ctx.fillStyle = body;
  ctx.strokeStyle = '#cfe6f2';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-hw, -hh, TUNE.hullW, TUNE.hullH, 8);
  ctx.fill();
  ctx.stroke();

  // 观察窗
  ctx.fillStyle = h.battery > 0 ? '#ffe9a8' : '#5a6672';
  ctx.beginPath();
  ctx.arc(hw - 12, 0, 5, 0, Math.PI * 2);
  ctx.fill();

  // 裂纹：损伤越多裂纹越多
  if (dmgRatio > 0.25) {
    ctx.strokeStyle = 'rgba(20, 10, 12, 0.65)';
    ctx.lineWidth = 1.4;
    const cracks = Math.min(4, Math.floor(dmgRatio * 5));
    for (let i = 0; i < cracks; i++) {
      const cx = -hw + 8 + i * 9;
      ctx.beginPath();
      ctx.moveTo(cx, -hh + 4);
      ctx.lineTo(cx + 4, 0);
      ctx.lineTo(cx - 2, hh - 4);
      ctx.stroke();
    }
  }

  // 推进方向指示（船尾喷口）
  if (g.power.main > 0.05) {
    ctx.fillStyle = `rgba(255, 160, 70, ${0.35 + g.power.main * 0.5})`;
    const len = 14 + g.power.main * 26;
    ctx.beginPath();
    ctx.moveTo(-hw, -6);
    ctx.lineTo(-hw - len, 0);
    ctx.lineTo(-hw, 6);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // 浮力气泡（独立于船体旋转）
  if (g.power.pumpUp > 0.05 || g.power.pumpDown > 0.05) {
    ctx.fillStyle = 'rgba(170, 235, 255, 0.55)';
    for (let i = 0; i < 3; i++) {
      const off = (performance.now() / 200 + i * 7) % 14;
      ctx.beginPath();
      ctx.arc(x - 10 + i * 10, y - hh - off, 2 + (i % 2), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawParticles(ctx, cam, particles) {
  for (const p of particles) {
    const a = Math.max(0, p.life / p.maxLife);
    if (p.kind === 'bubble') {
      ctx.strokeStyle = `rgba(170, 235, 255, ${0.6 * a})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(p.x - cam.x, p.y - cam.y, 3, 0, Math.PI * 2);
      ctx.stroke();
    } else if (p.kind === 'thrust') {
      ctx.fillStyle = `rgba(255, 150, 60, ${0.7 * a})`;
      ctx.beginPath();
      ctx.arc(p.x - cam.x, p.y - cam.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = `rgba(255, 220, 120, ${0.9 * a})`;
      ctx.beginPath();
      ctx.arc(p.x - cam.x, p.y - cam.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawVignette(ctx, g) {
  const low = Math.max(0, 1 - g.hull.oxygen / 28);
  const grad = ctx.createRadialGradient(VIEW.w / 2, VIEW.h / 2, VIEW.h * 0.35, VIEW.w / 2, VIEW.h / 2, VIEW.h * 0.75);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, `rgba(2, 8, 14, ${0.55 + low * 0.35})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
}

function bar(ctx, x, y, w, ratio, color, label, valueText) {
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(x - 2, y - 2, w + 4, 16);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(x, y, w, 12);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, ratio)), 12);
  ctx.fillStyle = '#e8f4fb';
  ctx.font = '12px sans-serif';
  ctx.fillText(`${label} ${valueText}`, x, y - 6);
}

export function drawHUD(ctx, g) {
  const h = g.hull;
  bar(ctx, 20, 34, 200, h.hp / TUNE.hpMax, h.hp < 30 ? '#ff6b5e' : '#5fd08a', '船体耐久', Math.ceil(h.hp));
  bar(ctx, 20, 70, 200, h.battery / TUNE.batteryMax, h.battery < 35 ? '#ffd76b' : '#6bb6ff', '电池', Math.ceil(h.battery));
  bar(ctx, 20, 106, 200, h.oxygen / TUNE.oxygenMax, h.oxygen < 28 ? '#ff8a5c' : '#8be0ff', '氧气', Math.ceil(h.oxygen));
  ctx.fillStyle = '#e8f4fb';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText(`样本舱 ${g.collected}/${g.samples.length}`, 250, 28);
  ctx.font = '13px sans-serif';
  ctx.fillText(`时间 ${g.time.toFixed(1)}s`, 250, 48);
  if (h.battery <= 0) {
    ctx.fillStyle = '#ffd76b';
    ctx.fillText('⚠ 电池耗尽：推进与灯光失效', 250, 70);
  }
}

export function render(ctx, g, time) {
  const cam = cameraFor(g.hull);
  drawWater(ctx, cam, time);
  drawRocks(ctx, cam);
  drawEntrance(ctx, cam);
  drawSamples(ctx, cam, g.samples, time);
  drawParticles(ctx, cam, g.particles);
  drawHull(ctx, cam, g);
  drawVignette(ctx, g);
  drawHUD(ctx, g);
}
