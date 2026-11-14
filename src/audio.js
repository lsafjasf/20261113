(function () {
  "use strict";

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  class SaltAudio {
    constructor() {
      this.context = null;
      this.master = null;
      this.waterGain = null;
      this.rainGain = null;
      this.pumpGain = null;
      this.pumpOsc = null;
      this.pumpHarmonic = null;
      this.muted = false;
      this.paused = false;
      this.lastWarning = 0;
      this.ready = false;
    }

    createNoiseBuffer(seconds) {
      const length = Math.floor(this.context.sampleRate * seconds);
      const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < length; i += 1) {
        const white = Math.random() * 2 - 1;
        last = last * 0.72 + white * 0.28;
        data[i] = last;
      }
      return buffer;
    }

    unlock() {
      if (this.ready) {
        if (this.context.state === "suspended") this.context.resume();
        return;
      }
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.78;
      this.master.connect(this.context.destination);

      const waterSource = this.context.createBufferSource();
      waterSource.buffer = this.createNoiseBuffer(2.5);
      waterSource.loop = true;
      const waterFilter = this.context.createBiquadFilter();
      waterFilter.type = "lowpass";
      waterFilter.frequency.value = 1050;
      waterFilter.Q.value = 0.55;
      this.waterGain = this.context.createGain();
      this.waterGain.gain.value = 0;
      waterSource.connect(waterFilter).connect(this.waterGain).connect(this.master);
      waterSource.start();

      const rainSource = this.context.createBufferSource();
      rainSource.buffer = this.createNoiseBuffer(2.2);
      rainSource.loop = true;
      const rainHigh = this.context.createBiquadFilter();
      rainHigh.type = "highpass";
      rainHigh.frequency.value = 1200;
      const rainLow = this.context.createBiquadFilter();
      rainLow.type = "lowpass";
      rainLow.frequency.value = 7600;
      this.rainGain = this.context.createGain();
      this.rainGain.gain.value = 0;
      rainSource.connect(rainHigh).connect(rainLow).connect(this.rainGain).connect(this.master);
      rainSource.start();

      this.pumpOsc = this.context.createOscillator();
      this.pumpOsc.type = "sawtooth";
      this.pumpOsc.frequency.value = 67;
      const pumpFilter = this.context.createBiquadFilter();
      pumpFilter.type = "lowpass";
      pumpFilter.frequency.value = 230;
      pumpFilter.Q.value = 4.5;
      this.pumpGain = this.context.createGain();
      this.pumpGain.gain.value = 0;
      this.pumpOsc.connect(pumpFilter).connect(this.pumpGain).connect(this.master);
      this.pumpOsc.start();

      this.pumpHarmonic = this.context.createOscillator();
      this.pumpHarmonic.type = "triangle";
      this.pumpHarmonic.frequency.value = 134;
      const harmonicGain = this.context.createGain();
      harmonicGain.gain.value = 0.22;
      this.pumpHarmonic.connect(harmonicGain).connect(this.pumpGain);
      this.pumpHarmonic.start();

      this.ready = true;
      if (this.context.state === "suspended") this.context.resume();
    }

    setMuted(muted) {
      this.muted = Boolean(muted);
      if (!this.ready) return this.muted;
      const now = this.context.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.78, now, 0.035);
      return this.muted;
    }

    setPaused(paused) {
      this.paused = Boolean(paused);
    }

    setTarget(param, target, speed) {
      if (!param) return;
      const now = this.context.currentTime;
      param.setTargetAtTime(target, now, speed || 0.12);
    }

    update(sim, dt) {
      if (!this.ready) return;
      const silent = sim.paused || sim.status !== "running" || sim.ended;
      const flow = sim.flows.total;
      const waterTarget = silent ? 0 : clamp(flow * 0.017 + sim.rainIntensity * 0.025, 0, 0.15);
      const rainTarget = silent ? 0 : clamp(sim.rainIntensity * 0.12, 0, 0.14);
      const pumpTarget = silent || !sim.pump.on ? 0 : 0.038 + sim.pump.power * 0.055;
      this.setTarget(this.waterGain.gain, waterTarget, 0.12);
      this.setTarget(this.rainGain.gain, rainTarget, 0.15);
      this.setTarget(this.pumpGain.gain, pumpTarget, 0.08);
      if (!silent) {
        const pumpSpeed = 61 + sim.pump.power * 18 + Math.sin(this.context.currentTime * 2.3) * 1.4;
        this.setTarget(this.pumpOsc.frequency, pumpSpeed, 0.08);
        this.setTarget(this.pumpHarmonic.frequency, pumpSpeed * 2.02, 0.08);
      }

      if (!silent && (sim.hazard.high || sim.hazard.low) && this.context.currentTime - this.lastWarning > 3.2) {
        this.warning();
      }
    }

    tone(frequency, startOffset, duration, type, gain, destination) {
      if (!this.ready) return;
      const start = this.context.currentTime + startOffset;
      const oscillator = this.context.createOscillator();
      const envelope = this.context.createGain();
      oscillator.type = type || "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.linearRampToValueAtTime(gain || 0.08, start + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(envelope).connect(destination || this.master);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.04);
    }

    warning() {
      if (!this.ready) return;
      this.lastWarning = this.context.currentTime + 0.01;
      this.tone(330, 0, 0.12, "square", 0.032);
      this.tone(262, 0.16, 0.16, "square", 0.027);
    }

    danger() {
      if (!this.ready) return;
      this.lastWarning = this.context.currentTime + 1.5;
      for (let i = 0; i < 5; i += 1) {
        this.tone(i % 2 === 0 ? 392 : 294, i * 0.13, 0.13, "square", 0.045);
      }
    }

    harvest() {
      if (!this.ready) return;
      [523, 659, 784].forEach((frequency, index) => {
        this.tone(frequency, index * 0.08, 0.34, "sine", 0.075);
      });
    }

    success() {
      if (!this.ready) return;
      [392, 523, 659, 784].forEach((frequency, index) => {
        this.tone(frequency, index * 0.14, 0.8, "triangle", 0.07);
      });
    }

    failure() {
      if (!this.ready) return;
      this.tone(196, 0, 0.7, "sawtooth", 0.045);
      this.tone(147, 0.17, 0.9, "sawtooth", 0.04);
      this.tone(98, 0.36, 1.2, "triangle", 0.055);
    }

    phaseChange(kind) {
      if (!this.ready) return;
      if (kind === "shower") {
        this.tone(440, 0, 0.2, "sine", 0.035);
        this.tone(554, 0.12, 0.28, "sine", 0.032);
      } else if (kind === "sun") {
        this.tone(659, 0, 0.28, "triangle", 0.04);
        this.tone(784, 0.12, 0.38, "triangle", 0.035);
      } else {
        this.tone(392, 0, 0.22, "sine", 0.035);
      }
    }

    gateMove(name) {
      if (!this.ready) return;
      this.tone(name === "a" ? 138 : 118, 0, 0.15, "triangle", 0.03);
    }
  }

  window.SaltAudio = SaltAudio;
})();
