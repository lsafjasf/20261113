// Seeded demand generator.
//
// Contract from the design brief: the generator must FIRST build a feasible
// reference voyage, then derive passenger demand from that voyage. A seed is
// only accepted when a deterministic replay of that voyage actually delivers
// every passenger inside the time and fuel budgets, so no mathematically
// impossible mission can ever be produced.

import { CONFIG, ISLANDS } from "./config.js";
import { Rng } from "./rng.js";
import { simulateLeg } from "./physics.js";

const NUM_ISLANDS = ISLANDS.length;

function buildRoute(rng) {
  const visitCount = rng.int(9, 12);
  const route = [0]; // ferry always starts berthed at island 0
  for (let i = 1; i < visitCount; i++) {
    let next = rng.int(0, NUM_ISLANDS - 1);
    if (next === route[i - 1]) next = (next + 1) % NUM_ISLANDS;
    route.push(next);
  }
  // Guarantee every island is visited at least once.
  const covered = new Set(route);
  for (let id = 0; id < NUM_ISLANDS; id++) {
    if (!covered.has(id)) {
      const slot = rng.int(1, route.length - 1);
      route[slot] = id;
      covered.add(id);
    }
  }
  return route;
}

// For each visit (except the last), list passenger indices whose destination
// island is visited later in the route.
function availableAt(route, visitIndex, used) {
  const out = [];
  for (let j = visitIndex + 1; j < route.length; j++) {
    if (!used[j]) out.push(j);
  }
  return out;
}

function buildPassengers(rng, route) {
  const used = new Array(route.length).fill(false);
  const passengers = [];
  const names = ["阿岚", "老周", "小夏", "陈伯", "阿荔", "米娅", "阿礁", "晚晴"];

  for (let p = 0; p < CONFIG.passengerTarget; p++) {
    // Pick a departure visit whose remaining route can host a destination.
    const departureChoices = [];
    for (let i = 0; i < route.length - 1; i++) {
      if (availableAt(route, i, used).length > 0) departureChoices.push(i);
    }
    if (departureChoices.length === 0) return null;

    const depVisit = rng.pick(departureChoices);
    const destChoices = availableAt(route, depVisit, used).filter(
      (j) => route[j] !== route[depVisit]
    );
    if (destChoices.length === 0) return null;
    const destVisit = rng.pick(destChoices);
    used[destVisit] = true;

    passengers.push({
      id: `p${p}`,
      name: names[p],
      from: route[depVisit],
      to: route[destVisit],
      depVisit,
      destVisit,
    });
  }
  return passengers;
}

// Deterministic replay of the reference route with a greedy but legal boarding
// policy (board every boardable waiter up to capacity at each dock). Returns
// the full timing/fuel ledger plus where each passenger was picked up.
function replay(route, passengers) {
  let time = 0;
  let fuelUsed = 0;
  const onboard = [];
  const waiting = passengers.map((p) => ({ ...p, state: "waiting" }));
  const ledger = []; // per-leg { from, to, load, seconds, fuel }
  const pickupTime = new Map();
  let delivered = 0;

  for (let visit = 0; visit < route.length; visit++) {
    const islandId = route[visit];

    // Disembark everyone whose destination is this island.
    for (let i = onboard.length - 1; i >= 0; i--) {
      if (onboard[i].to === islandId) {
        onboard.splice(i, 1);
        delivered += 1;
      }
    }

    // Board waiting passengers whose departure island is here and whose
    // reference destination visit still lies ahead.
    for (const p of waiting) {
      if (
        p.state === "waiting" &&
        p.from === islandId &&
        p.depVisit === visit &&
        onboard.length < CONFIG.capacity
      ) {
        p.state = "onboard";
        pickupTime.set(p.id, time);
        onboard.push(p);
      }
    }

    if (visit === route.length - 1) break;

    const leg = simulateLeg(route[visit], route[visit + 1], onboard.length);
    ledger.push({ from: route[visit], to: route[visit + 1], load: onboard.length, ...leg });
    time += leg.seconds;
    fuelUsed += leg.fuel;
  }

  return { time, fuelUsed, delivered, ledger, pickupTime, waiting };
}

export function generateMission(seed) {
  const rng = new Rng(seed);

  for (let attempt = 0; attempt < 400; attempt++) {
    const route = buildRoute(rng);
    const passengers = buildPassengers(rng, route);
    if (!passengers) continue;

    const result = replay(route, passengers);
    if (result.delivered !== CONFIG.passengerTarget) continue;
    if (result.time > CONFIG.duration * CONFIG.budget.timeRatio) continue;

    // Tank sized so the reference run uses at most budget.fuelRatio of it.
    const tank = Math.max(
      40,
      Math.ceil((result.fuelUsed / CONFIG.budget.fuelRatio) / 5) * 5
    );
    if (result.fuelUsed > tank * CONFIG.budget.fuelRatio + 0.001) continue;

    // Patience: reference pickup time + a comfortable buffer. A passenger can
    // never time out before the reference voyage would have collected them.
    const decorated = passengers.map((p) => {
      const pickup = result.pickupTime.get(p.id) ?? 0;
      const buffer = rng.range(CONFIG.patience.minBuffer, CONFIG.patience.maxBuffer);
      const patience = Math.min(
        CONFIG.patience.hardCap,
        Math.max(CONFIG.patience.minCap, pickup + buffer)
      );
      return {
        id: p.id,
        name: p.name,
        from: p.from,
        to: p.to,
        patience,
      };
    });

    return {
      seed: String(seed),
      route,
      passengers: decorated,
      reference: {
        time: result.time,
        fuelUsed: result.fuelUsed,
        tank,
        delivered: result.delivered,
        ledger: result.ledger,
      },
    };
  }
  throw new Error("无法为该 seed 构造可行航次（生成器重试耗尽）");
}

// Replacement passenger created when a waiting passenger runs out of patience.
// Demand stays at eight successful deliveries total, so the mission can still
// be won after a detour.
export function makeReplacement(rng, idIndex, excludedFrom) {
  let from = rng.int(0, NUM_ISLANDS - 1);
  if (from === excludedFrom) from = (from + 1) % NUM_ISLANDS;
  let to = rng.int(0, NUM_ISLANDS - 1);
  if (to === from) to = (to + 1) % NUM_ISLANDS;
  const patience = rng.range(CONFIG.patience.replacementMin, CONFIG.patience.replacementMax);
  return {
    id: `r${idIndex}`,
    name: `补${idIndex}`,
    from,
    to,
    patience,
    replacement: true,
  };
}
