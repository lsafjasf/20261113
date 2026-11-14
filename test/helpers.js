import { createGame, setInput, shiftBand, update } from '../src/engine.js';
import { LOCK_HOLD_SECONDS, angleDistance } from '../src/constants.js';
import { blinkState } from '../src/signals.js';

export function step(state, seconds, dt = 0.05) {
  let elapsed = 0;
  while (elapsed < seconds - 1e-9) {
    const chunk = Math.min(dt, seconds - elapsed);
    update(state, chunk);
    elapsed += chunk;
    if (state.mode !== 'play') break;
  }
}

// 用自动伺服把镜位压到指定信号并保持，直到锁定或超时
export function servoToSignal(state, signal, {
  holdNeeded = LOCK_HOLD_SECONDS + 0.4,
  gainOverride = null,
  timeout = 30,
} = {}) {
  const start = state.t;
  let held = 0;
  const targetGain = gainOverride ?? Math.max(state.gain, signal.requiredGain + 4);
  while (state.t - start < timeout) {
    // 增益
    if (state.gain < targetGain - 0.5) setInput(state, 'gainUp', true);
    else setInput(state, 'gainUp', false);
    if (state.gain > targetGain + 0.5) setInput(state, 'gainDown', true);
    else setInput(state, 'gainDown', false);

    // 方位：取最短环形方向
    const azDiff = (signal.az - state.az + 540) % 360 - 180;
    setInput(state, 'azRight', azDiff > 1.2);
    setInput(state, 'azLeft', azDiff < -1.2);

    const elDiff = signal.el - state.el;
    setInput(state, 'elUp', elDiff > 1.0);
    setInput(state, 'elDown', elDiff < -1.0);

    if (state.band !== signal.band) shiftBand(state, 1);

    update(state, 0.05);
    const azErr = angleDistance(state.az, signal.az);
    const elErr = Math.abs(state.el - signal.el);
    const blink = blinkState(signal, state.t);
    if (azErr <= 8 && elErr <= 6 && blink.active) held += 0.05;
    else held = 0;
    if (held >= holdNeeded || state.mode !== 'play') break;
  }
  return state.mode;
}

export function freshGame(options) {
  return createGame(options);
}
