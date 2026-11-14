export const STATIONS = [
  { id: "pine", name: "松脊", code: "S1", distance: 0, x: 0.1, y: 0.5, altitude: 1840 },
  { id: "mist", name: "雾台", code: "S2", distance: 176, x: 0.35, y: 0.42, altitude: 2075 },
  { id: "ice", name: "冰湖", code: "S3", distance: 354, x: 0.64, y: 0.5, altitude: 2310 },
  { id: "cloud", name: "云顶", code: "S4", distance: 548, x: 0.9, y: 0.37, altitude: 2568 },
];

export const GAME = {
  carCapacity: 4,
  cruiseSpeed: 11.5,
  acceleration: 1.25,
  baseDeceleration: 2.1,
  reactionTime: 0.45,
  stationDwell: 6,
  stationPowerCost: 2.4,
  emergencyHold: 7,
  emergencyPowerCost: 8,
  headwayBuffer: 34,
  carLength: 9,
  startBattery: 96,
  minimumBattery: 20,
  shiftLimit: 155,
  minInterval: 7,
  maxInterval: 36,
  defaultInterval: 26,
};

export const PASSENGER_NAMES = [
  "林岚",
  "周野",
  "苏禾",
  "陈川",
  "许知",
  "顾遥",
  "叶青",
  "沈星",
  "唐棠",
  "陆岳",
  "程雾",
  "夏初",
];

export const DEFAULT_SEED = "SNOW-2418";

export function stationByDistance(distance) {
  for (let index = STATIONS.length - 1; index >= 0; index -= 1) {
    if (distance >= STATIONS[index].distance) return index;
  }
  return 0;
}

export function brakingDistance(speed, ice) {
  const deceleration = GAME.baseDeceleration / (1 + ice * 0.9);
  return speed * GAME.reactionTime + (speed * speed) / (2 * deceleration);
}

