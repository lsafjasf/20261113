import { DEFAULT_SEED, GAME, STATIONS } from "./config.js";
import { generateScenario } from "./generator.js";
import { randomSeed } from "./rng.js";
import { RopewaySim, windSpeedFactor } from "./sim.js";
import { SnowlineRenderer } from "./renderer.js";
import { AudioEngine } from "./audio.js";

const ui = {
  scene: document.querySelector("#scene"),
  seedLabel: document.querySelector("#seedLabel"),
  seedButton: document.querySelector("#seedButton"),
  phaseLabel: document.querySelector("#phaseLabel"),
  liveDot: document.querySelector("#liveDot"),
  runState: document.querySelector("#runState"),
  clockValue: document.querySelector("#clockValue"),
  clockSub: document.querySelector("#clockSub"),
  windValue: document.querySelector("#windValue"),
  iceValue: document.querySelector("#iceValue"),
  tempValue: document.querySelector("#tempValue"),
  forecastText: document.querySelector("#forecastText"),
  statusBadge: document.querySelector("#statusBadge"),
  batteryValue: document.querySelector("#batteryValue"),
  batteryFill: document.querySelector("#batteryFill"),
  batteryNote: document.querySelector("#batteryNote"),
  deliveredValue: document.querySelector("#deliveredValue"),
  headwayValue: document.querySelector("#headwayValue"),
  emergencyValue: document.querySelector("#emergencyValue"),
  verifiedBadge: document.querySelector("#verifiedBadge"),
  intervalInput: document.querySelector("#intervalInput"),
  intervalValue: document.querySelector("#intervalValue"),
  launchHint: document.querySelector("#launchHint"),
  stopGrid: document.querySelector("#stopGrid"),
  launchButton: document.querySelector("#launchButton"),
  manifestCount: document.querySelector("#manifestCount"),
  passengerList: document.querySelector("#passengerList"),
  radioLog: document.querySelector("#radioLog"),
  toastStack: document.querySelector("#toastStack"),
  pauseButton: document.querySelector("#pauseButton"),
  audioButton: document.querySelector("#audioButton"),
  restartButton: document.querySelector("#restartButton"),
  helpButton: document.querySelector("#helpButton"),
  helpDialog: document.querySelector("#helpDialog"),
  closeHelpButton: document.querySelector("#closeHelpButton"),
  confirmHelpButton: document.querySelector("#confirmHelpButton"),
  resultDialog: document.querySelector("#resultDialog"),
  resultEyebrow: document.querySelector("#resultEyebrow"),
  resultIcon: document.querySelector("#resultIcon"),
  resultTitle: document.querySelector("#resultTitle"),
  resultMessage: document.querySelector("#resultMessage"),
  resultDelivered: document.querySelector("#resultDelivered"),
  resultBattery: document.querySelector("#resultBattery"),
  resultTime: document.querySelector("#resultTime"),
  resultEmergency: document.querySelector("#resultEmergency"),
  adjustButton: document.querySelector("#adjustButton"),
  retryButton: document.querySelector("#retryButton"),
  audioVisual: document.querySelector("#audioVisual"),
};

const renderer = new SnowlineRenderer(ui.scene);
const audio = new AudioEngine();
const querySeed = new URLSearchParams(window.location.search).get("seed");

let scenario = null;
let sim = null;
let seed = querySeed || DEFAULT_SEED;
let stopSelections = STATIONS.map(() => true);
let initialPatience = new Map();
let running = false;
let paused = false;
let speed = 2;
let lastFrame = performance.now();
let lastEventId = 0;
let resultScheduled = false;
let radioEntries = [];
let lastHeadwayAlert = 0;
let muted = false;

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatTone(tone) {
  if (tone === "danger") return "danger";
  if (tone === "warn") return "warn";
  if (tone === "good") return "good";
  return "neutral";
}

