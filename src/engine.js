import {
  AZ_START,
  AZ_TOLERANCE,
  BAND_COUNT,
  BATTERY_START,
  DISH_SPEED,
  DRAIN_BASE,
  DRAIN_GAIN_COEF,
  EL_START,
  EL_TOLERANCE,
  FIXED_SEED,
  GAIN_MAX,
  GAIN_MIN,
  GAIN_SPEED,
  GAIN_START,
  GUST_CHANCE,
  GUST_DECAY,
  LOCK_COOLDOWN,
  LOCK_HOLD_SECONDS,
  MISSION_SECONDS,
  REAL_TARGET_COUNT,
  STORM_MAX,
  STORM_RAMP,
  STORM_START,
  WIND_PEAK_SPEED,
  WRONG_LIMIT,
  angleDelta,
  angleDistance,
  clamp,
  wrapAz,
} from './constants.js';
import { makeRng } from './rng.js';
import { blinkState, generateSignals } from './signals.js';

export const INPUT_KEYS = [
  'azLeft',
  'azRight',
  'gainUp',
  'gainDown',
  'elUp',
  'elDown',
];

export function createGame(options = {}) {
  const seed = options.seed ?? FIXED_SEED;
  const signals = generateSignals(seed);
  return {
    seed,
    debug: Boolean(options.debug),
    mode: 'play',
    failReason: null,
    t: 0,
    timeLeft: MISSION_SECONDS,
    az: AZ_START,
    el: EL_START,
    gain: GAIN_START,
    band: 0,
    battery: BATTERY_START,
    noise: 0,
    storm: {
      strength: STORM_START,
      gustAz: 0,
      gustEl: 0,
      gustTimer: 0.5,
      warning: null,
      warningCooldown: 0,
      azWind: 0,
      elWind: 0,
    },
    lock: {
      candidateId: null,
      hold: 0,
      cooldown: 0,
      aligned: false,
    },
    lockCount: 0,
    wrongCount: 0,
    coopCount: 0,
    wasAligned: false,
    signals,
    input: Object.fromEntries(INPUT_KEYS.map((k) => [k, false])),
    rng: makeRng(seed ^ 0x9e3779b9),
    events: [],
  };
}

export function setInput(state, key, pressed) {
  if (key in state.input) state.input[key] = Boolean(pressed);
}

export function clearInput(state) {
  for (const key of INPUT_KEYS) state.input[key] = false;
}

// 频段切换为边沿触发
export function shiftBand(state, dir) {
  if (state.mode !== 'play') return;
  state.band = (state.band + dir + BAND_COUNT) % BAND_COUNT;
  state.events.push({ type: 'band', text: `滤波频段切换至 ${state.band}`, tone: 'info' });
}

function updateStorm(state, dt) {
  const storm = state.storm;
  storm.strength = clamp(
    STORM_START + STORM_RAMP * state.t,
    0,
    STORM_MAX,
  );
  storm.warningCooldown = Math.max(0, storm.warningCooldown - dt);

  // 阵风按固定节奏判定，随机方向，需两侧同时纠正
  storm.gustTimer -= dt;
  if (storm.gustTimer <= 0) {
    storm.gustTimer = 0.5;
    if (state.rng.next() < GUST_CHANCE) {
      const power = state.rng.range(0.5, 1);
      storm.gustAz = state.rng.next() < 0.5 ? -power : power;
      storm.gustEl = state.rng.next() < 0.5 ? -power : power;
      const azArrow = storm.gustAz > 0 ? 'AZ +' : 'AZ –';
      const elArrow = storm.gustEl > 0 ? 'EL +' : 'EL –';
      storm.warning = `${azArrow} / ${elArrow}，两侧同时纠正。`;
      state.events.push({ type: 'gust', text: `阵风预警：${storm.warning}`, tone: 'warn' });
      storm.warningCooldown = 2.5;
    }
  }
  storm.gustAz *= Math.exp(-GUST_DECAY * dt);
  storm.gustEl *= Math.exp(-GUST_DECAY * dt);
  if (Math.abs(storm.gustAz) < 0.01) storm.gustAz = 0;
  if (Math.abs(storm.gustEl) < 0.01) storm.gustEl = 0;
  if (storm.warningCooldown <= 0) storm.warning = null;

  // 持续缓慢推力（环形方位在四个时段换方向，仰角恒向低角度推）
  const driftDir =
    Math.floor(state.t / 28) % 2 === 0 ? 1 : -1;
  storm.azWind =
    WIND_PEAK_SPEED * storm.strength * 0.45 * driftDir +
    WIND_PEAK_SPEED * storm.gustAz * 0.75;
  storm.elWind =
    -WIND_PEAK_SPEED * storm.strength * 0.42 +
    WIND_PEAK_SPEED * storm.gustEl * 0.75;
}

