(function () {
  "use strict";

  var fs = require("fs");
  var path = require("path");
  var vm = require("vm");

  function makeGradient() {
    return { addColorStop: function () {} };
  }

  function makeCtx() {
    var noop = function () {};
    return new Proxy({}, {
      get: function (target, prop) {
        if (prop === "createLinearGradient" || prop === "createRadialGradient") {
          return makeGradient;
        }
        if (prop === "measureText") {
          return function () { return { width: 10 }; };
        }
        if (prop === "canvas") {
          return { width: 960, height: 600 };
        }
        return typeof target[prop] !== "undefined" ? target[prop] : noop;
      },
      set: function (target, prop, value) {
        target[prop] = value;
        return true;
      }
    });
  }

  var root = path.join(__dirname, "..", "js");
  ["config.js", "rng.js", "world.js", "simulation.js", "renderer.js"].forEach(function (file) {
    vm.runInThisContext(fs.readFileSync(path.join(root, file), "utf8"), { filename: file });
  });

  var FP = globalThis.FP;
  var failures = [];
  var sim = new FP.Simulation();
  sim.start();
  var canvas = { width: 960, height: 600, getContext: function () { return makeCtx(); } };
  var renderer = new FP.Renderer(canvas);

  try {
    for (var i = 0; i < 600; i++) {
      sim.setInput({ right: i % 200 < 100, reelOut: i < 120 });
      if (i === 300) {
        sim.pressShutter();
      }
      sim.update(FP.CONFIG.dt);
      renderer.render(sim, FP.CONFIG.dt);
    }
    console.log("  ✓ 渲染器连续运行 10 秒无异常");
  } catch (err) {
    failures.push(err.stack);
    console.error("  ✗ 渲染器异常: " + err.message);
  }

  var methods = ["drawSky", "drawStreaks", "drawRidges", "drawLandmarks",
    "drawClouds", "drawAnchor", "drawLine", "drawKite",
    "drawViewfinder", "drawFogOverlay", "drawFlash"];
  methods.forEach(function (name) {
    if (typeof renderer[name] !== "function") {
      failures.push(name);
      console.error("  ✗ 缺少渲染方法 " + name);
    }
  });
  console.log("  ✓ 包含 " + methods.length + " 个分层渲染方法");

  var landmarkKinds = sim.world.landmarks.map(function (lm) { return lm.kind; });
  if (landmarkKinds.join(",") === "tower,bridge,lake") {
    console.log("  ✓ 三处景观类型齐全: " + landmarkKinds.join(" / "));
  } else {
    failures.push("landmarks");
  }

  if (failures.length) {
    process.exit(1);
  }
  console.log("\n渲染检查通过 ✔");
})();
