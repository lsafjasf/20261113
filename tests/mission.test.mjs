import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const src = html.split("/* ===ENGINE=== */")[1].split("/* ===ENGINE_END=== */")[0];
const ctx = { Math, console };
vm.createContext(ctx);
vm.runInContext(src + "\nthis.exports = { CFG, generateWorld, createGame };", ctx);
const { CFG, generateWorld, createGame } = ctx.exports;
const test = (name, fn) => { fn(); console.log("  ok -", name); };
const dist3 = (d, ship) => (d.x - ship.x) ** 2 + (d.y - ship.y) ** 2;

// 经济导航：朝目标转向，脉冲加速 -> 惯性滑行 -> 基于停车距离反推，能拦截漂移目标
function autopilot(g, target, { arriveSpeed = 55, captureDist = 60, cruiseSpeed = 110 } = {}) {
  const s = g.state, ship = s.ship;
  const dx = target.x - ship.x, dy = target.y - ship.y;
  const dist = Math.hypot(dx, dy);
  const desired = Math.atan2(dy, dx);
  let diff = desired - ship.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const input = { thrust: false, brake: false, left: false, right: false, magnet: true };
  const radial = (ship.vx * dx + ship.vy * dy) / (dist || 1);
  const speed = Math.hypot(ship.vx, ship.vy);
  const headingToTarget = desired;
  const headingAgainstVelocity = Math.atan2(ship.vy, ship.vx) + Math.PI;
  // 残骸避让：航向锥内若有残骸，优先朝远离它的一侧偏转
  let avoid = 0;
  for (const w of g.state.world.wrecks) {
    const wx = w.x - ship.x, wy = w.y - ship.y;
    const wd = Math.hypot(wx, wy);
    const danger = w.r + CFG.SHIP.radius + 60;
    if (wd > danger + 120) continue;
    const bearing = Math.atan2(wy, wx) - ship.angle;
    let b = bearing;
    while (b > Math.PI) b -= Math.PI * 2;
    while (b < -Math.PI) b += Math.PI * 2;
    if (Math.abs(b) < 0.45 && wd < danger) {
      avoid = b >= 0 ? -1 : 1;
      break;
    }
  }
  const aligned = Math.abs(diff) < 0.6;
  // 第一步永远先把船头转到目标方向（避让时优先避让）
  if (avoid) {
    if (avoid > 0) input.right = true; else input.left = true;
    return input;
  }
  if (!aligned) {
    if (diff > 0) input.right = true; else input.left = true;
    return input;
  }
  const brakeAccel = CFG.SHIP.brake / ship.totalMass;
  const approachSpeed = Math.max(0, radial);
  const stopDist = (approachSpeed * approachSpeed) / (2 * brakeAccel) + 50;
  const effectiveCruise = ship.totalMass > 1.5 ? cruiseSpeed * 0.7 : cruiseSpeed;
  const isStation = target === g.state.world.station;
  if (isStation && dist < g.state.world.station.dockR && speed < CFG.SHIP.dockSpeed) {
    return input;
  }
  // 燃料紧张时进一步压低巡航速度，靠惯性滑行而非持续点火
  const fuelAwareCruise = ship.fuel < 40 ? effectiveCruise * 0.65 : effectiveCruise;
  // 边界防护：距外缘过近时，先把船头转向中心再反推，防止飞出场外被弹飞
  const r = Math.hypot(ship.x, ship.y);
  const edgeLimit = CFG.WORLD_R - 260;
  if (r > edgeLimit) {
    const toCenter = Math.atan2(-ship.y, -ship.x);
    let cd = toCenter - ship.angle;
    while (cd > Math.PI) cd -= Math.PI * 2;
    while (cd < -Math.PI) cd += Math.PI * 2;
    if (Math.abs(cd) > 0.25) {
      if (cd > 0) input.right = true; else input.left = true;
      return input;
    }
    input.brake = true;
    return input;
  }
  // 需要制动时，先把船头转到速度反方向再反推，避免“朝目标反推却越推越远”
  const needBrakeNow =
    speed > fuelAwareCruise + 20 ||
    (dist < 200 && speed > (ship.totalMass > 1.5 ? 70 : 90)) ||
    (dist <= stopDist && approachSpeed > arriveSpeed);
  if (needBrakeNow) {
    let vdiff = headingAgainstVelocity - ship.angle;
    while (vdiff > Math.PI) vdiff -= Math.PI * 2;
    while (vdiff < -Math.PI) vdiff += Math.PI * 2;
    if (Math.abs(vdiff) > 0.3) {
      if (vdiff > 0) input.right = true; else input.left = true;
      return input;
    }
    input.brake = true;
    return input;
  }
  if (dist > captureDist && speed < fuelAwareCruise) {
    input.thrust = true;
  }
  return input;
}