function showToast(text, tone = "neutral", duration = 3200) {
  const toast = document.createElement("div");
  toast.className = `toast ${formatTone(tone)}`;
  toast.textContent = text;
  ui.toastStack.appendChild(toast);
  while (ui.toastStack.children.length > 3) ui.toastStack.firstElementChild.remove();
  window.setTimeout(() => {
    toast.classList.add("leaving");
    window.setTimeout(() => toast.remove(), 230);
  }, duration);
}

function updateSeedAudit() {
  if (scenario.generationAudit.verified) {
    ui.verifiedBadge.textContent = "SEED 已校验";
    ui.verifiedBadge.title = "已先模拟一条可完成全程的基准行程，再生成乘客需求。";
  } else {
    ui.verifiedBadge.textContent = "校验失败";
  }
}

function statusForPassenger(passenger) {
  if (passenger.status === "delivered") return "已抵达";
  if (passenger.status === "left") return "已离开";
  if (passenger.status === "aboard") return `${passenger.car || "车"} · 前往`;
  return `${Math.ceil(passenger.patience)}s`;
}

function createPassengerRows() {
  ui.passengerList.innerHTML = "";
  initialPatience = new Map(
    scenario.passengers.map((passenger) => [passenger.id, passenger.patience]),
  );
  for (const passenger of scenario.passengers) {
    const row = document.createElement("div");
    row.className = "passenger-row";
    row.dataset.id = passenger.id;
    row.innerHTML = `
      <span class="passenger-avatar">${passenger.name.slice(-1)}</span>
      <div class="passenger-main">
        <div class="passenger-line">
          <strong>${passenger.name}</strong>
          <span class="passenger-status">${Math.ceil(passenger.patience)}s</span>
        </div>
        <div class="passenger-route">${STATIONS[passenger.origin].code} ${STATIONS[passenger.origin].name}
          → ${STATIONS[passenger.destination].code} ${STATIONS[passenger.destination].name}</div>
        <div class="patience-track"><i></i></div>
      </div>
    `;
    ui.passengerList.appendChild(row);
  }
}

function passengerState() {
  return sim ? sim.passengers : scenario.passengers;
}

function updatePassengerRows() {
  const passengers = passengerState();
  let delivered = 0;
  for (const passenger of passengers) {
    const row = ui.passengerList.querySelector(`[data-id="${passenger.id}"]`);
    if (!row) continue;
    const currentStatus = passenger.status ?? "waiting";
    const initial = Math.max(1, initialPatience.get(passenger.id) ?? passenger.patience);
    const ratio =
      currentStatus === "waiting" ? Math.max(0, Math.min(1, passenger.patience / initial)) : 1;
    const fill = row.querySelector(".patience-track i");
    fill.style.width = `${ratio * 100}%`;
    fill.style.background =
      ratio < 0.25
        ? "var(--danger)"
        : ratio < 0.5
          ? "var(--amber)"
          : "linear-gradient(90deg, #d8a548, #f3cc78)";
    row.querySelector(".passenger-status").textContent = statusForPassenger(passenger);
    row.classList.toggle("low", currentStatus === "waiting" && passenger.patience < 15);
    row.classList.toggle("aboard", currentStatus === "aboard");
    row.classList.toggle("delivered", currentStatus === "delivered");
    row.classList.toggle("left", currentStatus === "left");
    if (currentStatus === "delivered") delivered += 1;
  }
  ui.manifestCount.textContent = `${delivered} / ${scenario.passengers.length}`;
}

function stationDemand(index) {
  const passengers = passengerState();
  return {
    boarding: passengers.filter(
      (passenger) =>
        (passenger.status ?? "waiting") === "waiting" && passenger.origin === index,
    ).length,
    alighting: passengers.filter(
      (passenger) => passenger.status === "aboard" && passenger.destination === index,
    ).length,
  };
}

