'use strict';

// 《最后一盏灯》核心模拟：固定地图、船只漂移、光束牵引、发电机与结算。
// 不依赖 DOM / Canvas，可在 Node 中直接无头运行，便于自动化验证。

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ENGINE_GLOBAL = api;
})(typeof self !== 'undefined' ? self : this, function () {

const WORLD = { w: 1600, h: 900 };
const DURATION = 90;
const RESCUE_GOAL = 4;
const WRECK_LIMIT = 2;
const BLACKOUT_LIMIT = 3;

const LIGHTHOUSE = { x: 200, y: 540, islandR: 62 };

// 港口入口：越过入口线且位于两码头之间即获救，否则撞上左侧岸线。
const PORT = {
  mouthX: 300,
  yMin: 380,
  yMax: 650,
  docks: [
    { x: 315, y: 335, w: 165, h: 26 },
    { x: 330, y: 662, w: 165, h: 26 },
  ],
};

// 固定俯视海湾地图上的礁石（圆形碰撞）。
const REEFS = [
  // 礁群之间留出两条可被光束牵引通过的航道缝隙。
  { x: 700, y: 150, r: 62 },
  { x: 940, y: 250, r: 56 },
  { x: 1130, y: 168, r: 48 },
  { x: 720, y: 848, r: 56 },
  { x: 1180, y: 800, r: 42 },
];

const BEAM = {
  range: 1360,
  halfAngle: 0.14,
  boostRange: 1500,
  boostHalfAngle: 0.19,
  steer: 0.85,
  boostSteer: 1.35,
};

const SHIP_SPEC = [
  { x: 1432, y: 262, spawnT: 0, heading: 3.05, code: 'N-2' },
  { x: 1472, y: 372, spawnT: 6, heading: 3.25, code: 'P-03' },
  { x: 1422, y: 478, spawnT: 13, heading: 2.98, code: 'F-12' },
  { x: 1462, y: 648, spawnT: 20, heading: 3.35, code: 'W-07' },
  { x: 1392, y: 762, spawnT: 27, heading: 2.9, code: 'S-4' },
];

const WIND = { angle: Math.PI + 0.28, accel: 9 };
const SHIP = {
  len: 30,
  width: 12,
  hitR: 12,
  baseSpeed: 46,
  engineAcc: 48,
  drag: 0.85,
  freeTurn: 0.07,
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createShip(spec, index) {
  return {
    id: index,
    code: spec.code,
    x: spec.x,
    y: spec.y,
    vx: Math.cos(spec.heading) * SHIP.baseSpeed,
    vy: Math.sin(spec.heading) * SHIP.baseSpeed,
    heading: spec.heading,
    spawnT: spec.spawnT,
    status: 'waiting',
    lit: false,
    wreckReason: null,
    trail: [],
    gustPhase: index * 1.7 + 0.4,
  };
}

function createGame(seed) {
  const rand = mulberry32(seed === undefined ? 20261114 : seed);
  return {
    t: 0,
    timeLeft: DURATION,
    status: 'ready',
    endReason: null,
    rand,
    ships: SHIP_SPEC.map(createShip),
    beam: {
      aim: -0.35,
      on: true,
      boost: false,
      blackout: false,
      blackoutCount: 0,
      energy: 100,
      heat: 0,
      flicker: 1,
    },
    stats: { rescued: 0, wrecked: 0, litTime: 0, boostTime: 0 },
    events: [],
    input: { aim: -0.35, boost: false, spot: null },
  };
}

function emit(game, type, data) {
  game.events.push(Object.assign({ t: game.t, type }, data || {}));
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function circleHit(x, y, r, target) {
  const dx = x - target.x;
  const dy = y - target.y;
  const rr = r + target.r;
  return dx * dx + dy * dy <= rr * rr;
}

function rectHit(x, y, r, rect) {
  const nx = clamp(x, rect.x, rect.x + rect.w);
  const ny = clamp(y, rect.y, rect.y + rect.h);
  const dx = x - nx;
  const dy = y - ny;
  return dx * dx + dy * dy <= r * r;
}

// 光束是否罩住某艘船：距离与角度都在锥体内（灯塔岛本身不挡光）。
function beamHit(game, ship) {
  const beam = game.beam;
  if (!beam.on || beam.blackout) return null;
  const dx = ship.x - LIGHTHOUSE.x;
  const dy = ship.y - LIGHTHOUSE.y;
  const dist = Math.hypot(dx, dy);
  const range = beam.boost ? BEAM.boostRange : BEAM.range;
  if (dist > range) return null;
  const ang = Math.atan2(dy, dx);
  const half = beam.boost ? BEAM.boostHalfAngle : BEAM.halfAngle;
  if (Math.abs(angleDiff(ang, beam.aim)) > half) return null;
  // 光斑落在光束射线上；目标点（一般是船前方的引导点）决定它的距离。
  const target = game.input.spot || {};
  let spotDist;
  if (target.x !== undefined) {
    const tx = target.x - LIGHTHOUSE.x;
    const ty = target.y - LIGHTHOUSE.y;
    spotDist = clamp(tx * Math.cos(beam.aim) + ty * Math.sin(beam.aim), 120, range - 30);
  } else {
    spotDist = range * 0.62;
  }
  return {
    dist,
    angle: ang,
    spotX: LIGHTHOUSE.x + Math.cos(beam.aim) * spotDist,
    spotY: LIGHTHOUSE.y + Math.sin(beam.aim) * spotDist,
  };
}

function moveShip(game, ship, dt) {
  const headingVec = { x: Math.cos(ship.heading), y: Math.sin(ship.heading) };
  const windAcc = WIND.accel * (1 + 0.28 * Math.sin(game.t * 0.9 + ship.gustPhase));
  let ax = headingVec.x * SHIP.engineAcc + Math.cos(WIND.angle) * windAcc;
  let ay = headingVec.y * SHIP.engineAcc + Math.sin(WIND.angle) * windAcc;
  ship.vx += ax * dt;
  ship.vy += ay * dt;
  const damp = Math.pow(SHIP.drag, dt);
  ship.vx *= damp;
  ship.vy *= damp;

  const hit = beamHit(game, ship);
  ship.lit = Boolean(hit);
  if (hit) {
    ship.status = 'lit';
    // 受光时航向朝光斑中心缓慢修正，增强亮度下修正更快。
    const desired = Math.atan2(hit.spotY - ship.y, hit.spotX - ship.x);
    const rate = game.beam.boost ? BEAM.boostSteer : BEAM.steer;
    ship.heading += clamp(angleDiff(desired, ship.heading), -rate * dt, rate * dt);
  } else if (ship.status === 'lit') {
    ship.status = 'adrift';
  } else {
    ship.status = 'adrift';
    // 离开光束后在侧风中缓慢偏航，保留惯性。
    ship.heading += SHIP.freeTurn * Math.sin(game.t * 0.5 + ship.gustPhase) * dt;
  }

  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;
  // 海湾岸线软约束：贴近上、下、右岸时被岸流推回，避免无操作即快速失事。
  const margin = 70;
  if (ship.y < margin) ship.vy += (margin - ship.y) * 8 * dt;
  if (ship.y > WORLD.h - margin) ship.vy -= (ship.y - (WORLD.h - margin)) * 8 * dt;
  if (ship.x > WORLD.w - margin) ship.vx -= (ship.x - (WORLD.w - margin)) * 8 * dt;
  ship.trail.push({ x: ship.x, y: ship.y, lit: ship.lit });
  if (ship.trail.length > 90) ship.trail.shift();
}

function checkCollisions(game, ship) {
  const r = SHIP.hitR;
  for (const reef of REEFS) {
    if (circleHit(ship.x, ship.y, r, reef)) return 'reef';
  }
  if (circleHit(ship.x, ship.y, r, { x: LIGHTHOUSE.x, y: LIGHTHOUSE.y, r: LIGHTHOUSE.islandR })) {
    return 'shore';
  }
  for (const dock of PORT.docks) {
    if (rectHit(ship.x, ship.y, r, dock)) return 'shore';
  }
  return null;
}

function settleShip(game, ship) {
  const r = SHIP.hitR;
  // 越过港口入口线：夹在两码头之间即入港获救，否则撞西岸。
  if (ship.x - r <= PORT.mouthX) {
    if (ship.y > PORT.yMin && ship.y < PORT.yMax) {
      ship.status = 'rescued';
      game.stats.rescued += 1;
      emit(game, 'rescued', { id: ship.id, code: ship.code });
      return;
    }
    ship.status = 'wrecked';
    ship.wreckReason = 'shore';
    game.stats.wrecked += 1;
    emit(game, 'wrecked', { id: ship.id, code: ship.code, reason: 'shore' });
    return;
  }
  // 从其他三条边漂出海湾，同样算触礁失事。
  if (ship.x + r >= WORLD.w || ship.y - r <= 0 || ship.y + r >= WORLD.h) {
    ship.status = 'wrecked';
    ship.wreckReason = 'edge';
    game.stats.wrecked += 1;
    emit(game, 'wrecked', { id: ship.id, code: ship.code, reason: 'edge' });
    return;
  }
  const hit = checkCollisions(game, ship);
  if (hit) {
    ship.status = 'wrecked';
    ship.wreckReason = hit;
    game.stats.wrecked += 1;
    emit(game, 'wrecked', { id: ship.id, code: ship.code, reason: hit });
  }
}

function updateGenerator(game, dt, litShips) {
  const beam = game.beam;
  if (beam.blackout) {
    beam.energy += 13 * dt;
    beam.heat = Math.max(0, beam.heat - 26 * dt);
    if (beam.heat <= 42 && beam.energy >= 32) {
      beam.blackout = false;
      beam.on = true;
      emit(game, 'relight');
    }
    beam.energy = clamp(beam.energy, 0, 100);
    return;
  }

  const activeShips = game.ships.some((s) => s.status === 'adrift' || s.status === 'lit');
  const boost = beam.boost && beam.energy > 0 && activeShips;
  if (!activeShips) {
    // 湾内已无待救船只，发电机进入怠速，只缓慢回充。
    beam.energy = clamp(beam.energy + 5 * dt, 0, 100);
    beam.heat = Math.max(0, beam.heat - 9 * dt);
    beam.on = true;
    return;
  }
  const drain = boost ? 11 : 3.4;
  beam.energy = clamp(beam.energy - drain * dt + (boost ? 0 : 3.2 * dt), 0, 100);
  if (boost) {
    beam.heat = clamp(beam.heat + 16 * dt, 0, 100);
    game.stats.boostTime += dt;
  } else {
    beam.heat = Math.max(0, beam.heat - 9 * dt);
  }
  if (litShips > 0) game.stats.litTime += dt;

  if (beam.energy <= 0 || beam.heat >= 100) {
    beam.blackout = true;
    beam.blackoutCount += 1;
    beam.on = false;
    emit(game, 'blackout', { count: beam.blackoutCount, cause: beam.heat >= 100 ? 'heat' : 'energy' });
  } else {
    beam.on = true;
  }
  // 灯丝在高温/低电量下轻微抖动，供渲染层使用。
  const pressure = clamp(beam.heat / 100, 0, 1) + clamp(1 - beam.energy / 25, 0, 1);
  beam.flicker = 1 - 0.18 * clamp(pressure, 0, 1) * (0.5 + 0.5 * game.rand());
}

function endGame(game, reason) {
  game.status = reason === 'goal' ? 'won' : 'lost';
  game.endReason = reason;
  emit(game, 'end', { reason, rescued: game.stats.rescued, wrecked: game.stats.wrecked });
}

function step(game, dt) {
  if (game.status !== 'running') return game;
  dt = Math.min(dt, 0.05);
  game.t += dt;
  game.timeLeft = Math.max(0, DURATION - game.t);

  game.beam.aim = game.input.aim;
  game.beam.boost = Boolean(game.input.boost);

  let litShips = 0;
  for (const ship of game.ships) {
    if (ship.status === 'waiting') {
      if (game.t >= ship.spawnT) ship.status = 'adrift';
      else continue;
    }
    if (ship.status === 'rescued' || ship.status === 'wrecked') continue;
    moveShip(game, ship, dt);
    if (ship.lit) litShips += 1;
    settleShip(game, ship);
  }

  updateGenerator(game, dt, litShips);

  if (game.stats.wrecked >= WRECK_LIMIT) return endGame(game, 'wreck'), game;
  if (game.beam.blackoutCount >= BLACKOUT_LIMIT) return endGame(game, 'blackout'), game;
  if (game.stats.rescued >= RESCUE_GOAL) return endGame(game, 'goal'), game;
  if (game.timeLeft <= 0) return endGame(game, 'timeout'), game;
  return game;
}

  return {
    WORLD, DURATION, RESCUE_GOAL, WRECK_LIMIT, BLACKOUT_LIMIT,
    LIGHTHOUSE, PORT, REEFS, BEAM, WIND, SHIP, SHIP_SPEC,
    createGame, emit, mulberry32,
    angleDiff, clamp, beamHit, moveShip, checkCollisions, circleHit, rectHit,
    settleShip, updateGenerator, step,
  };
});
