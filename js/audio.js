(function (global) {
  "use strict";

  var FP = global.FP || (global.FP = {});

  function AudioManager() {
    this.ctx = null;
    this.master = null;
    this.windGain = null;
    this.windFilter = null;
    this.noiseBuffer = null;
    this.muted = false;
    this.started = false;
  }

  AudioManager.prototype.ensure = function () {
    if (this.ctx) {
      if (this.ctx.state === "suspended") {
        this.ctx.resume();
      }
      return;
    }
    var Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) {
      return;
    }
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.85;
    this.master.connect(this.ctx.destination);

    var length = this.ctx.sampleRate * 2;
    var buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    var data = buffer.getChannelData(0);
    var last = 0;
    for (var i = 0; i < length; i++) {
      var white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    this.noiseBuffer = buffer;

    var source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = "lowpass";
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.7;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.0001;
    source.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    source.start();
    this.started = true;
  };

  AudioManager.prototype.updateWind = function (altitude, windSpeed, tensionRatio, fog) {
    if (!this.ctx || !this.windGain) {
      return;
    }
    var t = this.ctx.currentTime;
    var norm = Math.min(1, altitude / 470);
    var freq = 280 + norm * 1150 + Math.min(420, windSpeed * 2.2);
    var gain = 0.05 + norm * 0.13 + Math.min(0.12, windSpeed / 2400) + fog * 0.04;
    this.windFilter.frequency.setTargetAtTime(freq, t, 0.12);
    this.windGain.gain.setTargetAtTime(gain, t, 0.15);
  };

  AudioManager.prototype.duckWind = function (amount, seconds) {
    if (!this.ctx || !this.windGain) {
      return;
    }
    var t = this.ctx.currentTime;
    var base = this.windGain.gain.value;
    this.windGain.gain.cancelScheduledValues(t);
    this.windGain.gain.setValueAtTime(base, t);
    this.windGain.gain.linearRampToValueAtTime(Math.max(0.01, base * (1 - amount)), t + 0.02);
    this.windGain.gain.linearRampToValueAtTime(base, t + seconds);
  };

  FP.AudioManager = AudioManager;

  AudioManager.prototype.tone = function (freq, duration, type, when, volume, glideTo) {
    if (!this.ctx) {
      return;
    }
    var t0 = this.ctx.currentTime + (when || 0);
    var osc = this.ctx.createOscillator();
    var gain = this.ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) {
      osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + duration);
    }
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume || 0.2, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  };

  AudioManager.prototype.noiseBurst = function (duration, filterFreq, type, volume) {
    if (!this.ctx) {
      return;
    }
    var t0 = this.ctx.currentTime;
    var source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    var filter = this.ctx.createBiquadFilter();
    filter.type = type || "bandpass";
    filter.frequency.value = filterFreq;
    filter.Q.value = 1.1;
    var gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume || 0.25, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(t0);
    source.stop(t0 + duration + 0.05);
  };

  AudioManager.prototype.shutter = function () {
    this.noiseBurst(0.05, 2600, "highpass", 0.32);
    this.tone(180, 0.06, "square", 0.05, 0.12);
    this.duckWind(0.45, 0.25);
  };

  AudioManager.prototype.snap = function () {
    this.noiseBurst(0.4, 480, "lowpass", 0.5);
    this.tone(220, 0.55, "sawtooth", 0, 0.22, 46);
  };

  AudioManager.prototype.success = function () {
    this.tone(523.25, 0.18, "triangle", 0, 0.22);
    this.tone(659.25, 0.18, "triangle", 0.16, 0.22);
    this.tone(783.99, 0.34, "triangle", 0.32, 0.24);
  };

  AudioManager.prototype.fail = function () {
    this.tone(330, 0.3, "sawtooth", 0, 0.18, 160);
    this.tone(196, 0.5, "sawtooth", 0.24, 0.18, 90);
  };

  AudioManager.prototype.click = function () {
    this.tone(660, 0.07, "square", 0, 0.1);
  };

  AudioManager.prototype.lockBlip = function () {
    this.tone(880, 0.08, "sine", 0, 0.08);
  };

  AudioManager.prototype.toggleMute = function () {
    this.muted = !this.muted;
    if (this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.85, this.ctx.currentTime, 0.05);
    }
    return this.muted;
  };
})(typeof window !== "undefined" ? window : globalThis);
