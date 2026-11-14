import { GreenhouseAudio } from "./audio.js";
import { GreenhouseRenderer } from "./renderer.js";
import { GreenhouseGame, OVERHEAT_GRACE, OVERHEAT_LIMIT } from "./simulation.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const canvas = $("#greenhouse-canvas");
const renderer = new GreenhouseRenderer(canvas);
const audio = new GreenhouseAudio();
let game = new GreenhouseGame();

$$(".overlay").forEach((overlay) => $(".game-stage").appendChild(overlay));

let phase = "ready";
let selectedIndex = 0;
let lastFrame = performance.now();
let lastUiUpdate = 0;
let finishHandled = false;
let lastWeatherKey = "";
let lastPump = false;
let lastFan = false;
let lastAlarm = false;

const ui = {
  intro: $("#intro-overlay"),
  pause: $("#pause-overlay"),
  result: $("#result-overlay"),
  pauseButton: $("#pause-button"),
  pauseLabel: $("#pause-button span"),
  soundButton: $("#sound-toggle"),
  clock: $("#shift-clock"),
  shiftState: $("#shift-state"),
  waterValue: $("#water-value"),
  waterFill: $("#water-fill"),
  waterHint: $("#water-hint"),
  waterCard: $(".water-card"),
  weatherCard: $("#weather-card"),
  weatherOrb: $("#weather-orb"),
  weatherKicker: $("#weather-kicker"),
  weatherTitle: $("#weather-title"),
  weatherAdvice: $("#weather-advice"),
  forecastPill: $("#forecast-pill"),
  forecastText: $("#forecast-text"),
  batchTotal: $("#batch-total"),
  batchList: $("#batch-list"),
  crates: $$(".batch-crates i"),
  selectedId: $("#selected-id"),
  selectedBatch: $("#selected-batch"),
  selectedStatus: $("#selected-status"),
  growthNumber: $("#growth-number"),
  moistureValue: $("#moisture-value"),
  moistureFill: $("#moisture-fill"),
  moistureBand: $("#moisture-band"),
  temperatureValue: $("#temperature-value"),
  temperatureFill: $("#temperature-fill"),
  temperatureBand: $("#temperature-band"),
  lightValue: $("#light-value"),
  lightFill: $("#light-fill"),
  lightBand: $("#light-band"),
  harvestButton: $("#harvest-button"),
  harvestKicker: $("#harvest-kicker"),
  eventRibbon: $("#event-ribbon"),
  eventRibbonText: $("#event-ribbon-text"),
  resultCard: $(".result-card"),
  resultTitle: $("#result-title"),
  resultReason: $("#result-reason"),
  resultStamp: $("#result-stamp"),
  resultTime: $("#result-time"),
  resultWater: $("#result-water"),
  resultBatches: $("#result-batches"),
  resultBeds: $("#result-beds"),
  liveAnnouncer: $("#live-announcer"),
};

const actionButtons = $$(".action-button");
const meterElements = {
  moisture: $('.readout-meter[data-meter="moisture"]'),
  temperature: $('.readout-meter[data-meter="temperature"]'),
  light: $('.readout-meter[data-meter="light"]'),
};

