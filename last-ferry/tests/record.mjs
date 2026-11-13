// Produces the three demo recordings:
//  - load-change.webm : board passengers, visibly changing load / speed
//  - timeout-fail.webm: idle until the 150s clock runs out (sped up)
//  - win-run.webm     : a complete successful dispatch
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const outDir = join(root, "recordings");
await mkdir(outDir, { recursive: true });
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
await new Promise((r) => server.listen(7782, r));

const launch = () =>
  chromium.launch({
    env: { ...process.env, LD_LIBRARY_PATH: `${process.env.HOME}/chromelibs/extracted/usr/lib/x86_64-linux-gnu` },
    args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
  });

// One docking decision, executed in the browser: board everyone possible,
// then sail toward the most useful next island.
async function autopilotStep(page) {
  return page.evaluate(() => {
    const g = window.__ferry.game;
    const s = g.snapshot();
    if (s.phase !== "docked" || s.over) return s;
    for (const p of s.waitingByIsland[s.dockedIsland]) {
      if (g.snapshot().onboard.length < 4) g.boardPassenger(p.id);
    }
    const snap = g.snapshot();
    const targets = new Set(snap.onboard.map((p) => p.to));
    if (targets.size === 0) {
      snap.waiting.filter((p) => p.from === snap.dockedIsland).forEach((p) => targets.add(p.to));
    }
    if (targets.size === 0) {
      for (let i = 0; i < 3; i++) {
        if (i !== snap.dockedIsland && snap.waitingByIsland[i].length) targets.add(i);
      }
    }
    if (targets.size === 0) targets.add((snap.dockedIsland + 1) % 3);
    g.setDestination([...targets][0]);
    return g.snapshot();
  });
}

async function runScenario(name, { timeScale, win, idle }) {
  const browser = await launch();
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    recordVideo: { dir: outDir, size: { width: 1400, height: 900 } },
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:7782/?seed=ferry-2026");
  await page.click("#btn-start");
  await page.evaluate((scale) => window.__ferry.setTimeScale(scale), timeScale);

  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (!idle) await autopilotStep(page);
    const s = await page.evaluate(() => window.__ferry.game.snapshot());
    if (s.over) {
      if (win && !s.over.win) throw new Error(`${name}: expected win, got ${s.over.reason}`);
      if (!win && s.over.win) throw new Error(`${name}: expected failure, got win`);
      break;
    }
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(1200); // let the end overlay settle on video
  await context.close();
  await browser.close();
}

// 1) Load change showcase: normal speed, sail one leg with an increasing load.
{
  const browser = await launch();
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    recordVideo: { dir: outDir, size: { width: 1400, height: 900 } },
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:7782/?seed=ferry-2026");
  await page.click("#btn-start");
  await page.waitForTimeout(600);
  // Board up to four passengers one by one so the load counter and speed drop
  // are clearly visible, then depart.
  await page.evaluate(() => {
    const g = window.__ferry.game;
    const s = g.snapshot();
    s.waitingByIsland[s.dockedIsland].slice(0, 4).forEach((p) => g.boardPassenger(p.id));
  });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const g = window.__ferry.game;
    const target = g.snapshot().onboard[0]?.to ?? 1;
    g.setDestination(target);
  });
  await page.waitForTimeout(9000);
  await context.close();
  await browser.close();
}

// Rename Playwright's generated webm files after each scenario by re-recording
// sequentially and moving the newest file.
async function newestVideo(label) {
  const { readdirSync, renameSync, statSync } = await import("node:fs");
  const files = readdirSync(outDir).filter((f) => f.endsWith(".webm"));
  const newest = files
    .map((f) => [f, join(outDir, f)])
    .sort((a, b) => statSync(b[1]).mtimeMs - statSync(a[1]).mtimeMs)[0];
  if (newest) renameSync(newest[1], join(outDir, `${label}.webm`));
}

await newestVideo("load-change");
await runScenario("timeout", { timeScale: 6, win: false, idle: true });
await newestVideo("timeout-fail");
await runScenario("win", { timeScale: 4, win: true, idle: false });
await newestVideo("win-run");

server.close();
console.log("recordings written to", outDir);
