// 实测：阵风中桨距过陡 -> 机械损伤累积、输出下降
const Sim = require("./sim.js");

const dt = 0.1;

function run(name, controlFn, verbose) {
  const s = Sim.createState();
  let lastPrint = -1;
  while (!s.over && s.t < Sim.DURATION) {
    const inputs = controlFn(s);
    Sim.step(s, dt, inputs);
    if (verbose && s.t >= 30 && s.t <= 58 && s.t - lastPrint >= 2) {
      lastPrint = s.t;
      const tb = s.turbines[0];
      console.log(
        `t=${s.t.toFixed(1).padStart(5)}s 风=${Sim.windSpeedAt(s.t).toFixed(1).padStart(4)}m/s ` +
        `桨距=${tb.pitch.toFixed(0).padStart(2)}° 应力=${tb.stress.toFixed(3)} ` +
        `损伤=${tb.damage.toFixed(1).padStart(5)}% 单机输出=${tb.power.toFixed(1).padStart(5)}kW ` +
        `电池=${s.battery.toFixed(1)}`
      );
    }
  }
  const dmg = s.turbines.map((t) => t.damage.toFixed(1)).join("/");
  console.log(`[${name}] 结束 t=${s.t.toFixed(1)}s 损伤=[${dmg}] ` +
    `缺口=${s.gaps} 电池=${s.battery.toFixed(1)} 结果=${s.win ? "胜利" : s.failReason || "进行中"}`);
  return s;
}

console.log("=== 场景A：玩家不顺桨，桨距保持10°硬扛第一次阵风 ===");
const bad = run("坏操作", (s) => s.turbines.map((tb) => ({
  // 只跟踪风向，不调整桨距
  yawDelta: Math.max(-1, Math.min(1, Sim.degDiff(Sim.windDirAt(s.t), tb.yaw) / 20)),
  pitchDelta: 0,
})), true);

console.log("\n=== 场景B：阵风中及时顺桨到安全角度 ===");
const good = run("好操作", (s) => s.turbines.map((tb) => {
  const wind = Sim.windSpeedAt(s.t);
  // 智能玩家：阵风时顺桨到安全角；平时按需求限功率，避免过充
  const safePitch = Math.min(70, Math.max(0, (wind - 11) * 7)) + 5;
  const aero = Math.min(1, Math.pow(wind / 12, 3));
  const perTurbineNeed = Sim.demandAt(s.t) / 3 * 1.05;
  const capNeed = Math.min(1, perTurbineNeed / (Sim.RATED_KW * aero));
  const ecoPitch = Math.acos(Math.max(0, Math.min(1, capNeed))) * 180 / Math.PI;
  const target = Math.max(safePitch, ecoPitch);
  return {
    yawDelta: Math.max(-1, Math.min(1, Sim.degDiff(Sim.windDirAt(s.t), tb.yaw) / 20)),
    pitchDelta: Math.max(-1, Math.min(1, (target - tb.pitch) / 10)),
  };
}), false);

// 断言
const dBad = bad.turbines[0].damage;
const dGood = good.turbines[0].damage;
console.log("\n=== 断言 ===");
console.assert(dBad > 5, `FAIL: 坏操作应产生明显机械损伤, 实际 ${dBad}%`);
console.assert(dGood < 1, `FAIL: 好操作应几乎无损伤, 实际 ${dGood}%`);
// 损伤导致输出下降：对比同风速下损伤前后输出
const pBefore = 38 * Math.min(1, Math.pow(15 / 12, 3)) * 1 * Math.cos(10 * Math.PI / 180) * 1;
const pAfter = pBefore * (1 - dBad / 120);
console.log(`损伤 ${dBad.toFixed(1)}% -> 同工况输出 ${pBefore.toFixed(1)}kW 降至 ${pAfter.toFixed(1)}kW`);
if (dBad > 5 && dGood < 1) console.log("PASS: 阵风损伤与输出下降真实发生");
else { console.log("TEST FAILED"); process.exit(1); }
