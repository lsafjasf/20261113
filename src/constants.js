// 全局调参常量。所有平衡性数字集中在此，引擎与界面共享。

export const FIXED_SEED = 20261113;

export const AZ_RANGE = 360; // 方位角 0..360（环形）
export const EL_MIN = 0;
export const EL_MAX = 90; // 仰角 0..90

export const AZ_TOLERANCE = 8; // 方位容差（度）
export const EL_TOLERANCE = 6; // 仰角容差（度）
export const LOCK_HOLD_SECONDS = 2; // 双轴同时入容差后的持续锁定时间
export const WRONG_LIMIT = 2; // 错锁诱饵次数上限
export const REAL_TARGET_COUNT = 3; // 真异常数量
export const DECOY_COUNT = 2; // 诱饵回波数量

export const BAND_COUNT = 3; // L / S / X
export const BAND_NAMES = ['L', 'S', 'X'];
export const BAND_FREQ_LABELS = ['1.2 GHz', '2.4 GHz', '8.4 GHz'];

// 操控速度（度/秒），增益为每秒百分比
export const DISH_SPEED = 26;
export const GAIN_SPEED = 22;

// 增益
export const GAIN_MIN = 20;
export const GAIN_MAX = 100;
export const GAIN_START = 55;

// 信号所需增益门槛：增益 >= 门槛才可在电平表与瀑布中显现
export const REQUIRED_GAIN_MIN = 35;
export const REQUIRED_GAIN_MAX = 80;

// 电池：百分比/秒，随增益二次放大
export const BATTERY_START = 100;
export const DRAIN_BASE = 0.55; // 最低增益下的基础耗电
export const DRAIN_GAIN_COEF = 0.00045; // 增益附加耗电系数

// 风暴
export const STORM_START = 0.2; // 初始推力比例
export const STORM_RAMP = 0.016; // 每秒推力增长
export const STORM_MAX = 1.15;
export const GUST_CHANCE = 0.22; // 每 0.5 秒触发阵风判定的概率
export const GUST_DECAY = 1.6; // 阵风指数衰减速率
export const WIND_PEAK_SPEED = 11; // 风暴满推力下的偏移速度（度/秒）

// 局时（秒），参考图约 1:50
export const MISSION_SECONDS = 110;

// 信号闪烁：周期 4.5..9 秒，占空比 0.45..0.7
export const BLINK_PERIOD_MIN = 4.5;
export const BLINK_PERIOD_MAX = 9;
export const BLINK_DUTY_MIN = 0.45;
export const BLINK_DUTY_MAX = 0.7;

// 瀑布可读性：对方轴偏差映射为噪声 0..1
export const CROSS_NOISE_FULL = 14; // 偏差达到该度数时频谱完全不可读

// 初始镜位
export const AZ_START = 152;
export const EL_START = 48;

// 锁定冷却：完成一次锁定后切换目标的缓冲秒数
export const LOCK_COOLDOWN = 0.8;

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// 环形角差，范围 -180..180
export function angleDelta(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

export function wrapAz(a) {
  return ((a % 360) + 360) % 360;
}

// 环形角距离（绝对值，0..180）
export function angleDistance(a, b) {
  return Math.abs(angleDelta(a, b));
}
