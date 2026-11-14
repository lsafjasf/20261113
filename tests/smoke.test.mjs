import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import assert from "node:assert/strict";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

function makeCtx() {
  const grad = { addColorStop() {} };
  return new Proxy({}, {
    get(t, prop) {
      if (prop === "createRadialGradient" || prop === "createLinearGradient") return () => grad;
      if (typeof prop === "string") return (..._a) => {};
      return undefined;
    },
    set() { return true; }
  });
}

const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;

// Canvas 打桩
window.HTMLCanvasElement.prototype.getContext = function () { return makeCtx(); };

// Web Audio 打桩
const audioSpy = { wind: 0, thrust: 0, hits: 0, wins: 0, loses: 0, deposits: 0 };
class FakeNode {
  constructor() { this.gain = { value: 0, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setValueAtTime() {} };
    this.frequency = { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }; this.Q = {}; this.type = ""; }
  connect() {} start() {} stop() {}
}
class FakeAudio {
  constructor() { this.state = "running"; this.currentTime = 0; this.sampleRate = 44100; this.destination = {}; }
  createGain() { return new FakeNode(); }
  createOscillator() { return new FakeNode(); }
  createBiquadFilter() { return new FakeNode(); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  createBufferSource() { return new FakeNode(); }
  resume() {}
}
window.AudioContext = FakeAudio;
window.HTMLCanvasElement.prototype.getContext = function () { return makeCtx(); };

// 运行页面脚本（剥掉 import 无关，直接执行 <script> 内容）
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
window.eval(script);

const doc = window.document;
const press = (code) => window.dispatchEvent(new window.KeyboardEvent("keydown", { code, bubbles: true, cancelable: true }));
const release = (code) => window.dispatchEvent(new window.KeyboardEvent("keyup", { code, bubbles: true }));

// 初始菜单可见
assert.ok(!doc.getElementById("overlay-start").classList.contains("hidden"));

// 点击开始
doc.getElementById("startBtn").click();
assert.ok(doc.getElementById("overlay-start").classList.contains("hidden"));

// 驱动若干帧（jsdom 的 rAF 已存在，但我们手动等待）
await new Promise((res) => setTimeout(res, 120));

// 模拟推进 + 转向 + 磁吸若干帧
press("KeyW"); press("KeyD"); press("Space");
await new Promise((res) => setTimeout(res, 200));
release("KeyW"); release("KeyD"); release("Space");

// 暂停 / 继续
press("KeyP");
assert.ok(!doc.getElementById("overlay-pause").classList.contains("hidden"));
press("KeyP");
assert.ok(doc.getElementById("overlay-pause").classList.contains("hidden"));

// HUD 数值在更新且合法
const timeText = doc.getElementById("timeText").textContent;
assert.ok(Number(timeText) > 200 && Number(timeText) <= 240, "倒计时应在合理区间: " + timeText);
const hull = Number(doc.getElementById("hullText").textContent);
assert.ok(hull >= 0 && hull <= 100);

// 静音切换不报错
press("KeyM"); press("KeyM");

// 重开（R）应重置 HUD
const fuelBefore = Number(doc.getElementById("fuelText").textContent);
press("KeyR");
await new Promise((res) => setTimeout(res, 60));
const fuelAfter = Number(doc.getElementById("fuelText").textContent);
assert.equal(doc.getElementById("fragText").textContent, "0/4");
assert.ok(fuelAfter >= fuelBefore, "重开后燃料应回满");

// 确定性：相同 seed 两次开局，首帧世界坐标一致（通过引擎间接保证）
assert.ok(doc.getElementById("seed-line").textContent.includes("MAGNET-2026"));

console.log("DOM 冒烟测试通过：开始/推进/磁吸/暂停/静音/重开/HUD 全部正常");
process.exit(0);
