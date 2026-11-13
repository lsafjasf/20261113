// Node-side tests for the pure simulation modules.
import assert from "node:assert/strict";
import { CONFIG, ISLANDS, speedFor, burnFor } from "../js/config.js";
import { simulateLeg, stepFerry } from "../js/physics.js";
import { generateMission, makeReplacement } from "../js/generator.js";
import { Rng } from "../js/rng.js";

// 1. Heavier load => strictly slower and thirstier.
for (let load = 0; load < CONFIG.capacity; load++) {
  assert.ok(speedFor(load) > speedFor(load + 1), `speed must drop at load ${load}`);
  assert.ok(burnFor(load) < burnFor(load + 1), `burn must rise at load ${load}`);
}

// 2. Current pushes the ferry off the straight line: after one step the
//    eastward displacement exceeds pure heading-based motion.
{
  const a = ISLANDS[0];
  const ferry = { x: a.x, y: a.y, heading: 0 };
  const before = { ...ferry };
  stepFerry(ferry, 2, 2, CONFIG.step);
  const headingOnlyX = Math.cos(ferry.heading) * speedFor(2) * CONFIG.step;
  assert.ok(ferry.x - before.x > headingOnlyX + 0.5, "current must add lateral drift");
}

// 3. Every generated seed is feasible within both budgets, and patience can
//    never expire before the reference pickup.
for (let i = 0; i < 120; i++) {
  const m = generateMission(`unit-${i}`);
  assert.equal(m.passengers.length, 8);
  assert.equal(m.reference.delivered, 8);
  assert.ok(m.reference.time <= CONFIG.duration * CONFIG.budget.timeRatio);
  assert.ok(m.reference.fuelUsed <= m.reference.tank * CONFIG.budget.fuelRatio + 1e-9);
  for (const p of m.passengers) {
    assert.notEqual(p.from, p.to);
    assert.ok(p.patience >= CONFIG.patience.minCap - 1e-9);
  }
  // Determinism: same seed => identical mission.
  const again = generateMission(`unit-${i}`);
  assert.deepEqual(again.passengers, m.passengers);
  assert.deepEqual(again.route, m.route);
}

// 4. Leg simulator terminates and fuel grows with load on the same leg.
{
  const light = simulateLeg(0, 1, 0);
  const heavy = simulateLeg(0, 1, 4);
  assert.ok(light.seconds > 0 && heavy.seconds > light.seconds, "heavy leg slower");
  assert.ok(heavy.fuel > light.fuel, "heavy leg burns more");
}

// 5. Replacement passengers always travel between distinct islands and carry
//    fresh patience.
{
  const rng = new Rng("replacement");
  for (let i = 1; i <= 10; i++) {
    const r = makeReplacement(rng, i, 0);
    assert.notEqual(r.from, r.to);
    assert.ok(r.patience >= CONFIG.patience.replacementMin);
    assert.ok(r.patience <= CONFIG.patience.replacementMax);
  }
}

console.log("UNIT TESTS OK");
