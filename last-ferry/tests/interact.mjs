import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
const root = new URL("..", import.meta.url).pathname;
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer(async (req, res) => {
  const p = req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0];
  try { const d = await readFile(join(root, p)); res.writeHead(200, { "content-type": mime[extname(p)] ?? "application/octet-stream" }); res.end(d); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(7784, r));
const browser = await chromium.launch({ env: { ...process.env, LD_LIBRARY_PATH: `${process.env.HOME}/chromelibs/extracted/usr/lib/x86_64-linux-gnu` } });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto("http://127.0.0.1:7784/?seed=ferry-2026");
await page.screenshot({ path: "recordings/frames/start.png" });
await page.click("#btn-start");
// real canvas click on island 1 (lighthouse)
const box = await page.locator("#sea").boundingBox();
await page.mouse.click(box.x + 800, box.y + 130);
await page.waitForTimeout(500);
const sailing = await page.evaluate(() => window.__ferry.game.snapshot());
// pause banner visibility
await page.click("#btn-pause");
await page.waitForTimeout(200);
const bannerVisible = await page.locator("#pause-banner").isVisible();
const t1 = await page.evaluate(() => window.__ferry.game.time);
await page.waitForTimeout(500);
const t2 = await page.evaluate(() => window.__ferry.game.time);
await page.click("#btn-pause");
// restart button mid-game
await page.click("#btn-restart");
await page.waitForTimeout(200);
const restarted = await page.evaluate(() => ({ t: window.__ferry.game.time, delivered: window.__ferry.game.deliveredCount, phase: window.__ferry.game.phase }));
await page.screenshot({ path: "recordings/frames/restart.png" });
console.log(JSON.stringify({ sailingPhase: sailing.phase, target: sailing.targetIsland, bannerVisible, frozen: t1 === t2, restarted, errors }, null, 2));
const ok = sailing.phase === "sailing" && sailing.targetIsland === 1 && bannerVisible && t1 === t2 && restarted.t < 1 && restarted.delivered === 0 && errors.length === 0;
await browser.close(); server.close();
if (!ok) { console.error("INTERACT FAILED"); process.exit(1); }
console.log("INTERACT OK");