function createStopButtons() {
  ui.stopGrid.innerHTML = "";
  STATIONS.forEach((station, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "stop-toggle";
    button.dataset.station = String(index);
    button.setAttribute("aria-pressed", String(stopSelections[index]));
    button.innerHTML = `
      <span class="station-code">${station.code}</span>
      <span class="station-copy">
        <strong>${station.name}</strong>
        <small></small>
      </span>
      <span class="stop-indicator" aria-hidden="true"></span>
    `;
    button.addEventListener("click", () => {
      if (running) return;
      stopSelections[index] = !stopSelections[index];
      button.setAttribute("aria-pressed", String(stopSelections[index]));
      renderer.setPreviewStops(stopSelections);
      audio.click();
      updateStopButtons();
    });
    ui.stopGrid.appendChild(button);
  });
  updateStopButtons();
}

function updateStopButtons() {
  ui.stopGrid.querySelectorAll(".stop-toggle").forEach((button) => {
    const index = Number(button.dataset.station);
    const demand = stationDemand(index);
    button.setAttribute("aria-pressed", String(stopSelections[index]));
    button.disabled = running;
    const note = button.querySelector("small");
    note.textContent =
      demand.boarding + demand.alighting > 0
        ? `待上 ${demand.boarding} · 待下 ${demand.alighting}`
        : stopSelections[index]
          ? "本站当前无人"
          : "无人 · 可跳过";
  });
}

function appendRadioEntries(events) {
  const fresh = events.filter((event) => event.id > lastEventId);
  if (!fresh.length) return;
  lastEventId = fresh[fresh.length - 1].id;
  for (const event of fresh) {
    radioEntries.push(event);
    if (event.type === "emergency" && event.time - lastHeadwayAlert > 5) {
      lastHeadwayAlert = event.time;
      showToast(event.text, "danger", 4200);
      audio.alarm();
    }
    if (event.type === "finish") {
      showToast(`${event.text}`, "good", 3400);
      audio.chime();
    }
    if (event.type === "lost" || event.type === "capacity") {
      showToast(event.text, event.type === "lost" ? "danger" : "warn", 3400);
    }
    if (event.type === "success" || event.type === "failure") {
      if (event.type === "failure") showToast(event.text, "danger", 4200);
    }
  }
  radioEntries = radioEntries.slice(-8);
  ui.radioLog.innerHTML = radioEntries
    .map(
      (event) => `
      <div class="log-entry ${formatTone(event.tone)}">
        <time>${formatTime(event.time)}</time>
        <span>${event.text}</span>
      </div>
    `,
    )
    .join("");
}

function resetRadioLog(message = "等待发车许可。") {
  radioEntries = [
    {
      id: 0,
      time: 0,
      tone: "neutral",
      text: message,
    },
  ];
  lastEventId = 0;
  ui.radioLog.innerHTML = `
    <div class="log-entry neutral"><time>00:00</time><span>${message}</span></div>
  `;
}

function setControlsLocked(locked) {
  ui.intervalInput.disabled = locked;
  ui.launchButton.disabled = locked;
  ui.stopGrid.querySelectorAll(".stop-toggle").forEach((button) => {
    button.disabled = locked;
  });
  ui.pauseButton.disabled = !locked;
}

function updateStatus(status, tone = "neutral") {
  ui.statusBadge.textContent = status;
  ui.statusBadge.className = `status-badge ${tone}`;
  ui.phaseLabel.textContent =
    status === "运行中" ? "班次运行中" : status === "待发车" ? "等待调度" : status;
  ui.liveDot.className = `live-dot ${tone === "live" ? "live" : tone === "alert" ? "alert" : ""}`;
}

