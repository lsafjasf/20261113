// All tunable constants live here so the feasibility generator and the live
// simulation share exactly the same numbers.

export const ISLANDS = [
  { id: 0, name: "雾屿", x: 150, y: 150, r: 52, color: "#caa46a" },
  { id: 1, name: "灯塔角", x: 800, y: 130, r: 56, color: "#9fb7c9" },
  { id: 2, name: "沙洲", x: 470, y: 470, r: 60, color: "#d8c98a" },
];

export const CONFIG = {
  canvas: { width: 960, height: 600 },

  duration: 150,          // seconds to deliver everyone
  passengerTarget: 8,
  capacity: 4,

  // Hull speed in px/s depending on onboard passengers (index = load).
  // Heavier load => slower ferry.
  speedByLoad: [118, 108, 98, 88, 78],

  // Fuel burn in units/s depending on load. Heavier => thirstier.
  burnByLoad: [0.62, 0.72, 0.84, 0.98, 1.14],

  // Horizontal ocean current (px/s), eastward. Pushes the ferry off its
  // straight-line course while under way.
  current: { x: 26, y: 0 },

  // Distance from island center at which the ferry snaps into dock.
  dockRadius: 46,

  // Fixed timestep for the deterministic physics simulation.
  step: 1 / 30,

  // Patience windows (seconds, measured from mission start).
  patience: {
    minBuffer: 26,      // extra time on top of the reference pickup time
    maxBuffer: 52,
    minCap: 45,
    hardCap: 125,
    replacementMin: 55, // replacement passengers get fresh patience
    replacementMax: 90,
  },

  // Generator budgets: a generated seed must be completable well inside both.
  budget: {
    timeRatio: 0.82,    // reference run must finish within 82% of 150s
    fuelRatio: 0.78,    // reference fuel must stay under 78% of the tank
  },

  colors: {
    dest: ["#ff8f5c", "#5cd6ff", "#b9f06b"],
  },
};

export function speedFor(load) {
  return CONFIG.speedByLoad[Math.max(0, Math.min(CONFIG.capacity, load))];
}

export function burnFor(load) {
  return CONFIG.burnByLoad[Math.max(0, Math.min(CONFIG.capacity, load))];
}

export function island(id) {
  return ISLANDS[id];
}
