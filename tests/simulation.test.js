import assert from "node:assert/strict";
import test from "node:test";
import {
  CROPS,
  GreenhouseGame,
  OVERHEAT_GRACE,
  WEATHER_EVENTS,
} from "../src/simulation.js";

function midpoint(range) {
  return (range[0] + range[1]) / 2;
}

function autopilot(game, dt = 0.1, { harvest = true } = {}) {
  for (const bed of game.beds) {
    if (bed.harvested) continue;
    const ideal = bed.crop.ideal;
    const moistureLow = ideal.moisture[0] + 5;
    const moistureHigh = ideal.moisture[1] - 3;
    const tempLow = midpoint(ideal.temperature) - 0.8;
    const tempHigh = midpoint(ideal.temperature) + 0.8;
    const lightHigh = ideal.light[1] - 2;

    if (bed.moisture <= moistureLow) game.setControl(bed.index, "irrigation", true);
    if (bed.moisture >= moistureHigh) game.setControl(bed.index, "irrigation", false);
    if (bed.temperature <= tempLow) {
      game.setControl(bed.index, "heating", true);
      game.setControl(bed.index, "ventilation", false);
    } else if (bed.temperature >= tempHigh) {
      game.setControl(bed.index, "heating", false);
      game.setControl(bed.index, "ventilation", true);
    } else {
      game.setControl(bed.index, "heating", false);
      game.setControl(bed.index, "ventilation", false);
    }
    game.setControl(bed.index, "shade", bed.light > lightHigh);
    if (harvest && bed.matured) game.harvest(bed.index);
  }
  game.tick(dt);
}

test("weather forecast arrives before every scripted event", () => {
  const game = new GreenhouseGame();
  for (const event of WEATHER_EVENTS) {
    assert.ok(event.forecastAt < event.startsAt);
    assert.ok(event.startsAt < event.endsAt);
    game.time = event.forecastAt;
    const weather = game.getWeatherAt(event.forecastAt);
    assert.equal(weather.forecast?.type, event.type);
    game.time = event.startsAt;
    assert.equal(game.getWeatherAt(event.startsAt).type, event.type);
  }
});

test("irrigation drains the tank and a dry tank ends the run", () => {
  const game = new GreenhouseGame();
  for (let index = 0; index < game.beds.length; index += 1) {
    game.setControl(index, "irrigation", true);
  }
  game.tick(12);
  assert.equal(game.status, "lost");
  assert.equal(game.failure?.code, "water");
  assert.equal(game.water, 0);
});

test("ignoring the heat event causes a continuous-overheat failure", () => {
  const game = new GreenhouseGame();
  const heatEvent = WEATHER_EVENTS.find((event) => event.type === "heat");
  game.time = heatEvent.startsAt - 0.1;
  game.weather = game.getWeatherAt(game.time);
  game.tick(heatEvent.endsAt - heatEvent.startsAt + 2);
  assert.equal(game.status, "lost");
  assert.equal(game.failure?.code, "overheat");
  const failedBed = game.beds[game.failure.bedIndex];
  assert.ok(failedBed.overheatTime >= OVERHEAT_GRACE);
});

test("a managed 90-second shift can mature and harvest all six beds", () => {
  const game = new GreenhouseGame();
  let guard = 0;
  while (game.status === "running" && guard < 1000) {
    autopilot(game);
    guard += 1;
  }

  assert.equal(game.status, "won", game.failure?.message);
  assert.ok(game.time <= 90);
  assert.ok(game.water > 0);
  assert.deepEqual(
    game.getBatchProgress().map((batch) => batch.harvested),
    [2, 2, 2],
  );
  assert.ok(game.beds.every((bed) => bed.growth === 100));
});

test("unharvested crops fail the shift when the 90-second clock expires", () => {
  const game = new GreenhouseGame();
  let guard = 0;
  while (game.status === "running" && guard < 1100) {
    autopilot(game, 0.1, { harvest: false });
    guard += 1;
  }

  assert.equal(game.status, "lost");
  assert.equal(game.failure?.code, "timeout");
  assert.equal(game.beds.filter((bed) => bed.harvested).length, 0);
});

test("three crop batches expose distinct climate bands", () => {
  const bands = Object.values(CROPS).map((crop) => crop.ideal);
  assert.equal(new Set(bands.map((band) => band.temperature.join("-"))).size, 3);
  assert.ok(CROPS.lettuce.ideal.temperature[0] < CROPS.tomato.ideal.temperature[0]);
  assert.ok(CROPS.tomato.ideal.temperature[0] < CROPS.basil.ideal.temperature[0]);
});
