import { fingerprint, hashSeed, mulberry32, pick, range, round } from "./rng.js";

export const QUADRANTS = {
  LF: { label: "左前", short: "LF", dx: -1, dy: 1, filter: "front" },
  RF: { label: "右前", short: "RF", dx: 1, dy: 1, filter: "front" },
  LB: { label: "左后", short: "LB", dx: -1, dy: -1, filter: "back" },
  RB: { label: "右后", short: "RB", dx: 1, dy: -1, filter: "back" },
};

export const QUADRANT_KEYS = Object.keys(QUADRANTS);

export const CASE_DURATION = 15;
export const MIN_CAPTURE_SECONDS = 4.5;

const ROOM_BOUNDS = [
  { minX: -4.8, maxX: -1.6, minY: -3.4, maxY: 3.2 },
  { minX: -1.6, maxX: 1.6, minY: -3.4, maxY: 3.2 },
  { minX: 1.6, maxX: 4.8, minY: -3.4, maxY: 3.2 },
];

function createRooms(random, seedHash) {
  const profiles = [
    { rt60: range(random, 0.92, 1.22), preDelay: range(random, 0.008, 0.016) },
    { rt60: range(random, 1.55, 1.92), preDelay: range(random, 0.013, 0.024) },
    { rt60: range(random, 2.18, 2.68), preDelay: range(random, 0.022, 0.038) },
  ];
  const names = ["西翼接收室", "中继监听室", "东翼接收室"];
  const stationX = [-1.72, 0, 1.72];
  return profiles.map((profile, index) => ({
    id: `R-0${index + 1}`,
    name: names[index],
    index,
    bounds: ROOM_BOUNDS[index],
    station: { x: stationX[index], y: 0.16, label: `监听位 R-0${index + 1}` },
    rt60: round(profile.rt60, 2),
    damping: round(range(random, 0.28, 0.76), 2),
    preDelay: round(profile.preDelay, 3),
    brightness: round(range(random, 0.42, 0.78), 2),
    irSeed: (seedHash ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0,
  }));
}

function createSource(name, quadrantKey, sideSeed, random) {
  const quadrant = QUADRANTS[quadrantKey];
  const side = quadrant.dx;
  const x = side * range(random, 2.42, 3.92);
  const y = quadrant.dy * range(random, 1.52, 2.92);
  const isAlpha = name === "α";
  return {
    id: name === "α" ? "alpha" : "beta",
    name,
    quadrant: quadrantKey,
    position: { x: round(x, 3), y: round(y, 3) },
    carrier: round(isAlpha ? range(random, 176, 226) : range(random, 314, 372), 1),
    overtone: round(isAlpha ? range(random, 352, 452) : range(random, 628, 744), 1),
    patternRate: round(isAlpha ? range(random, 0.74, 0.92) : range(random, 1.02, 1.22), 2),
    pulseLength: round(isAlpha ? range(random, 0.15, 0.23) : range(random, 0.09, 0.15), 2),
    sideSeed,
    start: 0,
  };
}

function createAmbience(random) {
  const footsteps = [];
  const water = [];
  for (let time = range(random, 2.1, 2.7); time < CASE_DURATION - 0.6; time += range(random, 1.9, 2.7)) {
    footsteps.push(round(time, 2));
  }
  for (let time = range(random, 1.1, 2.0); time < CASE_DURATION - 0.5; time += range(random, 2.6, 4.2)) {
    water.push(round(time, 2));
  }
  return {
    footsteps,
    water,
    humHz: round(range(random, 47, 57), 1),
    mainsHz: round(range(random, 38, 43), 1),
  };
}

function normalizeSeed(seed) {
  const value = String(seed ?? "").trim().toUpperCase();
  return (value || "ZERO-0714").slice(0, 40);
}

export function createCase(seedInput) {
  const seed = normalizeSeed(seedInput);
  const seedHash = hashSeed(seed);
  const random = mulberry32(seedHash);
  const rooms = createRooms(random, seedHash);
  const leftQuadrant = pick(random, ["LF", "LB"]);
  const rightQuadrant = pick(random, ["RF", "RB"]);
  const firstSide = random() < 0.5 ? "left" : "right";
  const sourceA = createSource("α", firstSide === "left" ? leftQuadrant : rightQuadrant, 1, random);
  const sourceB = createSource("β", firstSide === "left" ? rightQuadrant : leftQuadrant, 2, random);
  const sources = [sourceA, sourceB];
  const firstIndex = random() < 0.5 ? 0 : 1;
  const firstStart = round(range(random, 1.35, 2.05), 2);
  const secondStart = round(firstStart + range(random, 1.35, 2.15), 2);
  sources[firstIndex].start = firstStart;
  sources[1 - firstIndex].start = secondStart;
  const ambience = createAmbience(random);
  const payload = {
    seed,
    seedHash,
    rooms: rooms.map((room) => ({
      id: room.id,
      rt60: room.rt60,
      damping: room.damping,
      preDelay: room.preDelay,
      brightness: room.brightness,
      irSeed: room.irSeed,
    })),
    sources: sources.map((source) => ({
      id: source.id,
      quadrant: source.quadrant,
      position: source.position,
      start: source.start,
      carrier: source.carrier,
      overtone: source.overtone,
      patternRate: source.patternRate,
      pulseLength: source.pulseLength,
    })),
    ambience,
    firstSourceId: sources[firstIndex].id,
  };
  return deepFreeze({
    ...payload,
    fingerprint: fingerprint(payload),
    duration: CASE_DURATION,
    minCaptureSeconds: MIN_CAPTURE_SECONDS,
    rooms,
    sources,
    floor: { minX: -4.8, maxX: 4.8, minY: -3.4, maxY: 3.2 },
  });
}

export function spatialMetrics(station, source) {
  const dx = source.position.x - station.x;
  const dy = source.position.y - station.y;
  const distance = Math.hypot(dx, dy);
  const pan = clamp((dx / Math.max(distance, 0.001)) * 0.9, -1, 1);
  const angleDeg = round((Math.atan2(dx, Math.max(0.05, dy)) * 180) / Math.PI, 1);
  const theta = ((pan + 1) * Math.PI) / 4;
  const rear = dy < 0;
  const attenuation = round(1 / (1 + (distance / 1.55) ** 1.45), 3);
  const lowpass = Math.round(rear ? 1180 + 260 * (1 - Math.min(distance / 6, 1)) : 6400);
  return {
    dx: round(dx, 3),
    dy: round(dy, 3),
    distance: round(distance, 3),
    pan: round(pan, 3),
    angleDeg,
    leftGain: round(Math.cos(theta), 3),
    rightGain: round(Math.sin(theta), 3),
    attenuation,
    rear,
    lowpass,
    highShelfDb: rear ? -9.5 : 1.5,
    reverbSend: round(rear ? 0.27 : 0.15, 3),
  };
}

export function quadrantLabel(key) {
  return QUADRANTS[key]?.label ?? "未知";
}

export function cloneAnswer(answer) {
  return {
    alpha: answer?.alpha ?? null,
    beta: answer?.beta ?? null,
    first: answer?.first ?? null,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
