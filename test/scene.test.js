import test from "node:test";
import assert from "node:assert/strict";
import { createCase, QUADRANTS, spatialMetrics } from "../src/scene.js";

function deterministicView(caseData) {
  return {
    seed: caseData.seed,
    fingerprint: caseData.fingerprint,
    rooms: caseData.rooms.map((room) => ({
      id: room.id,
      rt60: room.rt60,
      damping: room.damping,
      preDelay: room.preDelay,
      brightness: room.brightness,
      irSeed: room.irSeed,
    })),
    sources: caseData.sources.map((source) => ({
      id: source.id,
      quadrant: source.quadrant,
      position: source.position,
      start: source.start,
      carrier: source.carrier,
      overtone: source.overtone,
    })),
    firstSourceId: caseData.firstSourceId,
    ambience: caseData.ambience,
  };
}

test("same seed reproduces sources, order and room impulse parameters", () => {
  const first = createCase("ZERO-0714");
  const second = createCase("  zero-0714  ");
  assert.deepEqual(deterministicView(first), deterministicView(second));
  assert.equal(first.fingerprint, second.fingerprint);
});

test("different seeds change the fixed case", () => {
  const first = createCase("ZERO-0714");
  const second = createCase("ZERO-0715");
  assert.notEqual(first.fingerprint, second.fingerprint);
});

test("the two sources occupy one left and one right quadrant", () => {
  const scene = createCase("QUADRANT-CHECK");
  const sides = scene.sources.map((source) => Math.sign(source.position.x));
  assert.deepEqual(sides.sort(), [-1, 1]);
  assert.notEqual(scene.sources[0].quadrant, scene.sources[1].quadrant);
});

test("spatial panning follows all four absolute quadrants", () => {
  const scene = createCase("PAN-CHECK");
  for (const [key, quadrant] of Object.entries(QUADRANTS)) {
    const source = { position: { x: quadrant.dx * 2.8, y: quadrant.dy * 2.3 } };
    const metrics = spatialMetrics(scene.rooms[1].station, source);
    assert.equal(Math.sign(metrics.pan), quadrant.dx, key);
    assert.equal(metrics.rear, quadrant.dy < 0, key);
    if (quadrant.dx < 0) assert.ok(metrics.leftGain > metrics.rightGain, key);
    else assert.ok(metrics.rightGain > metrics.leftGain, key);
  }
});

test("front filtering is brighter and drier than rear filtering", () => {
  const scene = createCase("FILTER-CHECK");
  const front = spatialMetrics(scene.rooms[1].station, { position: { x: 2.7, y: 2.2 } });
  const back = spatialMetrics(scene.rooms[1].station, { position: { x: 2.7, y: -2.2 } });
  assert.ok(front.lowpass > back.lowpass * 3);
  assert.ok(front.highShelfDb > back.highShelfDb);
  assert.ok(front.reverbSend < back.reverbSend);
});

test("distance attenuation ranks the nearer listening post above the far one", () => {
  const scene = createCase("DISTANCE-CHECK");
  const leftSource = scene.sources.find((source) => source.position.x < 0);
  const west = spatialMetrics(scene.rooms[0].station, leftSource);
  const east = spatialMetrics(scene.rooms[2].station, leftSource);
  assert.ok(west.distance < east.distance);
  assert.ok(west.attenuation > east.attenuation);
});

test("all three rooms have distinct impulse-response profiles", () => {
  const scene = createCase("ROOM-CHECK");
  const signatures = new Set(scene.rooms.map((room) => `${room.rt60}:${room.damping}:${room.preDelay}:${room.irSeed}`));
  assert.equal(signatures.size, 3);
  assert.ok(scene.rooms[0].rt60 < scene.rooms[1].rt60);
  assert.ok(scene.rooms[1].rt60 < scene.rooms[2].rt60);
});

test("broadcast order is stable and always inside the capture window", () => {
  const scene = createCase("ORDER-CHECK");
  const starts = scene.sources.map((source) => source.start).sort((a, b) => a - b);
  assert.ok(starts[0] >= 1.3);
  assert.ok(starts[1] > starts[0]);
  assert.ok(starts[1] < scene.minCaptureSeconds);
  const first = scene.sources.find((source) => source.id === scene.firstSourceId);
  assert.equal(first.start, starts[0]);
});
