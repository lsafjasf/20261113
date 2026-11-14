import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const src = html.split("/* ===ENGINE=== */")[1].split("/* ===ENGINE_END=== */")[0];
const ctx = { Math, console };
vm.createContext(ctx);
vm.runInContext(src + "\nthis.exports = { CFG, generateWorld, createGame };", ctx);
const { CFG, generateWorld, createGame } = ctx.exports;

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("  ok -", name); };

test("同 seed 生成完全一致，异 seed 不同", () => {
  const a = generateWorld("MAGNET-2026");
  const b = generateWorld("MAGNET-2026");
  const c = generateWorld("OTHER-SEED-7");
  assert.deepEqual(JSON.parse(JSON.stringify(a.debris)), JSON.parse(JSON.stringify(b.debris)));
  assert.deepEqual(a.wrecks, b.wrecks);
  assert.deepEqual(a.storms, b.storms);
  assert.notDeepEqual(a.debris, c.debris);
});

test("多 seed 下无重叠、碎片可接近、空间站未被包围", () => {
  for (const seed of ["MAGNET-2026", "alpha", "seed-001", "9999", "风暴清扫", "x"]) {
    const w = generateWorld(seed);
    for (let i = 0; i < w.wrecks.length; i++) {
      for (let j = i + 1; j < w.wrecks.length; j++) {
        const gap = Math.hypot(w.wrecks[i].x - w.wrecks[j].x, w.wrecks[i].y - w.wrecks[j].y);
        assert.ok(gap >= w.wrecks[i].r + w.wrecks[j].r + 70, `wreck overlap ${seed}`);
      }
    }
    for (const d of w.debris) {
      assert.ok(Math.hypot(d.x, d.y) + d.r + 120 <= CFG.WORLD_R, `debris out of bounds ${seed}`);
      for (const w2 of w.wrecks) {
        const gap = Math.hypot(d.x - w2.x, d.y - w2.y);
        assert.ok(gap >= d.r + w2.r + 110, `debris blocked by wreck ${seed}`);
      }
      assert.ok(Math.hypot(d.x, d.y) >= CFG.STATION.r + d.r + 320);
    }
    // 复刻引擎的通道检查
    let open = 0;
    for (let i = 0; i < 24; i++) {
      const ang = (i / 24) * Math.PI * 2;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      let blocked = false;
      for (const w2 of w.wrecks) {
        const proj = w2.x * dx + w2.y * dy;
        if (proj < 0 || proj > 430) continue;
        const perp2 = (w2.x - proj * dx) ** 2 + (w2.y - proj * dy) ** 2;
        if (perp2 < w2.r * w2.r) { blocked = true; break; }
      }
      if (!blocked) open++;
    }
    assert.ok(open >= 6, `station enclosed ${seed} open=${open}`);
    assert.equal(w.debris.length, 4);
  }
});

test("风暴日程确定且周期落在配置区间", () => {
  const w = generateWorld("MAGNET-2026");
  assert.ok(w.storms.length >= 3);
  for (const s of w.storms) {
    assert.ok(s.duration >= CFG.STORM.durMin && s.duration <= CFG.STORM.durMax);
    assert.ok(s.start >= CFG.STORM.first);
  }
  const w2 = generateWorld("MAGNET-2026");
  assert.deepEqual(w.storms, w2.storms);
});

test("飞船保留惯性：松开推进后速度保持（阻尼极弱）", () => {
  const g = createGame(generateWorld("MAGNET-2026"));
  g.state.ship.x = -68; g.state.ship.y = 292;
  const dt = 1 / 60;
  for (let i = 0; i < 60; i++) g.step(dt, { thrust: true });
  const v1 = Math.hypot(g.state.ship.vx, g.state.ship.vy);
  for (let i = 0; i < 120; i++) g.step(dt, {});
  const v2 = Math.hypot(g.state.ship.vx, g.state.ship.vy);
  assert.ok(v1 > 100);
  assert.ok(v2 / v1 > 0.9, `惯性衰减过快 ${v2 / v1}`);
});

