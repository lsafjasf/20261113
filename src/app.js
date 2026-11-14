import { BinauralEngine } from "./audio.js";
import {
  createCase,
  MIN_CAPTURE_SECONDS,
  cloneAnswer,
  quadrantLabel,
} from "./scene.js";
import { drawMeters, drawResultMap, drawSpectrum, drawTracks } from "./render.js";
import { range, mulberry32 } from "./rng.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const engine = new BinauralEngine();
const ui = {
  boot: $("#bootScreen"),
  investigation: $("#investigationScreen"),
  result: $("#resultScreen"),
  pauseOverlay: $("#pauseOverlay"),
  toast: $("#toast"),
  postList: $("#postList"),
  captureButton: $("#captureButton"),
  pauseButton: $("#pauseButton"),
  spectrum: $("#spectrumCanvas"),
  meters: $("#meterCanvas"),
  tracks: $("#trackCanvas"),
  resultMap: $("#resultMap"),
};

const state = {
  phase: "boot",
  caseData: null,
  currentStation: 1,
  answer: cloneAnswer(),
  evidence: [],
  capturing: false,
  lastSampleAt: -1,
  toastTimer: 0,
  calibrationPlayed: false,
  finished: null,
};

function setScreen(name) {
  ui.boot.hidden = name !== "boot";
  ui.investigation.hidden = name !== "investigation";
  ui.result.hidden = name !== "result";
}

function resetEvidence() {
  state.evidence = state.caseData.rooms.map(() => ({
    seconds: 0,
    completed: false,
    frames: [],
  }));
  state.answer = cloneAnswer();
  state.currentStation = 1;
  state.capturing = false;
  state.lastSampleAt = -1;
}

function normalizeSeed(value) {
  return (String(value || "").trim().toUpperCase() || "ZERO-0714").slice(0, 40);
}

function generateSeed() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  const random = mulberry32(values[0]);
  return `ZERO-${String(Math.floor(range(random, 10, 9999))).padStart(4, "0")}`;
}

async function beginCase(seed, fromRestart = false) {
  const normalized = normalizeSeed(seed);
  await engine.init();
  engine.stopPlayback();
  state.caseData = createCase(normalized);
  engine.configureCase(state.caseData);
  resetEvidence();
  state.phase = "investigation";
  state.finished = null;
  ui.pauseOverlay.hidden = true;
  setScreen("investigation");
  $("#activeSeed").textContent = state.caseData.seed;
  $("#activeHash").textContent = state.caseData.fingerprint;
  $("#sideSeed").textContent = state.caseData.seed;
  $("#captureStatus").textContent = "STANDBY";
  $("#captureStatus").classList.remove("recording");
  $("#headerStatus").textContent = fromRestart ? "同 seed 序列已复位" : "调查进行中";
  renderPostList();
  updateAnswers();
  updateEvidenceUi();
  setCaptureButton("开始采集");
  $("#receiveNote").textContent = "R-02 监听位待命。开始采集后，两处广播会按同一时间线依次出现。";
  $("#captureTime").textContent = `00.0 / ${state.caseData.duration.toFixed(1)} s`;
  $("#captureProgress").style.width = "0%";
  requestAnimationFrame(() => {
    drawSpectrum(ui.spectrum, engine.getAudioStats(), engine.context?.sampleRate ?? 44100, 0);
    drawMeters(ui.meters, engine.getAudioStats());
    drawTracks(ui.tracks, [], 0, state.caseData.duration, false);
  });
}

function renderPostList() {
  if (!state.caseData) return;
  ui.postList.textContent = "";
  state.caseData.rooms.forEach((room, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `post-card${index === state.currentStation ? " active" : ""}`;
    button.dataset.station = index;
    const heard = state.evidence[index]?.completed;
    button.innerHTML = `
      <span class="post-index">${room.id}</span>
      <span><span class="post-name">${room.name}</span><span class="post-params">IR ${room.rt60.toFixed(2)}s / W ${Math.round((1 - room.damping) * 100)}%</span></span>
      <span class="post-state${heard ? " heard" : ""}">${heard ? "已收录" : "待采集"}</span>
    `;
    button.addEventListener("click", () => switchStation(index));
    ui.postList.append(button);
  });
}