function updateMovement(state, dt) {
  const input = state.input;
  const azCmd =
    (input.azRight ? 1 : 0) - (input.azLeft ? 1 : 0);
  const elCmd = (input.elUp ? 1 : 0) - (input.elDown ? 1 : 0);
  const gainCmd =
    (input.gainUp ? 1 : 0) - (input.gainDown ? 1 : 0);
  const windScale = state._windPaused ? 0 : 1;

  state.az = wrapAz(
    state.az + (azCmd * DISH_SPEED + state.storm.azWind * windScale) * dt,
  );
  state.el = clamp(
    state.el + (elCmd * DISH_SPEED + state.storm.elWind * windScale) * dt,
    0,
    90,
  );
  state.gain = clamp(
    state.gain + gainCmd * GAIN_SPEED * dt,
    GAIN_MIN,
    GAIN_MAX,
  );

  // 噪声随增益上升（高增益放大底噪）
  state.noise = clamp((state.gain - GAIN_MIN) / (GAIN_MAX - GAIN_MIN), 0, 1);

  // 耗电随增益二次放大
  const gainRatio = state.gain / 100;
  const drain =
    DRAIN_BASE + DRAIN_GAIN_COEF * state.gain * gainRatio * 100;
  state.battery = Math.max(0, state.battery - drain * dt);
}

// 当前镜位下可被判定的候选：未锁定、正在闪烁、增益足够、频段一致、双轴都在容差内
export function candidateAt(state, t = state.t) {
  let best = null;
  let bestScore = Infinity;
  for (const signal of state.signals) {
    if (signal.locked) continue;
    const blink = blinkState(signal, t);
    if (!blink.active) continue;
    if (state.gain < signal.requiredGain) continue;
    if (signal.band !== state.band) continue;
    const azErr = angleDistance(state.az, signal.az);
    const elErr = Math.abs(state.el - signal.el);
    if (azErr > AZ_TOLERANCE || elErr > EL_TOLERANCE) continue;
    const score = azErr + elErr;
    if (score < bestScore) {
      bestScore = score;
      best = { signal, azErr, elErr, blink };
    }
  }
  return best;
}

export function alignmentInfo(state) {
  // 不限频段与增益，用于界面显示当前镜位离最近信号的双轴偏差
  let best = null;
  let bestScore = Infinity;
  for (const signal of state.signals) {
    if (signal.locked) continue;
    const azErr = angleDistance(state.az, signal.az);
    const elErr = Math.abs(state.el - signal.el);
    const score = azErr + elErr;
    if (score < bestScore) {
      bestScore = score;
      best = { signal, azErr, elErr };
    }
  }
  if (!best) return null;
  return {
    ...best,
    azWithin: best.azErr <= AZ_TOLERANCE,
    elWithin: best.elErr <= EL_TOLERANCE,
    azDelta: angleDelta(state.az, best.signal.az),
  };
}

