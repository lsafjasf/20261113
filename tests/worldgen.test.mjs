import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const src = html.split("/* ===ENGINE=== */")[1].split("/* ===ENGINE_END=== */")[0];
const ctx = { Math, console };
vm.createContext(ctx);
vm.runInContext(src + "\nthis.exports = { CFG, generateWorld };", ctx);
const { CFG, generateWorld } = ctx.exports;

function openCorridors(wrecks) {
  let open = 0;
  for (let i = 0; i < 24; i++) {
    const ang = (i / 24) * Math.PI * 2;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    let blocked = false;
    for (const w of wrecks) {
      const proj = w.x * dx + w.y * dy;
      if (proj < 0 || proj > 430) continue;
      if ((w.x - proj * dx) ** 2 + (w.y - proj * dy) ** 2 < w.r * w.r) {
        blocked = true; break;
      }
    }
    if (!blocked) open++;
  }
  return open;
}

const seeds = ["MAGNET-2026", "alpha", "seed-001", "9999", "风暴清扫", "x",
  "orbital-7", "zero", "2026", "deep-space"];

for (const seed of seeds) {
  const w = generateWorld(seed);
  assert.equal(w.debris.length, 4, seed + " 应有 4 块碎片");
  assert.ok(w.wrecks.length >= 15, seed + " 残骸数量不足");
  for (const d of w.debris) {
    assert.ok(Math.hypot(d.x, d.y) + d.r + 120 <= CFG.WORLD_R, seed + " 碎片越界");
    for (const wr of w.wrecks) {
      assert.ok(Math.hypot(d.x - wr.x, d.y - wr.y) >= d.r + wr.r + 110,
        seed + " 碎片被残骸卡住");
    }
  }
  assert.ok(openCorridors(w.wrecks) >= 6, seed + " 空间站被包围");
  // 同 seed 确定性
  assert.deepEqual(generateWorld(seed).debris, w.debris, seed + " 不确定");
}

console.log(`跨 ${seeds.length} 个 seed 的世界生成约束全部合格`);
process.exit(0);
