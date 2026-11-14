import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const PORT = 4407;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return;
    } catch {
      // The server needs a moment to bind to the port.
    }
    await delay(100);
  }
  throw new Error("Preview server did not start.");
}

const server = spawn(process.execPath, ["server.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__greenhouse?.phase === "ready");
  await page.screenshot({ path: "artifacts/01-intro.png", fullPage: true });
  await page.click("#start-button");
  await page.waitForFunction(() => window.__greenhouse?.phase === "running");

  await page.keyboard.press("p");
  assert.equal(await page.evaluate(() => window.__greenhouse.phase), "paused");
  await page.waitForTimeout(260);
  assert.equal(await page.locator("#pause-overlay").isVisible(), true);
  await page.click("#resume-button");
  assert.equal(await page.evaluate(() => window.__greenhouse.phase), "running");

  await page.keyboard.press("2");
  await page.keyboard.press("q");
  const smoke = await page.evaluate(() => ({
    selected: window.__greenhouse.selectedIndex,
    irrigation: window.__greenhouse.game.beds[1].controls.irrigation,
    pressed: document.querySelector('[data-control="irrigation"]').getAttribute("aria-pressed"),
  }));
  assert.equal(smoke.selected, 1);
  assert.equal(smoke.irrigation, true);
  assert.equal(smoke.pressed, "true");
  await page.keyboard.press("q");
  assert.equal(await page.evaluate(() => window.__greenhouse.game.beds[1].controls.irrigation), false);

  const victory = await page.evaluate(() => {
    const gh = window.__greenhouse;
    const game = gh.game;
    const midpoint = (range) => (range[0] + range[1]) / 2;
    const weatherSeen = new Set();

    for (let iteration = 0; iteration < 1000 && gh.phase === "running"; iteration += 1) {
      if (game.weather.active) weatherSeen.add(game.weather.type);
      for (const bed of game.beds) {
        if (bed.harvested) continue;
        const ideal = bed.crop.ideal;
        const moistureLow = ideal.moisture[0] + 5;
        const moistureHigh = ideal.moisture[1] - 3;
        const tempLow = midpoint(ideal.temperature) - 0.8;
        const tempHigh = midpoint(ideal.temperature) + 0.8;
        const lightHigh = ideal.light[1] - 2;

        game.setControl(
          bed.index,
          "irrigation",
          bed.moisture <= moistureLow ? true : bed.moisture >= moistureHigh ? false : bed.controls.irrigation,
        );
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
        if (bed.matured) game.harvest(bed.index);
      }
      gh.step(0.1);
    }

    return {
      phase: gh.phase,
      status: game.status,
      failure: game.failure,
      time: game.time,
      water: game.water,
      batches: game.getBatchProgress(),
      harvested: game.beds.filter((bed) => bed.harvested).length,
      weatherSeen: [...weatherSeen],
    };
  });

  assert.equal(victory.phase, "ended");
  assert.equal(victory.status, "won", victory.failure?.message);
  assert.equal(victory.harvested, 6);
  assert.deepEqual(
    victory.batches.map((batch) => batch.harvested),
    [2, 2, 2],
  );
  assert.ok(victory.water > 0);
  assert.deepEqual(victory.weatherSeen.sort(), ["cloud", "cold", "heat"]);
  await page.waitForTimeout(250);
  assert.equal(await page.locator("#result-overlay").isVisible(), true);
  assert.match(await page.locator("#result-title").textContent(), /全部入库/);
  await page.screenshot({ path: "artifacts/02-victory.png", fullPage: true });
  console.log(
    `Victory: ${victory.time.toFixed(1)}s, ${victory.harvested}/6 beds, ${victory.water.toFixed(1)} L remaining`,
  );

  await page.click("#retry-button");
  await page.waitForFunction(() => window.__greenhouse.phase === "running");
  const dryRun = await page.evaluate(() => {
    const gh = window.__greenhouse;
    for (const bed of gh.game.beds) gh.game.setControl(bed.index, "irrigation", true);
    gh.step(12);
    return {
      phase: gh.phase,
      status: gh.game.status,
      failure: gh.game.failure,
      water: gh.game.water,
    };
  });
  assert.equal(dryRun.status, "lost");
  assert.equal(dryRun.failure?.code, "water");
  assert.equal(dryRun.water, 0);
  await page.waitForTimeout(200);
  assert.match(await page.locator("#result-title").textContent(), /水箱/);
  await page.screenshot({ path: "artifacts/03-water-failure.png", fullPage: true });
  console.log(`Water failure: ${dryRun.failure.message}`);

  await page.click("#retry-button");
  await page.waitForFunction(() => window.__greenhouse.phase === "running");
  const heatRun = await page.evaluate(() => {
    const gh = window.__greenhouse;
    gh.step(47.9);
    gh.step(14);
    return {
      phase: gh.phase,
      status: gh.game.status,
      failure: gh.game.failure,
      time: gh.game.time,
      bed: gh.game.failure ? gh.game.beds[gh.game.failure.bedIndex] : null,
    };
  });
  assert.equal(heatRun.status, "lost");
  assert.equal(heatRun.failure?.code, "overheat");
  assert.ok(heatRun.bed.temperature > 31.8);
  await page.waitForTimeout(200);
  assert.match(await page.locator("#result-title").textContent(), /烧过/);
  await page.screenshot({ path: "artifacts/04-heat-failure.png", fullPage: true });
  console.log(`Heat failure: ${heatRun.failure.message}`);

  assert.deepEqual(errors, []);
  await browser.close();
  console.log("Browser playthrough passed with no page errors.");
} finally {
  server.kill("SIGTERM");
}