async function switchStation(index) {
  if (!["investigation", "paused"].includes(state.phase)) return;
  if (state.capturing) finishCapture("切换监听位");
  const wasPaused = state.phase === "paused";
  if (wasPaused) {
    ui.pauseOverlay.hidden = true;
    state.phase = "investigation";
    await engine.resume();
  }
  state.currentStation = index;
  state.lastSampleAt = -1;
  const room = state.caseData.rooms[index];
  renderPostList();
  setCaptureButton("开始采集");
  $("#captureStatus").textContent = "STANDBY";
  $("#captureStatus").classList.remove("recording");
  $("#trackTime").textContent = "00:00.0";
  $("#receiveNote").textContent = `${room.id} ${room.name} · 卷积混响 ${room.rt60.toFixed(2)}s。可重新采集同一条时间线。`;
  const evidence = state.evidence[index];
  drawTracks(ui.tracks, evidence.frames, evidence.seconds, state.caseData.duration, false);
}

function setCaptureButton(label) {
  ui.captureButton.textContent = label;
  ui.captureButton.classList.toggle("primary-outline", label === "开始采集");
}

function updateAnswers() {
  $$("[data-answer-group]").forEach((group) => {
    const key = group.dataset.answerGroup;
    group.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("selected", state.answer[key] === button.dataset.value);
    });
  });
  updateEvidenceUi();
}

function updateEvidenceUi() {
  const rooms = state.caseData?.rooms ?? [];
  const count = state.evidence.filter((item) => item.completed).length;
  $("#evidenceCount").textContent = `${count} / 3`;
  const bars = $$("#bufferBars i");
  bars.forEach((bar, index) => bar.classList.toggle("heard", Boolean(state.evidence[index]?.completed)));
  const missing = rooms.filter((room, index) => !state.evidence[index]?.completed).map((room) => room.id);
  const answerComplete = Boolean(state.answer.alpha && state.answer.beta && state.answer.first);
  const note = $("#verdictNote");
  if (!answerComplete) {
    note.textContent = "结论字段未填完整 · 两处方位与出现顺序";
    note.classList.remove("ready");
  } else if (missing.length) {
    note.textContent = `尚缺 ${missing.join(" / ")} 的有效采集`;
    note.classList.remove("ready");
  } else {
    note.textContent = "三处证据已齐 · 可提交结论";
    note.classList.add("ready");
  }
}

$$("[data-answer-group]").forEach((group) => {
  group.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-value]");
    if (!button || state.phase !== "investigation") return;
    state.answer[group.dataset.answerGroup] = button.dataset.value;
    updateAnswers();
  });
});

async function startCapture() {
  if (state.phase !== "investigation" || state.capturing) return;
  try {
    await engine.init();
    const result = await engine.startListening(state.caseData, state.currentStation);
    const evidence = state.evidence[state.currentStation];
    evidence.frames = [];
    evidence.seconds = 0;
    evidence.completed = false;
    state.capturing = true;
    state.lastSampleAt = -1;
    setCaptureButton("停止采集");
    $("#captureStatus").textContent = "RECORDING";
    $("#captureStatus").classList.add("recording");
    $("#receiveNote").textContent = `正在采集 ${result.station} · ${state.caseData.rooms[state.currentStation].rt60.toFixed(2)}s 混响 · 保持监听。`;
    renderPostList();
    updateEvidenceUi();
  } catch (error) {
    showToast(`音频启动失败：${error.message}`);
  }
}

