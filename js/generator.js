import { GAME, PASSENGER_NAMES, STATIONS } from "./config.js";
import { createRng } from "./rng.js";
import { simulate } from "./sim.js";

const BASELINE_INTERVALS = [18, 19, 20, 21, 22, 24, 26, 28, 30, 32, 34, 36];

function activityMask(passengers) {
  return STATIONS.map((_, stationIndex) =>
    passengers.some(
      (passenger) =>
        passenger.origin === stationIndex || passenger.destination === stationIndex,
    ),
  );
}

export function makeDemand(rng) {
  const names = rng.shuffle(PASSENGER_NAMES).slice(0, 8);
  const deadStation = rng.next() < 0.68 ? rng.pick([1, 2]) : null;
  const origins = [0, 1, 2].filter((stationIndex) => stationIndex !== deadStation);
  return names.map((name, index) => {
    const origin = rng.pick(origins);
    const destinations = Array.from(
      { length: STATIONS.length - origin - 1 },
      (_, offset) => origin + offset + 1,
    ).filter((stationIndex) => stationIndex !== deadStation);
    const destination = rng.pick(destinations);
    return {
      id: `P${index + 1}`,
      name,
      origin,
      destination,
      patience: Number.POSITIVE_INFINITY,
    };
  });
}

function policyCandidates(stops) {
  const masks = [];
  const optional = stops
    .map((required, index) => ({ required, index }))
    .filter((entry) => !entry.required)
    .map((entry) => entry.index);

  const combinationCount = 1 << optional.length;
  for (let bits = 0; bits < combinationCount; bits += 1) {
    const mask = [...stops];
    optional.forEach((stationIndex, bitIndex) => {
      mask[stationIndex] = Boolean(bits & (1 << bitIndex));
    });
    for (const interval of BASELINE_INTERVALS) {
      masks.push({ interval, stops: mask });
    }
  }
  return masks;
}

export function findBaseline(scenario) {
  const essentialStops = activityMask(scenario.passengers);
  const candidates = policyCandidates(essentialStops).sort((left, right) => {
    const leftStops = left.stops.filter(Boolean).length;
    const rightStops = right.stops.filter(Boolean).length;
    return leftStops - rightStops || left.interval - right.interval;
  });

  for (const policy of candidates) {
    const candidateScenario = {
      ...scenario,
      passengers: scenario.passengers.map((passenger) => ({
        ...passenger,
        patience: Number.POSITIVE_INFINITY,
      })),
    };
    const sim = simulate(candidateScenario, policy);
    if (
      sim.result?.success &&
      sim.emergencyStops === 0 &&
      sim.result.battery >= GAME.minimumBattery + 7
    ) {
      return { policy, sim };
    }
  }
  return null;
}

export function generateScenario(seed) {
  const rng = createRng(seed);
  const baseScenario = {
    seed: String(seed),
    windBase: Number(rng.range(7.2, 16.4).toFixed(1)),
    windGust: Number(rng.range(2.2, 5.2).toFixed(1)),
    windPhase: rng.range(0, Math.PI * 2),
    ice: Number(rng.range(0.22, 0.72).toFixed(2)),
    temperature: Math.round(rng.range(-18, -4)),
    passengers: makeDemand(rng),
    generationAudit: {
      verified: false,
      attempt: 0,
      baselineInterval: null,
    },
  };

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const baseline = findBaseline(baseScenario);
    if (!baseline) {
      baseScenario.passengers = makeDemand(rng);
      continue;
    }

    const pickupMargins = new Map(
      baseline.sim.passengers.map((passenger) => [
        passenger.id,
        Math.max(16, rng.range(18, 29)),
      ]),
    );
    for (const passenger of baseScenario.passengers) {
      const boardedAt = baseline.sim.passengers.find((item) => item.id === passenger.id)?.boardedAt;
      passenger.patience = Math.round((boardedAt ?? 40) + (pickupMargins.get(passenger.id) ?? 24));
    }

    let finalSim = simulate(baseScenario, baseline.policy);
    let extraPatience = 0;
    while (!finalSim.result?.success && extraPatience < 60) {
      extraPatience += 8;
      for (const passenger of baseScenario.passengers) passenger.patience += 8;
      finalSim = simulate(baseScenario, baseline.policy);
    }

    if (finalSim.result?.success && finalSim.emergencyStops === 0) {
      return {
        ...baseScenario,
        generationAudit: {
          verified: true,
          attempt,
          baselineInterval: baseline.policy.interval,
          baselineStops: baseline.policy.stops.map((stop, index) =>
            stop ? STATIONS[index].name : null,
          ).filter(Boolean),
          baselineTime: Number(finalSim.time.toFixed(1)),
          baselineBattery: Number(finalSim.battery.toFixed(1)),
          baselinePickups: baseline.sim.passengers
            .map((passenger) => ({
              id: passenger.id,
              boardedAt: Number((passenger.boardedAt ?? 0).toFixed(1)),
            }))
            .sort((left, right) => left.boardedAt - right.boardedAt),
        },
        baselinePolicy: baseline.policy,
      };
    }
    baseScenario.passengers = makeDemand(rng);
  }

  throw new Error(`Unable to construct a verified baseline for seed ${seed}`);
}

export function verifyScenarioBaseline(scenario) {
  return simulate(scenario, scenario.baselinePolicy);
}

