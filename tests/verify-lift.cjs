const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const url = process.env.GAME_URL ?? "http://127.0.0.1:4186/";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function snapshot(page) {
  return page.evaluate(() => window.__craneGame.getSnapshot());
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(url, { waitUntil: "networkidle" });
  await page.click("#start-button");
  await sleep(250);

  await page.keyboard.down("w");
  await sleep(1200);
  await page.keyboard.up("w");
  await sleep(1100);

  await page.keyboard.down("Space");
  let attached = null;
  for (let index = 0; index < 35; index += 1) {
    await sleep(100);
    const state = await snapshot(page);
    if (state.crane.attachedId !== null) {
      attached = state;
      break;
    }
  }
  await page.keyboard.up("Space");
  assert.ok(attached, "hook should latch onto a staged cargo box");
  await sleep(850);

  const before = await snapshot(page);
  await page.keyboard.down("s");
  await sleep(160);
  const accelerating = await snapshot(page);
  await sleep(700);
  const cruising = await snapshot(page);
  await page.keyboard.up("s");
  await sleep(140);
  const braking = await snapshot(page);
  await sleep(650);
  const swinging = await snapshot(page);
  await page.keyboard.down("a");
  await sleep(320);
  const slewing = await snapshot(page);
  await page.keyboard.up("a");
  await page.screenshot({ path: "artifacts/verified-lift.png" });

  const traveled = Math.abs(
    cruising.crane.carriedCargo.x - before.crane.carriedCargo.x,
  );
  const degrees = (radians) => radians * 180 / Math.PI;
  const swingDelta = Math.max(
    Math.abs(degrees(cruising.crane.swingAngle) - degrees(before.crane.swingAngle)),
    Math.abs(degrees(swinging.crane.swingAngle) - degrees(braking.crane.swingAngle)),
  );

  assert.ok(Math.abs(accelerating.crane.trolleyAcceleration) > 100, "trolley must accelerate");
  assert.ok(traveled > 100, "cargo must move at least 100 px");
  assert.equal(braking.crane.braking, true, "releasing throttle must engage braking");
  assert.ok(Math.abs(braking.crane.trolleyAcceleration) > 300, "braking must produce deceleration");
  assert.ok(swingDelta > 5, "swing angle must react to acceleration and braking");
  assert.ok(cruising.crane.motorLoad > 0.5, "motor load must follow movement");
  assert.ok(
    Math.abs(slewing.crane.angle - swinging.crane.angle) > 0.01,
    "A/D must rotate the boom",
  );
  assert.deepEqual(pageErrors, [], "page must not throw runtime errors");

  console.log(JSON.stringify({
    attachedCargo: before.crane.attachedId,
    weight: before.crane.carryingWeight,
    traveledPx: Number(traveled.toFixed(1)),
    acceleration: Number(accelerating.crane.trolleyAcceleration.toFixed(1)),
    brakeDeceleration: Number(braking.crane.trolleyAcceleration.toFixed(1)),
    swingBefore: Number(degrees(before.crane.swingAngle).toFixed(1)),
    swingWhileMoving: Number(degrees(cruising.crane.swingAngle).toFixed(1)),
    swingAfterBrake: Number(degrees(swinging.crane.swingAngle).toFixed(1)),
    motorLoad: cruising.crane.motorLoad,
    braking: braking.crane.braking,
    slewDeltaDeg: Number(degrees(slewing.crane.angle - swinging.crane.angle).toFixed(1)),
  }, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