function finishCapture(reason = "采集结束") {
  if (!state.capturing) return;
  const index = state.currentStation;
  const evidence = state.evidence[index];
  const elapsed = Math.max(evidence.seconds, engine.getElapsed());
  evidence.seconds = Math.min(state.caseData.duration, elapsed);
  const enough = evidence.seconds >= MIN_CAPTURE_SECONDS;
  evidence.completed = enough;
  state.capturing = false;
  state.lastSampleAt = -1;
  engine.stopPlayback();
  $("#captureStatus").textContent = enough ? "CAPTURE STORED" : "CAPTURE TOO SHORT";
  $("#captureStatus").classList.remove("recording");
  setCaptureButton("重新采集");
  if (enough) {
    $("#receiveNote").textContent = `${state.caseData.rooms[index].id} 证据已收录 · ${evidence.seconds.toFixed(1)} 秒双声道轨道。`;
  } else {
    $("#receiveNote").textContent = `${reason} · 有效证据需至少 ${MIN_CAPTURE_SECONDS.toFixed(1)} 秒，可重新采集。`;
    showToast(`有效证据不足：本次仅 ${evidence.seconds.toFixed(1)} 秒，需至少 ${MIN_CAPTURE_SECONDS.toFixed(1)} 秒。`);
  }
  drawTracks(ui.tracks, evidence.frames, evidence.seconds, state.caseData.duration, false);
  renderPostList();
  updateEvidenceUi();
}

function showToast(message, duration = 3200) {
  clearTimeout(state.toastTimer);
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  state.toastTimer = setTimeout(() => {
    ui.toast.hidden = true;
  }, duration);
}

async function pauseInvestigation() {
  if (state.phase !== "investigation") return;
  state.phase = "paused";
  if (engine.playback) await engine.pause();
  else if (engine.context?.state === "running") await engine.context.suspend();
  ui.pauseOverlay.hidden = false;
  $("#pauseButton").textContent = "调查暂停中";
}

async function resumeInvestigation() {
  if (state.phase !== "paused") return;
  ui.pauseOverlay.hidden = true;
  if (engine.playback) await engine.resume();
  else if (engine.context) await engine.context.resume();
  state.phase = "investigation";
  $("#pauseButton").textContent = "暂停调查";
}

ui.captureButton.addEventListener("click", () => {
  if (state.capturing) finishCapture("手动停止");
  else startCapture();
});
ui.pauseButton.addEventListener("click", pauseInvestigation);
$("#resumeButton").addEventListener("click", resumeInvestigation);

let lastUiUpdate = 0;
let lastTrackDraw = 0;
function animate(timestamp) {
  const stats = engine.getAudioStats();
  if (engine.context && !ui.investigation.hidden) {
    drawSpectrum(ui.spectrum, stats, engine.context.sampleRate, timestamp / 1000);
    drawMeters(ui.meters, stats);
  }

  if (state.phase === "investigation" && state.capturing) {
    const elapsed = engine.getElapsed();
    const evidence = state.evidence[state.currentStation];
    evidence.seconds = Math.max(evidence.seconds, elapsed);
    $("#captureTime").textContent = `${elapsed.toFixed(1)} / ${state.caseData.duration.toFixed(1)} s`;
    $("#captureProgress").style.width = `${(elapsed / state.caseData.duration) * 100}%`;
    $("#trackTime").textContent = `00:${elapsed.toFixed(1).padStart(4, "0")}`;
    if (elapsed > state.lastSampleAt + 0.075) {
      evidence.frames.push({
        t: elapsed,
        l: stats.leftDb,
        r: stats.rightDb,
      });
      state.lastSampleAt = elapsed;
    }
    if (timestamp - lastTrackDraw > 55) {
      drawTracks(ui.tracks, evidence.frames, elapsed, state.caseData.duration, true);
      lastTrackDraw = timestamp;
    }
    if (elapsed >= state.caseData.duration - 0.015) finishCapture("记录结束");
  }

  if (timestamp - lastUiUpdate > 180) {
    updateReadouts(stats);
    lastUiUpdate = timestamp;
  }
  requestAnimationFrame(animate);
}

function updateReadouts(stats) {
  if (!engine.context) return;
  const spectrum = stats.spectrum;
  let peakBin = 0;
  for (let i = 1; i < spectrum.length; i += 1) {
    if (spectrum[i] > spectrum[peakBin]) peakBin = i;
  }
  const peakHz = Math.round((peakBin * engine.context.sampleRate) / 2 / spectrum.length);
  $("#peakReadout").textContent = spectrum[peakBin] > 25 ? `PEAK ${peakHz} Hz` : "PEAK — Hz";
  const balance = stats.leftDb - stats.rightDb;
  $("#balanceReadout").textContent = `BAL ${balance >= 0 ? "+" : ""}${Number.isFinite(balance) ? balance.toFixed(2) : "0.00"}`;
}

