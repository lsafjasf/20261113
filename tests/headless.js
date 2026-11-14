(function () {
  "use strict";

  var fs = require("fs");
  var path = require("path");
  var vm = require("vm");

  var root = path.join(__dirname, "..", "js");
  ["config.js", "rng.js", "world.js", "simulation.js"].forEach(function (file) {
    var code = fs.readFileSync(path.join(root, file), "utf8");
    vm.runInThisContext(code, { filename: file });
  });

  var FP = globalThis.FP;
  var DT = FP.CONFIG.dt;
  var failures = [];

  function assert(cond, message) {
    if (!cond) {
      failures.push(message);
      console.error("  ✗ " + message);
    } else {
      console.log("  ✓ " + message);
    }
  }

  function runBot(controller, maxSeconds) {
    var sim = new FP.Simulation();
    sim.start();
    var frames = Math.round(maxSeconds / DT);
    for (var i = 0; i < frames && sim.state === "playing"; i++) {
      controller(sim, i * DT);
      sim.update(DT);
    }
    return sim;
  }

  function missionController(sim) {
    var k = sim.kite;
    var target = sim.world.landmarks.find(function (lm) { return !lm.shot; });
    var input = { left: false, right: false, reelIn: false, reelOut: false };

    if (target) {
      var anchor = FP.CONFIG.anchor;
      var wantRadius = Math.hypot(target.x - anchor.x, target.y - anchor.y);
      var distNow = Math.hypot(k.x - target.x, k.y - target.y);
      if (sim.lineLength < wantRadius - 14) {
        input.reelOut = true;
      } else if (distNow > 44) {
        input.reelIn = true;
      } else if (distNow < 14) {
        input.reelOut = true;
      }
      var errX = target.x - k.x;
      var steer = errX * 2.2 - k.vx * 0.7;
      input.right = steer > 12;
      input.left = steer < -12;
      var dist = Math.hypot(target.x - k.x, target.y - k.y);
      var speed = Math.hypot(k.vx, k.vy);
      if (dist < FP.CONFIG.camera.alignRadius - 6 &&
          speed < FP.CONFIG.camera.maxLockSpeed &&
          sim.lockProgress >= FP.CONFIG.camera.lockTime) {
        sim.pressShutter();
      }
    } else {
      input.reelIn = true;
      var errXHome = FP.CONFIG.anchor.x - k.x;
      var steerHome = errXHome * 1.1 - k.vx * 0.5;
      input.right = steerHome > 28;
      input.left = steerHome < -28;
    }
    sim.setInput(input);
  }

  console.log("\n[1] 完整任务：拍齐三张并收线返航");
  var sim = runBot(missionController, 150);
  assert(sim.state === "won", "最终状态为 won（实际: " + sim.state + "）");
  assert(sim.shots === 3, "完成三处景观拍摄（实际: " + sim.shots + "）");
  assert(sim.film >= 0 && sim.film < FP.CONFIG.camera.film,
    "消耗了胶片（剩余: " + sim.film + "）");
  sim.world.landmarks.forEach(function (lm) {
    assert(lm.shot === true, "景观《" + lm.name + "》已拍摄");
  });
  var home = Math.hypot(sim.kite.x - FP.CONFIG.anchor.x, sim.kite.y - FP.CONFIG.anchor.y);
  assert(home <= FP.CONFIG.mission.winRadius, "风筝回到锚点附近（距离: " + home.toFixed(1) + "）");
  assert(sim.time <= FP.CONFIG.mission.timeLimit,
    "在时限内完成（用时: " + sim.time.toFixed(1) + "s）");
  console.log("    用时 " + sim.time.toFixed(1) + "s · 剩余胶片 " + sim.film +
    " · 完好度 " + Math.max(0, sim.damage).toFixed(0) + "%");

  console.log("\n[2] 失败用例：浪费完全部胶片");
  var wasteShots = 0;
  var filmSim = runBot(function (s) {
    s.setInput({ left: false, right: false, reelIn: false, reelOut: false });
    if (s.film > 0 && s.time > 1 + wasteShots * 0.4) {
      wasteShots++;
      s.pressShutter();
    }
  }, 30);
  assert(filmSim.state === "lost", "胶片耗尽后状态为 lost（实际: " + filmSim.state + "）");
  assert(filmSim.endReason === "no-film", "失败原因为 no-film（实际: " + filmSim.endReason + "）");

  console.log("\n[3] 失败用例：松线被风卷走");
  var blowSim = runBot(function (s) {
    s.setInput({ reelOut: true });
  }, 30);
  assert(blowSim.state === "lost", "卷走后状态为 lost（实际: " + blowSim.state + "）");
  assert(blowSim.endReason === "blown-away",
    "失败原因为 blown-away（实际: " + blowSim.endReason + "）");

  console.log("\n[4] 失败用例：超时");
  var idleSim = runBot(function () {}, 130);
  assert(idleSim.state === "lost", "超时后状态为 lost（实际: " + idleSim.state + "）");
  assert(idleSim.endReason === "timeout", "失败原因为 timeout（实际: " + idleSim.endReason + "）");

  console.log("\n[4b] 失败用例：持续收线绷断");
  var snapReeling = false;
  var snapSim = new FP.Simulation();
  snapSim.lineLength = 260;
  snapSim.start();
  var snapFrames = Math.round(30 / DT);
  for (var sf = 0; sf < snapFrames && snapSim.state === "playing"; sf++) {
    if (!snapReeling && snapSim.kite.y > 95) {
      snapSim.setInput({ reelOut: true, reelIn: false });
    } else {
      snapReeling = true;
      snapSim.setInput({ reelIn: true, reelOut: false });
    }
    snapSim.update(DT);
  }
  assert(snapSim.state === "lost", "断线后状态为 lost（实际: " + snapSim.state + "）");
  assert(snapSim.endReason === "line-snapped",
    "失败原因为 line-snapped（实际: " + snapSim.endReason + "）");

  console.log("\n[5] 物理手感：风筝始终被线约束在半径内");
  var checkSim = new FP.Simulation();
  checkSim.start();
  var violation = 0;
  for (var f = 0; f < 60 * 60 && checkSim.state === "playing"; f++) {
    missionController(checkSim);
    checkSim.update(DT);
    var d = Math.hypot(checkSim.kite.x - FP.CONFIG.anchor.x,
      checkSim.kite.y - FP.CONFIG.anchor.y);
    if (d > checkSim.lineLength + 2) {
      violation++;
    }
  }
  assert(violation === 0, "60 秒内无越界帧（违规帧: " + violation + "）");

  console.log("\n[6] 世界确定性：相同 seed 生成一致");
  var w1 = new FP.World(FP.CONFIG.seed);
  var w2 = new FP.World(FP.CONFIG.seed);
  var same = JSON.stringify(w1.landmarks) === JSON.stringify(w2.landmarks) &&
    w1.ridges[0].points.length === w2.ridges[0].points.length;
  assert(same, "同 seed 景观与山脊数据一致");
  var windA = w1.windAt(300, 150, 4.2);
  var windB = w2.windAt(300, 150, 4.2);
  assert(windA.x === windB.x && windA.y === windB.y, "风带查询确定性一致");

  if (failures.length) {
    console.error("\n" + failures.length + " 项断言失败");
    process.exit(1);
  }
  console.log("\n全部断言通过 ✔");
})();
