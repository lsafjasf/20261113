(function () {
  "use strict";

  const config = window.SALT_CONFIG;
  const sim = new window.SaltSimulation(config);
  const canvas = document.getElementById("sceneCanvas");
  const renderer = new window.SaltRenderer(canvas, sim);
  const audio = new window.SaltAudio();

  const byId = (id) => document.getElementById(id);
  const ui = {
    phaseIcon: byId("phaseIcon"),
    phaseKicker: byId("phaseKicker"),
    phaseLabel: byId("phaseLabel"),
    phaseClock: byId("phaseClock"),
    phaseTrack: byId("phaseTrack"),
    timeLeft: byId("timeLeft"),
    batchCount: byId("batchCount"),
    soundBtn: byId("soundBtn"),
    soundIcon: byId("soundIcon"),
    pauseBtn: byId("pauseBtn"),
    pauseIcon: byId("pauseIcon"),
    weatherBadge: byId("weatherBadge"),
    weatherText: byId("weatherText"),
    tideFill: byId("tideFill"),
    tideValue: byId("tideValue"),
    flowSummary: byId("flowSummary"),
    gateA: byId("gateA"),
    gateB: byId("gateB"),
    gateAValue: byId("gateAValue"),
    gateBValue: byId("gateBValue"),
    pumpBtn: byId("pumpBtn"),
    pumpState: byId("pumpState"),
    pumpPower: byId("pumpPower"),
    pumpPowerValue: byId("pumpPowerValue"),
    alertStack: byId("alertStack"),
    startOverlay: byId("startOverlay"),
    startBtn: byId("startBtn"),
    pauseOverlay: byId("pauseOverlay"),
    resumeBtn: byId("resumeBtn"),
    endOverlay: byId("endOverlay"),
    endCard: byId("endOverlay").querySelector(".end-card"),
    endGlyph: byId("endGlyph"),
    endKicker: byId("endKicker"),
    endTitle: byId("endTitle"),
    endCopy: byId("endCopy"),
    endBatch: byId("endBatch"),
    endTime: byId("endTime"),
    endLevel: byId("endLevel"),
    againBtn: byId("againBtn"),
    restartBtn: byId("restartBtn"),
    hintText: byId("hintText"),
    mission: Array.from(document.querySelectorAll(".mission-step")),
    pondCards: Array.from(document.querySelectorAll(".pond-card")),
    harvestButtons: Array.from(document.querySelectorAll("[data-harvest]")),
    pondStates: [byId("pondState0"), byId("pondState1"), byId("pondState2")],
    salts: [byId("salt0"), byId("salt1"), byId("salt2")],
    levels: [byId("level0"), byId("level1"), byId("level2")],
    miniLevels: [byId("miniLevel0"), byId("miniLevel1"), byId("miniLevel2")],
    phaseSegments: Array.from(document.querySelectorAll(".phase-seg")),
  };

  let lastFrame = performance.now();
  let uiClock = 0;
  let alertTimers = new Set();

  function formatTime(seconds) {
    const safe = Math.max(0, Math.ceil(seconds));
    const minutes = Math.floor(safe / 60);
    const remainder = safe % 60;
    return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }

  function setSliderFill(input) {
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 100;
    const amount = ((Number(input.value) - min) / (max - min)) * 100;
    input.style.setProperty("--fill", `${amount}%`);
  }

  function addAlert(alert) {
    const item = document.createElement("div");
    item.className = `alert-item ${alert.tone === "danger" ? "danger" : alert.tone === "success" ? "success" : ""}`;
    const marks = { danger: "!", success: "✓", warning: "△", info: "i" };
    item.innerHTML = `<span class="alert-mark">${marks[alert.tone] || "i"}</span><span>${alert.message}</span>`;
    ui.alertStack.appendChild(item);
    while (ui.alertStack.children.length > 3) ui.alertStack.firstElementChild.remove();
    const timer = window.setTimeout(() => {
      item.remove();
      alertTimers.delete(timer);
    }, (alert.ttl || 3.8) * 1000);
    alertTimers.add(timer);
  }

  function clearAlerts() {
    alertTimers.forEach((timer) => window.clearTimeout(timer));
    alertTimers.clear();
    ui.alertStack.innerHTML = "";
  }

  function startGame() {
    audio.unlock();
    clearAlerts();
    sim.start();
    ui.startOverlay.hidden = true;
    ui.endOverlay.hidden = true;
    ui.pauseOverlay.hidden = true;
    lastFrame = performance.now();
    addAlert({ message: sim.phase.hint, tone: "info", ttl: 4.6 });
    updateUI(true);
  }

  function resetGame(autostart) {
    clearAlerts();
    sim.reset();
    renderer.rain = [];
    renderer.evaporation = [];
    renderer.splashes = [];
    renderer.bubbles = [];
    renderer.lastPondLevels = sim.ponds.map((pond) => pond.level);
    ui.endOverlay.hidden = true;
    ui.pauseOverlay.hidden = true;
    ui.startOverlay.hidden = Boolean(autostart);
    syncInputs();
    updateUI(true);
    if (autostart) startGame();
  }

  function togglePause() {
    if (sim.status === "idle" || sim.ended) return;
    const paused = sim.togglePause();
    audio.setPaused(paused);
    ui.pauseOverlay.hidden = !paused;
    ui.pauseIcon.textContent = paused ? "▶" : "Ⅱ";
    updateUI(true);
  }

  function toggleSound() {
    audio.unlock();
    const muted = audio.setMuted(!audio.muted);
    ui.soundBtn.classList.toggle("muted", muted);
    ui.soundIcon.textContent = muted ? "×" : "♪";
    ui.soundBtn.setAttribute("aria-label", muted ? "开启声音" : "关闭声音");
  }

  function syncInputs() {
    ui.gateA.value = Math.round(sim.gates.a * 100);
    ui.gateB.value = Math.round(sim.gates.b * 100);
    ui.pumpPower.value = Math.round(sim.pump.power * 100);
    setSliderFill(ui.gateA);
    setSliderFill(ui.gateB);
    setSliderFill(ui.pumpPower);
    ui.gateAValue.textContent = `${ui.gateA.value}%`;
    ui.gateBValue.textContent = `${ui.gateB.value}%`;
    ui.pumpPowerValue.textContent = `${ui.pumpPower.value}%`;
    ui.pumpBtn.setAttribute("aria-pressed", String(sim.pump.on));
    ui.pumpState.textContent = sim.pump.on ? "运行中" : "已停机";
  }

  function adjustGate(name, delta) {
    if (sim.status === "idle" || sim.ended) return;
    const current = sim.gates[name];
    const next = Math.max(0, Math.min(1, current + delta));
    sim.setGate(name, next * 100);
    syncInputs();
  }

  function updateUI(force) {
    const index = sim.phaseIndex;
    const progress = sim.phaseProgress;
    const started = sim.status !== "idle";
    const remaining = sim.remaining;

    ui.timeLeft.textContent = formatTime(remaining);
    ui.phaseIcon.textContent = sim.phase.icon;
    ui.phaseKicker.textContent = sim.phase.kicker;
    ui.phaseLabel.textContent = sim.paused ? "已暂停" : sim.phase.name;
    ui.phaseClock.textContent = `${formatTime(sim.elapsed)} / 02:00`;
    ui.weatherText.textContent = sim.paused ? "天气与水动力已冻结" : sim.phase.weather;
    ui.weatherBadge.className = `weather-badge ${sim.paused ? "tide" : sim.phase.id}`;
    ui.batchCount.textContent = sim.batches;
    ui.tideFill.style.width = `${Math.round(sim.tide)}%`;
    ui.tideValue.textContent = Math.round(sim.tide);

    ui.phaseSegments.forEach((segment, segmentIndex) => {
      segment.classList.toggle("active", segmentIndex === index && !sim.ended);
      segment.classList.toggle("complete", segmentIndex < index || sim.ended);
      segment.style.setProperty(
        "--progress",
        segmentIndex === index ? `${Math.round(progress * 100)}%` : "0%"
      );
    });

    const pumpActive = sim.pump.on && sim.ponds[2].level > 18;
    ui.pumpBtn.setAttribute("aria-pressed", String(sim.pump.on));
    ui.pumpState.textContent = sim.paused
      ? "已暂停"
      : sim.pump.on
        ? pumpActive ? "运行中" : "低水位保护"
        : "已停机";
    ui.gateAValue.textContent = `${Math.round(sim.gates.a * 100)}%`;
    ui.gateBValue.textContent = `${Math.round(sim.gates.b * 100)}%`;
    ui.pumpPowerValue.textContent = `${Math.round(sim.pump.power * 100)}%`;
    setSliderFill(ui.gateA);
    setSliderFill(ui.gateB);
    setSliderFill(ui.pumpPower);

    let flowLabel = "静水";
    if (sim.paused) flowLabel = "已暂停";
    else if (sim.status === "idle") flowLabel = "待命";
    else if (sim.rainIntensity > 0.1) flowLabel = "暴雨进水";
    else if (sim.flows.drain > 0.2) flowLabel = "正在排水";
    else if (sim.flows.pump > 0.2) flowLabel = "正在抽水";
    else if (sim.flows.intake > 0.2) flowLabel = "正在进水";
    else if (sim.flows.total > 0.2) flowLabel = "池间溢流";
    ui.flowSummary.textContent = flowLabel;
    ui.flowSummary.parentElement.classList.toggle("active", sim.flows.total > 0.18 && !sim.paused);

    sim.ponds.forEach((pond, pondIndex) => {
      const state = sim.pondState(pond);
      const harvestable = sim.canHarvest(pond);
      const card = ui.pondCards[pondIndex];
      const stateNode = ui.pondStates[pondIndex];
      const harvestButton = ui.harvestButtons[pondIndex];
      const level = Math.max(0, Math.round(pond.level));
      const salinity = Math.max(0, Math.round(pond.salinity));

      ui.salts[pondIndex].textContent = salinity;
      ui.levels[pondIndex].textContent = `${level}%`;
      ui.miniLevels[pondIndex].style.width = `${level}%`;
      ui.miniLevels[pondIndex].className = level < 18 ? "low" : level > 90 ? "high" : "";
      stateNode.textContent = state.text;
      stateNode.className = `pond-state ${state.key}`;
      card.classList.toggle("harvested", pond.harvested);
      card.classList.toggle("ready", harvestable);
      card.classList.toggle("critical", state.key === "danger");
      harvestButton.disabled = !harvestable;

      if (pond.harvested) {
        harvestButton.textContent = "本池已收成";
      } else if (harvestable) {
        harvestButton.textContent = "收盐 · 计 1 批";
      } else if (pond.salinity < config.targetSalinity) {
        harvestButton.textContent = `盐度差 ${Math.ceil(config.targetSalinity - pond.salinity)}‰`;
      } else if (pond.level < config.harvestLevel.min) {
        harvestButton.textContent = "水位过低，暂缓";
      } else if (pond.level > config.harvestLevel.max) {
        harvestButton.textContent = "水位过高，暂缓";
      } else {
        harvestButton.textContent = "盐度不足";
      }
    });

    const activeMission = sim.phase.id === "tide" ? "fill" : sim.phase.id === "shower" ? "protect" : "harvest";
    ui.mission.forEach((step) => {
      step.classList.toggle("active", step.dataset.step === activeMission);
      step.classList.toggle("complete", step.dataset.step === "harvest" && sim.batches >= config.targetBatches);
    });
    if (sim.batches === 1) ui.mission[2].textContent = "03 收盐 ×2 · 1/2";
    else if (sim.batches >= 2) ui.mission[2].textContent = "03 收盐完成";
    else ui.mission[2].textContent = "03 收盐 ×2";

    if (started && !sim.ended) {
      if (sim.ponds.some((pond) => pond.level >= 92)) {
        ui.hintText.textContent = "警告：池水逼近池埂，立即开排水闸";
      } else if (sim.ponds.some((pond) => pond.level < 20)) {
        ui.hintText.textContent = "警告：水位过低，开进水闸或减少抽水";
      } else if (sim.phase.id === "shower") {
        ui.hintText.textContent = "阵雨稀释卤水：保持排水，雨停后再晒盐";
      } else if (sim.phase.id === "sun") {
        ui.hintText.textContent = "日照提盐：盐度达 60‰ 后点击池卡收盐";
      } else {
        ui.hintText.textContent = "涨潮蓄水：三池串联，开 A 闸后再用泵均衡卤水";
      }
    } else if (sim.status === "idle") {
      ui.hintText.innerHTML = "<kbd>Q</kbd><kbd>E</kbd> 进水闸　<kbd>A</kbd><kbd>D</kbd> 排水闸　<kbd>Space</kbd> 暂停";
    }

    if (sim.status === "idle") {
      ui.pauseIcon.textContent = "Ⅱ";
      ui.pauseBtn.disabled = true;
    } else {
      ui.pauseBtn.disabled = false;
      ui.pauseIcon.textContent = sim.paused ? "▶" : "Ⅱ";
    }
    if (force) syncInputs();
  }

  function showEnd(detail) {
    const success = detail.success;
    ui.endCard.classList.toggle("failure", !success);
    ui.endGlyph.textContent = success ? "✓" : "!";
    ui.endKicker.textContent = success ? "SHIFT COMPLETE" : "SHIFT ABORTED";
    ui.endTitle.textContent = success ? "两批盐，收成了。" : detail.reason === "timeout" ? "钟声已响，盐未满仓。" : "这一池，失守了。";
    if (success) {
      ui.endCopy.textContent = "潮水、阵雨与烈日都已纳入你的调度，两批盐顺利入仓。";
    } else if (detail.reason === "overflow") {
      ui.endCopy.textContent = `${detail.pond ? detail.pond.name : "池子"}水位越过池埂，卤水漫出。下一次记得在暴雨前打开排水闸。`;
    } else if (detail.reason === "dry") {
      ui.endCopy.textContent = `${detail.pond ? detail.pond.name : "池子"}连续干涸超过 10 秒，盐晶失去母液。及时引潮补水可以避免。`;
    } else {
      ui.endCopy.textContent = `两分钟结束时只收成了 ${detail.batches} 批盐。留意强日照后期，及时把达标的卤水收上来。`;
    }
    ui.endBatch.textContent = detail.batches;
    ui.endTime.textContent = formatTime(detail.elapsed);
    ui.endLevel.textContent = `${Math.round(detail.minLevel)}%`;
    ui.endOverlay.hidden = false;
    ui.pauseOverlay.hidden = true;
    renderer.triggerShake(success ? 1 : 7);
    renderer.triggerFlash();
    if (success) audio.success();
    else audio.failure();
    updateUI(true);
  }

  function bindEvents() {
    ui.startBtn.addEventListener("click", startGame);
    ui.againBtn.addEventListener("click", () => resetGame(true));
    ui.restartBtn.addEventListener("click", () => resetGame(false));
    ui.resumeBtn.addEventListener("click", togglePause);
    ui.pauseBtn.addEventListener("click", togglePause);
    ui.soundBtn.addEventListener("click", toggleSound);

    ui.gateA.addEventListener("input", () => {
      audio.unlock();
      sim.setGate("a", ui.gateA.value);
      setSliderFill(ui.gateA);
      ui.gateAValue.textContent = `${ui.gateA.value}%`;
    });
    ui.gateB.addEventListener("input", () => {
      audio.unlock();
      sim.setGate("b", ui.gateB.value);
      setSliderFill(ui.gateB);
      ui.gateBValue.textContent = `${ui.gateB.value}%`;
    });
    document.querySelectorAll("[data-gate]").forEach((button) => {
      button.addEventListener("click", () => {
        audio.unlock();
        const name = button.dataset.gate;
        sim.setGate(name, Number(button.dataset.value));
        syncInputs();
      });
    });
    ui.pumpBtn.addEventListener("click", () => {
      audio.unlock();
      sim.setPump(!sim.pump.on);
      syncInputs();
    });
    ui.pumpPower.addEventListener("input", () => {
      sim.setPumpPower(Number(ui.pumpPower.value) / 100);
      setSliderFill(ui.pumpPower);
      ui.pumpPowerValue.textContent = `${ui.pumpPower.value}%`;
    });
    ui.harvestButtons.forEach((button) => {
      button.addEventListener("click", () => {
        audio.unlock();
        const index = Number(button.dataset.harvest);
        if (!sim.harvest(index)) {
          const pond = sim.ponds[index];
          if (pond.harvested) addAlert({ message: `${pond.name}本局已经收过盐`, tone: "info", ttl: 2.4 });
          else if (pond.salinity < config.targetSalinity) addAlert({ message: `${pond.name}盐度还差 ${Math.ceil(config.targetSalinity - pond.salinity)}‰`, tone: "warning", ttl: 2.4 });
          else addAlert({ message: `${pond.name}水位不在安全收盐区间`, tone: "warning", ttl: 2.4 });
        }
      });
    });

    document.addEventListener("pointerdown", () => audio.unlock(), { once: true });

    document.addEventListener("keydown", (event) => {
      const tagName = event.target && event.target.tagName;
      if (tagName === "INPUT" && (event.code === "Space" || event.code === "Enter")) return;
      const overlayVisible = !ui.startOverlay.hidden;
      if (overlayVisible) {
        if (event.code === "Enter" || event.code === "Space") {
          event.preventDefault();
          startGame();
        }
        return;
      }
      if (event.repeat && !["KeyQ", "KeyE", "KeyA", "KeyD"].includes(event.code)) return;
      switch (event.code) {
        case "Space":
        case "KeyP":
          event.preventDefault();
          togglePause();
          break;
        case "KeyQ":
          event.preventDefault();
          adjustGate("a", -0.08);
          break;
        case "KeyE":
          event.preventDefault();
          adjustGate("a", 0.08);
          break;
        case "KeyA":
          event.preventDefault();
          adjustGate("b", -0.08);
          break;
        case "KeyD":
          event.preventDefault();
          adjustGate("b", 0.08);
          break;
        case "Digit1":
          event.preventDefault();
          sim.harvest(0);
          break;
        case "Digit2":
          event.preventDefault();
          sim.harvest(1);
          break;
        case "Digit3":
          event.preventDefault();
          sim.harvest(2);
          break;
        case "KeyM":
          toggleSound();
          break;
        default:
          break;
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && sim.status === "running" && !sim.paused) {
        sim.setPaused(true);
        audio.setPaused(true);
        ui.pauseOverlay.hidden = false;
        updateUI(true);
      }
    });

    sim.on("alert", addAlert);
    sim.on("phase", (phase) => {
      audio.phaseChange(phase.id);
    });
    sim.on("gate", (action) => audio.gateMove(action.name));
    sim.on("warning", () => {
      audio.warning();
      renderer.triggerShake(1.1);
    });
    sim.on("danger", () => {
      audio.danger();
      renderer.triggerShake(6);
    });
    sim.on("harvest", () => audio.harvest());
    sim.on("end", showEnd);
  }

  function frame(now) {
    const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    sim.update(dt);
    renderer.render(dt);
    audio.update(sim, dt);
    uiClock += dt;
    if (uiClock >= 0.08) {
      updateUI(false);
      uiClock = 0;
    }
    window.requestAnimationFrame(frame);
  }

  bindEvents();
  syncInputs();
  updateUI(true);

  window.__saltGame = {
    simulation: sim,
    renderer,
    audio,
    start: startGame,
    restart: () => resetGame(true),
    setGate: (name, value) => {
      sim.setGate(name, value);
      syncInputs();
    },
    setPump: (on) => {
      sim.setPump(on);
      syncInputs();
    },
    harvest: (index) => sim.harvest(index),
    pause: togglePause,
    get state() {
      return sim.actionSnapshot();
    },
  };

  window.requestAnimationFrame(frame);
})();
