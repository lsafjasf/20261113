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
await new Promise((r) => server.listen(7785, r));
const browser = await chromium.launch({ env: { ...process.env, LD_LIBRARY_PATH: `${process.env.HOME}/chromelibs/extracted/usr/lib/x86_64-linux-gnu` } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto("http://127.0.0.1:7785/?seed=ferry-2026");
await page.click("#btn-start");
// Shrink all patience so a leave happens quickly; stay docked (idle).
await page.evaluate(() => {
  const g = window.__ferry.game;
  g.waiting.forEach((p) => { p.patienceLeft = 1.5; });
});
await page.waitForTimeout(2600);
const after = await page.evaluate(() => {
  const g = window.__ferry.game;
  return {
    leaving: g.leavingCount,
    replacements: g.waiting.filter((p) => p.replacement).length,
    totalWaiting: g.waiting.length,
    initialLeft: g.waiting.every((p) => p.patienceLeft > 1),
  };
});
console.log(JSON.stringify({ after, errors }, null, 2));
const ok = after.leaving >= 1 && after.replacements >= 1 && errors.length === 0;
await browser.close(); server.close();
if (!ok) { console.error("PATIENCE TEST FAILED"); process.exit(1); }
console.log("PATIENCE/REPLACEMENT OK");
