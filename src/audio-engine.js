import { PROJECT_DURATION, clamp, wrapTime } from "./project-model.js";

const mulberry32 = (seed) => {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const setParam = (param, value, contextTime, timeConstant = 0.045) => {
  param.setTargetAtTime(value, contextTime, timeConstant);
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.waterGain = null;
    this.waterFilter = null;
    this.subGain = null;
    this.fogGain = null;
    this.fogFilter = null;
    this.delay = null;
    this.playing = false;
    this.loop = true;
    this.anchorTimeline = 0;
    this.anchorAudioTime = 0;
    this.pulseEvents = [];
    this.scheduledPulses = new Map();
    this.pulseNodes = new Set();
    this.pulseLog = [];
    this._schedulerId = null;
    this._masterLevel = 0.68;
    this._lastParamUpdate = 0;
    this._scrubMode = false;
    this._scrubPulseTimes = new Map();
  }

  async ensureContext() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") {
        await this.ctx.resume();
      }
      return this.ctx;
    }

    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("当前浏览器不支持 Web Audio");
    }

    const context = new AudioContextClass({ latencyHint: "interactive" });
    this.ctx = context;

    this.master = context.createGain();
    this.master.gain.value = 0.0001;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 18;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.012;
    compressor.release.value = 0.28;
    this.master.connect(compressor);
    compressor.connect(context.destination);

    this.delay = context.createDelay(1.2);
    this.delay.delayTime.value = 0.33;
    const feedback = context.createGain();
    feedback.gain.value = 0.24;
    const delayWet = context.createGain();
    delayWet.gain.value = 0.18;
    this.delay.connect(feedback);
    feedback.connect(this.delay);
    this.delay.connect(delayWet);
    delayWet.connect(this.master);

    const noiseBuffer = this.createNoiseBuffer(context, 8);
    this.createWaterLayer(context, noiseBuffer);
    this.createFogLayer(context, noiseBuffer);

    if (context.state === "suspended") {
      await context.resume();
    }
    return context;
  }

  createNoiseBuffer(context, seconds) {
    const length = Math.round(context.sampleRate * seconds);
    const buffer = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      const random = mulberry32(0x2f6d93e1 + channel * 0x1021);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let b3 = 0;
      let b4 = 0;
      let b5 = 0;
      let b6 = 0;

      for (let index = 0; index < length; index += 1) {
        const white = random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        b6 = white * 0.115926;
        data[index] =
          (b0 + b1 + b2 + b3 + b4 + b5 + b6) * 0.22 + white * 0.035;
      }
    }
    return buffer;
  }

  createWaterLayer(context, noiseBuffer) {
    const waterSource = context.createBufferSource();
    waterSource.buffer = noiseBuffer;
    waterSource.loop = true;
    this.waterFilter = context.createBiquadFilter();
    this.waterFilter.type = "lowpass";
    this.waterFilter.frequency.value = 520;
    this.waterFilter.Q.value = 0.62;
    const waterShelf = context.createBiquadFilter();
    waterShelf.type = "lowpass";
    waterShelf.frequency.value = 290;
    waterShelf.Q.value = 0.4;
    this.waterGain = context.createGain();
    this.waterGain.gain.value = 0.14;
    waterSource.connect(this.waterFilter);
    this.waterFilter.connect(waterShelf);
    waterShelf.connect(this.waterGain);
    this.waterGain.connect(this.master);
    waterSource.start(context.currentTime, 0.63);

    this.subGain = context.createGain();
    this.subGain.gain.value = 0.022;
    this.subGain.connect(this.master);
    for (const [frequency, gainValue, detune] of [
      [43.65, 0.7, -4],
      [54.32, 0.38, 3],
      [69.1, 0.22, -7],
    ]) {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      oscillator.detune.value = detune;
      const oscillatorGain = context.createGain();
      oscillatorGain.gain.value = gainValue;
      oscillator.connect(oscillatorGain);
      oscillatorGain.connect(this.subGain);
      oscillator.start();
    }
  }

  createFogLayer(context, noiseBuffer) {
    const fogSource = context.createBufferSource();
    fogSource.buffer = noiseBuffer;
    fogSource.loop = true;
    this.fogFilter = context.createBiquadFilter();
    this.fogFilter.type = "bandpass";
    this.fogFilter.frequency.value = 1800;
    this.fogFilter.Q.value = 0.23;
    this.fogGain = context.createGain();
    this.fogGain.gain.value = 0.014;
    fogSource.connect(this.fogFilter);
    this.fogFilter.connect(this.fogGain);
    this.fogGain.connect(this.master);
    fogSource.start(context.currentTime, 1.87);
  }

  setPulseEvents(keyframes) {
    this.pulseEvents = keyframes
      .filter((keyframe) => Number.isFinite(keyframe.time))
      .map((keyframe) => ({
        id: keyframe.id,
        time: wrapTime(keyframe.time),
        value: clamp(keyframe.value, 0, 1),
      }))
      .sort((a, b) => a.time - b.time);
  }

  async play(timeline, loop = true) {
    await this.ensureContext();
    if (this.ctx.state !== "running") {
      await this.ctx.resume();
    }

    this.stopPulseSources();
    this.scheduledPulses.clear();
    this._scrubMode = false;
    this.playing = true;
    this.loop = Boolean(loop);
    this.anchorTimeline =
      timeline >= PROJECT_DURATION ? 0 : clamp(Number(timeline) || 0, 0, PROJECT_DURATION);
    this.anchorAudioTime = this.ctx.currentTime;
    this.lastParamUpdate = 0;

    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(
      Math.max(0.0001, this.master.gain.value),
      now,
    );
    this.master.gain.exponentialRampToValueAtTime(
      this._masterLevel,
      now + 0.16,
    );

    this.schedulePulses();
    window.clearInterval(this._schedulerId);
    this._schedulerId = window.setInterval(() => this.schedulePulses(), 80);
    return this.getTimelineTime(now);
  }

  pause() {
    if (!this.ctx) {
      this.playing = false;
      return;
    }
    this.playing = false;
    this._scrubMode = false;
    window.clearInterval(this._schedulerId);
    this._schedulerId = null;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(
      Math.max(0.0001, this.master.gain.value),
      now,
    );
    this.master.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
    this.stopPulseSources();
    this.scheduledPulses.clear();
  }

  beginScrubPreview(timeline) {
    if (!this.ctx) {
      return false;
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    this.stopPulseSources();
    this.scheduledPulses.clear();
    this._scrubPulseTimes.clear();
    this._scrubMode = true;
    this.playing = true;
    this.loop = false;
    this.anchorTimeline = clamp(Number(timeline) || 0, 0, PROJECT_DURATION);
    this.anchorAudioTime = this.ctx.currentTime;
    this.lastParamUpdate = 0;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(
      Math.max(0.0001, this.master.gain.value),
      now,
    );
    this.master.gain.exponentialRampToValueAtTime(
      this._masterLevel * 0.74,
      now + 0.09,
    );
    return true;
  }

  scrubTo(timeline, values) {
    if (!this.ctx || !this._scrubMode) {
      return;
    }
    const previous = this.anchorTimeline;
    const current = clamp(Number(timeline) || 0, 0, PROJECT_DURATION);
    this.anchorTimeline = current;
    this.anchorAudioTime = this.ctx.currentTime;
    this.updateParams(values, this.ctx.currentTime, true);

    const low = Math.min(previous, current);
    const high = Math.max(previous, current);
    for (const event of this.pulseEvents) {
      const crossed =
        current >= previous
          ? event.time > previous && event.time <= current
          : event.time >= current && event.time < previous;
      if (!crossed) {
        continue;
      }
      const lastPulse = this._scrubPulseTimes.get(event.id) || -Infinity;
      if (this.ctx.currentTime - lastPulse < 0.65) {
        continue;
      }
      this._scrubPulseTimes.set(event.id, this.ctx.currentTime);
      if (event.value >= 0.08) {
        this.triggerPulse(this.ctx.currentTime + 0.015, event.value, event.id);
      }
    }
  }

  endScrubPreview() {
    if (!this.ctx || !this._scrubMode) {
      return;
    }
    this._scrubMode = false;
    this.playing = false;
    this.stopPulseSources();
    this.scheduledPulses.clear();
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(
      Math.max(0.0001, this.master.gain.value),
      now,
    );
    this.master.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);
  }

  setLoop(loop) {
    this.loop = Boolean(loop);
    if (this.playing && this.ctx) {
      const current = this.getTimelineTime();
      this.anchorTimeline = current;
      this.anchorAudioTime = this.ctx.currentTime;
      this.scheduledPulses.clear();
    }
  }

  getTimelineTime(audioTime = this.ctx?.currentTime) {
    if (!this.ctx || !this.playing) {
      return this.anchorTimeline;
    }
    const elapsed = Math.max(0, audioTime - this.anchorAudioTime);
    const absolute = this.anchorTimeline + elapsed;
    if (this.loop) {
      return absolute % PROJECT_DURATION;
    }
    return Math.min(PROJECT_DURATION, absolute);
  }

  schedulePulses() {
    if (!this.playing || !this.ctx || this.ctx.state !== "running") {
      return;
    }
    const now = this.ctx.currentTime;
    const timeline = this.getTimelineTime(now);
    const horizon = 0.8;

    for (const event of this.pulseEvents) {
      let delta = event.time - timeline;
      if (this.loop) {
        delta = ((delta % PROJECT_DURATION) + PROJECT_DURATION) % PROJECT_DURATION;
      } else if (delta < -0.002) {
        continue;
      }

      if (delta < -0.002 || delta > horizon) {
        continue;
      }

      const targetTime = now + Math.max(0, delta);
      const key = `${event.id}@${Math.round(targetTime * 50)}`;
      if (this.scheduledPulses.has(key)) {
        continue;
      }

      this.scheduledPulses.set(key, targetTime);
      if (event.value >= 0.05) {
        this.triggerPulse(targetTime, event.value, event.id);
      }
    }

    for (const [key, targetTime] of this.scheduledPulses) {
      if (targetTime < now - 0.6) {
        this.scheduledPulses.delete(key);
      }
    }
  }

  triggerPulse(when, intensity, eventId) {
    const context = this.ctx;
    const strength = 0.18 + intensity * 0.82;
    const panner = context.createStereoPanner();
    panner.pan.value = -0.12 + intensity * 0.06;
    const toneBus = context.createGain();
    toneBus.gain.setValueAtTime(0.0001, when);
    toneBus.gain.exponentialRampToValueAtTime(
      0.115 * strength,
      when + 0.018,
    );
    toneBus.gain.exponentialRampToValueAtTime(
      0.048 * strength,
      when + 0.38,
    );
    toneBus.gain.exponentialRampToValueAtTime(0.0001, when + 2.6);

    const oscillators = [];
    for (const [frequency, detune, mixValue] of [
      [392, -3, 1],
      [587.33, 2, 0.48],
      [783.99, -6, 0.26],
    ]) {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, when);
      oscillator.detune.setValueAtTime(detune, when);
      const gain = context.createGain();
      gain.gain.value = mixValue;
      oscillator.connect(gain);
      gain.connect(toneBus);
      oscillator.start(when);
      oscillator.stop(when + 2.8);
      oscillators.push(oscillator);
    }

    const body = context.createOscillator();
    body.type = "sine";
    body.frequency.setValueAtTime(98, when);
    body.frequency.exponentialRampToValueAtTime(67, when + 0.7);
    const bodyGain = context.createGain();
    bodyGain.gain.setValueAtTime(0.0001, when);
    bodyGain.gain.exponentialRampToValueAtTime(
      0.035 * strength,
      when + 0.025,
    );
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.72);
    body.connect(bodyGain);
    bodyGain.connect(toneBus);
    body.start(when);
    body.stop(when + 0.8);
    oscillators.push(body);

    toneBus.connect(panner);
    panner.connect(this.master);
    panner.connect(this.delay);

    const group = { oscillators, panner, toneBus };
    this.pulseNodes.add(group);
    this.pulseLog.push({ eventId, when, intensity });
    if (this.pulseLog.length > 80) {
      this.pulseLog.shift();
    }
    window.setTimeout(() => {
      this.pulseNodes.delete(group);
    }, Math.max(0, (when - context.currentTime + 3) * 1000));
  }

  stopPulseSources() {
    const now = this.ctx?.currentTime;
    for (const group of this.pulseNodes) {
      for (const oscillator of group.oscillators) {
        try {
          oscillator.stop(now + 0.06);
        } catch {
          // A source can already have ended; nothing to stop.
        }
      }
      try {
        group.toneBus.disconnect();
        group.panner.disconnect();
      } catch {
        // Already disconnected.
      }
    }
    this.pulseNodes.clear();
  }

  updateParams(values, audioTime = this.ctx?.currentTime, force = false) {
    if (!this.ctx || !this.playing || !values || !audioTime) {
      return;
    }
    if (!force && audioTime - this._lastParamUpdate < 0.012) {
      return;
    }
    this._lastParamUpdate = audioTime;
    const tide = clamp(values.tide ?? 0.4, 0, 1);
    const fog = clamp(values.fog ?? 0.5, 0, 1);
    setParam(this.waterGain.gain, 0.045 + tide * 0.175, audioTime, 0.055);
    setParam(
      this.waterFilter.frequency,
      260 + tide * 860,
      audioTime,
      0.075,
    );
    setParam(this.subGain.gain, 0.009 + tide * 0.057, audioTime, 0.065);
    setParam(this.fogGain.gain, 0.004 + fog * 0.033, audioTime, 0.08);
    setParam(
      this.fogFilter.frequency,
      950 + fog * 2600,
      audioTime,
      0.09,
    );
  }

  getStatus() {
    return {
      initialized: Boolean(this.ctx),
      state: this.ctx?.state || "uninitialized",
      sampleRate: this.ctx?.sampleRate || null,
      playing: this.playing,
      loop: this.loop,
      mode: this._scrubMode ? "scrub-preview" : this.playing ? "playing" : "stopped",
      pulsesScheduled: this.pulseLog.length,
      lastPulse: this.pulseLog.at(-1) || null,
      timeline: this.ctx ? this.getTimelineTime() : 0,
    };
  }
}
