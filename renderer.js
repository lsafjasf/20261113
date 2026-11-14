'use strict';

// Canvas 渲染层：只读取 engine 的状态做绘制，不修改任何模拟数据。

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RENDERER_GLOBAL = api;
})(typeof self !== 'undefined' ? self : this, function () {

const PALETTE = {
  deep0: '#071316',
  deep1: '#0c2226',
  deep2: '#10302f',
  land: '#0a1a18',
  landEdge: '#2a4a44',
  reef: '#101f1d',
  reefRing: 'rgba(180, 214, 205, 0.28)',
  gold: '#f2cf8d',
  goldBright: '#ffe6b0',
  beam: 'rgba(242, 207, 141, 0.16)',
  beamCore: 'rgba(255, 232, 178, 0.34)',
  hull: '#2b3136',
  hullLight: '#8d9aa0',
  danger: '#e0685a',
  teal: '#8fd0c2',
};

function makeRain(rand, count) {
  const drops = [];
  for (let i = 0; i < count; i += 1) {
    drops.push({
      x: rand() * 1600,
      y: rand() * 900,
      len: 9 + rand() * 16,
      speed: 520 + rand() * 360,
      drift: -120 - rand() * 80,
      alpha: 0.08 + rand() * 0.22,
    });
  }
  return drops;
}

function createRenderer() {
  return { rain: makeRain(Math.random, 240), time: 0 };
}

function render(ctx, E, game, view) {
  const r = view.renderer;
  r.time += view.dt;
  drawWater(ctx, r);
  drawLand(ctx, E);
  drawReefs(ctx, E);
  drawChannel(ctx, E);
  drawBeam(ctx, E, game);
  drawTrails(ctx, game);
  drawLighthouse(ctx, E, game, r);
  drawShips(ctx, E, game);
  drawSpray(ctx, E, game, r);
  drawRain(ctx, r, view.dt);
}

function drawWater(ctx, r) {
  const g = ctx.createLinearGradient(0, 0, 1600, 900);
  g.addColorStop(0, PALETTE.deep0);
  g.addColorStop(0.55, PALETTE.deep1);
  g.addColorStop(1, PALETTE.deep2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1600, 900);
  ctx.strokeStyle = 'rgba(143, 208, 194, 0.05)';
  ctx.lineWidth = 1.5;
  for (let row = 0; row < 9; row += 1) {
    const y = 70 + row * 95;
    ctx.beginPath();
    for (let x = 0; x <= 1600; x += 40) {
      const yy = y + Math.sin(x * 0.012 + r.time * 0.6 + row) * 7;
      if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
}

function drawLand(ctx, E) {
  ctx.fillStyle = PALETTE.land;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(120, 0);
  ctx.lineTo(120, E.PORT.yMin - 30);
  ctx.lineTo(240, E.PORT.yMin - 18);
  ctx.lineTo(240, E.PORT.yMax + 18);
  ctx.lineTo(120, E.PORT.yMax + 30);
  ctx.lineTo(120, 900);
  ctx.lineTo(0, 900);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = PALETTE.landEdge;
  ctx.lineWidth = 2;
  ctx.stroke();

  for (const dock of E.PORT.docks) {
    ctx.fillStyle = '#1a2c29';
    ctx.fillRect(dock.x, dock.y, dock.w, dock.h);
    ctx.strokeStyle = 'rgba(242, 207, 141, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(dock.x, dock.y, dock.w, dock.h);
    for (let i = 0; i < 5; i += 1) {
      ctx.fillStyle = i % 2 ? '#6e8a83' : '#b98f5e';
      ctx.fillRect(dock.x + 12 + i * 30, dock.y + 6, 18, 8);
    }
  }
}

function drawReefs(ctx, E) {
  for (const reef of E.REEFS) {
    ctx.beginPath();
    ctx.arc(reef.x, reef.y, reef.r + 16, 0, Math.PI * 2);
    ctx.strokeStyle = PALETTE.reefRing;
    ctx.setLineDash([5, 7]);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    const points = 9;
    for (let i = 0; i <= points; i += 1) {
      const a = (i / points) * Math.PI * 2;
      const wobble = reef.r * (0.82 + 0.18 * Math.sin(i * 2.3 + reef.x));
      const x = reef.x + Math.cos(a) * wobble;
      const y = reef.y + Math.sin(a) * wobble;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = PALETTE.reef;
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 150, 140, 0.35)';
    ctx.stroke();
  }
}

function drawChannel(ctx, E) {
  const cy = (E.PORT.yMin + E.PORT.yMax) / 2;
  ctx.save();
  ctx.strokeStyle = 'rgba(143, 208, 194, 0.16)';
  ctx.setLineDash([3, 12]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(E.PORT.mouthX, cy);
  ctx.lineTo(1560, cy);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(143, 208, 194, 0.5)';
  ctx.font = '13px ui-monospace, monospace';
  ctx.fillText('PORT ENTRANCE · 港口入口', E.PORT.mouthX + 26, E.PORT.yMin + 30);
  ctx.restore();
}

function beamState(E, game) {
  const beam = game.beam;
  if (!beam.on || beam.blackout) return null;
  const range = beam.boost ? E.BEAM.boostRange : E.BEAM.range;
  const half = beam.boost ? E.BEAM.boostHalfAngle : E.BEAM.halfAngle;
  return { range, half, alpha: (beam.boost ? 1.25 : 1) * (beam.flicker || 1) };
}

function drawBeam(ctx, E, game) {
  const spec = beamState(E, game);
  if (!spec) return;
  const { x, y } = E.LIGHTHOUSE;
  const aim = game.beam.aim;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const grad = ctx.createRadialGradient(x, y, 20, x, y, spec.range);
  grad.addColorStop(0, `rgba(255, 232, 178, ${0.22 * spec.alpha})`);
  grad.addColorStop(0.4, `rgba(242, 207, 141, ${0.1 * spec.alpha})`);
  grad.addColorStop(1, 'rgba(242, 207, 141, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, spec.range, aim - spec.half, aim + spec.half);
  ctx.closePath();
  ctx.fill();
  // 光束中心线
  ctx.strokeStyle = `rgba(255, 232, 178, ${0.18 * spec.alpha})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(aim) * spec.range, y + Math.sin(aim) * spec.range);
  ctx.stroke();
  ctx.restore();
}

function drawTrails(ctx, game) {
  for (const ship of game.ships) {
    if (ship.trail.length < 2) continue;
    ctx.save();
    for (let i = 1; i < ship.trail.length; i += 1) {
      const p0 = ship.trail[i - 1];
      const p1 = ship.trail[i];
      ctx.strokeStyle = p1.lit ? 'rgba(242, 207, 141, 0.22)' : 'rgba(143, 208, 194, 0.12)';
      ctx.lineWidth = p1.lit ? 2 : 1.2;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawLighthouse(ctx, E, game, r) {
  const { x, y, islandR } = E.LIGHTHOUSE;
  ctx.fillStyle = PALETTE.reef;
  ctx.beginPath();
  ctx.arc(x, y, islandR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120, 150, 140, 0.4)';
  ctx.stroke();
  // 塔身
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#d9c6a3';
  ctx.beginPath();
  ctx.moveTo(-9, 18);
  ctx.lineTo(-6, -14);
  ctx.lineTo(6, -14);
  ctx.lineTo(9, 18);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#8a6a45';
  ctx.fillRect(-8, -2, 16, 5);
  ctx.fillRect(-7, 8, 14, 4);
  const lit = game.beam.on && !game.beam.blackout;
  const glow = lit ? (0.7 + 0.3 * Math.sin(r.time * 6)) * (game.beam.flicker || 1) : 0.12;
  ctx.fillStyle = lit ? PALETTE.goldBright : '#5a5548';
  ctx.beginPath();
  ctx.arc(0, -20, 6, 0, Math.PI * 2);
  ctx.fill();
  if (lit) {
    ctx.globalCompositeOperation = 'lighter';
    const rg = ctx.createRadialGradient(0, -20, 2, 0, -20, 46);
    rg.addColorStop(0, `rgba(255, 230, 170, ${0.8 * glow})`);
    rg.addColorStop(1, 'rgba(255, 230, 170, 0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(0, -20, 46, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawShips(ctx, E, game) {
  for (const ship of game.ships) {
    if (ship.status === 'waiting') continue;
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.heading);
    if (ship.status === 'wrecked') {
      ctx.globalAlpha = 0.55;
    }
    // 船体：船头朝 +x
    ctx.fillStyle = ship.lit ? '#3a444b' : PALETTE.hull;
    ctx.beginPath();
    ctx.moveTo(17, 0);
    ctx.lineTo(8, -7);
    ctx.lineTo(-13, -7);
    ctx.lineTo(-16, 0);
    ctx.lineTo(-13, 7);
    ctx.lineTo(8, 7);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = PALETTE.hullLight;
    ctx.lineWidth = 1;
    ctx.stroke();
    // 货舱与桅灯
    ctx.fillStyle = '#b98f5e';
    ctx.fillRect(-8, -4, 10, 8);
    ctx.fillStyle = ship.lit ? PALETTE.goldBright : '#c96a5a';
    ctx.beginPath();
    ctx.arc(10, 0, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 状态标签
    ctx.font = '11px ui-monospace, monospace';
    if (ship.status === 'wrecked') {
      ctx.fillStyle = PALETTE.danger;
      ctx.fillText('✕ ' + ship.code, ship.x - 16, ship.y - 22);
    } else if (ship.lit) {
      ctx.fillStyle = PALETTE.gold;
      ctx.fillText('◈ ' + ship.code, ship.x - 16, ship.y - 22);
    }
  }
}

function drawSpray(ctx, E, game, r) {
  for (const reef of E.REEFS) {
    const n = 5;
    for (let i = 0; i < n; i += 1) {
      const a = r.time * 0.8 + i * ((Math.PI * 2) / n) + reef.x;
      const rr = reef.r + 6 + 4 * Math.sin(r.time * 2 + i);
      const x = reef.x + Math.cos(a) * rr;
      const y = reef.y + Math.sin(a) * rr;
      ctx.fillStyle = 'rgba(200, 226, 220, 0.18)';
      ctx.beginPath();
      ctx.arc(x, y, 1.6 + (i % 2), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (const ship of game.ships) {
    if (ship.status !== 'adrift' && ship.status !== 'lit') continue;
    const bx = ship.x - Math.cos(ship.heading) * 15;
    const by = ship.y - Math.sin(ship.heading) * 15;
    ctx.fillStyle = 'rgba(200, 226, 220, 0.15)';
    ctx.beginPath();
    ctx.arc(bx, by, 3 + Math.sin(r.time * 5 + ship.id) * 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRain(ctx, r, dt) {
  ctx.save();
  ctx.strokeStyle = 'rgba(170, 205, 210, 0.35)';
  ctx.lineWidth = 1;
  for (const drop of r.rain) {
    drop.y += drop.speed * dt;
    drop.x += drop.drift * dt;
    if (drop.y > 900) { drop.y = -20; drop.x = Math.random() * 1600; }
    if (drop.x < 0) drop.x = 1600;
    ctx.globalAlpha = drop.alpha;
    ctx.beginPath();
    ctx.moveTo(drop.x, drop.y);
    ctx.lineTo(drop.x + drop.drift * 0.03, drop.y - drop.len);
    ctx.stroke();
  }
  ctx.restore();
}

  return {
    createRenderer, render, PALETTE, makeRain, beamState,
    drawBeam, drawShips, drawRain, drawLighthouse,
  };
});
