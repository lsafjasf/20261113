export class GreenhouseAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.pumpGain = null;
    this.fanGain = null;
    this.fanToneGain = null;
    this.alarmNodes = null;
    this.muted = false;
    this.ready = false;
  }

  async init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return;
    }

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.72;
    this.master.connect(this.ctx.destination);

    const noiseBuffer = this.createNoiseBuffer(2.5);
    this.pumpGain = this.createLoop(noiseBuffer, "lowpass", 340, 0.7);
    this.fanGain = this.createLoop(noiseBuffer, "bandpass", 980, 0.55);
    this.fanGain.gain.value = 0;

    this.fanToneGain = this.ctx.createGain();
    this.fanToneGain.gain.value = 0;
    this.fanToneGain.connect(this.master);
    const fanOscillator = this.ctx.createOscillator();
    fanOscillator.type = "sine";
    fanOscillator.frequency.value = 91;
    fanOscillator.connect(this.fanToneGain);
    fanOscillator.start();

    this.ready = true;
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  createNoiseBuffer(seconds) {
    const frameCount = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, frameCount, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < frameCount; index += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.72 + white * 0.28;
      data[index] = last;
    }
    return buffer;
  }

  createLoop(buffer, filterType, frequency, q) {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
    return gain;
  }

  setPump(active) {
    if (!this.ready) return;
    this.ramp(this.pumpGain.gain, active ? 0.085 : 0, active ? 0.12 : 0.24);
  }

  setFan(active) {
    if (!this.ready) return;
    this.ramp(this.fanGain.gain, active ? 0.055 : 0, active ? 0.18 : 0.3);
    this.ramp(this.fanToneGain.gain, active ? 0.022 : 0, active ? 0.2 : 0.3);
  }

  setAlarm(active) {
    if (!this.ready) return;
    if (active && !this.alarmNodes) this.startAlarm();
    if (!active && this.alarmNodes) this.stopAlarm();
  }

  startAlarm() {
    const oscillator = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();

    oscillator.type = "triangle";
    oscillator.frequency.value = 148;
    gain.gain.value = 0;
    lfo.type = "square";
    lfo.frequency.value = 5.4;
    lfoGain.gain.value = 0.055;
    lfo.connect(lfoGain).connect(gain.gain);
    oscillator.connect(gain).connect(this.master);

    oscillator.start();
    lfo.start();
    this.ramp(gain.gain, 0.052, 0.1);
    this.alarmNodes = { oscillator, gain, lfo };
  }

  stopAlarm() {
    if (!this.alarmNodes) return;
    const { oscillator, gain, lfo } = this.alarmNodes;
    this.ramp(gain.gain, 0, 0.12);
    window.setTimeout(() => {
      try {
        oscillator.stop();
        lfo.stop();
      } catch {
        // The nodes may already have been stopped by a fast restart.
      }
    }, 160);
    this.alarmNodes = null;
  }

  mature() {
    if (!this.ready) return;
    this.tone(660, 0.12, 0.075, "sine", 0);
    this.tone(880, 0.19, 0.06, "sine", 0.11);
    this.tone(1174, 0.25, 0.045, "sine", 0.23);
  }

  harvest() {
    if (!this.ready) return;
    this.tone(520, 0.08, 0.045, "triangle", 0);
    this.tone(390, 0.13, 0.04, "triangle", 0.07);
  }

  win() {
    if (!this.ready) return;
    [523, 659, 784, 1047].forEach((frequency, index) => {
      this.tone(frequency, 0.38, 0.05, "sine", index * 0.1);
    });
  }

  failure(code) {
    if (!this.ready) return;
    this.stopAlarm();
    const start = code === "water" ? 310 : 240;
    this.tone(start, 0.34, 0.08, "sawtooth", 0, start * 0.65);
    this.tone(start * 0.8, 0.46, 0.06, "square", 0.18, start * 0.45);
  }

  warning() {
    if (!this.ready) return;
    this.tone(740, 0.09, 0.04, "sine", 0);
    this.tone(740, 0.09, 0.035, "sine", 0.14);
  }

  tone(frequency, duration, volume, type = "sine", delay = 0, endFrequency = null) {
    if (!this.ready) return;
    const now = this.ctx.currentTime + delay;
    const oscillator = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), now + duration);
    }
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.03);
  }

  ramp(parameter, target, duration) {
    const now = this.ctx.currentTime;
    parameter.cancelScheduledValues(now);
    parameter.setValueAtTime(parameter.value, now);
    parameter.linearRampToValueAtTime(target, now + Math.max(0.02, duration));
  }

  setMuted(muted) {
    this.muted = muted;
    if (!this.ready) return;
    this.ramp(this.master.gain, muted ? 0 : 0.72, 0.08);
  }

  stopLoops() {
    if (!this.ready) return;
    this.setPump(false);
    this.setFan(false);
    this.setAlarm(false);
  }
}
