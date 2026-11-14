import { BAND_NAMES } from './constants.js';

// 提示音引擎：
// - 左声道脉冲频率跟随方位误差，右声道跟随仰角误差（越近音越高、节奏越快）
// - 三个滤波频段切换振荡器基础波形与音色
// - 锁定 / 错锁 / 阵风 / 胜利失败各有独立反馈
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.master = null;
    this.panners = {};
    this.osc = {};
    this.gain = {};
    this.lastPulse = { az: 0, el: 0 };
  }

  ensure() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    // 两个静态声像：方位提示偏左，仰角提示偏右
    for (const [key, pan] of [['az', -0.65], ['el', 0.65]]) {
      const panner = this.ctx.createStereoPanner
        ? this.ctx.createStereoPanner()
        : this.ctx.createGain();
      if (panner.pan) panner.pan.value = pan;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 440;
      osc.connect(g);
      g.connect(panner);
      panner.connect(this.master);
      osc.start();
      this.panners[key] = panner;
      this.gain[key] = g;
      this.osc[key] = osc;
    }
  }

  resume() {
    this.ensure();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

  setBand(band) {
    if (!this.ctx) return;
    // L 正弦柔和，S 三角，X 方波更尖锐
    this.osc.az.type = ['sine', 'triangle', 'square'][band] ?? 'sine';
    this.osc.el.type = ['sine', 'triangle', 'square'][band] ?? 'sine';
  }

  // 持续提示：根据双轴误差调制两个声道
  updateCues(state, azErr, elErr, aligned) {
    if (!this.ctx || this.muted || state.mode !== 'play') {
      if (this.ctx && state.mode !== 'play') {
        this.gain.az.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
        this.gain.el.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
      }
      return;
    }
    const t = this.ctx.currentTime;
    const bandBase = [380, 520, 720][state.band];

    // 误差越小频率越高（引导对准）
    const azPitch = bandBase * (1.6 - Math.min(1, azErr / 40));
    const elPitch = bandBase * 1.2 * (1.6 - Math.min(1, elErr / 30));
    this.osc.az.frequency.setTargetAtTime(azPitch, t, 0.08);
    this.osc.el.frequency.setTargetAtTime(elPitch, t, 0.08);

    const azLevel = aligned ? 0.025 : 0.05;
    const elLevel = aligned ? 0.025 : 0.05;
    this.gain.az.gain.setTargetAtTime(azLevel, t, 0.1);
    this.gain.el.gain.setTargetAtTime(elLevel, t, 0.1);
  }

  blip(freq, panValue, duration = 0.12, type = 'sine', vol = 0.18) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    let node = g;
    if (this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = panValue;
      g.connect(panner);
      node = panner;
    }
    osc.connect(g);
    node.connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  handleEvent(evt) {
    if (!this.ctx || this.muted) return;
    switch (evt.type) {
      case 'locked':
        this.blip(660, 0, 0.15, 'triangle', 0.2);
        setTimeout(() => this.blip(880, 0, 0.25, 'triangle', 0.2), 120);
        break;
      case 'wrong':
        this.blip(200, 0, 0.35, 'sawtooth', 0.22);
        setTimeout(() => this.blip(140, 0, 0.4, 'sawtooth', 0.2), 160);
        break;
      case 'gust':
        this.blip(300, -0.4, 0.2, 'square', 0.12);
        setTimeout(() => this.blip(300, 0.4, 0.2, 'square', 0.12), 90);
        break;
      case 'win':
        [523, 659, 784, 1047].forEach((f, i) =>
          setTimeout(() => this.blip(f, 0, 0.3, 'triangle', 0.2), i * 140));
        break;
      case 'fail':
        [400, 300, 200].forEach((f, i) =>
          setTimeout(() => this.blip(f, 0, 0.4, 'sawtooth', 0.18), i * 180));
        break;
      case 'band':
        this.blip(700, 0.2, 0.08, 'sine', 0.1);
        break;
      default:
        break;
    }
  }

  bandName(band) {
    return BAND_NAMES[band];
  }
}
