import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SEED, GAME, brakingDistance } from "../js/config.js";
import { generateScenario, verifyScenarioBaseline } from "../js/generator.js";
import { RopewaySim, simulate } from "../js/sim.js";

test("seed generator constructs a verifiable baseline itinerary before demand", () => {
  const scenario = generateScenario(DEFAULT_SEED);
  assert.equal(scenario.generationAudit.verified, true);
  assert.ok(scenario.generationAudit.baselinePickups.length === 8);
  assert.ok(scenario.generationAudit.baselineTime > 0);
  assert.ok(scenario.generationAudit.baselineBattery >= GAME.minimumBattery);

  const baseline = verifyScenarioBaseline(scenario);
  assert.equal(baseline.result.success, true);
  assert.equal(baseline.result.delivered, 8);
  assert.equal(baseline.emergencyStops, 0);
});

test("multiple procedural seeds all carry a feasible baseline", () => {
  for (let index = 0; index < 20; index += 1) {
    const scenario = generateScenario(`VERIFY-${index}`);
    const simulation = verifyScenarioBaseline(scenario);
    assert.equal(
      simulation.result?.success,
      true,
      `seed VERIFY-${index} baseline failed: ${simulation.result?.message}`,
    );
    assert.ok(simulation.result.battery >= GAME.minimumBattery);
  }
});

test("a successful shift delivers all eight passengers above the battery floor", () => {
  const scenario = generateScenario(DEFAULT_SEED);
  const simulation = simulate(scenario, {
    interval: GAME.defaultInterval,
    stops: [true, true, true, true],
  });

  assert.equal(simulation.result.success, true);
  assert.equal(simulation.result.delivered, 8);
  assert.ok(simulation.result.battery >= GAME.minimumBattery);
  assert.equal(simulation.result.emergencyStops, 0);
  assert.equal(simulation.cars.every((car) => car.state === "finished"), true);
});

test("an over-dense departure interval triggers a distinct emergency stop", () => {
  const scenario = generateScenario(DEFAULT_SEED);
  const simulation = new RopewaySim(scenario, {
    interval: 8,
    stops: [true, true, true, true],
  });

  let firstEmergency = null;
  for (let index = 0; index < 1000 && !firstEmergency; index += 1) {
    simulation.step(0.05);
    firstEmergency = simulation.events.find((event) => event.type === "emergency") ?? null;
  }

  assert.ok(firstEmergency, "expected an emergency stop event");
  assert.match(firstEmergency.text, /间距过近/);
  assert.equal(simulation.cars[1].state, "emergency");
  assert.equal(simulation.cars[1].speed, 0);

  simulation.advance(180, 0.05);
  assert.ok(simulation.emergencyStops >= 2);
  assert.equal(simulation.result.success, false);
  assert.equal(simulation.result.reason, "battery");
  assert.ok(simulation.battery < GAME.minimumBattery);
});

test("ice lengthens the required braking distance", () => {
  const dryBraking = brakingDistance(11, 0);
  const icyBraking = brakingDistance(11, 0.72);
  assert.ok(icyBraking > dryBraking * 1.2);
});