test("自动驾驶完整回收全部 4 块（含大型碎片）并胜利", () => {
  const world = generateWorld("MAGNET-2026");
  const g = createGame(world);
  const dt = 1 / 60;
  const big = world.debris[3];
  let heavySample = null;
  let frames = 0;

  // 阶段 1：直接把大型碎片移到船边并锁定（绕过“磁吸最近碎片”规则，专门考核大件拖曳）
  const ship = g.state.ship;
  ship.x = -600; ship.y = 500; ship.angle = 0; ship.vx = 0; ship.vy = 0;
  big.x = ship.x + 70; big.y = ship.y; big.vx = 0; big.vy = 0;
  ship.lockedId = big.id; big.locked = true; g.state.locked = big;
  assert.ok(g.state.locked === big, "应锁定大型碎片");

  // 阶段 2：拖回空间站，记录拖曳中的质量；先远离空间站避免提前触发对接
  ship.x = -700; ship.y = 700;
  big.x = ship.x + 70; big.y = ship.y;
  frames = 0;
  while (g.state.locked && frames++ < 60 * 90) {
    g.step(dt, autopilot(g, world.station));
    if (frames === 120) {
      heavySample = {
        mass: g.state.ship.totalMass,
        speed: Math.hypot(g.state.ship.vx, g.state.ship.vy)
      };
    }
  }
  assert.ok(big.collected, "大型碎片应已交付空间站");
  assert.ok(heavySample && heavySample.mass > 3.5, "拖大件时有效质量应远大于裸船");
  console.log("    拖大件回站采样:", JSON.stringify(heavySample));

  // 阶段 3：依次回收剩余碎片（磁力总是吸最近的一块，符合游戏规则）
  const remaining = () => world.debris.filter(d => !d.collected);
  while (remaining().length > 0) {
    const target = remaining().reduce((best, d) =>
      (!best || dist3(d, ship) < dist3(best, ship)) ? d : best, null);
    const before = g.state.collected;
    frames = 0;
    // 阶段 A：追目标直到锁定（若在对接圈内同帧交付，则 target.collected 直接变真）
    while (!g.state.locked && !target.collected && frames++ < 60 * 60 && g.state.status === "running") {
      g.step(dt, autopilot(g, target));
    }
    // 阶段 B：返航交付
    frames = 0;
    while (g.state.locked && frames++ < 60 * 90 && g.state.status === "running") {
      g.step(dt, autopilot(g, world.station));
    }
    assert.ok(target.collected || g.state.collected > before, "一块碎片应被回收");
  }

  assert.equal(g.state.collected, 4);
  assert.equal(g.state.status, "won");
  assert.ok(g.state.ship.hull > 0, "船体未损毁");
  console.log(`    任务用时 ${g.state.time.toFixed(1)}s，剩余燃料 ${g.state.ship.fuel.toFixed(0)}，船体 ${g.state.ship.hull.toFixed(0)}`);
});

test("对照：同一路线裸船与拖大件的速度爬升差异（实际拖带手感）", () => {
  function run(towBig) {
    const g = createGame(generateWorld("MAGNET-2026"));
    const ship = g.state.ship;
    ship.x = -900; ship.y = -900;
    if (towBig) {
      const d = g.state.world.debris[3];
      d.x = ship.x; d.y = ship.y - 60; d.vx = 0; d.vy = 0;
      ship.lockedId = d.id; d.locked = true; g.state.locked = d;
    }
    const dt = 1 / 60;
    for (let i = 0; i < 45; i++) g.step(dt, { thrust: true, magnet: towBig });
    return {
      mass: ship.totalMass,
      speed: Math.hypot(ship.vx, ship.vy)
    };
  }
  const solo = run(false);
  const tow = run(true);
  console.log("    裸船 0.75s 末速:", solo.speed.toFixed(1), "质量", solo.mass);
  console.log("    拖大件 0.75s 末速:", tow.speed.toFixed(1), "质量", tow.mass);
  assert.ok(tow.speed < solo.speed * 0.4, "拖大件时速度爬升应明显迟缓");
});

console.log("\n全部任务链路测试通过");
process.exit(0);