function updateTelemetry() {
  const time = sim?.time ?? 0;
  const battery = sim?.battery ?? GAME.startBattery;
  const passengers = passengerState();
  const delivered = passengers.filter((passenger) => passenger.status === "delivered").length;
  const emergencyStops = sim?.emergencyStops ?? 0;
  const batteryPercent = Math.max(0, Math.min(100, battery));
  const batteryRatio = batteryPercent / 100;

  ui.clockValue.textContent = formatTime(time);
  ui.clockSub.textContent = `调度窗口 ${formatTime(GAME.shiftLimit)}`;
  ui.batteryValue.innerHTML = `${Math.round(batteryPercent)}<span>%</span>`;
  ui.batteryFill.style.width = `${batteryPercent}%`;
  ui.batteryFill.style.background =
    batteryPercent < 24
      ? "linear-gradient(90deg, #cf514b, #f17369)"
      : batteryPercent < 40
        ? "linear-gradient(90deg, #c68d32, #f0ba5e)"
        : "linear-gradient(90deg, #63c799, #9be1bd)";
  ui.batteryNote.textContent =
    batteryPercent < 24 ? "逼近保护线" : batteryPercent < 40 ? "余量偏低" : "电量充足";
  ui.batteryNote.style.color =
    batteryPercent < 24 ? "var(--danger)" : batteryPercent < 40 ? "var(--amber)" : "var(--green)";
  ui.deliveredValue.textContent = `${delivered} / ${scenario.passengers.length}`;
  ui.emergencyValue.textContent = String(emergencyStops);
  ui.emergencyValue.style.color = emergencyStops > 0 ? "var(--danger)" : "";

  if (sim) {
    const follower = sim.cars[1];
    if (follower.state === "queued") {
      ui.headwayValue.textContent = "待发";
    } else if (sim.cars[0].state === "finished") {
      ui.headwayValue.textContent = "终到";
    } else {
      const gap = Math.max(0, sim.cars[0].distance - follower.distance - GAME.carLength);
      ui.headwayValue.textContent = `${Math.round(gap)} m`;
      ui.headwayValue.style.color =
        gap < 65 ? "var(--danger)" : gap < 110 ? "var(--amber)" : "";
    }
  } else {
    ui.headwayValue.textContent = "待发";
    ui.headwayValue.style.color = "";
  }

  const wind = sim?.currentWind ?? scenario.windBase;
  ui.windValue.innerHTML = `${wind.toFixed(1)}<small>m/s</small>`;
  ui.iceValue.innerHTML = `${Math.round(scenario.ice * 100)}<small>%</small>`;
  ui.tempValue.innerHTML = `${scenario.temperature}<small>°C</small>`;
  ui.intervalValue.innerHTML = `${ui.intervalInput.value}<span>秒</span>`;
  ui.intervalInput.style.setProperty(
    "--pct",
    `${((Number(ui.intervalInput.value) - GAME.minInterval) /
      (GAME.maxInterval - GAME.minInterval)) *
      100}%`,
  );
  ui.launchHint.textContent = `01 号立即离站 · 02 号 ${ui.intervalInput.value} 秒后跟进`;

  const speedLoss = Math.round((1 - windSpeedFactor(wind)) * 100);
  const brakingExtra = Math.round(scenario.ice * 90);
  ui.forecastText.textContent =
    wind > 13
      ? `强阵风 ${wind.toFixed(1)} m/s · 巡航减速约 ${speedLoss}% · 冰面制动距离 +${brakingExtra}%`
      : `阵风 ${wind.toFixed(1)} m/s · 巡航减速约 ${speedLoss}% · 冰面制动距离 +${brakingExtra}%`;

  updatePassengerRows();
  updateStopButtons();
  updateBatteryWarning(batteryRatio);
}

function updateBatteryWarning(ratio) {
  if (sim && ratio < GAME.minimumBattery / 100) {
    ui.batteryNote.textContent = "电量越线";
  }
}

function setStatusForRun() {
  if (!sim) {
    updateStatus("待发车", "neutral");
  } else if (sim.result?.success) {
    updateStatus("班次完成", "live");
  } else if (sim.result) {
    updateStatus("班次失败", "alert");
  } else if (paused) {
    updateStatus("已暂停", "neutral");
  } else {
    updateStatus("运行中", "live");
  }
  ui.runState.textContent =
    sim?.result?.success
      ? "已抵达"
      : sim?.result
        ? "已停机"
        : paused
          ? "已暂停"
          : sim
            ? "运行中"
            : "待发车";
}

