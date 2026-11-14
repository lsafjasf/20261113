import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const port = 4201;
const server = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "inherit"],
});

await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("server start timeout")), 5000);
  server.stdout.on("data", (chunk) => {
    if (chunk.toString().includes("Snowline running")) {
      clearTimeout(timeout);
      resolve();
    }
  });
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.stack || error.message));

try {
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  assert.deepEqual(errors, []);

  await page.locator('[data-speed="4"]').click();
  await page.locator("#launchButton").click();
  await page.waitForSelector("#resultDialog[open]", { timeout: 55000 });

  const success = await page.evaluate(() => window.__SNOWLINE__.sim.result);
  assert.equal(success.success, true);
  assert.equal(success.delivered, 8);
  assert.ok(success.battery >= 20);
  assert.equal(success.emergencyStops, 0);
  await page.screenshot({ path: "artifacts/e2e-success.png" });
  console.log(
    `Successful shift: ${success.delivered}/8, battery ${success.battery.toFixed(1)}%, time ${success.time.toFixed(1)}s`,
  );

  await page.evaluate(() => {
    window.__SNOWLINE__.resetShift();
    const input = document.querySelector("#intervalInput");
    input.value = "8";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator("#launchButton").click();
  await page.waitForFunction(
    () => window.__SNOWLINE__.sim?.emergencyStops > 0,
    null,
    { timeout: 20000 },
  );
  const emergency = await page.evaluate(() => ({
    stops: window.__SNOWLINE__.sim.emergencyStops,
    events: window.__SNOWLINE__.sim.events
      .filter((event) => event.type === "emergency")
      .map((event) => event.text),
    followerState: window.__SNOWLINE__.sim.cars[1].state,
  }));
  assert.ok(emergency.stops >= 1);
  assert.match(emergency.events[0], /间距过近/);
  assert.equal(emergency.followerState, "emergency");
  await page.screenshot({ path: "artifacts/e2e-emergency.png" });

  await page.evaluate(() => window.__SNOWLINE__.fastForward(200));
  const failure = await page.evaluate(() => window.__SNOWLINE__.sim.result);
  assert.equal(failure.success, false);
  assert.equal(failure.reason, "battery");
  assert.ok(failure.emergencyStops >= 2);
  assert.ok(failure.battery < 20);
  console.log(
    `Over-dense shift: ${failure.emergencyStops} emergency stops, battery ${failure.battery.toFixed(2)}%`,
  );
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  server.kill("SIGTERM");
}

