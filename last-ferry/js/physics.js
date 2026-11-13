import { CONFIG, island } from "./config.js";

// One deterministic fixed-step move of the ferry.
// The ferry always points at its destination island and sails at full hull
// speed for its current load; the ocean current simply adds drift on top, so
// the vessel is pushed sideways and needs extra time to close in.
//
// `ferry` is mutated in place: { x, y, heading }
export function stepFerry(ferry, targetIslandId, load, dt) {
  const target = island(targetIslandId);
  const dx = target.x - ferry.x;
  const dy = target.y - ferry.y;
  const dist = Math.hypot(dx, dy);
  if (dist > 0.0001) {
    ferry.heading = Math.atan2(dy, dx);
  }

  const speed = CONFIG.speedByLoad[Math.max(0, Math.min(CONFIG.capacity, load))];
  ferry.x += Math.cos(ferry.heading) * speed * dt + CONFIG.current.x * dt;
  ferry.y += Math.sin(ferry.heading) * speed * dt + CONFIG.current.y * dt;

  if (Math.hypot(target.x - ferry.x, target.y - ferry.y) <= CONFIG.dockRadius) {
    ferry.x = target.x;
    ferry.y = target.y;
    return true; // docked
  }
  return false;
}

// Headless leg simulation used by the seed generator. Constant load per leg,
// same fixed timestep as the live game, so feasibility claims match gameplay.
// Returns { seconds, fuel }.
export function simulateLeg(fromId, toId, load) {
  const from = island(fromId);
  const ferry = { x: from.x, y: from.y, heading: 0 };
  const dt = CONFIG.step;
  let seconds = 0;
  let fuel = 0;
  const burn = CONFIG.burnByLoad[Math.max(0, Math.min(CONFIG.capacity, load))];
  // Hard guard; a leg can never legitimately take this long.
  const maxSteps = Math.ceil(60 / dt);
  for (let i = 0; i < maxSteps; i++) {
    const docked = stepFerry(ferry, toId, load, dt);
    seconds += dt;
    fuel += burn * dt;
    if (docked) break;
  }
  return { seconds, fuel };
}
