'use strict';

// 全部声音由 Web Audio 实时合成，无外部音频资源。

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AUDIO_GLOBAL = api;
})(typeof self !== 'undefined' ? self : this, function () {

function createAudio() {
  const audio = {
    ctx: null,
    master: null,
    nodes: {},
    muted: false,
    started: false,
  };

  function ensure() {
    if (audio.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audio.ctx = new Ctx();
    audio.master = audio.ctx.createGain();
    audio.master.gain.value = 0.55;
    audio.master.connect(audio.ctx.destination);
  }

  function start() {
    ensure();
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
    if (audio.started) return;
    audio.started = true;
    const ctx = audio.ctx;

    // 海浪：两个慢速 LFO 调制的滤波白噪声
    const waveLen = 2 * ctx.sampleRate;
    const waveBuf = ctx.createBuffer(1, waveLen, ctx.sampleRate);
    const data = waveBuf.getChannelData(0);
    for (let i = 0; i < waveLen; i += 1) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = waveBuf;
    noise.loop = true;
    const waveFilter = ctx.createBiquadFilter();
    waveFilter.type = 'lowpass';
    waveFilter.frequency.value = 480;
    const waveGain = ctx.createGain();
    waveGain.gain.value = 0.12;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.12;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.06;
    lfo.connect(lfoGain);
    lfoGain.connect(waveGain.gain);
    noise.connect(waveFilter).connect(waveGain).connect(audio.master);
    noise.start();
    lfo.start();
    audio.nodes.waveGain = waveGain;

    // 发电机：低频嗡鸣 + 转速谐波，增益随超频/熄灯变化
    const gen = ctx.createOscillator();
    gen.type = 'sawtooth';
    gen.frequency.value = 58;
    const genFilter = ctx.createBiquadFilter();
    genFilter.type = 'lowpass';
    genFilter.frequency.value = 320;
    const genGain = ctx.createGain();
    genGain.gain.value = 0.0;
    gen.connect(genFilter).connect(genGain).connect(audio.master);
    gen.start();
    audio.nodes.gen = gen;
    audio.nodes.genGain = genGain;

    // 雨：高通白噪声
    const rain = ctx.createBufferSource();
    rain.buffer = waveBuf;
    rain.loop = true;
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'bandpass';
    rainFilter.frequency.value = 2400;
    const rainGain = ctx.createGain();
    rainGain.gain.value = 0.035;
    rain.connect(rainFilter).connect(rainGain).connect(audio.master);
    rain.start();
  }

  // 每帧根据游戏状态更新发电机声像
  function update(game) {
    if (!audio.started) return;
    const ctx = audio.ctx;
    const t = ctx.currentTime;
    const beam = game.beam;
    const target = beam.blackout ? 0.004 : beam.boost ? 0.11 : 0.05;
    audio.nodes.genGain.gain.setTargetAtTime(audio.muted ? 0 : target, t, 0.15);
    audio.nodes.gen.frequency.setTargetAtTime(beam.boost ? 84 : 58, t, 0.2);
  }

  function blip(freq, duration, type, volume) {
    if (!audio.started || audio.muted) return;
    const ctx = audio.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume || 0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain).connect(audio.master);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  }

  function alarm() {
    if (!audio.started || audio.muted) return;
    const ctx = audio.ctx;
    [0, 0.28].forEach((delay) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 660;
      const start = ctx.currentTime + delay;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.08, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      osc.connect(gain).connect(audio.master);
      osc.start(start);
      osc.stop(start + 0.25);
    });
  }

  // 雾笛：低频两长声，入港/胜利时触发
  function foghorn() {
    if (!audio.started || audio.muted) return;
    const ctx = audio.ctx;
    [0, 1.1].forEach((delay) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(118, ctx.currentTime + delay);
      osc.frequency.linearRampToValueAtTime(96, ctx.currentTime + delay + 0.7);
      const start = ctx.currentTime + delay;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.12);
      gain.gain.setValueAtTime(0.16, start + 0.6);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.85);
      osc.connect(gain).connect(audio.master);
      osc.start(start);
      osc.stop(start + 0.9);
    });
  }

  function crash() {
    if (!audio.started || audio.muted) return;
    const ctx = audio.ctx;
    const len = ctx.sampleRate * 0.5;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) {
      d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.value = 0.25;
    src.connect(filter).connect(gain).connect(audio.master);
    src.start();
  }

  function setMuted(muted) {
    audio.muted = muted;
    if (audio.master) audio.master.gain.value = muted ? 0 : 0.55;
  }

  return { start, update, alarm, foghorn, crash, blip, setMuted, get ctx() { return audio.ctx; } };
}

  return { createAudio };
});
