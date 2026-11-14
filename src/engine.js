// 《双舵沉箱》纯逻辑引擎：可在浏览器与 Node 中运行，不依赖 DOM。
// 固定步长推进，所有手感参数集中在 TUNE 中便于调试。

export const WORLD = { w: 1500, h: 1200 };

export const TUNE = {
  hullW: 46,
  hullH: 30,
  mainAccel: 380, // W/S 前后主推
  reverseAccel: 270,
  jetAccel: 250, // A/D 左右喷口（较弱，体现两套系统分工）
  buoyAccel: 320, // 方向键浮力泵
  passiveSink: 30, // 无人调浮力时持续下沉，单人无法长期驾驶
  drag: 0.62, // 线性水阻，越小惯性越明显
  quadDrag: 0.0016,
  maxVx: 340,
  maxVy: 300,
  hitSpeed: 95, // 低于该碰撞速度只刮蹭不掉血
  hitDamage: 0.17,
  hitMax: 26,
  hitCooldown: 0.12,
  hpMax: 100,
  batteryMax: 220,
  oxygenMax: 100,
  lightDrain: 0.18,
  mainDrain: 2.2,
  jetDrain: 1.5,
  pumpDrain: 1.2,
  oxygenDrain: 0.9,
  sampleOxygenBonus: 12,
  pickupRadius: 36,
  dockSpeed: 150,
};

// 手工地图：实心矩形即岩体，其余为海水。
// 狭窄竖井 x[760,840]，横洞 y[836,900]，B 舱内两块岩台。
export const MAP = {
  solids: [
    { x: 0, y: 0, w: 1500, h: 24, name: 'top' },
    { x: 0, y: 1176, w: 1500, h: 24, name: 'bottom' },
    { x: 0, y: 0, w: 24, h: 1200, name: 'left' },
    { x: 1476, y: 0, w: 24, h: 1200, name: 'right' },
    // A 舱（入口舱）
    { x: 24, y: 330, w: 672, h: 40, name: 'floorA' },
    { x: 696, y: 24, w: 64, h: 180, name: 'shaftLTop' },
    { x: 696, y: 264, w: 64, h: 636, name: 'shaftLBottom' },
    // 竖井右壁，在横洞高度留口
    { x: 840, y: 140, w: 64, h: 696, name: 'shaftR' },
    // 横洞 B
    { x: 840, y: 796, w: 224, h: 40, name: 'tunnelCeil' },
    { x: 840, y: 900, w: 224, h: 40, name: 'tunnelFloor' },
    // B 舱左壁，横洞高度留口
    { x: 1000, y: 330, w: 64, h: 506, name: 'chamberBLeftTop' },
    { x: 1000, y: 900, w: 64, h: 276, name: 'chamberBLeftBottom' },
    // 横洞下方基岩填平
    { x: 696, y: 940, w: 304, h: 236, name: 'bedrock' },
    // B 舱内两块岩台
    { x: 1180, y: 520, w: 150, h: 34, name: 'ledgeUpper' },
    { x: 1150, y: 760, w: 170, h: 34, name: 'ledgeLower' },
  ],
  entrance: { x: 36, y: 30, w: 124, h: 66 },
  spawn: { x: 98, y: 112 },
  shaft: { x: 760, y: 140, w: 80, h: 760 },
  samples: [
    { id: 0, x: 420, y: 314, r: 12 },
    { id: 1, x: 1255, y: 504, r: 12 },
    { id: 2, x: 1235, y: 744, r: 12 },
  ],
};

export function createGame() {
  return {
    state: 'ready', // ready | playing | paused | won | lost
    loseReason: null,
    time: 0,
    hull: {
      x: MAP.spawn.x,
      y: MAP.spawn.y,
      vx: 0,
      vy: 0,
      angle: 0,
      hp: TUNE.hpMax,
      battery: TUNE.batteryMax,
      oxygen: TUNE.oxygenMax,
      hitFlash: 0,
      hitCooldown: 0,
    },
    samples: MAP.samples.map((s) => ({ ...s, taken: false })),
    collected: 0,
    particles: [],
    // 当前各系统功率（供渲染与音频使用）
    power: { main: 0, jet: 0, pumpUp: 0, pumpDown: 0 },
    events: [], // 每帧由宿主取出播放声音
    stats: { hits: 0, damageTaken: 0 },
  };
}

