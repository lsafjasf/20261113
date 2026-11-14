// 用桩替代浏览器 API，真实执行 index.html 内嵌脚本若干帧，验证无运行时错误
const fs = require("fs");
const Sim = require("./sim.js");

const html = fs.readFileSync("./index.html", "utf8");
const m = html.match(/<script>\n([\s\S]*?)<\/script>/);
if (!m) { console.error("未找到内嵌脚本"); process.exit(1); }

// ---- 桩 ----
const grad = { addColorStop() {} };
const ctx2d = new Proxy({}, {
  get(t, k) {
    if (k === "createLinearGradient") return () => grad;
    if (k === "measureText") return () => ({ width: 0 });
    return typeof k === "string" ? function () {} : undefined;
  },
  set() { return true; },
});
const canvas = {
  width: 960, height: 600,
  getContext: () => ctx2d,
  addEventListener() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 600 }),
};
const listeners = {};
const sandbox = {
  Sim,
  document: { getElementById: () => canvas },
  window: { addEventListener: (ev, fn) => { listeners[ev] = fn; } },
  requestAnimationFrame: (fn) => { sandbox.__raf = fn; },
  console,
};
sandbox.window.AudioContext = undefined;

const vm = require("vm");
vm.createContext(sandbox);
vm.runInContext(m[1], sandbox);

// 模拟按键：选中风机1，迎风+顺桨操作，跑过第一次阵风
let simTime = 0;
let frames = 0;
const keydown = listeners.keydown, keyup = listeners.keyup;
keydown({ key: "1", preventDefault() {} });
keydown({ key: "ArrowRight", preventDefault() {} });
keydown({ key: "ArrowDown", preventDefault() {} });
let ts = 0;
while (simTime < 60 && frames < 4000) {
  ts += 16.7;
  const raf = sandbox.__raf;
  sandbox.__raf = null;
  raf(ts);
  simTime += 16.7 / 1000;
  frames++;
}
keyup({ key: "ArrowRight" });
console.log(`执行 ${frames} 帧无异常, 游戏内 t≈${(frames * 16.7 / 1000).toFixed(1)}s`);
console.log("PASS: 渲染循环与输入处理运行正常");
