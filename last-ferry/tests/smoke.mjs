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

await new Promise((r) => server.listen(7781, r));
const browser = await chromium.launch({
  env: { ...process.env, LD_LIBRARY_PATH: `${process.env.HOME}/chromelibs/extracted/usr/lib/x86_64-linux-gnu` },
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto("http://127.0.0.1:7781/?seed=ferry-2026");
await page.click("#btn-start");
await page.waitForFunction(() => window.__ferry.game.phase === "docked");

// Drive a winning run: at every dock, board all boardable waiters, then sail
// to an island where at least one onboard passenger (or a known waiter) needs.
async function chooseNext() {
  const g = window.__ferry.game;
  const s = g.snapshot();
  if (s.phase !== "docked") return s;
  for (const p of s.waitingByIsland[s.dockedIsland]) {
    if (s.onboard.length < 4) g.boardPassenger(p.id);
  }
  const snap = g.snapshot();
  const targets = new Set();
  snap.onboard.forEach((p) => targets.add(p.to));
  if (targets.size === 0) {
    snap.waiting.filter((p) => p.from === snap.dockedIsland).forEach((p) => targets.add(p.to));
  }
  if (targets.size === 0) {
    for (let i = 0; i < 3; i++) if (i !== snap.dockedIsland && snap.waitingByIsland[i].length) targets.add(i);
  }
  if (targets.size === 0) targets.add((snap.dockedIsland + 1) % 3);
  g.setDestination([...targets][0]);
  return g.snapshot();
}

let docks = 0;
let lastDockTime = -1;
const deadline = Date.now() + 60000;
while (Date.now() < deadline) {
  const s = await page.evaluate(chooseNext);
  if (s && s.phase === "docked" && s.time !== lastDockTime) { lastDockTime = s.time; docks++; }
  if (s.over) break;
  await page.waitForTimeout(150);
}

const end = await page.evaluate(() => {
  const g = window.__ferry.game;
  return { over: g.over, delivered: g.deliveredCount, fuel: g.fuel, time: g.time, waiting: g.waiting.length };
});
end.docks = docks;

// Pause freeze check on a fresh run.
await page.click("#btn-replay");
await page.waitForFunction(() => window.__ferry.game.phase === "docked");
const before = await page.evaluate(() => {
  const g = window.__ferry.game;
  const t = g.time;
  g.togglePause();
  return t;
});
await page.waitForTimeout(700);
const pausedAt = await page.evaluate(() => ({ t: window.__ferry.game.time, paused: window.__ferry.game.paused }));
await page.click("#btn-pause"); // resume
await page.waitForTimeout(700);
await page.waitForTimeout(300);
const resumedAt = await page.evaluate(() => window.__ferry.game.time);

console.log(JSON.stringify({ end, before, pausedAt, resumedAt, errors }, null, 2));

const ok =
  errors.length === 0 &&
  end.over?.win === true &&
  end.delivered === 8 &&
  end.fuel > 0 &&
  pausedAt.t === before &&
  pausedAt.paused === true &&
  resumedAt > before;

await browser.close();
server.close();
if (!ok) { console.error("SMOKE FAILED"); process.exit(1); }
console.log("SMOKE OK");
