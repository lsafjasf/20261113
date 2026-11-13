// Verifies the fuel failure path: with a deliberately tiny tank the mission
// must end as a fuel-out failure while there is still time on the clock.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer(async (req, res) => {
  const path = req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0];
  try {
    const data = await readFile(join(root, path));
    res.writeHead(200, { "content-type": mime[extname(path)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((r) => server.listen(7783, r));

const browser = await chromium.launch({
  env: { ...process.env, LD_LIBRARY_PATH: `${process.env.HOME}/chromelibs/extracted/usr/lib/x86_64-linux-gnu` },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto("http://127.0.0.1:7783/?seed=ferry-2026");
await page.click("#btn-start");
await page.evaluate(() => {
  const g = window.__ferry.game;
  g.fuel = 1.2;
  g.fuelTank = 1.2;
  const s = g.snapshot();
  s.waitingByIsland[0].slice(0, 4).forEach((p) => g.boardPassenger(p.id));
  g.setDestination(g.snapshot().onboard[0].to);
});

await page.waitForFunction(() => window.__ferry.game.over !== null, null, { timeout: 20000 });
const result = await page.evaluate(() => {
  const g = window.__ferry.game;
  return { over: g.over, timeLeft: g.timeLeft, fuel: g.fuel };
});

console.log(JSON.stringify(result, null, 2));
const ok =
  errors.length === 0 &&
  result.over.win === false &&
  result.over.reason.includes("燃油") &&
  result.timeLeft > 100 &&
  result.fuel === 0;

await browser.close();
server.close();
if (!ok) { console.error("FUEL TEST FAILED"); process.exit(1); }
console.log("FUEL FAIL PATH OK");
