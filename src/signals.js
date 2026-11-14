import { makeRng } from './rng.js';
import {
  BAND_COUNT,
  BLINK_DUTY_MAX,
  BLINK_DUTY_MIN,
  BLINK_PERIOD_MAX,
  BLINK_PERIOD_MIN,
  DECOY_COUNT,
  REAL_TARGET_COUNT,
  REQUIRED_GAIN_MAX,
  REQUIRED_GAIN_MIN,
  angleDistance,
} from './constants.js';

// 同一 seed 永远生成同一组信号（同一张雷达屏）
export function generateSignals(seed) {
  const rng = makeRng(seed);
  const signals = [];

  const tooClose = (az, el) =>
    signals.some(
      (s) => angleDistance(s.az, az) < 26 && Math.abs(s.el - el) < 12,
    );

  const place = () => {
    let az = 0;
    let el = 0;
    let tries = 0;
    do {
      az = rng.range(8, 352);
      el = rng.range(8, 82);
      tries += 1;
    } while (tooClose(az, el) && tries < 80);
    return { az, el };
  };

  const makeBlink = () => {
    const period = rng.range(BLINK_PERIOD_MIN, BLINK_PERIOD_MAX);
    return {
      period,
      duty: rng.range(BLINK_DUTY_MIN, BLINK_DUTY_MAX),
      phase: rng.range(0, period),
    };
  };

  // 真异常覆盖三个频段，顺序由 seed 决定
  const realBands = [0, 1, 2].sort(() => rng.next() - 0.5);

  for (let i = 0; i < REAL_TARGET_COUNT; i += 1) {
    const { az, el } = place();
    signals.push({
      id: `R${i + 1}`,
      kind: 'real',
      az,
      el,
      band: realBands[i],
      requiredGain: rng.range(REQUIRED_GAIN_MIN, REQUIRED_GAIN_MAX),
      blink: makeBlink(),
      locked: false,
    });
  }

  for (let i = 0; i < DECOY_COUNT; i += 1) {
    const { az, el } = place();
    signals.push({
      id: `D${i + 1}`,
      kind: 'decoy',
      az,
      el,
      band: rng.int(0, BAND_COUNT - 1),
      requiredGain: rng.range(REQUIRED_GAIN_MIN, REQUIRED_GAIN_MAX),
      blink: makeBlink(),
      locked: false,
    });
  }

  return signals;
}

// 信号按固定节律闪烁：相位内占空比窗口为“可见”
export function blinkState(signal, t) {
  const { period, duty, phase } = signal.blink;
  const p = (t + phase) % period;
  const onTime = period * duty;
  const active = p < onTime;
  const remaining = active
    ? onTime - p
    : period - p; // 距下一次状态翻转的秒数
  return { active, remaining, progress: p / period };
}
