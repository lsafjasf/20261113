import { BinauralEngine } from "./audio.js";
import { createCase, QUADRANTS, spatialMetrics } from "./scene.js";

const engine = new BinauralEngine();
const caseData = createCase("AUDIO-AUDIT");
const checksBody = document.querySelector("#checks");
const channelReadout = document.querySelector("#channel-readout");
const logNode = document.querySelector("#log");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastResults = {};

function log(message) {
  const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  logNode.textContent = `[${time}] ${message}\n${logNode.textContent}`.slice(0, 1800);
}

function row(name, status, detail) {
  const tr = document.createElement("tr");
  tr.dataset.check = name;
  const statusClass = status === "PASS" ? "pass" : status === "FAIL" ? "fail" : "wait";
  tr.innerHTML = `<td>${name}</td><td class="${statusClass}">${status}</td><td>${detail}</td>`;
  checksBody.append(tr);
  return tr;
}

function resetChecks() {
  checksBody.textContent = "";
}

function modelPreflight() {
  const results = [];
  const allQuadrants = Object.keys(QUADRANTS).map((key) => {
    const q = QUADRANTS[key];
    const source = { position: { x: q.dx * 2.7, y: q.dy * 2.35 } };
    return { key, ...spatialMetrics(caseData.rooms[1].station, source) };
  });
  const wrongPan = allQuadrants.filter((entry) => {
    const q = QUADRANTS[entry.key];
    return Math.sign(entry.pan) !== q.dx;
  });
  const front = allQuadrants.filter((entry) => QUADRANTS[entry.key].filter === "front");
  const back = allQuadrants.filter((entry) => QUADRANTS[entry.key].filter === "back");
  const frontCutoff = Math.min(...front.map((entry) => entry.lowpass));
  const backCutoff = Math.max(...back.map((entry) => entry.lowpass));
  const roomIr = new Set(caseData.rooms.map((room) => `${room.rt60}:${room.damping}:${room.preDelay}`));
  results.push(["四方位声像", wrongPan.length === 0 ? "PASS" : "FAIL",
    allQuadrants.map((entry) => `${entry.key} ${entry.pan >= 0 ? "+" : ""}${entry.pan.toFixed(2)}`).join(" / ")]);
  results.push(["前/后滤波", frontCutoff > backCutoff ? "PASS" : "FAIL",
    `前 ${frontCutoff} Hz / 后 ${backCutoff} Hz`]);
  results.push(["三房 IR 参数", roomIr.size === 3 ? "PASS" : "FAIL",
    caseData.rooms.map((room) => `${room.id} ${room.rt60}s`).join(" / ")]);
  results.push(["同 seed 场景", createCase("AUDIO-AUDIT").fingerprint === caseData.fingerprint ? "PASS" : "FAIL",
    caseData.fingerprint]);
  return { results, allQuadrants };
}

async function measureCalibration(side) {
  engine.stopPlayback();
  await engine.playCalibration(side);
  let peakL = -90;
  let peakR = -90;
  for (let i = 0; i < 12; i += 1) {
    await delay(55);
    const stats = engine.getAudioStats();
    peakL = Math.max(peakL, stats.leftDb);
    peakR = Math.max(peakR, stats.rightDb);
  }
  return { side, peakL, peakR };
}

function readBrightness(spectrum) {
  const nyquist = engine.context.sampleRate / 2;
  const perBin = nyquist / spectrum.length;
  let low = 0;
  let high = 0;
  for (let i = 1; i < spectrum.length; i += 1) {
    const frequency = i * perBin;
    if (frequency >= 240 && frequency <= 1500) low += spectrum[i];
    if (frequency >= 2200 && frequency <= 7600) high += spectrum[i];
  }
  return high / Math.max(1, low);
}

