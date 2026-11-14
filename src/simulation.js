(function () {
  "use strict";

  const C = window.SALT_CONFIG;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const smoothstep = (value) => {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  };

  class SaltSimulation {
    constructor(config) {
      this.config = config || C;
      this.listeners = new Map();
      this.reset();
    }

    reset() {
      this.status = "idle";
      this.elapsed = 0;
      this.timeScale = 1;
      this.paused = false;
      this.ended = false;
      this.failure = null;
      this.batches = 0;
      this.totalHarvestValue = 0;
      this.alerts = [];
      this.eventCount = 0;
      this.activeAlert = null;
      this.minLevel = 100;
      this.maxLevel = 0;
      this.tide = 64;
      this.channelSalinity = 32;
      this.rainIntensity = 0;
      this.sunIntensity = 0;
      this.evaporationPulse = 0;
      this.gates = { a: 0, b: 0 };
      this.pump = { on: false, power: 0.65 };
      this.flows = {
        intake: 0,
        drain: 0,
        pump: 0,
        weir12: 0,
        weir23: 0,
        rain: 0,
        total: 0,
      };
      this.lastAction = null;
      this.hazard = { low: false, high: false, dry: false };
      this.phase = this.config.phases[0];
      this.ponds = this.config.ponds.map((source) => ({
        id: source.id,
        name: source.name,
        level: source.level,
        salinity: source.salinity,
        evaporation: source.evaporation,
        harvested: false,
        drySeconds: 0,
        dryWarned: false,
        overflowWarned: false,
        lastHarvest: null,
      }));
      this.emit("reset", this);
    }

    on(event, callback) {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set());
      this.listeners.get(event).add(callback);
      return () => this.listeners.get(event).delete(callback);
    }

    emit(event, detail) {
      const callbacks = this.listeners.get(event);
      if (!callbacks) return;
      callbacks.forEach((callback) => callback(detail));
    }

    start() {
      if (this.status === "idle" || this.ended) this.reset();
      this.status = "running";
      this.paused = false;
      this.emit("start", this);
    }

    setPaused(paused) {
      if (this.ended || this.status === "idle") return this.paused;
      this.paused = Boolean(paused);
      this.status = this.paused ? "paused" : "running";
      this.emit(this.paused ? "pause" : "resume", this);
      return this.paused;
    }

    togglePause() {
      if (this.status === "idle" || this.ended) return false;
      return this.setPaused(!this.paused);
    }

    setGate(name, value) {
      if (name !== "a" && name !== "b") return;
      const next = clamp(Number(value) || 0, 0, 100) / 100;
      const changed = Math.abs(next - this.gates[name]) > 0.004;
      this.gates[name] = next;
      if (changed && this.status !== "idle" && !this.ended) {
        this.lastAction = { type: "gate", name, value: next, at: this.elapsed };
        this.emit("gate", this.lastAction);
      }
    }

    setPump(on) {
      const next = Boolean(on);
      if (next === this.pump.on) return;
      this.pump.on = next;
      if (this.status !== "idle" && !this.ended) {
        this.lastAction = { type: "pump", value: next, at: this.elapsed };
        this.emit("pump", this.lastAction);
      }
    }

    setPumpPower(value) {
      this.pump.power = clamp(Number(value) || 0, 0.3, 1);
    }

    get phaseIndex() {
      const index = this.config.phases.findIndex(
        (phase) => this.elapsed >= phase.start && this.elapsed < phase.end
      );
      return index < 0 ? this.config.phases.length - 1 : index;
    }

    get phaseProgress() {
      const phase = this.phase;
      return clamp((this.elapsed - phase.start) / (phase.end - phase.start), 0, 1);
    }

    get remaining() {
      return Math.max(0, this.config.duration - this.elapsed);
    }

    normalizePond(pond) {
      const oldLevel = Math.max(pond.level, 0.001);
      pond.level = clamp(pond.level, 0, 100);
      if (pond.level <= 0.01) {
        pond.salinity = 0;
      } else if (oldLevel !== pond.level && pond.level > 0) {
        pond.salinity = clamp((oldLevel * pond.salinity) / pond.level, 0, this.config.maxSalinity);
      }
      pond.salinity = clamp(pond.salinity, 0, this.config.maxSalinity);
    }

    addWater(pond, amount, sourceSalinity) {
      if (amount <= 0) return;
      const oldWater = Math.max(pond.level, 0.001);
      const oldSalt = oldWater * pond.salinity;
      const nextLevel = clamp(pond.level + amount, 0, 100);
      const addedWater = Math.max(0, nextLevel - pond.level);
      const addedSalt = addedWater * sourceSalinity;
      pond.level = nextLevel;
      pond.salinity = clamp((oldSalt + addedSalt) / Math.max(nextLevel, 0.001), 0, this.config.maxSalinity);
    }

    removeFlow(pond, amount) {
      if (amount <= 0) return;
      pond.level = clamp(pond.level - amount, 0, 100);
      if (pond.level <= 0.01) pond.salinity = 0;
    }

    evaporate(pond, amount) {
      if (amount <= 0 || pond.level <= 0.01) return;
      const nextLevel = Math.max(0.001, pond.level - amount);
      pond.salinity = clamp(pond.salinity * (pond.level / nextLevel), 0, this.config.maxSalinity);
      pond.level = nextLevel;
    }

    update(deltaSeconds) {
      if (this.status !== "running" || this.paused || this.ended) return;
      const delta = clamp(Number(deltaSeconds) || 0, 0, 0.2);
      const steps = Math.max(1, Math.ceil(delta / 0.04));
      const step = delta / steps;
      for (let i = 0; i < steps && !this.ended; i += 1) {
        this.step(step);
      }
    }

    step(dt) {
      this.elapsed = Math.min(this.config.duration, this.elapsed + dt * this.timeScale);
      const previousPhase = this.phase;
      this.phase = this.config.phases[this.phaseIndex];
      if (this.phase !== previousPhase) {
        this.onPhaseChange(this.phase);
      }
      this.updateEnvironment(dt);
      this.updateHydraulics(dt);
      this.updateWeatherWater(dt);
      this.updatePondStatus(dt);
      if (this.elapsed >= this.config.duration && !this.ended) {
        this.finish(this.batches >= this.config.targetBatches ? "success" : "timeout");
      }
    }

    onPhaseChange(phase) {
      const message = phase.id === "tide"
        ? "外渠开始涨潮，引水蓄池"
        : phase.id === "shower"
          ? "阵雨抵达，开排水闸护池"
          : "云散日出，盐度将快速上升";
      this.pushAlert(message, phase.id === "sun" ? "warning" : "info", 4.5);
      this.emit("phase", phase);
    }

    pushAlert(message, tone, duration) {
      const alert = {
        id: this.eventCount += 1,
        message,
        tone: tone || "info",
        ttl: duration || 3.8,
      };
      this.activeAlert = alert;
      this.emit("alert", alert);
    }

    updateEnvironment(dt) {
      const progress = this.phaseProgress;
      const t = this.elapsed;
      if (this.phase.id === "tide") {
        this.tide = 61 + 31 * smoothstep(progress) + Math.sin(t * 0.72) * 1.4;
        this.channelSalinity = 38 - progress * 1.2;
        this.rainIntensity = 0;
        this.sunIntensity = 0;
      } else if (this.phase.id === "shower") {
        this.tide = 91 - 13 * smoothstep(progress) + Math.sin(t * 0.82) * 1.1;
        this.channelSalinity = 34.5;
        this.rainIntensity = 0.58 + 0.42 * (0.5 + 0.5 * Math.sin(t * 0.63));
        this.sunIntensity = 0;
      } else {
        this.tide = 78 - 23 * smoothstep(progress) + Math.sin(t * 0.65) * 0.8;
        this.channelSalinity = 41;
        this.rainIntensity = 0;
        this.sunIntensity = clamp(0.66 + 0.34 * smoothstep(progress / 0.18), 0, 1);
      }
      this.evaporationPulse += dt;
    }

    updateHydraulics(dt) {
      const p1 = this.ponds[0];
      const p2 = this.ponds[1];
      const p3 = this.ponds[2];

      const intakeHead = Math.max(0, this.tide - p1.level);
      const intake = intakeHead > 0.1 ? this.gates.a * (0.18 + intakeHead * 0.057) : 0;
      if (intake > 0.001 && intakeHead > 0.1) {
        this.addWater(p1, intake * dt, this.channelSalinity);
      }

      const weir12 = clamp(
        Math.max(0, p1.level - 57) * 0.26 + Math.max(0, p1.level - p2.level) * 0.16,
        0,
        2.7
      );
      if (weir12 > 0.001) {
        const sourceSalinity = p1.salinity;
        this.removeFlow(p1, weir12 * dt);
        this.addWater(p2, weir12 * dt, sourceSalinity);
      }

      const weir23 = clamp(
        Math.max(0, p2.level - 55) * 0.25 + Math.max(0, p2.level - p3.level) * 0.15,
        0,
        2.45
      );
      if (weir23 > 0.001) {
        const sourceSalinity = p2.salinity;
        this.removeFlow(p2, weir23 * dt);
        this.addWater(p3, weir23 * dt, sourceSalinity);
      }

      let pumped = 0;
      if (this.pump.on && p3.level > 18) {
        pumped = (0.72 + this.pump.power * 2.05) * Math.min(1, (p3.level - 14) / 10);
        if (pumped > 0.001) {
          const sourceSalinity = p3.salinity;
          this.removeFlow(p3, pumped * dt);
          this.addWater(p1, pumped * dt, sourceSalinity);
        }
      } else {
        pumped = 0;
      }

      const drain = this.gates.b * clamp(p3.level - 7, 0, 100) * 0.052;
      if (drain > 0.001) this.removeFlow(p3, drain * dt);

      this.flows.intake = intake;
      this.flows.weir12 = weir12;
      this.flows.weir23 = weir23;
      this.flows.pump = pumped;
      this.flows.drain = drain;
      this.flows.total = intake + weir12 + weir23 + pumped + drain;
    }

    updateWeatherWater(dt) {
      const rain = this.rainIntensity * 0.23;
      const sunEvaporation = this.sunIntensity * 0.64;
      const baseEvaporation = this.phase.id === "shower" ? 0.025 : 0.048;
      this.flows.rain = rain;

      this.ponds.forEach((pond) => {
        if (rain > 0.0001) this.addWater(pond, rain * dt, 0);
        const evaporation = (baseEvaporation + sunEvaporation) * pond.evaporation;
        this.evaporate(pond, evaporation * dt);
        this.normalizePond(pond);
      });
    }

    pondState(pond) {
      if (pond.harvested) return { key: "harvested", text: "已收盐" };
      if (pond.level < 8) return { key: "danger", text: "濒临干涸" };
      if (pond.level >= 96) return { key: "danger", text: "即将满溢" };
      if (pond.level < this.config.warningLevel.low) return { key: "danger", text: "水位过低" };
      if (pond.level > this.config.warningLevel.high) return { key: "danger", text: "水位过高" };
      if (this.canHarvest(pond)) return { key: "ready", text: "可以收盐" };
      if (pond.salinity >= this.config.targetSalinity - 8) return { key: "good", text: "接近达标" };
      return { key: "normal", text: "晒制中" };
    }

    canHarvest(pond) {
      return Boolean(
        pond &&
        !pond.harvested &&
        this.status === "running" &&
        !this.paused &&
        !this.ended &&
        pond.salinity >= this.config.targetSalinity &&
        pond.salinity <= this.config.maxSalinity &&
        pond.level >= this.config.harvestLevel.min &&
        pond.level <= this.config.harvestLevel.max
      );
    }

    updatePondStatus(dt) {
      let hasDanger = false;
      this.ponds.forEach((pond, index) => {
        this.minLevel = Math.min(this.minLevel, pond.level);
        this.maxLevel = Math.max(this.maxLevel, pond.level);

        if (pond.level >= 96) {
          hasDanger = true;
          if (!pond.overflowWarned) {
            pond.overflowWarned = true;
            this.pushAlert(`${pond.name}水位越过池埂，立即排水！`, "danger", 5);
            this.emit("danger", { type: "overflow", pond: index });
          }
          this.finish("overflow", pond, index);
          return;
        }
        if (pond.level < 96) pond.overflowWarned = false;

        if (pond.level < 8) {
          pond.drySeconds += dt;
          hasDanger = true;
          if (!pond.dryWarned) {
            pond.dryWarned = true;
            this.pushAlert(`${pond.name}正在干涸，须在 10 秒内补水`, "danger", 5);
            this.emit("danger", { type: "dry", pond: index });
          }
          if (pond.drySeconds >= this.config.dryLimit) {
            this.finish("dry", pond, index);
          }
        } else {
          pond.drySeconds = Math.max(0, pond.drySeconds - dt * 1.8);
          if (pond.level >= 12) pond.dryWarned = false;
        }
        if (pond.level < this.config.warningLevel.low || pond.level > this.config.warningLevel.high) {
          hasDanger = true;
        }
      });
      this.hazard.high = this.ponds.some((pond) => pond.level >= 90);
      this.hazard.low = this.ponds.some((pond) => pond.level < 18);
      this.hazard.dry = this.ponds.some((pond) => pond.drySeconds > 0);
      if (hasDanger && !this.hazard.alertActive) {
        this.hazard.alertActive = true;
        this.emit("warning", this.hazard);
      } else if (!hasDanger) {
        this.hazard.alertActive = false;
      }
    }

    harvest(index) {
      const pond = this.ponds[index];
      if (!this.canHarvest(pond)) return false;
      pond.harvested = true;
      pond.lastHarvest = { at: this.elapsed, salinity: pond.salinity, level: pond.level };
      this.batches += 1;
      this.totalHarvestValue += Math.round((pond.salinity - 60) * pond.level);
      const recoveredLevel = Math.min(pond.level, 8);
      pond.level = Math.max(24, pond.level - recoveredLevel);
      pond.salinity = 41;
      this.lastAction = { type: "harvest", index, at: this.elapsed, batches: this.batches };
      this.pushAlert(`${pond.name}收盐成功 · 第 ${this.batches} 批`, "success", 4.2);
      this.emit("harvest", { index, pond, batches: this.batches });
      if (this.batches >= this.config.targetBatches) {
        this.finish("success", pond, index);
      }
      return true;
    }

    finish(reason, pond, index) {
      if (this.ended) return;
      this.ended = true;
      this.status = "ended";
      this.paused = false;
      const success = reason === "success";
      this.failure = success ? null : { reason, pond: pond ? pond.name : null, index };
      this.emit("end", {
        success,
        reason,
        pond,
        index,
        batches: this.batches,
        elapsed: this.elapsed,
        minLevel: this.minLevel,
      });
    }

    actionSnapshot() {
      return {
        gates: { ...this.gates },
        pump: { ...this.pump },
        batches: this.batches,
        phase: this.phase.id,
        elapsed: this.elapsed,
        ended: this.ended,
        failure: this.failure,
        ponds: this.ponds.map((pond) => ({
          level: pond.level,
          salinity: pond.salinity,
          harvested: pond.harvested,
          drySeconds: pond.drySeconds,
        })),
      };
    }
  }

  window.SaltSimulation = SaltSimulation;
})();