requestAnimationFrame(animate);

function submitVerdict() {
  if (state.phase !== "investigation") return;
  if (!state.answer.alpha || !state.answer.beta || !state.answer.first) {
    showToast("结论不完整：请为 α、β 各选一个方位，并判定出现顺序。");
    return;
  }
  if (state.capturing) finishCapture("提交前停止采集");
  const alpha = state.caseData.sources.find((source) => source.id === "alpha");
  const beta = state.caseData.sources.find((source) => source.id === "beta");
  const evidenceCompletions = state.evidence.map((item) => item.completed);
  const fullEvidence = evidenceCompletions.every(Boolean);
  const correct = state.answer.alpha === alpha.quadrant
    && state.answer.beta === beta.quadrant
    && state.answer.first === state.caseData.firstSourceId;
  const success = correct && fullEvidence;
  state.phase = "result";
  engine.stopPlayback();
  state.finished = { success, correct, fullEvidence };
  showResult({ success, correct, fullEvidence });
}

function showResult({ success, correct, fullEvidence }) {
  setScreen("result");
  const alpha = state.caseData.sources.find((source) => source.id === "alpha");
  const beta = state.caseData.sources.find((source) => source.id === "beta");
  const first = state.caseData.sources.find((source) => source.id === state.caseData.firstSourceId);
  const report = $(".result-report");
  report.classList.toggle("failed", !success);
  $("#resultCode").textContent = success ? "CASE CLOSED / 正确结案" : "INSUFFICIENT EVIDENCE / 证据不足";
  $("#resultTitle").textContent = success ? "正确结案" : "无法确认广播位置";
  const missing = state.caseData.rooms.filter((room, index) => !state.evidence[index].completed).map((room) => room.id);
  let reason;
  if (success) {
    reason = "两处广播的绝对方位与出现顺序均和双耳记录一致。三间房的距离衰减与卷积混响差异共同指向同一组声源坐标。";
  } else if (!fullEvidence) {
    reason = `缺少 ${missing.join(" / ")} 的有效采集。结论没有覆盖三个监听位，无法排除距离与混响造成的误判。测量图仅作复盘。`;
  } else {
    reason = "三处证据采齐，但提交的方位或先后顺序与记录不一致。复核后只能判定为证据不足，测量图仅作复盘。";
  }
  $("#resultReason").textContent = reason;
  $("#resultAnswers").textContent = "";
  const answerRows = [
    {
      label: "α / 低频脉冲",
      actual: `${quadrantLabel(alpha.quadrant)} ${alpha.quadrant}`,
      submitted: quadrantLabel(state.answer.alpha),
      correct: state.answer.alpha === alpha.quadrant,
    },
    {
      label: "β / 高频双音节",
      actual: `${quadrantLabel(beta.quadrant)} ${beta.quadrant}`,
      submitted: quadrantLabel(state.answer.beta),
      correct: state.answer.beta === beta.quadrant,
    },
    {
      label: "首现广播",
      actual: `${first.name} · ${first.start.toFixed(2)}s`,
      submitted: state.answer.first === "alpha" ? "α 先出现" : "β 先出现",
      correct: state.answer.first === state.caseData.firstSourceId,
    },
  ];
  for (const row of answerRows) {
    const node = document.createElement("div");
    node.className = "result-answer";
    node.innerHTML = `<span>${row.label}</span><b>实测 ${row.actual} · 提交 ${row.submitted}</b><em class="${row.correct ? "" : "wrong"}">${row.correct ? "吻合" : "不符"}</em>`;
    $("#resultAnswers").append(node);
  }
  $("#resultSeed").textContent = state.caseData.seed;
  $("#resultFingerprint").textContent = state.caseData.fingerprint;
  const totalSeconds = state.evidence.reduce((sum, item) => sum + item.seconds, 0);
  $("#resultEvidence").textContent = `${state.evidence.filter((item) => item.completed).length} / 3 · ${totalSeconds.toFixed(1)}s`;
  $("#headerStatus").textContent = success ? "案件完成 · 数据已归档" : "案件未结 · 证据不足";
  requestAnimationFrame(() => {
    requestAnimationFrame(() => drawResultMap(ui.resultMap, state.caseData, state.answer));
  });
}