function updateAudioVisual() {
  if (!sim) return;
  const maxSpeed = Math.max(0, ...sim.cars.map((car) => car.speed));
  const ratios = [0.3, 0.48, 0.82, 0.61, 0.4];
  ui.audioVisual.querySelectorAll("span").forEach((bar, index) => {
    const active = sim.cars.some((car) =>
      ["running", "dwelling", "emergency"].includes(car.state),
    );
    const base = active ? (maxSpeed / GAME.cruiseSpeed) * 15 : 4;
    bar.style.height = `${4 + Math.abs(Math.sin(sim.time * (1.5 + index * 0.3))) * base * ratios[index] * 1.8}px`;
    bar.style.background =
      sim.emergencyStops > 0 && sim.cars.some((car) => car.state === "emergency")
        ? "rgba(241, 115, 105, 0.68)"
        : `rgba(130, 217, 230, ${0.38 + ratios[index] * 0.35})`;
  });
}

function loadScenario(nextSeed, options = {}) {
  ui.resultDialog.close();
  scenario = generateScenario(nextSeed);
  seed = nextSeed;
  sim = null;
  running = false;
  paused = false;
  resultScheduled = false;
  lastHeadwayAlert = 0;
  stopSelections = STATIONS.map(() => true);
  renderer.setPreviewStops(stopSelections);
  ui.seedLabel.textContent = scenario.seed;
  ui.verifiedBadge.textContent = "SEED 已校验";
  ui.verifiedBadge.classList.remove("unverified");
  ui.intervalInput.value = String(options.interval ?? GAME.defaultInterval);
  renderer.setScenario(scenario, null);
  createStopButtons();
  createPassengerRows();
  resetRadioLog(`SEED ${scenario.seed} · 基准行程校验通过。`);
  setControlsLocked(false);
  setStatusForRun();
  updateSeedAudit();
  updateTelemetry();
}

function startShift() {
  if (running || !scenario) return;
  if (sim?.result) resetShift();
  audio.ensure();
  sim = new RopewaySim(scenario, {
    interval: Number(ui.intervalInput.value),
    stops: [...stopSelections],
  });
  running = true;
  paused = false;
  resultScheduled = false;
  lastEventId = 0;
  ui.resultDialog.close();
  setControlsLocked(true);
  setStatusForRun();
  appendRadioEntries(sim.events);
  updateTelemetry();
  showToast(`01 号离站，02 号将在 ${ui.intervalInput.value} 秒后跟进。`, "neutral", 2600);
  audio.click();
}

function resetShift() {
  if (ui.resultDialog.open) ui.resultDialog.close();
  sim = null;
  running = false;
  paused = false;
  resultScheduled = false;
  lastHeadwayAlert = 0;
  setControlsLocked(false);
  resetRadioLog(`策略已复位 · 上次设置保留，等待重新发车。`);
  setStatusForRun();
  renderer.setScenario(scenario, null);
  updateTelemetry();
  ui.pauseButton.innerHTML = "<span>Ⅱ</span> 暂停";
}

function togglePause() {
  if (!running) return;
  paused = !paused;
  ui.pauseButton.innerHTML = paused ? "<span>▶</span> 继续" : "<span>Ⅱ</span> 暂停";
  setStatusForRun();
  audio.click();
}

function showResult() {
  if (!sim?.result || resultScheduled) return;
  resultScheduled = true;
  const result = sim.result;
  setStatusForRun();
  window.setTimeout(() => {
    if (sim?.result !== result) return;
    if (!ui.resultDialog.open) ui.resultDialog.showModal();
    ui.resultEyebrow.textContent = result.success ? "SHIFT COMPLETE" : "SHIFT ABORTED";
    ui.resultIcon.textContent = result.success ? "✓" : "!";
    ui.resultIcon.classList.toggle("failure", !result.success);
    ui.resultTitle.textContent = result.success ? "雪线班次完成" : "班次中断";
    ui.resultMessage.textContent = result.message;
    ui.resultDelivered.textContent = `${result.delivered} / ${result.total}`;
    ui.resultBattery.textContent = `${Math.round(result.battery)}%`;
    ui.resultTime.textContent = formatTime(result.time);
    ui.resultEmergency.textContent = String(result.emergencyStops);
    if (result.success) audio.chime();
    else audio.tone(180, 0.35, "sawtooth", 0.06);
  }, 420);
}