async function measureQuadrant(quadrant, stationIndex) {
  engine.stopPlayback();
  const metrics = await engine.startProbe(quadrant, stationIndex);
  let peakL = -90;
  let peakR = -90;
  let brightness = 0;
  for (let i = 0; i < 18; i += 1) {
    await delay(55);
    const stats = engine.getAudioStats();
    peakL = Math.max(peakL, stats.leftDb);
    peakR = Math.max(peakR, stats.rightDb);
    brightness += readBrightness(stats.spectrum);
  }
  engine.stopPlayback();
  return { ...metrics, peakL, peakR, brightness: brightness / 18 };
}

async function runAllChecks() {
  if (!engine.context) await engine.init();
  await engine.context.resume();
  resetChecks();
  log("开始模型与实时音频审计");
  const { results, allQuadrants } = modelPreflight();
  for (const item of results) row(...item);

  const left = await measureCalibration("left");
  const right = await measureCalibration("right");
  const channelPass = left.peakL > left.peakR + 6 && right.peakR > right.peakL + 6;
  row("L/R 声道分离", channelPass ? "PASS" : "FAIL",
    `L测 ${left.peakL.toFixed(1)}:${left.peakR.toFixed(1)} dB / R测 ${right.peakL.toFixed(1)}:${right.peakR.toFixed(1)} dB`);

  const measured = {};
  for (const key of Object.keys(QUADRANTS)) {
    measured[key] = await measureQuadrant(key, 1);
    log(`${key} 实测 L ${measured[key].peakL.toFixed(1)} dB / R ${measured[key].peakR.toFixed(1)} dB`);
  }
  const wrongActual = Object.entries(measured).filter(([key, value]) => {
    const expected = QUADRANTS[key].dx;
    return expected < 0 ? value.peakL <= value.peakR : value.peakR <= value.peakL;
  });
  row("实时四方位声像", wrongActual.length === 0 ? "PASS" : "FAIL",
    Object.entries(measured).map(([key, value]) => `${key} ${value.peakL.toFixed(0)}/${value.peakR.toFixed(0)}`).join(" · "));

  const frontBrightness = (measured.LF.brightness + measured.RF.brightness) / 2;
  const backBrightness = (measured.LB.brightness + measured.RB.brightness) / 2;
  row("实时前/后滤波", frontBrightness > backBrightness * 1.08 ? "PASS" : "FAIL",
    `前高频比 ${frontBrightness.toFixed(2)} / 后 ${backBrightness.toFixed(2)}`);

  lastResults = { model: allQuadrants, left, right, measured, timestamp: Date.now() };
  channelReadout.textContent = `L ${left.peakL.toFixed(1)} dB / R ${right.peakR.toFixed(1)} dB`;
  log("审计完成");
  return lastResults;
}

document.querySelector("#init").addEventListener("click", async () => {
  await engine.init();
  engine.configureCase(caseData);
  channelReadout.textContent = "音频上下文已启动 · 等待测试";
  log(`AudioContext ${engine.context.state} · ${engine.context.sampleRate} Hz`);
});

document.querySelector("#test-left").addEventListener("click", async () => {
  const result = await measureCalibration("left");
  channelReadout.textContent = `L 测 ${result.peakL.toFixed(1)} dB / R ${result.peakR.toFixed(1)} dB`;
});

document.querySelector("#test-right").addEventListener("click", async () => {
  const result = await measureCalibration("right");
  channelReadout.textContent = `L 测 ${result.peakL.toFixed(1)} dB / R ${result.peakR.toFixed(1)} dB`;
});

document.querySelectorAll("[data-quadrant]").forEach((button) => {
  button.addEventListener("click", async () => {
    await engine.init();
    engine.configureCase(caseData);
    const stationIndex = Number(document.querySelector("#station").value);
    const metrics = await engine.startProbe(button.dataset.quadrant, stationIndex);
    log(`${button.dataset.quadrant} · pan ${metrics.pan} · LPF ${metrics.lowpass} Hz · ${metrics.distance} m`);
  });
});

document.querySelector("#check-all").addEventListener("click", runAllChecks);

window.__AUDIO_AUDIT__ = {
  engine,
  caseData,
  runAllChecks,
  modelPreflight,
  measureCalibration,
  measureQuadrant,
  getResults: () => lastResults,
};

log("声学台待命 · 点击「启动音频」");