test("拖带大型碎片后加速与转向都明显变重（真实物理，非 HUD 数字）", () => {
  const measure = (lockBig) => {
    const g = createGame(generateWorld("MAGNET-2026"));
    const { ship } = g.state;
    if (lockBig) {
      const big = g.state.world.debris[3]; // r=40 最大碎片
      big.x = ship.x; big.y = ship.y - 60;
      ship.lockedId = big.id; big.locked = true; g.state.locked = big;
    }
    const dt = 1 / 60;
    const v0 = { ...ship };
    for (let i = 0; i < 30; i++) g.step(dt, { thrust: true, right: true, magnet: lockBig });
    const linAcc = Math.hypot(ship.vx, ship.vy) / (30 * dt);
    const angAcc = Math.abs(ship.angle - v0.angle) / (30 * dt);
    return { linAcc, angAcc, mass: ship.totalMass };
  };
  const solo = measure(false);
  const tow = measure(true);
  console.log("    单机:", JSON.stringify(solo));
  console.log("    拖大件:", JSON.stringify(tow));
  assert.ok(tow.mass > solo.mass * 3, "有效质量应显著上升");
  assert.ok(tow.linAcc < solo.linAcc * 0.45, "线加速度应大幅下降");
  assert.ok(tow.angAcc < solo.angAcc * 0.45, "转向应明显发沉");
});

test("绳索约束把碎片拉住且不会压缩穿透", () => {
  const g = createGame(generateWorld("MAGNET-2026"));
  const { ship } = g.state;
  ship.x = -600; ship.y = 500;
  ship.angle = 0;
  const d = g.state.world.debris[3];
  d.x = ship.x + 70; d.y = ship.y;
  d.vx = 0; d.vy = 0;
  ship.lockedId = d.id; d.locked = true; g.state.locked = d;
  const dt = 1 / 60;
  let maxLen = 0;
    for (let i = 0; i < 240; i++) {
    g.step(dt, { thrust: true, magnet: true });
    maxLen = Math.max(maxLen, Math.hypot(d.x - ship.x, d.y - ship.y));
  }
  assert.ok(maxLen <= CFG.TETHER.rest + 6, `绳长越界 ${maxLen}`);
  assert.ok(Math.hypot(d.x - ship.x, d.y - ship.y) > 40, "碎片应被拖走而非原地不动");
});

test("磁力在范围内自动锁定且只锁定一块", () => {
  const g = createGame(generateWorld("MAGNET-2026"));
  const { ship } = g.state;
  const d0 = g.state.world.debris[0];
  d0.x = ship.x + 100; d0.y = ship.y;
  g.step(1 / 60, { magnet: true });
  assert.equal(ship.lockedId, 0);
  const d1 = g.state.world.debris[1];
  d1.x = ship.x + 50; d1.y = ship.y;
  g.step(1 / 60, { magnet: true });
  assert.equal(ship.lockedId, 0, "已锁定时不切换目标");
  g.step(1 / 60, { magnet: false });
  assert.equal(ship.lockedId, -1);
});

test("停靠交付碎片，集齐 4 块胜利", () => {
  const g = createGame(generateWorld("MAGNET-2026"));
  const { ship } = g.state;
  for (const d of g.state.world.debris) {
    ship.x = 30; ship.y = 0; ship.vx = 0; ship.vy = 0;
    d.x = ship.x + 70; d.y = ship.y;
    g.step(1 / 60, { magnet: true });
    assert.ok(d.collected);
    assert.equal(ship.lockedId, -1);
  }
  assert.equal(g.state.collected, 4);
  assert.equal(g.state.status, "won");
});

test("三种失败路径：耐久归零 / 超时 / 燃料耗尽", () => {
  let g = createGame(generateWorld("MAGNET-2026"));
  g.state.ship.hull = 0;
  g.step(1 / 60, {});
  assert.equal(g.state.status, "lost");

  g = createGame(generateWorld("MAGNET-2026"));
  g.state.time = CFG.TIME_LIMIT - 0.001;
  g.step(1 / 60, {});
  assert.equal(g.state.status, "lost");

  g = createGame(generateWorld("MAGNET-2026"));
  g.state.ship.fuel = 1;
  g.state.ship.x = 1500; // 远离空间站
  for (let i = 0; i < 60 * (CFG.FUEL_GRACE + 1); i++) g.step(1 / 60, { thrust: true });
  assert.equal(g.state.status, "lost");
});

test("风暴激活时对飞船施加持续推力", () => {
  const g = createGame(generateWorld("MAGNET-2026"));
  const storm = g.state.world.storms[0];
  g.state.time = storm.start + 0.01;
  const before = { ...g.state.ship };
  for (let i = 0; i < 60; i++) g.step(1 / 60, {});
  const dvx = g.state.ship.vx - before.vx;
  const dvy = g.state.ship.vy - before.vy;
  const expectedAng = Math.atan2(dvy, dvx);
  let diff = Math.abs(expectedAng - storm.angle);
  diff = Math.min(diff, Math.PI * 2 - diff);
  assert.ok(diff < 0.1, "推力方向应与风暴方向一致");
  assert.ok(Math.hypot(dvx, dvy) > 10);
});

console.log(`\n全部 ${passed} 项引擎测试通过`);
