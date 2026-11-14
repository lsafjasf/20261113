// Web Audio 合成：推进器功率与升降速度分别调制两路引擎音高；
// 碰撞、取样、胜负均为即时合成提示音，无外部音频资源。

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.thruster = null;
    this.pump = null;
  }

  // 必须由用户手势触发，满足浏览器自动播放策略
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this._startDrone('sawtooth', 0.05, 70, 'thruster');
    this._startDrone('triangle', 0.04, 120, 'pump');
  }

  _startDrone(type, gain, baseFreq, slot) {
    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    osc.type = type;
    osc.frequency.value = baseFreq;
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    gainNode.gain.value = 0;
    osc.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(this.master);
    osc.start();
    this[slot] = { osc, gain: gainNode, filter, baseFreq };
  }

  // power 0..1；vertical 归一化升降速度（负为上浮）
  update(power, vertical) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const thrustLevel = Math.max(power.main, power.jet * 0.7);
    this.thruster.osc.frequency.setTargetAtTime(
      this.thruster.baseFreq + thrustLevel * 150,
      t,
      0.08
    );
    this.thruster.filter.frequency.setTargetAtTime(400 + thrustLevel * 900, t, 0.1);
    this.thruster.gain.gain.setTargetAtTime(this.muted ? 0 : thrustLevel * 0.12, t, 0.1);

    const pumpLevel = Math.max(power.pumpUp, power.pumpDown);
    const vert = Math.abs(vertical);
    this.pump.osc.frequency.setTargetAtTime(
      this.pump.baseFreq + vert * 110 + pumpLevel * 40,
      t,
      0.1
    );
    this.pump.gain.gain.setTargetAtTime(this.muted ? 0 : (pumpLevel * 0.1 + vert * 0.05), t, 0.12);
  }

  _blip(freq, dur, type = 'sine', vol = 0.3, slideTo = null) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  _noise(dur, vol) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(t);
  }

  handleEvent(ev) {
    if (!this.ctx) return;
    switch (ev.type) {
      case 'hit':
        this._noise(0.28, 0.35 + ev.intensity * 0.25);
        this._blip(120, 0.2, 'square', 0.15, 60);
        break;
      case 'pickup':
        this._blip(520, 0.12, 'sine', 0.28);
        setTimeout(() => this._blip(780, 0.16, 'sine', 0.28), 110);
        break;
      case 'win':
        [440, 554, 659, 880].forEach((f, i) =>
          setTimeout(() => this._blip(f, 0.22, 'triangle', 0.3), i * 140)
        );
        break;
      case 'lose':
        this._blip(300, 0.6, 'sawtooth', 0.3, 70);
        this._noise(0.5, 0.25);
        break;
      case 'start':
        this._blip(360, 0.12, 'triangle', 0.22, 540);
        break;
      default:
        break;
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }
}