function updateLock(state, dt) {
  const lock = state.lock;
  lock.cooldown = Math.max(0, lock.cooldown - dt);
  const candidate = candidateAt(state);
  lock.aligned = Boolean(candidate);

  if (candidate && lock.cooldown <= 0) {
    if (lock.candidateId !== candidate.signal.id) {
      lock.candidateId = candidate.signal.id;
      lock.hold = 0;
    }
    lock.hold += dt;
    if (!state.wasAligned) {
      state.coopCount += 1;
      state.events.push({
        type: 'align',
        text: '双轴同时进入容差，开始保持。',
        tone: 'info',
      });
    }
    if (lock.hold >= LOCK_HOLD_SECONDS) {
      resolveLock(state, candidate.signal);
    }
  } else {
    // 偏离、信号熄灭或频段不匹配：保持计时中断并归零
    lock.candidateId = null;
    lock.hold = 0;
  }
  state.wasAligned = lock.aligned;
}

function resolveLock(state, signal) {
  signal.locked = true;
  state.lock.hold = 0;
  state.lock.candidateId = null;
  state.lock.cooldown = LOCK_COOLDOWN;

  if (signal.kind === 'real') {
    state.lockCount += 1;
    state.events.push({
      type: 'locked',
      text: `捕获确认：异常 0${state.lockCount} 已锁定。`,
      tone: 'good',
    });
    if (state.lockCount >= REAL_TARGET_COUNT) {
      state.mode = 'won';
      state.events.push({ type: 'win', text: '三个异常全部锁定。', tone: 'good' });
    }
  } else {
    state.wrongCount += 1;
    state.events.push({
      type: 'wrong',
      text: `错误锁定 ${state.wrongCount}/${WRONG_LIMIT}：这是单峰诱饵回波。`,
      tone: 'bad',
    });
    if (state.wrongCount >= WRONG_LIMIT) {
      state.mode = 'lost';
      state.failReason = 'wrong';
    }
  }
}

export function update(state, dtRaw) {
  if (state.mode !== 'play') return state.events;
  const dt = Math.min(dtRaw, 0.1);
  state.events = [];
  state.t += dt;
  state.timeLeft = Math.max(0, MISSION_SECONDS - state.t);

  if (!state._windPaused) updateStorm(state, dt);
  updateMovement(state, dt);
  updateLock(state, dt);

  if (state.battery <= 0 && state.mode === 'play') {
    state.mode = 'lost';
    state.failReason = 'battery';
    state.events.push({ type: 'fail', text: '电池耗尽，阵列断电。', tone: 'bad' });
  } else if (state.timeLeft <= 0 && state.mode === 'play') {
    state.mode = 'lost';
    state.failReason = 'timeout';
    state.events.push({ type: 'fail', text: '风暴前锋抵达，观测窗口关闭。', tone: 'bad' });
  }
  if (state.battery <= 22 && Math.floor(state.t * 2) !== state._lastBatteryWarn) {
    state._lastBatteryWarn = Math.floor(state.t * 2);
    state.events.push({
      type: 'battery',
      text: '电池低于 22%，降低增益或尽快完成锁定。',
      tone: 'warn',
    });
  }
  return state.events;
}

// 对方轴偏差造成的频谱污染（0 干净 .. 1 完全不可读）
export function crossNoiseFor(state, axis) {
  const info = alignmentInfo(state);
  if (!info) return 0;
  const err = axis === 'left' ? info.elErr : info.azErr;
  const full = 14;
  return clamp(err / full, 0, 1);
}

// 信号电平：增益充足且频段匹配时给出 0..1 的可读电平，含闪烁与噪声
export function signalLevel(state, signal, t = state.t) {
  const blink = blinkState(signal, t);
  if (!blink.active) return 0;
  if (signal.band !== state.band) return 0;
  const margin = state.gain - signal.requiredGain;
  if (margin < 0) return 0;
  const base = clamp(0.45 + margin / 55, 0.45, 1);
  const jitter = 1 - state.noise * 0.25;
  return clamp(base * jitter, 0, 1);
}

export function lockProgress(state) {
  return clamp(state.lock.hold / LOCK_HOLD_SECONDS, 0, 1);
}
