'use strict';

const E = require('./engine');

function run(options = {}) {
  const game = E.createGame(20261114);
  game.status = 'running';
  const dt = 1 / 60;
  const controller = options.controller || (() => {});
  let guard = 0;
  while (game.status === 'running' && guard < 20000) {
    controller(game, dt);
    E.step(game, dt);
    guard += 1;
  }
  return game;
}

function fixedAim(aim, boost = false) {
  return (game) => {
    game.input.aim = aim;
    game.input.boost = boost;
  };
}

function trackNearest(boost = true) {
  return (game) => {
    let best = null;
    let bestD = Infinity;
    for (const ship of game.ships) {
      if (ship.status === 'waiting' || ship.status === 'rescued' || ship.status === 'wrecked') continue;
      const d = Math.hypot(ship.x - E.LIGHTHOUSE.x, ship.y - E.LIGHTHOUSE.y);
      if (d < bestD) { bestD = d; best = ship; }
    }
    if (best) {
      game.input.aim = Math.atan2(best.y - E.LIGHTHOUSE.y, best.x - E.LIGHTHOUSE.x);
      game.input.boost = boost && game.beam.energy > 25 && game.beam.heat < 80;
    }
  };
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

// 模拟熟练玩家：始终引导离港口最近的活动船只，遇礁石则沿弧线改道。
function rescueController() {
  let focusId = null;
  return (game) => {
    const active = game.ships
      .filter((s) => s.status === 'adrift' || s.status === 'lit');
    if (active.length === 0) return;
    const ranked = active
      .map((s) => ({ s, danger: dangerScore(s) }))
      .sort((a, b) => b.danger - a.danger);
    const current = ranked.find((r) => r.s.id === focusId);
    if (!current || ranked[0].danger > current.danger + 120 || current.danger < 60) {
      focusId = ranked[0].s.id;
    }
    const ship = active.find((s) => s.id === focusId);
    const portX = E.PORT.mouthX - 6;
    const portY = (E.PORT.yMin + E.PORT.yMax) / 2;
    let baseAng = Math.atan2(portY - ship.y, portX - ship.x);
    let chosen = baseAng;
    // 若直线路径上有障碍，逐步加大偏转角寻找干净航线。
    for (const mag of [0, 0.25, 0.5, 0.75, 1.0, 1.25]) {
      if (mag === 0) { chosen = baseAng; } else {
        const clearUp = testAngle(ship, baseAng + mag) && testAngle(ship, baseAng + mag * 0.5);
        const clearDown = testAngle(ship, baseAng - mag) && testAngle(ship, baseAng - mag * 0.5);
        chosen = baseAng + mag * (clearUp ? 1 : clearDown ? -1 : 1);
      }
      if (testAngle(ship, chosen)) break;
    }
    // 光斑沿期望航向放在船前方，再换算成相对灯塔的光束角度。
    const targetX = ship.x + Math.cos(chosen) * 220;
    const targetY = ship.y + Math.sin(chosen) * 220;
    game.input.aim = Math.atan2(targetY - E.LIGHTHOUSE.y, targetX - E.LIGHTHOUSE.x);
    game.input.spot = { x: targetX, y: targetY };
    game.input.boost = game.beam.energy > 30 && game.beam.heat < 78;
  };
}

function dangerScore(ship) {
  let score = 0;
  for (const reef of E.REEFS) {
    const d = Math.hypot(ship.x - reef.x, ship.y - reef.y) - reef.r;
    if (d < 170) score += (170 - d) * 1.5;
  }
  if (ship.x > E.WORLD.w - 240) score += (ship.x - (E.WORLD.w - 240)) * 2;
  if (ship.y < 170 || ship.y > E.WORLD.h - 170) score += 220;
  // 已经深入海湾、接近港口的船优先收尾。
  score += Math.max(0, 900 - ship.x) * 0.35;
  return score;
}

function testAngle(ship, ang) {
  const steps = 14;
  const span = 620;
  for (let i = 1; i <= steps; i += 1) {
    const d = (span * i) / steps;
    const x = ship.x + Math.cos(ang) * d;
    const y = ship.y + Math.sin(ang) * d;
    if (pointInObstacle(x, y, E.SHIP.hitR)) return false;
  }
  return true;
}

if (require.main === module) {
  // 观察：光束固定指向港口入口，看第一艘船的轨迹与结算。
  const portAim = Math.atan2(
    (E.PORT.yMin + E.PORT.yMax) / 2 - E.LIGHTHOUSE.y,
    E.PORT.mouthX + 40 - E.LIGHTHOUSE.x,
  );
  const game = run({ controller: rescueController() });
  console.log('end:', game.status, game.endReason, 't=', game.t.toFixed(1));
  for (const s of game.ships) {
    console.log(s.code, s.status, s.wreckReason || '',
      'pos=(', s.x.toFixed(0), s.y.toFixed(0), ')',
      'head=', s.heading.toFixed(2), 'lit=', s.lit, 'blackouts=', game.beam.blackoutCount);
  }
  console.log('energy=', game.beam.energy.toFixed(1), 'heat=', game.beam.heat.toFixed(1));
}

module.exports = { run, fixedAim, trackNearest, rescueController };