export function makeInput() {
  return {
    p1: { mainF: false, mainR: false, left: false, right: false },
    p2: { up: false, down: false },
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function overlap(x, y, w, h, r) {
  return x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y;
}

function pushEvent(g, type, intensity = 1) {
  g.events.push({ type, intensity });
}

function spawnParticle(g, kind, x, y, vx, vy, life) {
  if (g.particles.length > 260) g.particles.shift();
  g.particles.push({ kind, x, y, vx, vy, life, maxLife: life });
}

function resetIntoPlaying(g) {
  const fresh = createGame();
  // 原地重置，避免替换 hull/samples 等嵌套对象后调用方持有旧引用
  g.loseReason = fresh.loseReason;
  g.time = fresh.time;
  Object.assign(g.hull, fresh.hull);
  if (g.samples.length === fresh.samples.length) {
    g.samples.forEach((s, i) => Object.assign(s, fresh.samples[i]));
  } else {
    g.samples = fresh.samples;
  }
  g.collected = 0;
  g.particles.length = 0;
  Object.assign(g.power, fresh.power);
  g.events.length = 0;
  g.stats.hits = 0;
  g.stats.damageTaken = 0;
  g.state = 'playing';
  pushEvent(g, 'start');
}

export function startGame(g) {
  if (g.state === 'ready' || g.state === 'won' || g.state === 'lost') {
    resetIntoPlaying(g);
  } else if (g.state === 'paused') {
    g.state = 'playing';
  }
}

// 任意状态下的快速重开
export function restartGame(g) {
  resetIntoPlaying(g);
}

export function togglePause(g) {
  if (g.state === 'playing') g.state = 'paused';
  else if (g.state === 'paused') g.state = 'playing';
}

// 沿单轴移动并解决碰撞，返回该轴撞击速度
function moveAxis(g, h, dx, dy, axis) {
  h.x += dx;
  h.y += dy;
  const hw = TUNE.hullW / 2;
  const hh = TUNE.hullH / 2;
  let impact = 0;
  const moving = axis === 'x' ? dx !== 0 : dy !== 0;
  if (!moving) return 0;
  for (const solid of MAP.solids) {
    const box = { x: h.x - hw, y: h.y - hh, w: TUNE.hullW, h: TUNE.hullH };
    if (!overlap(box.x, box.y, box.w, box.h, solid)) continue;
    if (axis === 'x') {
      if (h.vx > 0) h.x = solid.x - hw - 0.01;
      else h.x = solid.x + solid.w + hw + 0.01;
      impact = Math.abs(h.vx);
      h.vx = 0;
    } else {
      if (h.vy > 0) h.y = solid.y - hh - 0.01;
      else h.y = solid.y + solid.h + hh + 0.01;
      impact = Math.abs(h.vy);
      h.vy = 0;
    }
  }
  return impact;
}

function registerHit(g, impact) {
  const h = g.hull;
  if (impact <= TUNE.hitSpeed || h.hitCooldown > 0) return;
  const dmg = Math.min(TUNE.hitMax, (impact - TUNE.hitSpeed) * TUNE.hitDamage);
  h.hp = Math.max(0, h.hp - dmg);
  h.hitFlash = 0.25;
  h.hitCooldown = TUNE.hitCooldown;
  g.stats.hits += 1;
  g.stats.damageTaken += dmg;
  pushEvent(g, 'hit', clamp(impact / TUNE.maxVx, 0.2, 1));
  for (let i = 0; i < 10; i++) {
    spawnParticle(
      g,
      'spark',
      h.x,
      h.y,
      (Math.random() - 0.5) * 260,
      (Math.random() - 0.5) * 260,
      0.4 + Math.random() * 0.3
    );
  }
}

function updateParticles(g, dt) {
  const ps = g.particles;
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    p.life -= dt;
    if (p.life <= 0) {
      ps.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += p.kind === 'bubble' ? -26 * dt : 18 * dt;
    p.vx *= 1 - 0.8 * dt;
  }
}

export function stepGame(g, input, dt) {
  if (g.state !== 'playing') return;
  dt = Math.min(dt, 1 / 30);
  g.time += dt;
  const h = g.hull;
  h.hitCooldown = Math.max(0, h.hitCooldown - dt);
  h.hitFlash = Math.max(0, h.hitFlash - dt);

  const powered = h.battery > 0;
  const p1 = input.p1;
  const p2 = input.p2;
  let ax = 0;
  let ay = TUNE.passiveSink; // 没人调浮力就慢慢沉，逼玩家二配合
  let main = 0;
  let jet = 0;
  let pumpUp = 0;
  let pumpDown = 0;
  let drain = TUNE.lightDrain; // 舱灯常亮耗电

  if (powered) {
    // 玩家一：W/S 主推（强、惯性大），A/D 侧向喷口（弱、便于微调）
    if (p1.mainF) {
      ax += TUNE.mainAccel;
      main = 1;
      drain += TUNE.mainDrain;
    }
    if (p1.mainR) {
      ax -= TUNE.reverseAccel;
      main = Math.max(main, 0.75);
      drain += TUNE.mainDrain;
    }
    if (p1.left) {
      ax -= TUNE.jetAccel;
      jet = 1;
      drain += TUNE.jetDrain;
    }
    if (p1.right) {
      ax += TUNE.jetAccel;
      jet = 1;
      drain += TUNE.jetDrain;
    }
    // 玩家二：方向键调浮力
    if (p2.up) {
      ay -= TUNE.buoyAccel + TUNE.passiveSink;
      pumpUp = 1;
      drain += TUNE.pumpDrain;
    }
    if (p2.down) {
      ay += TUNE.buoyAccel;
      pumpDown = 1;
      drain += TUNE.pumpDrain;
    }
  }
  g.power.main += (main - g.power.main) * Math.min(1, dt * 10);
  g.power.jet += (jet - g.power.jet) * Math.min(1, dt * 10);
  g.power.pumpUp += (pumpUp - g.power.pumpUp) * Math.min(1, dt * 10);
  g.power.pumpDown += (pumpDown - g.power.pumpDown) * Math.min(1, dt * 10);

  h.vx += ax * dt;
  h.vy += ay * dt;
  h.vx *= 1 - TUNE.drag * dt;
  h.vy *= 1 - TUNE.drag * dt;
  h.vx -= TUNE.quadDrag * h.vx * Math.abs(h.vx) * dt;
  h.vy -= TUNE.quadDrag * h.vy * Math.abs(h.vy) * dt;
  h.vx = clamp(h.vx, -TUNE.maxVx, TUNE.maxVx);
  h.vy = clamp(h.vy, -TUNE.maxVy, TUNE.maxVy);

  registerHit(g, moveAxis(g, h, h.vx * dt, 0, 'x'));
  registerHit(g, moveAxis(g, h, 0, h.vy * dt, 'y'));

  // 船体随横向速度轻微倾斜，纯视觉
  const targetAngle = clamp(h.vx / TUNE.maxVx, -1, 1) * 0.32;
  h.angle += (targetAngle - h.angle) * Math.min(1, dt * 6);

  emitThrustParticles(g, main, jet, pumpUp, pumpDown, dt);
  updateParticles(g, dt);

  // 资源消耗
  h.battery = Math.max(0, h.battery - drain * dt);
  h.oxygen = Math.max(0, h.oxygen - TUNE.oxygenDrain * dt);

  // 取样
  for (const s of g.samples) {
    if (s.taken) continue;
    if (Math.hypot(h.x - s.x, h.y - s.y) <= TUNE.pickupRadius) {
      s.taken = true;
      g.collected += 1;
      h.oxygen = Math.min(TUNE.oxygenMax, h.oxygen + TUNE.sampleOxygenBonus);
      pushEvent(g, 'pickup', g.collected / g.samples.length);
    }
  }

  // 回到入口且速度足够慢才算停靠
  const e = MAP.entrance;
  const inDock = overlap(h.x - TUNE.hullW / 2, h.y - TUNE.hullH / 2, TUNE.hullW, TUNE.hullH, e);
  if (g.collected === g.samples.length && inDock && Math.hypot(h.vx, h.vy) < TUNE.dockSpeed) {
    g.state = 'won';
    pushEvent(g, 'win');
    return;
  }

  if (h.hp <= 0) {
    g.state = 'lost';
    g.loseReason = 'hull';
    pushEvent(g, 'lose');
  } else if (h.oxygen <= 0) {
    g.state = 'lost';
    g.loseReason = 'oxygen';
    pushEvent(g, 'lose');
  }
}

function emitThrustParticles(g, main, jet, pumpUp, pumpDown, dt) {
  const h = g.hull;
  if (Math.random() < main * dt * 22) {
    spawnParticle(g, 'thrust', h.x - TUNE.hullW / 2, h.y + (Math.random() - 0.5) * 10, -160 - Math.random() * 80, (Math.random() - 0.5) * 40, 0.5);
  }
  if (Math.random() < jet * dt * 18) {
    const side = h.vx >= 0 ? -1 : 1;
    spawnParticle(g, 'bubble', h.x + side * TUNE.hullW / 2, h.y, side * (90 + Math.random() * 60), (Math.random() - 0.5) * 30, 0.6);
  }
  if (Math.random() < (pumpUp + pumpDown) * dt * 20) {
    spawnParticle(g, 'bubble', h.x + (Math.random() - 0.5) * 20, h.y - TUNE.hullH / 2, (Math.random() - 0.5) * 30, -70 - Math.random() * 50, 0.8);
  }
}