function tickSimulation(delta) {
  if (!running || paused || !sim || sim.ended) return;
  const scaledDelta = Math.min(0.1, delta) * speed;
  sim.advance(scaledDelta);
  appendRadioEntries(sim.events);
  updateTelemetry();
  if (sim.ended) {
    running = false;
    setControlsLocked(false);
    ui.launchButton.disabled = false;
    setStatusForRun();
    showResult();
  }
}

function frame(now) {
  const delta = Math.max(0, Math.min(0.1, (now - lastFrame) / 1000));
  lastFrame = now;
  tickSimulation(delta);
  renderer.render(sim, scenario, delta);

  const maxSpeed = sim ? Math.max(0, ...sim.cars.map((car) => car.speed)) : 0;
  const active = sim
    ? sim.cars.some((car) => ["running", "dwelling", "emergency"].includes(car.state))
    : false;
  const emergency = sim?.cars.some((car) => car.state === "emergency") ?? false;
  audio.update({
    wind: sim?.currentWind ?? scenario.windBase,
    speed: maxSpeed,
    active,
    emergency,
    paused,
  });
  updateAudioVisual();
  window.requestAnimationFrame(frame);
}

function switchSeed() {
  const nextSeed = randomSeed();
  loadScenario(nextSeed);
  audio.click();
}

ui.launchButton.addEventListener("click", startShift);
ui.seedButton.addEventListener("click", switchSeed);
ui.pauseButton.addEventListener("click", togglePause);
ui.restartButton.addEventListener("click", resetShift);
ui.audioButton.addEventListener("click", () => {
  muted = !muted;
  audio.setMuted(muted);
  audio.ensure();
  ui.audioButton.innerHTML = muted ? "<span>◌</span> 声音 关" : "<span>◖</span> 声音 开";
});

ui.intervalInput.addEventListener("input", () => {
  updateTelemetry();
  if (!running) audio.click();
});

document.querySelectorAll("[data-speed]").forEach((button) => {
  button.addEventListener("click", () => {
    speed = Number(button.dataset.speed);
    document.querySelectorAll("[data-speed]").forEach((item) => {
      item.classList.toggle("active", item === button);
    });
    audio.click();
  });
});

ui.helpButton.addEventListener("click", () => ui.helpDialog.showModal());
ui.closeHelpButton.addEventListener("click", () => ui.helpDialog.close());
ui.confirmHelpButton.addEventListener("click", () => ui.helpDialog.close());

ui.adjustButton.addEventListener("click", () => {
  ui.resultDialog.close();
  resetShift();
});
ui.retryButton.addEventListener("click", () => {
  ui.resultDialog.close();
  resetShift();
  startShift();
});

window.addEventListener("keydown", (event) => {
  if (event.target.matches("input, button, dialog")) return;
  if (event.code === "Space") {
    event.preventDefault();
    if (running) togglePause();
    else startShift();
  }
  if (event.key === "r" || event.key === "R") resetShift();
});

try {
  loadScenario(seed);
} catch (error) {
  console.error(error);
  seed = DEFAULT_SEED;
  loadScenario(seed);
}

window.__SNOWLINE__ = {
  get scenario() {
    return scenario;
  },
  get sim() {
    return sim;
  },
  startShift,
  resetShift,
  setPolicy(interval, stops = [true, true, true, true]) {
    ui.intervalInput.value = String(interval);
    stopSelections = [...stops];
    renderer.setPreviewStops(stopSelections);
    createStopButtons();
    updateTelemetry();
  },
  fastForward(seconds) {
    if (!sim) startShift();
    const chunks = Math.ceil(seconds / 0.05);
    for (let index = 0; index < chunks && !sim.ended; index += 1) {
      sim.step(0.05);
      appendRadioEntries(sim.events);
    }
    updateTelemetry();
    if (sim.ended) {
      running = false;
      setControlsLocked(false);
      setStatusForRun();
      showResult();
    }
    return sim.result;
  },
};

window.requestAnimationFrame(frame);

