(function () {
  "use strict";

  var fs = require("fs");
  var path = require("path");
  var vm = require("vm");

  function makeEl(id) {
    return {
      id: id,
      dataset: {},
      style: {},
      classList: {
        classes: new Set(),
        toggle: function (name, force) {
          if (force) { this.classes.add(name); }
          else { this.classes.delete(name); }
        }
      },
      children: [],
      childElementCount: 0,
      innerHTML: "",
      textContent: "",
      appendChild: function (child) {
        this.children.push(child);
        this.childElementCount = this.children.length;
      },
      addEventListener: function () {}
    };
  }

  var elements = {};
  var ids = ["game", "overlay", "film", "hp-bar", "timer", "targets",
    "altitude", "lineLen", "windCompass", "tension-bar",
    "lostReason", "wonStats"];
  ids.forEach(function (id) { elements[id] = makeEl(id); });
  elements.game.getContext = function () {
    return new Proxy({}, {
      get: function (t, prop) {
        if (prop === "createLinearGradient" || prop === "createRadialGradient") {
          return function () { return { addColorStop: function () {} }; };
        }
        return typeof t[prop] !== "undefined" ? t[prop] : function () {};
      },
      set: function (t, prop, value) { t[prop] = value; return true; }
    });
  };

  var panels = ["menu", "pause", "lost", "won"].map(function (name) {
    var el = makeEl("panel-" + name);
    el.dataset.panel = name;
    return el;
  });

  var listeners = {};
  var sandbox = {
    console: console,
    performance: { now: function () { return Date.now(); } },
    requestAnimationFrame: function () { return 0; },
    AudioContext: function () {
      return {
        state: "running",
        currentTime: 0,
        sampleRate: 44100,
        destination: {},
        resume: function () {},
        createGain: function () {
          return { gain: { value: 1, setValueAtTime: function () {},
            setTargetAtTime: function () {}, linearRampToValueAtTime: function () {},
            cancelScheduledValues: function () {}, exponentialRampToValueAtTime: function () {} },
            connect: function () {} };
        },
        createBuffer: function (ch, len) { return { getChannelData: function () { return new Float32Array(len); } }; },
        createBufferSource: function () {
          return { connect: function () {}, start: function () {}, stop: function () {} };
        },
        createBiquadFilter: function () {
          return { frequency: { setTargetAtTime: function () {} }, Q: {}, connect: function () {} };
        },
        createOscillator: function () {
          return { frequency: { setValueAtTime: function () {}, exponentialRampToValueAtTime: function () {} },
            connect: function () {}, start: function () {}, stop: function () {} };
        }
      };
    },
    document: {
      getElementById: function (id) { return elements[id]; },
      querySelectorAll: function (sel) {
        return sel === ".panel" ? panels : [];
      },
      createElement: function () { return makeEl("dynamic"); },
      addEventListener: function (name, fn) {
        listeners[name] = fn;
      }
    },
    window: {},
    setTimeout: setTimeout
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = function (name, fn) {
    listeners[name] = fn;
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  var root = path.join(__dirname, "..", "js");
  ["config.js", "rng.js", "world.js", "simulation.js",
   "audio.js", "renderer.js", "main.js"].forEach(function (file) {
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), sandbox,
      { filename: file });
  });

  var failures = [];
  function assert(cond, msg) {
    if (!cond) { failures.push(msg); console.error("  ✗ " + msg); }
    else { console.log("  ✓ " + msg); }
  }

  var game = sandbox.window.FP_GAME;
  assert(!!game, "main.js 暴露了 FP_GAME 控制对象");
  assert(game.sim.state === "ready", "初始状态为 ready");

  game.startGame();
  assert(game.sim.state === "playing", "开始后状态为 playing");
  var firstSim = game.sim;

  listeners.keydown({ code: "KeyD", repeat: false, preventDefault: function () {} });
  assert(firstSim.input.right === true, "A/D 摆动输入生效");
  listeners.keyup({ code: "KeyD", preventDefault: function () {} });
  assert(firstSim.input.right === false, "按键释放后输入复位");

  listeners.keydown({ code: "Space", repeat: false, preventDefault: function () {} });
  firstSim.update(sandbox.FP.CONFIG.dt);
  assert(firstSim.film === 5, "空格快门消耗一张胶片");

  listeners.keydown({ code: "KeyP", repeat: false, preventDefault: function () {} });
  assert(firstSim.state === "paused", "P 键暂停");
  listeners.keydown({ code: "KeyP", repeat: false, preventDefault: function () {} });
  assert(firstSim.state === "playing", "再次 P 键继续");

  game.startGame();
  assert(game.sim !== firstSim, "重开后生成新的模拟实例");
  assert(game.sim.state === "playing" && game.sim.film === 6, "新实例胶片重置为 6");

  if (failures.length) { process.exit(1); }
  console.log("\n主控逻辑检查通过 ✔");
})();