function formatTime(seconds) {
  const value = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function formatNumber(value, decimals = 0) {
  return Number(value).toFixed(decimals);
}

function announce(text) {
  ui.liveAnnouncer.textContent = "";
  window.setTimeout(() => {
    ui.liveAnnouncer.textContent = text;
  }, 20);
}

function setOverlay(element, visible) {
  element.classList.toggle("is-hidden", !visible);
}

function hideAllOverlays() {
  setOverlay(ui.intro, false);
  setOverlay(ui.pause, false);
  setOverlay(ui.result, false);
}

async function startShift() {
  await audio.init();
  if (phase === "ready") {
    game = new GreenhouseGame();
    selectedIndex = 0;
    finishHandled = false;
  }
  phase = "running";
  hideAllOverlays();
  ui.pauseButton.disabled = false;
  updatePauseButton();
  lastFrame = performance.now();
  announce("轮班开始。先检查每块床的湿度和温度。");
  updateUI(true);
}

function resetGame({ showIntro = false, autoStart = false } = {}) {
  game = new GreenhouseGame();
  selectedIndex = 0;
  finishHandled = false;
  lastWeatherKey = "";
  audio.stopLoops();
  lastPump = false;
  lastFan = false;
  lastAlarm = false;
  setOverlay(ui.result, false);
  setOverlay(ui.pause, false);
  if (showIntro) {
    phase = "ready";
    setOverlay(ui.intro, true);
    ui.pauseButton.disabled = true;
    updatePauseButton();
    updateUI(true);
  } else {
    phase = "running";
    hideAllOverlays();
    ui.pauseButton.disabled = false;
    updatePauseButton();
    if (autoStart) audio.init();
    updateUI(true);
  }
}

function setPaused(paused) {
  if (paused && phase === "running") {
    phase = "paused";
    setOverlay(ui.pause, true);
    ui.pauseLabel.textContent = "继续";
    syncAudio();
    updateUI(true);
    return;
  }
  if (!paused && phase === "paused") {
    phase = "running";
    setOverlay(ui.pause, false);
    ui.pauseLabel.textContent = "暂停";
    lastFrame = performance.now();
    updateUI(true);
  }
}

function togglePause() {
  if (phase === "running") setPaused(true);
  else if (phase === "paused") setPaused(false);
}

function updatePauseButton() {
  ui.pauseLabel.textContent = phase === "paused" ? "继续" : "暂停";
  ui.pauseButton.disabled = phase === "ready" || phase === "ended";
}

function selectBed(index) {
  if (!Number.isInteger(index) || index < 0 || index >= game.beds.length) return;
  selectedIndex = index;
  updateUI(true);
}

function toggleControl(control) {
  if (phase !== "running") return;
  const bed = game.beds[selectedIndex];
  if (!game.toggleControl(selectedIndex, control)) return;
  const label = {
    irrigation: "灌溉",
    heating: "加热",
    ventilation: "通风",
    shade: "遮光",
  }[control];
  announce(`${bed.id} ${label}${bed.controls[control] ? "已开启" : "已关闭"}`);
  syncAudio();
  updateUI(true);
}

function harvestSelected() {
  if (phase !== "running") return;
  const bed = game.beds[selectedIndex];
  if (!game.harvest(selectedIndex)) return;
  processEvents();
  audio.harvest();
  announce(`${bed.id} ${bed.crop.name} 已收获。`);
  const nextBed = game.beds.findIndex(
    (candidate, index) => index !== selectedIndex && candidate.matured && !candidate.harvested,
  );
  const nextGrowing = game.beds.findIndex((candidate) => !candidate.harvested);
  if (nextBed >= 0) selectedIndex = nextBed;
  else if (nextGrowing >= 0) selectedIndex = nextGrowing;
  updateUI(true);
}

function processEvents() {
  const events = game.consumeEvents();
  for (const event of events) {
    if (event.type === "mature") {
      const bed = game.beds.find((item) => item.id === event.bedId);
      audio.mature();
      announce(`${bed.id} ${bed.crop.name} 已成熟，可以收获。`);
    }
    if (event.type === "failure") audio.failure(event.code);
    if (event.type === "win") audio.win();
  }

  if (game.status !== "running" && phase === "running") {
    showResult();
  }
}

function showResult() {
  if (finishHandled) return;
  finishHandled = true;
  phase = "ended";
  audio.stopLoops();
  syncAudio();
  updatePauseButton();
  setOverlay(ui.intro, false);
  setOverlay(ui.pause, false);
  setOverlay(ui.result, true);

  const won = game.status === "won";
  const failure = game.failure;
  ui.resultCard.classList.toggle("is-failure", !won);
  ui.resultStamp.textContent = won ? "合格" : "失败";
  ui.resultTitle.textContent = won
    ? "三批作物全部入库"
    : failure?.code === "water"
      ? "水箱先见了底"
      : failure?.code === "overheat"
        ? "一块床烧过了头"
        : "轮班结束，仍有未收作物";
  ui.resultReason.textContent = won
    ? "冷空气、云层和过热设备都撑过去了，三批作物按时交货。"
    : failure?.message || "轮班提前结束。";
  ui.resultTime.textContent = `用时 ${formatTime(game.endedAt ?? game.time)}`;
  ui.resultWater.textContent = `${Math.ceil(game.water)} L`;
  const completedBatches = game.getBatchProgress().filter((batch) => batch.harvested === 2).length;
  ui.resultBatches.textContent = `${completedBatches} / 3`;

  ui.resultBeds.innerHTML = game.beds
    .map((bed) => {
      const failedBed = failure?.bedIndex === bed.index;
      const stateClass = bed.harvested ? "is-harvested" : failedBed ? "is-failed" : "";
      const state = bed.harvested
        ? "已收获入库"
        : failedBed
          ? `连续过热 ${OVERHEAT_GRACE.toFixed(1)}s`
          : bed.matured
            ? "成熟，未收获"
            : `生长 ${Math.round(bed.growth)}% · ${game.getConditionStatus(bed).all ? "区间内" : "暂时停滞"}`;
      return `
        <div class="result-bed ${stateClass}">
          <span class="result-bed-id">${bed.id}</span>
          <span class="result-bed-copy">
            <strong>${bed.crop.name}</strong>
            <small>M ${Math.round(bed.moisture)}% · T ${bed.temperature.toFixed(1)}° · L ${Math.round(bed.light)}%</small>
            <span class="result-bed-state">${state}</span>
          </span>
        </div>
      `;
    })
    .join("");

  updateUI(true);
  window.setTimeout(() => $("#retry-button").focus(), 80);
  announce(won ? "轮班完成，三批作物全部入库。" : `轮班失败。${failure?.message || ""}`);
}

function syncAudio() {
  const active = phase === "running";
  const pump = active && game.beds.some((bed) => bed.controls.irrigation && !bed.harvested) && game.water > 0;
  const fan = active && game.beds.some((bed) => bed.controls.ventilation && !bed.harvested);
  const alarm =
    active &&
    game.beds.some(
      (bed) => !bed.harvested && (bed.overheatTime > 0.05 || bed.temperature >= OVERHEAT_LIMIT),
    );

  if (pump !== lastPump) {
    audio.setPump(pump);
    lastPump = pump;
  }
  if (fan !== lastFan) {
    audio.setFan(fan);
    lastFan = fan;
  }
  if (alarm !== lastAlarm) {
    audio.setAlarm(alarm);
    lastAlarm = alarm;
  }
}

function setMeter(name, value, idealRange, min = 0, max = 100, display = null) {
  const low = Math.max(min, Math.min(max, idealRange[0]));
  const high = Math.max(min, Math.min(max, idealRange[1]));
  const normalized = ((value - min) / (max - min)) * 100;
  const fill = `${Math.max(0, Math.min(100, normalized))}%`;
  const bandLeft = `${((low - min) / (max - min)) * 100}%`;
  const bandWidth = `${((high - low) / (max - min)) * 100}%`;
  const valid = value >= idealRange[0] && value <= idealRange[1];
  const valueElement = ui[`${name}Value`];
  const fillElement = ui[`${name}Fill`];
  const bandElement = ui[`${name}Band`];

  valueElement.textContent = display ?? `${Math.round(value)}%`;
  fillElement.style.width = fill;
  bandElement.style.left = bandLeft;
  bandElement.style.width = bandWidth;
  meterElements[name].classList.toggle("is-out", !valid);
  meterElements[name].querySelector("b").style.color = valid ? "" : "var(--danger)";
}

function overheatBed() {
  return game.beds.find(
    (bed) => !bed.harvested && (bed.overheatTime > 0.08 || bed.temperature >= OVERHEAT_LIMIT),
  );
}

function updateRibbon() {
  const hotBed = overheatBed();
  const weather = game.weather;
  let text = "";
  let visible = false;
  let danger = false;

  if (phase === "running" && hotBed) {
    visible = true;
    danger = true;
    text = `${hotBed.id} 温度过高 · 连续过热 ${hotBed.overheatTime.toFixed(1)} / ${OVERHEAT_GRACE.toFixed(1)} s`;
  } else if (phase === "running" && game.water < 18) {
    visible = true;
    danger = true;
    text = `水箱仅剩 ${Math.ceil(game.water)} L · 立即关闭闲置灌溉`;
  } else if (weather.active) {
    visible = true;
    danger = weather.type === "heat" || weather.type === "cold";
    text = `${weather.name} · ${weather.headline} · ${weather.advice}`;
  } else if (weather.forecast) {
    visible = true;
    danger = weather.forecast.type === "heat";
    text = `天气预警 · ${Math.ceil(weather.secondsUntil)}s 后 ${weather.forecast.name} · ${weather.forecast.advice}`;
  }

  ui.eventRibbon.classList.toggle("is-visible", visible);
  ui.eventRibbon.classList.toggle("is-danger", danger);
  if (text) ui.eventRibbonText.textContent = text;
}

function updateWeatherAnnouncement() {
  const weather = game.weather;
  const key = weather.active
    ? `active:${weather.type}`
    : weather.forecast
      ? `forecast:${weather.forecast.type}`
      : "calm";
  if (key === lastWeatherKey || phase !== "running") {
    lastWeatherKey = key;
    return;
  }
  lastWeatherKey = key;
  if (weather.active) {
    announce(`${weather.name}开始。${weather.advice}`);
    audio.warning();
  } else if (weather.forecast) {
    announce(`天气预警：${Math.ceil(weather.secondsUntil)} 秒后${weather.forecast.name}。${weather.forecast.advice}`);
    audio.warning();
  }
}

function updateUI(force = false) {
  const now = performance.now();
  if (!force && now - lastUiUpdate < 70) return;
  lastUiUpdate = now;

  const remaining = Math.max(0, (phase === "ready" ? game.duration : game.duration - game.time));
  ui.clock.textContent = formatTime(remaining);
  ui.shiftState.textContent =
    phase === "ready"
      ? "待开始"
      : phase === "running"
        ? "值班中"
        : phase === "paused"
          ? "已暂停"
          : game.status === "won"
            ? "已完成"
            : "已失败";

  ui.waterValue.textContent = Math.ceil(game.water);
  ui.waterFill.style.width = `${(game.water / game.waterCapacity) * 100}%`;
  ui.waterCard.classList.toggle("is-low", game.water < 25);
  ui.waterHint.textContent =
    game.water < 25
      ? `低水位 · 泵送余量 ${Math.ceil(game.water)} L`
      : "每床灌溉耗水 1.8 L/s";
  $(".water-meter").setAttribute("aria-valuenow", String(Math.ceil(game.water)));

  const weather = game.weather;
  const visualWeather = weather.active
    ? weather.type
    : weather.forecast
      ? weather.forecast.type
      : "clear";
  ui.weatherOrb.dataset.weather = visualWeather;
  ui.weatherCard.classList.toggle("is-active", weather.active);
  ui.weatherCard.classList.toggle("is-forecast", Boolean(weather.forecast) && !weather.active);

  if (weather.active) {
    ui.weatherKicker.textContent = "天气事件 · 进行中";
    ui.weatherTitle.textContent = `${weather.name} · ${weather.headline}`;
    ui.weatherAdvice.textContent = weather.advice;
    ui.forecastText.textContent = `剩余 ${formatTime(weather.endsAt - game.time)} · ${weather.advice}`;
  } else {
    ui.weatherKicker.textContent = "当前天气";
    ui.weatherTitle.textContent = `${weather.name} · ${weather.headline}`;
    ui.weatherAdvice.textContent = weather.advice;
    if (weather.forecast) {
      ui.forecastText.textContent = `${Math.ceil(weather.secondsUntil)}s 后 · ${weather.forecast.name}`;
    } else if (weather.next) {
      ui.forecastText.textContent = `下一场 ${Math.ceil(weather.secondsUntil)}s 后`;
    } else {
      ui.forecastText.textContent = "本班天气已稳定";
    }
  }

  const batchProgress = game.getBatchProgress();
  const completeBatches = batchProgress.filter((batch) => batch.harvested === 2).length;
  ui.batchTotal.textContent = completeBatches;
  batchProgress.forEach((batch, index) => {
    ui.crates[index].classList.toggle("is-done", batch.harvested === 2);
    const row = ui.batchList.children[index];
    row.querySelector("em").textContent = batch.harvested;
  });

  const selected = game.beds[selectedIndex];
  const conditions = game.getConditionStatus(selected);
  ui.selectedId.textContent = selected.id;
  ui.selectedBatch.textContent = `批次 ${selected.batch} · ${selected.crop.name}`;
  ui.selectedStatus.textContent = selected.harvested
    ? "已收获入库"
    : selected.matured
      ? "成熟，等待收获"
      : conditions.all
        ? "气候适宜 · 生长中"
        : "气候偏离 · 生长暂停";
  ui.growthNumber.innerHTML = `${Math.round(selected.growth)}<em>%</em>`;

  setMeter("moisture", selected.moisture, selected.crop.ideal.moisture);
  setMeter(
    "temperature",
    selected.temperature,
    selected.crop.ideal.temperature,
    8,
    38,
    `${selected.temperature.toFixed(1)}°C`,
  );
  setMeter("light", selected.light, selected.crop.ideal.light);

  actionButtons.forEach((button) => {
    const control = button.dataset.control;
    const disabled = phase !== "running" || selected.harvested;
    const active = Boolean(selected.controls[control]);
    button.disabled = disabled;
    button.setAttribute("aria-pressed", String(active));
  });
  const canHarvest = phase === "running" && selected.matured && !selected.harvested;
  ui.harvestButton.disabled = !canHarvest;
  ui.harvestButton.classList.toggle("is-ready", canHarvest);
  ui.harvestKicker.textContent = selected.harvested
    ? "本床已入库"
    : selected.matured
      ? "成熟 · 立即入库"
      : `还需 ${Math.ceil(100 - selected.growth)}% 生长`;

  updateRibbon();
  updateWeatherAnnouncement();
  updatePauseButton();
}

function frame(now) {
  const delta = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  if (phase === "running") {
    game.tick(delta);
    processEvents();
  }
  syncAudio();
  updateUI();
  renderer.draw(game, selectedIndex, phase, now);
  requestAnimationFrame(frame);
}

canvas.addEventListener("click", (event) => {
  const index = renderer.bedAt(event.clientX, event.clientY);
  if (index !== undefined) selectBed(index);
});

actionButtons.forEach((button) => {
  button.addEventListener("click", () => toggleControl(button.dataset.control));
});

ui.harvestButton.addEventListener("click", harvestSelected);
$("#start-button").addEventListener("click", startShift);
ui.pauseButton.addEventListener("click", togglePause);
$("#resume-button").addEventListener("click", () => setPaused(false));
$("#retry-button").addEventListener("click", () => resetGame({ showIntro: false, autoStart: true }));
$("#restart-overlay-button").addEventListener("click", () => resetGame({ showIntro: true }));
$("#pause-restart-button").addEventListener("click", () => resetGame({ showIntro: true }));

ui.soundButton.addEventListener("click", async () => {
  await audio.init();
  audio.setMuted(!audio.muted);
  ui.soundButton.setAttribute("aria-pressed", String(!audio.muted));
  ui.soundButton.setAttribute("aria-label", audio.muted ? "开启音效" : "关闭音效");
  announce(audio.muted ? "音效已关闭" : "音效已开启");
});

window.addEventListener("keydown", (event) => {
  if (event.repeat) return;
  const key = event.key.toLowerCase();
  if (event.target instanceof HTMLButtonElement && (key === " " || key === "enter")) return;

  if (/^[1-6]$/.test(key)) {
    selectBed(Number(key) - 1);
    return;
  }
  if (key === "q") toggleControl("irrigation");
  if (key === "w") toggleControl("heating");
  if (key === "e") toggleControl("ventilation");
  if (key === "r") toggleControl("shade");
  if (key === "p" || key === "escape") {
    event.preventDefault();
    togglePause();
  }
  if (key === "m") {
    ui.soundButton.click();
  }
  if (key === " ") {
    event.preventDefault();
    harvestSelected();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && phase === "running") setPaused(true);
});

game = new GreenhouseGame();
updateUI(true);
requestAnimationFrame(frame);

window.__greenhouse = {
  get game() {
    return game;
  },
  get phase() {
    return phase;
  },
  get selectedIndex() {
    return selectedIndex;
  },
  selectBed,
  toggleControl,
  harvestSelected,
  startShift,
  setPaused,
  resetGame,
  updateUI,
  step(seconds) {
    if (phase !== "running") return;
    game.tick(seconds);
    processEvents();
    syncAudio();
    updateUI(true);
  },
  snapshot() {
    return JSON.parse(JSON.stringify(game.getSummary()));
  },
};
