(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const TAU = Math.PI * 2;
  const LOW_HZ = 80;
  const HIGH_HZ = 440;
  const THRESHOLD = 30;
  const STABLE_TARGET = 5;
  const TRIP_LIMIT = 24;

  const ui = {
    seedInput: $("#seedInput"),
    restartSeed: $("#restartSeed"),
    armedLabel: $("#armedLabel"),
    armedText: $("#armedText"),
    signature: $("#signatureText"),
    elapsed: $("#elapsedTime"),
    listenButton: $("#listenButton"),
    listenLabel: $("#listenLabel"),
    pumpList: $("#pumpList"),
    rpmStat: $("#rpmStat"),
    overlapValue: $("#overlapValue"),
    thermalGauge: $("#thermalGauge"),
    thermalValue: $("#thermalValue"),
    stableValue: $("#stableValue"),
    stableBar: $("#stableBar"),
    protectionTag: $("#protectionTag"),
    peakLeak: $("#peakLeak"),
    compositePeak: $("#compositePeak"),
    scopePeakLabel: $("#scopePeakLabel"),
    filterStack: $("#filterStack"),
    phaseKnobs: $("#phaseKnobs"),
    lockCount: $("#lockCount"),
    footerSeed: $("#footerSeed"),
    scopeCanvas: $("#scopeCanvas"),
    spectrumCanvas: $("#spectrumCanvas"),
    historyCanvas: $("#historyCanvas"),
    modalLayer: $("#modalLayer"),
    resultModal: $("#resultModal"),
    resultHatch: $("#resultHatch"),
    modalKicker: $("#modalKicker"),
    modalTitle: $("#modalTitle"),
    modalCopy: $("#modalCopy"),
    resultLeak: $("#resultLeak"),
    resultThermal: $("#resultThermal"),
    resultElapsed: $("#resultElapsed"),
    modalRestart: $("#modalRestart"),
    modalClose: $("#modalClose"),
  };

  const state = {
    seed: 2419,
    started: false,
    ended: false,
    outcome: null,
    elapsed: 0,
    overload: 0,
    stable: 0,
    peakLeak: 100,
    hiddenFaultPump: 0,
    pumpRpm: [5100, 5107, 5114],
    bands: [],
    history: [],
    historyLastAt: 0,
    lastFrameAt: performance.now(),
    lastAudioStressAt: 0,
    audioMuted: false,
  };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function random() {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function angularDistance(a, b) {
    const raw = Math.abs(a - b) % 360;
    return Math.min(raw, 360 - raw);
  }

  function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds - minutes * 60;
    return `${String(minutes).padStart(2, "0")}:${rest.toFixed(1).padStart(3, "0")}`;
  }

  function signedSeed(seed) {
    return (seed * 2654435761 + 0x9e3779b9) >>> 0;
  }

  function makeSeedModel(seed) {
    const rng = mulberry32(signedSeed(seed));
    const hiddenFaultPump = Math.floor(rng() * 3);
    const baseRpm = 5088 + Math.floor(rng() * 20);
    const rpmJitter = [-2, Math.floor(rng() * 9) - 4, Math.floor(rng() * 10) + 4];
    const pumpRpm = rpmJitter.map((jitter, index) => baseRpm + jitter + index * 3);
    const fundamental = (pumpRpm[hiddenFaultPump] / 60) * 0.94;
    const harmonics = [1.48, 2.35, 3.44];
    const centers = harmonics.map((ratio, index) => {
      const jitter = (rng() - 0.5) * (index === 0 ? 5 : 9);
      return Math.round(clamp(fundamental * ratio + jitter, 104 + index * 70, 335));
    });
    const targetQs = [
      10.8 + rng() * 1.7,
      3.6 + rng() * 0.9,
      8.2 + rng() * 1.9,
    ];
    const targetPhases = [
      Math.round(25 + rng() * 42),
      Math.round(302 + rng() * 44),
      Math.round(38 + rng() * 70),
    ];
    const detune = [-104, 84, -69];
    const initialCenters = centers.map((center, index) =>
      Math.round(clamp(center + detune[index] + (rng() - 0.5) * 18, 82, 436)),
    );
    const initialQs = targetQs.map((q, index) =>
      Number(clamp(q + [-0.6, 1.2, -0.8][index] + (rng() - 0.5) * 0.8, 1, 16).toFixed(1)),
    );
    const initialPhases = targetPhases.map((phase, index) =>
      Math.round((phase + [54, -68, 73][index] + rng() * 22) % 360),
    );
    const signature = `SG-${(
      (rng() * 0xffffff) |
      0
    )
      .toString(16)
      .toUpperCase()
      .padStart(6, "0")
      .slice(0, 6)}`;

    return {
      centers,
      targetQs,
      targetPhases,
      initialCenters,
      initialQs,
      initialPhases,
      pumpRpm,
      hiddenFaultPump,
      signature,
    };
  }

  function computeBandLeak(band) {
    const centerGap = Math.abs(band.center - band.targetCenter) / Math.max(38, band.targetCenter * 0.16);
    const qGap = Math.abs(band.q - band.targetQ) / Math.max(3.4, band.targetQ * 0.34);
    const phaseGap = angularDistance(band.phase, band.targetPhase) / 92;
    return Math.round(clamp(centerGap * 0.62 + qGap * 0.24 + phaseGap * 0.14, 0, 1) * 100);
  }

  function deriveState() {
    const leaks = state.bands.map(computeBandLeak);
    state.peakLeak = Math.max(...leaks);
    return leaks;
  }

  function loadSeed(seed) {
    state.seed = clamp(Math.round(seed) || 2419, 1, 999999);
    const model = makeSeedModel(state.seed);
    state.hiddenFaultPump = model.hiddenFaultPump;
    state.pumpRpm = model.pumpRpm;
    state.bands = model.centers.map((center, index) => ({
      id: index,
      label: ["LOW BAND", "MID BAND", "HIGH BAND"][index],
      center: model.initialCenters[index],
      q: model.initialQs[index],
      phase: model.initialPhases[index],
      targetCenter: center,
      targetQ: Number(model.targetQs[index].toFixed(1)),
      targetPhase: model.targetPhases[index],
      leak: 100,
      locked: false,
    }));
    state.history = primeHistory(model.centers);
    ui.seedInput.value = String(state.seed);
    ui.footerSeed.textContent = `SEED ${state.seed}`;
    ui.signature.textContent = `SIGNATURE ${model.signature}`;
    ui.rpmStat.textContent = `${(state.pumpRpm.reduce((a, b) => a + b, 0) / state.pumpRpm.length / 1000).toFixed(1)}k`;
    updatePumpMetadata();
    buildFilterControls();
    resetRunState();
    syncControlUI();
    applyAudioSettings();
    drawAll(performance.now() / 1000);
  }

  function resetRunState() {
    state.started = false;
    state.ended = false;
    state.outcome = null;
    state.elapsed = 0;
    state.overload = 0;
    state.stable = 0;
    state.lastFrameAt = performance.now();
    state.lastAudioStressAt = 0;
    state.audioMuted = false;
    ui.armedLabel.textContent = "ARMED";
    ui.armedText.textContent = "待机";
    ui.listenLabel.textContent = "启用监听";
    ui.listenButton.setAttribute("aria-pressed", "false");
    ui.listenButton.disabled = false;
    ui.protectionTag.textContent = "NOMINAL";
    ui.modalLayer.classList.remove("is-open");
    ui.modalLayer.setAttribute("aria-hidden", "true");
    updateRunUI();
  }

  function updatePumpMetadata() {
    const rows = ui.pumpList.querySelectorAll(".pump-row");
    rows.forEach((row, index) => {
      const rpm = state.pumpRpm[index];
      const temp = 64.1 + index * 0.42 + ((state.seed + index * 7) % 9) / 10;
      const pressure = 3 + ((state.seed + index * 3) % 12) / 100;
      $(".pump-rpm", row).textContent = `${rpm} RPM`;
      $(".pump-meta small", row).textContent = `${temp.toFixed(1)}°C · ${pressure.toFixed(2)} bar`;
    });
  }

  function primeHistory(centers) {
    const rng = mulberry32(signedSeed(state.seed) ^ 0xa51ce);
    const frames = [];
    for (let frame = 0; frame < 170; frame += 1) {
      const bins = new Float32Array(240);
      centers.forEach((center, index) => {
        const centerBin = ((center - LOW_HZ) / (HIGH_HZ - LOW_HZ)) * bins.length;
        const width = 1.9 + index * 0.35 + rng() * 0.5;
        for (let bin = 0; bin < bins.length; bin += 1) {
          const distance = Math.abs(bin - centerBin);
          bins[bin] = Math.max(
            bins[bin],
            Math.exp(-(distance * distance) / (2 * width * width)) * (0.84 + rng() * 0.15),
          );
        }
      });
      for (let bin = 0; bin < bins.length; bin += 1) {
        bins[bin] += rng() * 0.08;
      }
      frames.push(bins);
    }
    return frames;
  }

  function knobMetrics(value, min, max) {
    const pct = clamp((value - min) / (max - min), 0, 1);
    return {
      pct,
      angle: -130 + pct * 260,
      fill: pct * 100,
    };
  }

  function knobMarkup({ id, kind, band, label, unit, value, min, max, step, accent = "" }) {
    const metrics = knobMetrics(value, min, max);
    const decimals = step < 1 ? 1 : 0;
    return `
      <div class="knob-control">
        <div class="knob-shell" style="--angle:${metrics.angle}deg;--fill:${metrics.fill}">
          <div class="knob-dial"></div>
          <i class="knob-needle"></i>
          <i class="knob-hub"></i>
          <input
            class="knob-input"
            id="${id}"
            type="range"
            min="${min}"
            max="${max}"
            step="${step}"
            value="${value}"
            data-kind="${kind}"
            data-band="${band}"
            aria-label="${label} · BPF-0${band + 1}"
            aria-valuetext="${Number(value).toFixed(decimals)} ${unit}"
          />
        </div>
        <span class="knob-label">
          ${label}
          <b><span data-knob-value="${kind}-${band}">${Number(value).toFixed(decimals)}</span><span class="knob-unit">${unit}</span></b>
        </span>
      </div>`;
  }

  function buildFilterControls() {
    ui.filterStack.innerHTML = state.bands
      .map(
        (band, index) => `
          <article class="filter-card" data-band="${index}">
            <div class="filter-head">
              <span class="filter-name"><b>BPF-0${index + 1}</b> · ${band.label}</span>
              <span class="filter-state">DETUNED</span>
            </div>
            <div class="filter-controls">
              ${knobMarkup({
                id: `center-${index}`,
                kind: "center",
                band: index,
                label: "中心频率",
                unit: "Hz",
                value: band.center,
                min: 80,
                max: 440,
                step: 1,
              })}
              ${knobMarkup({
                id: `q-${index}`,
                kind: "q",
                band: index,
                label: "宽度 Q",
                unit: "Q",
                value: band.q,
                min: 1,
                max: 16,
                step: 0.1,
              })}
              <div class="leak-control">
                <div class="leak-head"><span>RESIDUAL / 残余</span><b data-leak-value="${index}">100%</b></div>
                <div class="leak-meter" data-leak-meter="${index}" style="--leak:100%"></div>
                <div class="meter-scale"><span>0</span><span>LIMIT 30</span><span>100</span></div>
              </div>
            </div>
          </article>`,
      )
      .join("");

    ui.phaseKnobs.innerHTML = state.bands
      .map(
        (band, index) => `
          <div data-phase-band="${index}">
            ${knobMarkup({
              id: `phase-${index}`,
              kind: "phase",
              band: index,
              label: `PHASE P-0${index + 1}`,
              unit: "°",
              value: band.phase,
              min: 0,
              max: 359,
              step: 1,
            })}
          </div>`,
      )
      .join("");
  }

  function setKnobVisual(shell, value, min, max) {
    if (!shell) return;
    const metrics = knobMetrics(value, min, max);
    shell.style.setProperty("--angle", `${metrics.angle}deg`);
    shell.style.setProperty("--fill", metrics.fill);
  }

  function syncControlUI() {
    const leaks = deriveState();
    state.bands.forEach((band, index) => {
      const card = $(`.filter-card[data-band="${index}"]`, ui.filterStack);
      if (!card) return;
      const locked = leaks[index] < THRESHOLD;
      band.locked = locked;
      const centerInput = $(`#center-${index}`, card);
      const qInput = $(`#q-${index}`, card);
      const phaseInput = $(`#phase-${index}`, ui.phaseKnobs);
      centerInput.value = String(band.center);
      qInput.value = String(band.q);
      phaseInput.value = String(band.phase);
      centerInput.setAttribute("aria-valuetext", `${band.center} Hz`);
      qInput.setAttribute("aria-valuetext", `${band.q.toFixed(1)} Q`);
      phaseInput.setAttribute("aria-valuetext", `${band.phase} 度`);
      setKnobVisual(centerInput.parentElement, band.center, 80, 440);
      setKnobVisual(qInput.parentElement, band.q, 1, 16);
      setKnobVisual(phaseInput.parentElement, band.phase, 0, 359);
      $(`[data-knob-value="center-${index}"]`, card).textContent = String(band.center);
      $(`[data-knob-value="q-${index}"]`, card).textContent = band.q.toFixed(1);
      $(`[data-knob-value="phase-${index}"]`, ui.phaseKnobs).textContent = String(band.phase);
      $(`[data-leak-value="${index}"]`, card).textContent = `${leaks[index]}%`;
      $(`[data-leak-meter="${index}"]`, card).style.setProperty("--leak", `${leaks[index]}%`);
      $(".filter-state", card).textContent = locked ? "LOCKED" : "DETUNED";
      $(".filter-state", card).classList.toggle("locked", locked);
      $(".leak-control", card).classList.toggle("locked", locked);
    });

    const lockedCount = state.bands.filter((band) => band.locked).length;
    ui.lockCount.textContent = `${lockedCount}/3 锁频`;
    ui.lockCount.style.color = lockedCount === 3 ? "var(--mint)" : "";
    ui.overlapValue.textContent = (0.18 + (state.peakLeak / 100) * 0.662).toFixed(3);
    ui.peakLeak.textContent = `${state.peakLeak}% LEAK`;
    updateRunUI();
    applyAudioSettings();
  }

  function readKnobInput(event) {
    const input = event.target.closest(".knob-input");
    if (!input) return;
    const bandIndex = Number(input.dataset.band);
    const band = state.bands[bandIndex];
    const kind = input.dataset.kind;
    if (!band || !["center", "q", "phase"].includes(kind)) return;
    const next = Number(input.value);
    band[kind] = kind === "q" ? Number(next.toFixed(1)) : Math.round(next);
    syncControlUI();
  }

  function updateRunUI() {
    ui.elapsed.textContent = formatTime(state.elapsed);
    const thermal = clamp(state.overload, 0, TRIP_LIMIT);
    ui.thermalValue.textContent = thermal.toFixed(1);
    ui.thermalGauge.style.setProperty("--thermal", ((thermal / TRIP_LIMIT) * 72).toFixed(2));
    const stableRatio = clamp(state.stable / STABLE_TARGET, 0, 1);
    ui.stableValue.textContent = (STABLE_TARGET - state.stable).toFixed(1);
    ui.stableBar.style.width = `${stableRatio * 100}%`;
    ui.peakLeak.textContent = `${state.peakLeak}% LEAK`;

    let tag = "NOMINAL";
    if (state.ended) {
      tag = state.outcome === "success" ? "LOOP STABLE" : "TRIPPED";
    } else if (state.started && state.peakLeak >= THRESHOLD) {
      tag = "OVERLOAD";
    } else if (state.started && state.peakLeak < THRESHOLD) {
      tag = "TUNING";
    }
    ui.protectionTag.textContent = tag;
    ui.protectionTag.style.color =
      tag === "TRIPPED" || tag === "OVERLOAD" ? "var(--orange)" : tag === "LOOP STABLE" ? "var(--mint)" : "";
    ui.protectionTag.style.borderColor =
      tag === "TRIPPED" || tag === "OVERLOAD" ? "#7a4436" : tag === "LOOP STABLE" ? "#397b63" : "";

    if (state.ended) {
      ui.armedLabel.textContent = state.outcome === "success" ? "STABLE" : "TRIPPED";
      ui.armedText.textContent = state.outcome === "success" ? "回路稳定" : "保护停机";
    } else if (state.started) {
      ui.armedLabel.textContent = "ARMED";
      ui.armedText.textContent = "运行";
    } else {
      ui.armedLabel.textContent = "ARMED";
      ui.armedText.textContent = "待机";
    }
  }

  const canvasMetrics = new WeakMap();
  let historyTexture = null;
  let lastHistoryRender = 0;
  let lastReadoutAt = 0;

  function fitCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let metric = canvasMetrics.get(canvas);
    if (!metric || metric.width !== width || metric.height !== height || metric.dpr !== dpr) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      metric = { width, height, dpr };
      canvasMetrics.set(canvas, metric);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(metric.dpr, 0, 0, metric.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return { ctx, width, height };
  }

  function waveformSample(time, band) {
    const drift = 0.25 + band.id * 0.07;
    return Math.sin(TAU * band.targetCenter * time + drift) * 0.72;
  }

  function getCompositeWave(time, count = 300) {
    const samples = new Float32Array(count);
    const leakGain = 0.28 + (state.peakLeak / 100) * 0.76;
    const bed = 0.2;
    const pumpBase = state.pumpRpm[0] / 60;
    for (let index = 0; index < count; index += 1) {
      const t = time + (index / count) * 0.08;
      let value = 0;
      state.bands.forEach((band, bandIndex) => {
        const harmonic = 1 + 0.015 * Math.sin(TAU * (0.31 + bandIndex * 0.08) * t);
        value += waveformSample(t, band) * harmonic * (0.27 + bandIndex * 0.015);
      });
      value += Math.sin(TAU * pumpBase * t) * bed;
      value += Math.sin(TAU * pumpBase * 1.024 * t + 1.8) * bed * 0.65;
      value *= leakGain;
      value += (Math.random() - 0.5) * (0.018 + state.peakLeak * 0.00012);
      samples[index] = value;
    }
    return samples;
  }

  function drawScope(time) {
    const { ctx, width, height } = fitCanvas(ui.scopeCanvas);
    if (width < 20 || height < 10) return;
    const samples = getCompositeWave(time, Math.max(340, Math.round(width * 1.2)));
    let maxAbs = 0;
    samples.forEach((sample) => {
      maxAbs = Math.max(maxAbs, Math.abs(sample));
    });
    const displayPeak = clamp(maxAbs * 0.72, 0.12, 0.99);
    const amplitude = (height * 0.62) / Math.max(maxAbs, 0.35);
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    samples.forEach((sample, index) => {
      const x = (index / (samples.length - 1)) * width;
      const y = height * 0.49 - sample * amplitude;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "rgba(52, 137, 108, 0.24)";
    ctx.lineWidth = 4.5;
    ctx.stroke();
    ctx.shadowBlur = 13;
    ctx.shadowColor = "rgba(123, 243, 194, 0.72)";
    ctx.strokeStyle = "#86f2c7";
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(205, 255, 232, 0.55)";
    ctx.lineWidth = 0.45;
    ctx.stroke();
    ctx.restore();

    if (time - lastReadoutAt > 0.12) {
      lastReadoutAt = time;
      ui.compositePeak.textContent = `±${displayPeak.toFixed(2)}`;
      ui.scopePeakLabel.textContent = `PEAK ${displayPeak.toFixed(2)}`;
    }
  }

  function gaussian(x, center, width) {
    const normalized = (x - center) / width;
    return Math.exp(-0.5 * normalized * normalized);
  }

  function bandpassResponse(frequency, center, q) {
    const ratio = frequency / center;
    const numerator = ratio / q;
    const denominator = Math.sqrt((1 - ratio * ratio) ** 2 + numerator * numerator);
    return numerator / Math.max(denominator, 1e-6);
  }

  function drawSpectrum(time) {
    const { ctx, width, height } = fitCanvas(ui.spectrumCanvas);
    if (width < 40 || height < 40) return;
    const margin = { left: 21, right: 13, top: 12, bottom: 28 };
    const plotW = Math.max(10, width - margin.left - margin.right);
    const plotH = Math.max(10, height - margin.top - margin.bottom);
    const bottom = margin.top + plotH;
    const toX = (frequency) => margin.left + ((frequency - LOW_HZ) / (HIGH_HZ - LOW_HZ)) * plotW;
    const limitLevel = 0.54;
    const limitY = bottom - limitLevel * plotH * 0.92;

    ctx.fillStyle = "#06100e";
    ctx.fillRect(0, 0, width, height);
    ctx.lineWidth = 1;
    ctx.font = '7px "Ubuntu Sans", sans-serif';
    ctx.textBaseline = "middle";

    for (let index = 0; index <= 4; index += 1) {
      const y = margin.top + (plotH / 4) * index;
      ctx.strokeStyle = "rgba(40, 70, 60, 0.46)";
      ctx.beginPath();
      ctx.moveTo(margin.left, y + 0.5);
      ctx.lineTo(width - margin.right, y + 0.5);
      ctx.stroke();
    }

    const tickFrequencies = [80, 160, 240, 320, 440];
    tickFrequencies.forEach((frequency) => {
      const x = toX(frequency);
      ctx.strokeStyle = "rgba(40, 70, 60, 0.36)";
      ctx.beginPath();
      ctx.moveTo(x + 0.5, margin.top);
      ctx.lineTo(x + 0.5, bottom);
      ctx.stroke();
      ctx.fillStyle = "#566a63";
      ctx.textAlign = frequency === 80 ? "left" : frequency === 440 ? "right" : "center";
      ctx.fillText(
        frequency === 440 ? "440 HZ" : String(frequency).padStart(2, "0"),
        frequency === 80 ? x : frequency === 440 ? x + 5 : x,
        height - 10,
      );
    });

    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(255, 101, 71, 0.62)";
    ctx.beginPath();
    ctx.moveTo(margin.left, limitY);
    ctx.lineTo(width - margin.right, limitY);
    ctx.stroke();
    ctx.setLineDash([]);

    const points = [];
    const filterPoints = state.bands.map(() => []);
    for (let px = 0; px <= plotW; px += 1) {
      const frequency = LOW_HZ + (px / plotW) * (HIGH_HZ - LOW_HZ);
      let signalLevel = 0.035 + 0.012 * Math.sin(frequency * 0.15 + time * 0.7);
      state.bands.forEach((band) => {
        const widthHz = Math.max(3.2, band.targetCenter / (band.targetQ * 2.8));
        const amplitude = 0.19 + (band.leak / 100) * 0.83;
        signalLevel += gaussian(frequency, band.targetCenter, widthHz) * amplitude;
      });
      signalLevel += (Math.random() - 0.5) * 0.006;
      const displayLevel = clamp(signalLevel, 0.02, 1.04);
      points.push({
        x: margin.left + px,
        y: bottom - displayLevel * plotH * 0.92,
      });
      state.bands.forEach((band, index) => {
        const response = bandpassResponse(frequency, band.center, band.q);
        const level = 0.045 + clamp(response, 0, 1) * 0.42;
        filterPoints[index].push({
          x: margin.left + px,
          y: bottom - level * plotH * 0.92,
        });
      });
    }

    const signalGradient = ctx.createLinearGradient(0, margin.top, 0, bottom);
    signalGradient.addColorStop(0, "rgba(242, 237, 117, 0.05)");
    signalGradient.addColorStop(0.35, "rgba(242, 237, 117, 0.26)");
    signalGradient.addColorStop(1, "rgba(98, 106, 47, 0.02)");
    ctx.beginPath();
    ctx.moveTo(margin.left, bottom);
    points.forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.lineTo(width - margin.right, bottom);
    ctx.closePath();
    ctx.fillStyle = signalGradient;
    ctx.fill();
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = "#eee66f";
    ctx.lineWidth = 1.15;
    ctx.shadowBlur = 8;
    ctx.shadowColor = "rgba(242, 237, 117, 0.35)";
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.setLineDash([4, 4]);
    filterPoints.forEach((filterPoint, index) => {
      ctx.beginPath();
      filterPoint.forEach((point, pointIndex) => {
        if (pointIndex === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.strokeStyle =
        state.bands[index].leak < THRESHOLD
          ? "rgba(94, 185, 160, 0.72)"
          : "rgba(69, 127, 115, 0.5)";
      ctx.lineWidth = 0.9;
      ctx.stroke();
    });
    ctx.setLineDash([]);

    state.bands.forEach((band, index) => {
      const x = toX(band.targetCenter);
      const widthHz = Math.max(3.2, band.targetCenter / (band.targetQ * 2.8));
      const amplitude = 0.19 + (band.leak / 100) * 0.83;
      const y = bottom - clamp(amplitude, 0.02, 1.04) * plotH * 0.92;
      ctx.fillStyle = "#bfe9d9";
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#778c84";
      ctx.textAlign = "center";
      ctx.font = '6px "Ubuntu Sans", sans-serif';
      ctx.fillText(`F${index + 1}`, x, Math.max(8, y - 8));
      if (width > 360) {
        ctx.fillStyle = "rgba(118, 137, 129, 0.75)";
        ctx.fillText(`${band.targetCenter}`, x, Math.max(9, y - 17));
      }
      void widthHz;
    });

    const limitLabel = $(".limit-label");
    if (limitLabel) {
      const cardTop = ui.spectrumCanvas.getBoundingClientRect().top;
      const labelY = limitY - (cardTop - ui.spectrumCanvas.getBoundingClientRect().top);
      limitLabel.style.top = `${labelY - 8}px`;
    }
  }

  function addHistoryFrame(time) {
    if (time * 1000 - state.historyLastAt < 80) return;
    state.historyLastAt = time * 1000;
    const bins = new Float32Array(240);
    state.bands.forEach((band, index) => {
      const centerBin = ((band.targetCenter - LOW_HZ) / (HIGH_HZ - LOW_HZ)) * bins.length;
      const width = 1.8 + index * 0.35;
      const gain = 0.34 + (band.leak / 100) * 0.66;
      for (let bin = 0; bin < bins.length; bin += 1) {
        const distance = Math.abs(bin - centerBin);
        bins[bin] = Math.max(
          bins[bin],
          Math.exp(-(distance * distance) / (2 * width * width)) * gain,
        );
      }
    });
    for (let bin = 0; bin < bins.length; bin += 1) {
      bins[bin] += Math.random() * 0.055 + 0.012 * Math.sin(bin * 0.3 + time * 1.8);
    }
    state.history.push(bins);
    if (state.history.length > 250) state.history.shift();
  }

  function colorHistoryPixel(intensity, ageRatio) {
    const boosted = clamp((intensity - 0.07) / 0.82, 0, 1);
    const ageGain = 0.46 + ageRatio * 0.54;
    const hot = clamp((boosted - 0.62) / 0.38, 0, 1);
    return [
      Math.round((5 + boosted * 106 + hot * 126) * ageGain),
      Math.round((19 + boosted * 183 + hot * 52) * ageGain),
      Math.round((16 + boosted * 108 + hot * 25) * ageGain),
      255,
    ];
  }

  function drawHistory(time) {
    addHistoryFrame(time);
    if (time - lastHistoryRender < 0.055) return;
    lastHistoryRender = time;
    const { ctx, width, height } = fitCanvas(ui.historyCanvas);
    if (width < 60 || height < 40) return;
    const margin = { left: 35, right: 12, top: 4, bottom: 24 };
    const plotW = Math.max(20, width - margin.left - margin.right);
    const plotH = Math.max(20, height - margin.top - margin.bottom);
    const textureW = 240;
    const textureH = 176;
    if (!historyTexture) {
      historyTexture = document.createElement("canvas");
      historyTexture.width = textureW;
      historyTexture.height = textureH;
    }
    const textureCtx = historyTexture.getContext("2d");
    const texture = textureCtx.createImageData(textureW, textureH);
    const frames = state.history;
    for (let y = 0; y < textureH; y += 1) {
      const ageRatio = 1 - y / (textureH - 1);
      const frameIndex = Math.min(frames.length - 1, Math.floor((1 - y / textureH) * frames.length));
      const frame = frames[frameIndex];
      for (let x = 0; x < textureW; x += 1) {
        const intensity = frame ? frame[x] : 0.01;
        const rgba = colorHistoryPixel(intensity, ageRatio);
        const offset = (y * textureW + x) * 4;
        texture.data[offset] = rgba[0];
        texture.data[offset + 1] = rgba[1];
        texture.data[offset + 2] = rgba[2];
        texture.data[offset + 3] = rgba[3];
      }
    }
    textureCtx.putImageData(texture, 0, 0);

    ctx.fillStyle = "#06100e";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(historyTexture, margin.left, margin.top, plotW, plotH);
    ctx.strokeStyle = "rgba(35, 62, 53, 0.62)";
    ctx.lineWidth = 1;
    [0, 0.5, 0.75, 1].forEach((ratio) => {
      const y = margin.top + ratio * plotH;
      ctx.beginPath();
      ctx.moveTo(margin.left, y + 0.5);
      ctx.lineTo(width - margin.right, y + 0.5);
      ctx.stroke();
    });
    [80, 160, 240, 320, 440].forEach((frequency, index) => {
      const x = margin.left + ((frequency - LOW_HZ) / (HIGH_HZ - LOW_HZ)) * plotW;
      ctx.strokeStyle = "rgba(35, 62, 53, 0.45)";
      ctx.beginPath();
      ctx.moveTo(x + 0.5, margin.top);
      ctx.lineTo(x + 0.5, margin.top + plotH);
      ctx.stroke();
      if (index !== 1 && index !== 3) {
        ctx.fillStyle = "#566a63";
        ctx.font = '7px "Ubuntu Sans", sans-serif';
        ctx.textAlign = index === 0 ? "left" : "right";
        ctx.fillText(
          index === 4 ? "440 HZ →" : "- 80 HZ",
          index === 0 ? x : x + 3,
          height - 10,
        );
      }
    });

    ctx.fillStyle = "#5f736c";
    ctx.font = '7px "Ubuntu Sans", sans-serif';
    ctx.textAlign = "right";
    [
      { ratio: 0, label: "-20 S" },
      { ratio: 0.5, label: "-10 S" },
      { ratio: 0.75, label: "-5 S" },
      { ratio: 1, label: "NOW" },
    ].forEach((tick) => {
      ctx.fillText(tick.label, margin.left - 7, margin.top + tick.ratio * plotH + 3);
    });
  }

  function drawPumpWaves(time) {
    const canvases = ui.pumpList.querySelectorAll(".pump-wave");
    canvases.forEach((canvas, index) => {
      const { ctx, width, height } = fitCanvas(canvas);
      if (width < 10 || height < 8) return;
      const rpm = state.pumpRpm[index] || 5100;
      const cycles = 2.2 + index * 0.12;
      ctx.beginPath();
      for (let x = 0; x <= width; x += 1) {
        const normalized = x / width;
        const jag = Math.sin(normalized * TAU * 5 + time * 2.1 + index) * 0.9;
        const sample =
          Math.sin(normalized * TAU * cycles + time * (rpm / 900) + index * 0.8) * 0.62 +
          Math.sin(normalized * TAU * (cycles * 2.4) + time * 1.3) * 0.23 +
          jag * 0.08;
        const y = height / 2 - sample * height * 0.34;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "rgba(102, 233, 184, 0.68)";
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }

  function drawAll(time) {
    drawScope(time);
    drawSpectrum(time);
    drawHistory(time);
    drawPumpWaves(time);
  }

  class PumpAudioEngine {
    constructor() {
      this.context = null;
      this.master = null;
      this.compressor = null;
      this.resonanceNodes = [];
      this.bedOscillators = [];
      this.started = false;
      this.muted = false;
      this.ducked = false;
    }

    async start() {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("Web Audio is unavailable");
      this.context = new AudioContextClass();
      await this.context.resume();
      this.master = this.context.createGain();
      this.master.gain.value = 0;
      this.compressor = this.context.createDynamicsCompressor();
      this.compressor.threshold.value = -15;
      this.compressor.knee.value = 10;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.02;
      this.compressor.release.value = 0.25;
      this.master.connect(this.compressor);
      this.compressor.connect(this.context.destination);
      this.buildPumpBed();
      this.buildResonanceBank();
      this.started = true;
      this.master.gain.setTargetAtTime(0.27, this.context.currentTime, 0.18);
      return this;
    }

    buildPumpBed() {
      const bedBus = this.context.createGain();
      bedBus.gain.value = 0.56;
      bedBus.connect(this.master);
      state.pumpRpm.forEach((rpm, index) => {
        const oscillator = this.context.createOscillator();
        oscillator.type = "sawtooth";
        oscillator.frequency.value = rpm / 60;
        oscillator.detune.value = index * 11 - 10;
        const filter = this.context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 260 + index * 18;
        filter.Q.value = 0.42;
        const gain = this.context.createGain();
        gain.gain.value = 0.028 + index * 0.003;
        oscillator.connect(filter);
        filter.connect(gain);
        gain.connect(bedBus);
        oscillator.start();
        this.bedOscillators.push(oscillator);
      });

      const noiseLength = Math.floor(this.context.sampleRate * 2);
      const noiseBuffer = this.context.createBuffer(1, noiseLength, this.context.sampleRate);
      const noiseData = noiseBuffer.getChannelData(0);
      const rng = mulberry32(signedSeed(state.seed) ^ 0xb00b);
      let smoothed = 0;
      for (let index = 0; index < noiseLength; index += 1) {
        const raw = rng() * 2 - 1;
        smoothed = smoothed * 0.72 + raw * 0.28;
        noiseData[index] = smoothed;
      }
      const noise = this.context.createBufferSource();
      noise.buffer = noiseBuffer;
      noise.loop = true;
      const noiseFilter = this.context.createBiquadFilter();
      noiseFilter.type = "bandpass";
      noiseFilter.frequency.value = 185;
      noiseFilter.Q.value = 0.7;
      const noiseGain = this.context.createGain();
      noiseGain.gain.value = 0.031;
      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(bedBus);
      noise.start();
    }

    buildResonanceBank() {
      state.bands.forEach((band, index) => {
        const oscillator = this.context.createOscillator();
        oscillator.type = "sawtooth";
        oscillator.frequency.value = band.targetCenter;
        oscillator.detune.value = index * 3;

        const filter = this.context.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = band.center;
        filter.Q.value = band.q;

        const delay = this.context.createDelay(0.03);
        delay.delayTime.value = (band.phase / 360) * (1 / band.targetCenter) * 0.55;

        const dryGain = this.context.createGain();
        dryGain.gain.value = 0.012 + (band.leak / 100) * 0.045;
        const wetGain = this.context.createGain();
        wetGain.gain.value = 0.01 + (band.leak / 100) * 0.034;

        oscillator.connect(dryGain);
        dryGain.connect(this.master);
        oscillator.connect(filter);
        filter.connect(delay);
        delay.connect(wetGain);
        wetGain.connect(this.master);
        oscillator.start();
        this.resonanceNodes.push({ oscillator, filter, delay, dryGain, wetGain, band });
      });
    }

    update(bands) {
      if (!this.started || !this.context) return;
      const now = this.context.currentTime;
      this.resonanceNodes.forEach((node) => {
        const band = bands[node.band.id];
        if (!band) return;
        node.filter.frequency.setTargetAtTime(band.center, now, 0.045);
        node.filter.Q.setTargetAtTime(Math.max(0.1, band.q), now, 0.045);
        node.dryGain.gain.setTargetAtTime(0.012 + (band.leak / 100) * 0.045, now, 0.08);
        node.wetGain.gain.setTargetAtTime(0.01 + (band.leak / 100) * 0.034, now, 0.08);
        node.delay.delayTime.setTargetAtTime(
          (band.phase / 360) * (1 / band.targetCenter) * 0.55,
          now,
          0.06,
        );
      });
      this.setOutputLevel();
    }

    setOutputLevel() {
      if (!this.context || !this.master) return;
      const stressLift = 1 + clamp(state.overload / TRIP_LIMIT, 0, 1) * 0.35;
      const level = this.muted ? 0.0001 : this.ducked ? 0.11 : 0.27 * stressLift;
      this.master.gain.setTargetAtTime(level, this.context.currentTime, 0.12);
    }

    setStress(stress) {
      if (!this.context) return;
      const now = this.context.currentTime;
      this.bedOscillators.forEach((oscillator, index) => {
        oscillator.detune.setTargetAtTime(index * 11 - 10 + stress * 68, now, 0.18);
      });
      this.setOutputLevel();
    }

    setMuted(muted) {
      this.muted = muted;
      this.setOutputLevel();
    }

    setDucked(ducked) {
      this.ducked = ducked;
      this.setOutputLevel();
    }

    stop() {
      if (!this.context) return;
      const context = this.context;
      if (this.master) {
        this.master.gain.setTargetAtTime(0, context.currentTime, 0.08);
      }
      setTimeout(() => {
        context.close().catch(() => {});
      }, 180);
      this.started = false;
      this.context = null;
      this.master = null;
      this.resonanceNodes = [];
      this.bedOscillators = [];
    }
  }

  let audioEngine = null;

  function applyAudioSettings() {
    if (audioEngine && audioEngine.started) {
      audioEngine.update(state.bands);
    }
  }

  async function toggleMonitor() {
    if (state.ended) return;
    if (!state.started) {
      state.started = true;
      state.lastFrameAt = performance.now();
      ui.armedLabel.textContent = "ARMED";
      ui.armedText.textContent = "运行";
      ui.listenButton.setAttribute("aria-pressed", "true");
      ui.listenLabel.textContent = "监听中";
      state.audioMuted = false;
      try {
        audioEngine = new PumpAudioEngine();
        await audioEngine.start();
        audioEngine.update(state.bands);
      } catch (error) {
        console.warn("[resonance] live audio unavailable:", error);
        ui.listenLabel.textContent = "视觉模式";
        ui.listenButton.setAttribute("aria-pressed", "false");
      }
      updateRunUI();
      return;
    }

    state.audioMuted = !state.audioMuted;
    if (audioEngine) audioEngine.setMuted(state.audioMuted);
    ui.listenButton.setAttribute("aria-pressed", String(!state.audioMuted));
    ui.listenLabel.textContent = state.audioMuted ? "监听暂停" : "监听中";
  }

  function simulateStep(dt) {
    if (!state.started || state.ended) return;
    state.elapsed += dt;
    if (state.peakLeak < THRESHOLD) {
      state.stable = Math.min(STABLE_TARGET, state.stable + dt);
      state.overload = Math.min(TRIP_LIMIT, state.overload);
    } else {
      state.stable = 0;
      state.overload = Math.min(TRIP_LIMIT, state.overload + dt);
    }
    updateRunUI();
    if (audioEngine && state.elapsed - state.lastAudioStressAt >= 0.2) {
      state.lastAudioStressAt = state.elapsed;
      audioEngine.setStress(clamp(state.overload / TRIP_LIMIT, 0, 1));
    }
    if (state.stable >= STABLE_TARGET) {
      finishRun("success");
    } else if (state.overload >= TRIP_LIMIT) {
      finishRun("failure");
    }
  }

  function finishRun(outcome) {
    if (state.ended) return;
    state.ended = true;
    state.outcome = outcome;
    state.stable = outcome === "success" ? STABLE_TARGET : state.stable;
    ui.listenButton.disabled = true;
    updateRunUI();
    if (audioEngine) audioEngine.setDucked(true);
    showResult(outcome);
  }

  function showResult(outcome) {
    const success = outcome === "success";
    ui.resultModal.classList.toggle("failure", !success);
    ui.modalKicker.textContent = success
      ? "LOOP STABILIZED / 调校通过"
      : "PROTECTION TRIP / 保护动作";
    ui.modalTitle.textContent = success ? "回路稳定" : "保护停机";
    ui.modalCopy.textContent = success
      ? "三个共振频段已连续 5.0 秒低于 30% 残余阈值。冷却回路解除临界状态，允许继续运行。"
      : "累计过载时间达到保护上限。冷却回路已被隔离，无法继续调校，请使用相同 SEED 复盘。";
    ui.resultLeak.textContent = `${state.peakLeak}%`;
    ui.resultThermal.textContent = `${state.overload.toFixed(1)} s`;
    ui.resultElapsed.textContent = formatTime(state.elapsed);
    ui.modalRestart.textContent = success ? "相同 SEED 再试一次" : "相同 SEED 复位";
    ui.modalLayer.classList.add("is-open");
    ui.modalLayer.setAttribute("aria-hidden", "false");
    setTimeout(() => ui.modalRestart.focus(), 60);
  }

  function closeResult() {
    ui.modalLayer.classList.remove("is-open");
    ui.modalLayer.setAttribute("aria-hidden", "true");
    ui.restartSeed.focus();
  }

  function restart(seed = state.seed) {
    if (audioEngine) {
      audioEngine.stop();
      audioEngine = null;
    }
    loadSeed(seed);
  }

  function frame(now) {
    const dt = clamp((now - state.lastFrameAt) / 1000, 0, 0.1);
    state.lastFrameAt = now;
    simulateStep(dt);
    drawAll(now / 1000);
    requestAnimationFrame(frame);
  }

  ui.filterStack.addEventListener("input", readKnobInput);
  ui.phaseKnobs.addEventListener("input", readKnobInput);
  ui.listenButton.addEventListener("click", toggleMonitor);
  ui.restartSeed.addEventListener("click", () => restart(Number(ui.seedInput.value)));
  ui.seedInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      restart(Number(ui.seedInput.value));
    }
  });
  ui.seedInput.addEventListener("change", () => {
    restart(Number(ui.seedInput.value));
  });
  ui.modalRestart.addEventListener("click", () => restart(state.seed));
  ui.modalClose.addEventListener("click", closeResult);
  ui.modalLayer.addEventListener("click", (event) => {
    if (event.target === ui.modalLayer) closeResult();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && ui.modalLayer.classList.contains("is-open")) {
      closeResult();
    }
  });

  window.__tuningConsole = Object.freeze({
    snapshot() {
      return {
        seed: state.seed,
        targets: state.bands.map((band) => ({
          center: band.targetCenter,
          q: band.targetQ,
          phase: band.targetPhase,
        })),
        controls: state.bands.map((band) => ({
          center: band.center,
          q: band.q,
          phase: band.phase,
          leak: computeBandLeak(band),
        })),
        started: state.started,
        ended: state.ended,
        outcome: state.outcome,
        elapsed: state.elapsed,
        overload: state.overload,
        stable: state.stable,
        peakLeak: state.peakLeak,
      };
    },
    setToTargets() {
      state.bands.forEach((band) => {
        band.center = band.targetCenter;
        band.q = band.targetQ;
        band.phase = band.targetPhase;
      });
      syncControlUI();
      drawAll(performance.now() / 1000);
    },
    advance(seconds) {
      const stepCount = Math.max(1, Math.ceil(seconds / 0.05));
      const step = seconds / stepCount;
      for (let index = 0; index < stepCount && !state.ended; index += 1) {
        simulateStep(step);
      }
      drawAll(performance.now() / 1000);
      return this.snapshot();
    },
    restart(seed = state.seed) {
      restart(seed);
      return this.snapshot();
    },
  });

  loadSeed(state.seed);
  requestAnimationFrame(frame);
})();
