export class AudioEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.motorGain = null;
    this.motorFilter = null;
    this.motorA = null;
    this.motorB = null;
    this.windGain = null;
    this.noiseBuffer = null;
    this.enabled = false;
  }

  async start() {
    if (!this.context) this.build();
    if (!this.context) return;
    if (this.context.state === "suspended") await this.context.resume();
    this.enabled = true;
    this.master.gain.setTargetAtTime(0.72, this.context.currentTime, 0.08);
  }

  build() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = 0;
    const compressor = this.context.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 18;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.24;
    this.master.connect(compressor).connect(this.context.destination);
    this.noiseBuffer = this.createNoiseBuffer(2.5);

    this.motorFilter = this.context.createBiquadFilter();
    this.motorFilter.type = "lowpass";
    this.motorFilter.frequency.value = 340;
    this.motorFilter.Q.value = 1.8;
    this.motorGain = this.context.createGain();
    this.motorGain.gain.value = 0;
    this.motorFilter.connect(this.motorGain).connect(this.master);

    this.motorA = this.context.createOscillator();
    this.motorA.type = "sawtooth";
    this.motorA.frequency.value = 46;
    const low = this.context.createGain();
    low.gain.value = 0.18;
    this.motorA.connect(low).connect(this.motorFilter);

    this.motorB = this.context.createOscillator();
    this.motorB.type = "triangle";
    this.motorB.frequency.value = 92;
    const harmonic = this.context.createGain();
    harmonic.gain.value = 0.12;
    this.motorB.connect(harmonic).connect(this.motorFilter);
    this.motorA.start();
    this.motorB.start();

    const wind = this.context.createBufferSource();
    wind.buffer = this.noiseBuffer;
    wind.loop = true;
    const windFilter = this.context.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 420;
    windFilter.Q.value = 0.52;
    this.windGain = this.context.createGain();
    this.windGain.gain.value = 0.018;
    wind.connect(windFilter).connect(this.windGain).connect(this.master);
    wind.start();
  }

  createNoiseBuffer(seconds) {
    const length = Math.floor(this.context.sampleRate * seconds);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.68 + white * 0.32;
      data[i] = previous;
    }
    return buffer;
  }

  setMotor(load, braking, motorRunning, wind) {
    if (!this.context || !this.enabled) return;
    const now = this.context.currentTime;
    const motorLevel = motorRunning ? 0.025 + load * 0.075 : 0.008;
    const frequency = 43 + load * 72 + (braking ? 9 : 0);
    this.motorGain.gain.setTargetAtTime(motorLevel, now, 0.08);
    this.motorFilter.frequency.setTargetAtTime(250 + load * 760, now, 0.12);
    this.motorA.frequency.setTargetAtTime(frequency, now, 0.1);
    this.motorB.frequency.setTargetAtTime(frequency * 2.03, now, 0.1);
    this.windGain.gain.setTargetAtTime(0.012 + Math.min(Math.abs(wind) / 100, 1) * 0.026, now, 0.3);
  }

  tone(frequency, duration, volume, type = "sine", delay = 0) {
    if (!this.context || !this.enabled) return;
    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  noise(duration, volume, filterType, frequency, delay = 0) {
    if (!this.context || !this.enabled) return;
    const start = this.context.currentTime + delay;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(70, frequency * 0.3), start + duration);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(start);
    source.stop(start + duration);
  }

  hook() {
    this.tone(760, 0.16, 0.13, "triangle");
    this.tone(1180, 0.2, 0.055, "sine", 0.018);
    this.noise(0.09, 0.075, "highpass", 1900);
  }

  release() {
    this.tone(360, 0.1, 0.07, "square");
    this.noise(0.08, 0.045, "bandpass", 900);
  }

  impact(hard = false) {
    const size = hard ? 1 : 0.52;
    this.tone(hard ? 67 : 88, 0.25 * size, 0.2 * size, "sine");
    this.noise(0.22 * size, 0.11 * size, "lowpass", hard ? 360 : 620);
  }

  splash() {
    this.noise(0.8, 0.2, "lowpass", 1400);
    this.tone(74, 0.48, 0.1, "sine");
    this.noise(0.42, 0.09, "highpass", 1100, 0.08);
  }

  success() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((note, index) => {
      this.tone(note, 0.44, 0.075, "sine", index * 0.075);
      this.tone(note * 2, 0.24, 0.022, "triangle", index * 0.075);
    });
  }

  warning() {
    this.tone(168, 0.18, 0.12, "square");
    this.tone(142, 0.22, 0.1, "square", 0.21);
  }

  win() {
    [392, 523.25, 659.25, 783.99, 1046.5].forEach((note, index) => {
      this.tone(note, 0.7, 0.085, "triangle", index * 0.1);
    });
  }

  fail() {
    [220, 185, 146.8].forEach((note, index) => {
      this.tone(note, 0.5, 0.1, "sawtooth", index * 0.16);
    });
  }

  click() {
    this.tone(620, 0.06, 0.045, "square");
  }
}