async function restartSameSeed() {
  if (!state.caseData) return;
  ui.pauseOverlay.hidden = true;
  const seed = state.caseData.seed;
  await beginCase(seed, true);
}

$("#submitVerdict").addEventListener("click", submitVerdict);
$("#restartSameSeed").addEventListener("click", restartSameSeed);
$("#pauseRestart").addEventListener("click", restartSameSeed);
$("#resultSameSeed").addEventListener("click", restartSameSeed);
$("#newCase").addEventListener("click", () => {
  engine.stopPlayback();
  setScreen("boot");
  state.phase = "boot";
  state.finished = null;
  $("#headerStatus").textContent = "本地声学调查终端";
  $("#seedInput").value = generateSeed();
  updateStartButton();
});

function updateStartButton() {
  const left = $("#confirmLeft").checked;
  const right = $("#confirmRight").checked;
  $("#startCase").disabled = !(state.calibrationPlayed && left && right);
}

$("#playCalibration").addEventListener("click", async () => {
  $("#audioError").textContent = "";
  $("#playCalibration").disabled = true;
  try {
    await engine.playCalibration("both");
    state.calibrationPlayed = true;
    $("#calibrationState").textContent = "CALIBRATION SENT";
    $("#calibrationArt").classList.add("testing");
    setTimeout(() => $("#calibrationArt").classList.remove("testing"), 1450);
    updateStartButton();
  } catch (error) {
    $("#audioError").textContent = `无法播放校准音：${error.message}`;
  } finally {
    setTimeout(() => {
      $("#playCalibration").disabled = false;
    }, 1500);
  }
});

$("#confirmLeft").addEventListener("change", updateStartButton);
$("#confirmRight").addEventListener("change", updateStartButton);
$("#volume").addEventListener("input", (event) => {
  const value = Number(event.target.value);
  $("#volumeOut").textContent = `${value}%`;
  engine.setVolume(value / 100);
});
$("#randomSeed").addEventListener("click", () => {
  $("#seedInput").value = generateSeed();
});
$("#seedInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !$("#startCase").disabled) $("#startCase").click();
});
$("#startCase").addEventListener("click", async () => {
  $("#audioError").textContent = "";
  try {
    await beginCase($("#seedInput").value);
  } catch (error) {
    $("#audioError").textContent = `案件启动失败：${error.message}`;
  }
});

window.addEventListener("resize", () => {
  if (state.phase === "result" && state.caseData) {
    drawResultMap(ui.resultMap, state.caseData, state.answer);
  }
});

function updateClock() {
  $("#clock").textContent = new Date().toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
updateClock();
setInterval(updateClock, 1000);

window.__ZERO_RADIO__ = {
  engine,
  getCase: () => state.caseData,
  getState: () => ({
    phase: state.phase,
    station: state.currentStation,
    answer: cloneAnswer(state.answer),
    evidence: state.evidence.map((item) => ({ seconds: item.seconds, completed: item.completed, samples: item.frames.length })),
    capturing: state.capturing,
    elapsed: engine.getElapsed(),
    finished: state.finished,
    metrics: engine.getPlaybackMetrics(),
  }),
  getSceneSnapshot: () => state.caseData && JSON.parse(JSON.stringify({
    seed: state.caseData.seed,
    fingerprint: state.caseData.fingerprint,
    rooms: state.caseData.rooms,
    sources: state.caseData.sources,
    firstSourceId: state.caseData.firstSourceId,
    ambience: state.caseData.ambience,
  })),
  startCapture,
  finishCapture,
  submitVerdict,
};
