export const VIEW = Object.freeze({ width: 1600, height: 900 });

export const WORLD = Object.freeze({
  horizonY: 475,
  waterY: 696,
  quayTop: 728,
  quayRight: 866,
  shipLeft: 870,
  shipRight: 1240,
  shipDeckY: 647,
  pivotX: 158,
  pivotY: 238,
  boomLength: 1200,
  trolleyMin: 142,
  trolleyMax: 1110,
  angleMin: -0.035,
  angleMax: 0.295,
  defaultAngle: 0.12,
  defaultTrolley: 470,
  defaultCable: 126,
  minCable: 68,
  maxCable: 470,
});

export const PHYSICS = Object.freeze({
  gravity: 560,
  trolleySpeed: 238,
  trolleyAccel: 610,
  trolleyBrake: 810,
  slewSpeed: 0.31,
  slewAccel: 1.55,
  slewBrake: 2.4,
  payOutSpeed: 182,
  reelSpeed: 148,
  windBase: 38,
  windGust: 34,
  hookGrabRadius: 42,
  impactSpeed: 245,
  impactForce: 155,
  durabilityLoss: 34,
  lostCargoLoss: 30,
});

export const TARGETS = Object.freeze([
  { id: 1, x: 304, color: "#ff6f52", dark: "#a83b2e", name: "赤色" },
  { id: 2, x: 400, color: "#efc84f", dark: "#9b7c21", name: "黄色" },
  { id: 3, x: 496, color: "#39c9a5", dark: "#1e7964", name: "青色" },
  { id: 4, x: 592, color: "#54add9", dark: "#286d90", name: "蓝色" },
  { id: 5, x: 688, color: "#b78bff", dark: "#6949a5", name: "紫色" },
  { id: 6, x: 784, color: "#b9d84f", dark: "#71851f", name: "绿色" },
]);

export const CARGO_SIZE = Object.freeze({ width: 56, height: 48 });
export const SLOT_WIDTH = 78;
export const SLOT_CENTER_Y = WORLD.quayTop - CARGO_SIZE.height / 2;

export const STAGING = Object.freeze(
  TARGETS.map((target, index) => ({
    id: target.id,
    x: 902 + index * 60,
    y: WORLD.shipDeckY - CARGO_SIZE.height / 2 - 1,
    color: target.color,
    dark: target.dark,
    name: target.name,
    weight: [0.9, 1.18, 1.02, 1.34, 1.56, 1.26][index],
  })),
);
