// Small WebAudio synth. No audio assets needed.
// - Continuous engine hum whose pitch drops as the load gets heavier.
// - Docking / delivery / boarding / leave / win / lose cues.
// Everything is suspended while paused so the simulation goes fully silent.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engineNodes = null;
  }

  // Must be called from a user gesture.
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();

    const master = this.ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.9;
    master.connect(this.ctx.destination);
    this.master = master;

    const engineGain = this.ctx.createGain();
    engineGain.gain.value = 0;

    const osc1 = this.ctx.createOscillator();
    osc1.type = "sawtooth";
    const osc2 = this.ctx.createOscillator();
    osc2.type = "triangle";
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 420;
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(engineGain);
    engineGain.connect(master);
    osc1.start();
    osc2.start();
    this.engineNodes = { osc1, osc2, filter, gain: engineGain };
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.02);
    }
  }

  suspend() {
    if (this.ctx && this.ctx.state === "running") this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  }

  // moving: bool; load: 0..4
  updateEngine(moving, load) {
    if (!this.ctx || !this.engineNodes) return;
    const t = this.ctx.currentTime;
    // Empty boat spins fast; a full four-passenger load drags the pitch down.
    const baseFreq = 96 - load * 9;
    this.engineNodes.osc1.frequency.setTargetAtTime(baseFreq, t, 0.08);
    this.engineNodes.osc2.frequency.setTargetAtTime(baseFreq * 1.5 + 12, t, 0.08);
    this.engineNodes.filter.frequency.setTargetAtTime(340 + load * 60, t, 0.1);
    this.engineNodes.gain.gain.setTargetAtTime(moving ? 0.055 : 0.0001, t, 0.12);
  }

  tone(freq, duration, type = "sine", volume = 0.16, when = 0, slideTo = null) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  dock() {
    this.tone(320, 0.18, "sine", 0.18);
    this.tone(480, 0.22, "sine", 0.12, 0.09);
  }

  board() {
    this.tone(520, 0.09, "triangle", 0.12);
  }

  unboard() {
    this.tone(420, 0.09, "triangle", 0.1);
  }

  deliver() {
    this.tone(660, 0.12, "sine", 0.16);
    this.tone(880, 0.16, "sine", 0.14, 0.1);
    this.tone(1175, 0.22, "sine", 0.1, 0.2);
  }

  leave() {
    this.tone(300, 0.35, "sawtooth", 0.1, 0, 140);
  }

  win() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, "triangle", 0.15, i * 0.13));
  }

  lose() {
    [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.3, "sawtooth", 0.12, i * 0.16));
  }
}
