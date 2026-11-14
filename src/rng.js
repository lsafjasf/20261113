const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function hashSeed(value, salt = 0) {
  let hash = (FNV_OFFSET ^ (salt >>> 0)) >>> 0;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function range(random, min, max) {
  return min + (max - min) * random();
}

export function pick(random, values) {
  return values[Math.floor(random() * values.length)];
}

export function round(value, places = 2) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

export function fingerprint(value) {
  return hashSeed(JSON.stringify(value)).toString(16).toUpperCase().padStart(8, "0");
}
