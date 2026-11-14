export class AudioEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.windGain = null;
    this.windFilter = null;
    this.motorGain = null;
    this.motorOsc = null;
    this.motorOscB = null;
    this.motorFilter = null;
    this.muted = false;
    this.started = false;
  }

  ensure() {
    if (this.context) {
      if (this.context.state === "suspended") this.context.resume();
      return true;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return false;

    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(this.context.destination);

    const noiseBuffer = this.context.createBuffer(
      1,
      this.context.sampleRate * 3,
      this.context.sampleRate,
    );
    const data = noiseBuffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < data.length; index += 1) {
      last = last * 0.94 + (Math.random() * 2 - 1) * 0.06;
      data[index] = last * 4.6;
    }

    const wind = this.context.createBufferSource();
    wind.buffer = noiseBuffer;
    wind.loop = true;
    this.windFilter = this.context.createBiquadFilter();
    this.windFilter.type = "lowpass";
    this.windFilter.frequency.value = 440;
    this.windFilter.Q.value = 0.3;
    this.windGain = this.context.createGain();
    this.windGain.gain.value = 0.025;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    wind.start();

    this.motorFilter = this.context.createBiquadFilter();
    this.motorFilter.type = "lowpass";
    this.motorFilter.frequency.value = 540;
    this.motorGain = this.context.createGain();
    this.motorGain.gain.value = 0;
    this.motorOsc = this.context.createOscillator();
    this.motorOsc.type = "sawtooth";
    this.motorOsc.frequency.value = 62;
    this.motorOscB = this.context.createOscillator();
    this.motorOscB.type = "triangle";
    this.motorOscB.frequency.value = 93;
    this.motorOsc.connect(this.motorFilter);
    this.motorOscB.connect(this.motorFilter);
    this.motorFilter.connect(this.motorGain).connect(this.master);
    this.motorOsc.start();
    this.motorOscB.start();
    this.started = true;
    return true;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.context.currentTime, 0.08);
    }
  }

  update({ wind = 0, speed = 0, active = false, emergency = false, paused = false }) {
    if (!this.context || !this.started) return;
    const now = this.context.currentTime;
    const windLevel = Math.min(1, Math.max(0, wind / 22));
    const speedLevel = Math.min(1, speed / 12);
    const motion = active && !paused;
    const emergencyPulse = emergency ? Math.sin(now * 18) * 0.008 : 0;

    this.windGain.gain.setTargetAtTime(0.018 + windLevel * 0.06, now, 0.18);
    this.windFilter.frequency.setTargetAtTime(230 + windLevel * 980, now, 0.12);
    this.motorGain.gain.setTargetAtTime(
      motion ? 0.012 + speedLevel * 0.027 + emergencyPulse : 0,
      now,
      0.1,
    );
    const baseFrequency = 48 + speedLevel * 92;
    this.motorOsc.frequency.setTargetAtTime(baseFrequency, now, 0.08);
    this.motorOscB.frequency.setTargetAtTime(baseFrequency * 1.49, now, 0.08);
    this.motorFilter.frequency.setTargetAtTime(360 + speedLevel * 620, now, 0.1);
  }

  tone(frequency, duration, type = "sine", volume = 0.08, delay = 0) {
    if (!this.context || !this.started || this.muted) return;
    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  alarm() {
    this.tone(720, 0.22, "square", 0.055);
    this.tone(540, 0.28, "square", 0.045, 0.26);
  }

  chime() {
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
      this.tone(frequency, 0.62, "sine", 0.065, index * 0.12);
    });
  }

  click() {
    this.tone(880, 0.055, "triangle", 0.025);
  }
}

