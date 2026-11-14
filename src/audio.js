import { spatialMetrics, QUADRANTS } from "./scene.js";
import { mulberry32 } from "./rng.js";

const TWO_PI = Math.PI * 2;

export function generateImpulseResponse(context, room) {
  const sampleRate = context.sampleRate;
  const seconds = Math.min(3.4, room.rt60 * 1.24);
  const length = Math.max(1, Math.floor(sampleRate * seconds));
  const impulse = context.createBuffer(2, length, sampleRate);
  const random = mulberry32(room.irSeed);
  const damping = 0.92 - room.damping * 0.58;
  const earlyCount = Math.round(8 + room.damping * 10);
  const taps = [];
  for (let i = 0; i < earlyCount; i += 1) {
    taps.push({
      time: room.preDelay + (i + random() * 0.7) * 0.021,
      gain: (0.58 - i * 0.034) * (0.55 + random() * 0.8),
      side: random() < 0.5 ? -1 : 1,
    });
  }

  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    let lowState = 0;
    let previous = 0;
    for (let i = 0; i < length; i += 1) {
      const time = i / sampleRate;
      const raw = random() * 2 - 1;
      lowState += (raw - lowState) * (0.16 + room.brightness * 0.16);
      const dark = lowState * (1 - room.damping * 0.42) + previous * damping * 0.24;
      previous = dark;
      const envelope = Math.exp((-6.9 * time) / room.rt60);
      let value = dark * envelope;
      for (const tap of taps) {
        const distance = Math.abs(time - tap.time);
        if (distance < 0.0008) {
          value += tap.gain * (tap.side === (channel ? 1 : -1) ? 0.8 : 1);
        }
      }
      data[i] = value;
    }
  }

  let peak = 0;
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]));
  }
  const scale = peak > 0 ? 0.62 / peak : 0;
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) data[i] *= scale;
  }
  return impulse;
}

export class BinauralEngine {
  constructor() {
    this.context = null;
    this.caseData = null;
    this.irBuffers = new Map();
    this.noiseBuffer = null;
    this.playback = null;
    this.paused = false;
    this.masterVolume = 0.76;
    this.calibrationEnd = 0;
  }

  async init() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("此浏览器不支持 Web Audio");
      this.context = new AudioContextClass({ latencyHint: "interactive" });
      this._buildMasterGraph();
      this.noiseBuffer = this._makeNoiseBuffer(3, 0x51f15e);
    }
    if (this.context.state === "suspended" && !this.playback) {
      await this.context.resume();
    }
    return this.context;
  }

  _buildMasterGraph() {
    const ctx = this.context;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.masterVolume;
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -15;
    this.compressor.knee.value = 14;
    this.compressor.ratio.value = 3.5;
    this.compressor.attack.value = 0.008;
    this.compressor.release.value = 0.22;

    this.analyserL = ctx.createAnalyser();
    this.analyserR = ctx.createAnalyser();
    this.analyserL.fftSize = 2048;
    this.analyserR.fftSize = 2048;
    this.timeDataL = new Float32Array(this.analyserL.fftSize);
    this.timeDataR = new Float32Array(this.analyserR.fftSize);
    this.frequencyData = new Uint8Array(this.analyserL.frequencyBinCount);
    this.frequencyL = new Uint8Array(this.analyserL.frequencyBinCount);
    this.frequencyR = new Uint8Array(this.analyserR.frequencyBinCount);

    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);
    const analysisSink = ctx.createGain();
    analysisSink.gain.value = 0;
    splitter.connect(this.analyserL, 0);
    splitter.connect(this.analyserR, 1);
    this.analyserL.connect(merger, 0, 0);
    this.analyserR.connect(merger, 0, 1);
    merger.connect(analysisSink).connect(ctx.destination);
    this.compressor.connect(this.masterGain).connect(ctx.destination);
    this.compressor.connect(splitter);
    this.input = ctx.createGain();
    this.input.gain.value = 1;
    this.input.connect(this.compressor);

    this.calibrationBus = ctx.createGain();
    this.calibrationBus.gain.value = 1;
    this.calibrationBus.connect(this.input);
  }

  _makeNoiseBuffer(seconds, seed) {
    const ctx = this.context;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    const random = mulberry32(seed);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      let smoothing = 0;
      for (let i = 0; i < length; i += 1) {
        const white = random() * 2 - 1;
        smoothing += (white - smoothing) * 0.16;
        data[i] = smoothing * 0.8 + white * 0.2;
      }
    }
    return buffer;
  }

  configureCase(caseData) {
    this.caseData = caseData;
    for (const room of caseData.rooms) {
      if (!this.irBuffers.has(room.irSeed)) {
        this.irBuffers.set(room.irSeed, generateImpulseResponse(this.context, room));
      }
    }
  }

  setVolume(value) {
    this.masterVolume = Math.max(0, Math.min(1, value));
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.masterVolume, this.context.currentTime, 0.04);
    }
  }

  async playCalibration(side = "both") {
    await this.init();
    await this.context.resume();
    const now = this.context.currentTime + 0.04;
    this._tone(now, side === "right" ? 1 : -1, true);
    if (side === "both") this._tone(now + 0.76, 1, false);
    this.calibrationEnd = now + (side === "both" ? 1.48 : 0.72);
    return this.calibrationEnd - now;
  }

  _tone(start, pan, first) {
    const ctx = this.context;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(first ? 392 : 523.25, start);
    panner.pan.setValueAtTime(pan, start);
    gain.gain.setValueAtTime(0.0001, start);
    for (let i = 0; i < 2; i += 1) {
      const at = start + i * 0.22;
      gain.gain.exponentialRampToValueAtTime(0.16, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    }
    oscillator.connect(gain).connect(panner).connect(this.calibrationBus);
    oscillator.start(start);
    oscillator.stop(start + 0.48);
  }

  getAudioStats() {
    if (!this.context) {
      return {
        leftDb: -90,
        rightDb: -90,
        leftPeak: 0,
        rightPeak: 0,
        spectrum: this.frequencyData ?? new Uint8Array(512),
      };
    }
    this.analyserL.getFloatTimeDomainData(this.timeDataL);
    this.analyserR.getFloatTimeDomainData(this.timeDataR);
    this.analyserL.getByteFrequencyData(this.frequencyL);
    this.analyserR.getByteFrequencyData(this.frequencyR);
    for (let i = 0; i < this.frequencyData.length; i += 1) {
      this.frequencyData[i] = Math.max(this.frequencyL[i] ?? 0, this.frequencyR[i] ?? 0);
    }
    return {
      leftDb: rmsDb(this.timeDataL),
      rightDb: rmsDb(this.timeDataR),
      leftPeak: peak(this.timeDataL),
      rightPeak: peak(this.timeDataR),
      spectrum: this.frequencyData,
      spectrumL: this.frequencyL,
      spectrumR: this.frequencyR,
    };
  }

  async startListening(caseData, stationIndex, options = {}) {
    await this.init();
    await this.context.resume();
    this.stopPlayback();
    this.configureCase(caseData);
    this.paused = false;

    const ctx = this.context;
    const room = caseData.rooms[stationIndex];
    if (!room) throw new Error("无效的监听位");
    const station = room.station;
    const startAt = ctx.currentTime + 0.08;
    const duration = options.duration ?? caseData.duration;
    const output = ctx.createGain();
    output.gain.value = 0;
    output.connect(this.input);
    output.gain.linearRampToValueAtTime(1, startAt + 0.06);
    const dryBus = ctx.createGain();
    dryBus.gain.value = 0.72;
    dryBus.connect(output);
    const wetBus = ctx.createGain();
    wetBus.gain.value = 1;
    const convolver = ctx.createConvolver();
    convolver.buffer = this.irBuffers.get(room.irSeed);
    const wetReturn = ctx.createGain();
    wetReturn.gain.value = 0.9;
    wetBus.connect(convolver).connect(wetReturn).connect(output);

    const playback = {
      caseData,
      stationIndex,
      room,
      station,
      startedAt: startAt,
      duration,
      output,
      dryBus,
      wetBus,
      nodes: [],
      sources: [],
      probe: Boolean(options.probeQuadrant),
    };
    this.playback = playback;
    const sourceList = options.probeQuadrant
      ? [this._makeProbeSource(options.probeQuadrant)]
      : caseData.sources;
    for (const source of sourceList) {
      playback.sources.push(this._buildBroadcast(playback, source, startAt));
    }
    if (!playback.probe) {
      this._buildAmbience(playback, startAt);
    }
    return {
      duration,
      station: room.id,
      metrics: playback.sources.map((entry) => ({
        id: entry.data.id,
        name: entry.data.name,
        start: entry.data.start,
        ...entry.metrics,
      })),
    };
  }

  _makeProbeSource(quadrantKey) {
    const quadrant = QUADRANTS[quadrantKey];
    return {
      id: `probe-${quadrantKey}`,
      name: "PROBE",
      quadrant: quadrantKey,
      position: { x: quadrant.dx * 2.7, y: quadrant.dy * 2.35 },
      carrier: 196,
      overtone: 392,
      patternRate: 1,
      pulseLength: 0.18,
      start: 0.24,
    };
  }

  async startProbe(quadrantKey, roomIndex = 1) {
    if (!this.caseData) throw new Error("请先载入案件");
    const result = await this.startListening(this.caseData, roomIndex, {
      duration: 3.2,
      probeQuadrant: quadrantKey,
    });
    return result.metrics[0];
  }

  getElapsed() {
    if (!this.playback) return 0;
    const elapsed = this.context.currentTime - this.playback.startedAt;
    return Math.max(0, Math.min(this.playback.duration, elapsed));
  }

  isPlaying() {
    return Boolean(this.playback) && !this.paused && this.getElapsed() < this.playback.duration;
  }

  async pause() {
    if (!this.playback || this.paused) return;
    this.paused = true;
    await this.context.suspend();
  }

  async resume() {
    if (!this.playback || !this.paused) return;
    await this.context.resume();
    this.paused = false;
  }

  stopPlayback() {
    const playback = this.playback;
    if (!playback) return;
    this.playback = null;
    try {
      playback.output.gain.cancelScheduledValues(this.context.currentTime);
      playback.output.gain.setValueAtTime(playback.output.gain.value, this.context.currentTime);
      playback.output.gain.linearRampToValueAtTime(0, this.context.currentTime + 0.04);
    } catch {
      // The graph may already be closing.
    }
    for (const node of playback.nodes) {
      try {
        node.stop(this.context.currentTime + 0.06);
      } catch {
        // A source can only be stopped once.
      }
    }
  }

  setStation(index) {
    if (!this.caseData) return;
    this.stopPlayback();
    this.stationIndex = index;
  }

  getPlaybackMetrics() {
    if (!this.playback) return [];
    return this.playback.sources.map((entry) => ({
      id: entry.data.id,
      name: entry.data.name,
      start: entry.data.start,
      quadrant: entry.data.quadrant,
      ...entry.metrics,
    }));
  }

  _buildBroadcast(playback, source, startAt) {
    const ctx = this.context;
    const metrics = spatialMetrics(playback.station, source);
    const spatialInput = ctx.createGain();
    const lowpass = ctx.createBiquadFilter();
    const shelf = ctx.createBiquadFilter();
    const panner = ctx.createStereoPanner();
    const distanceGain = ctx.createGain();
    const drySend = ctx.createGain();
    const wetSend = ctx.createGain();
    lowpass.type = "lowpass";
    lowpass.frequency.value = metrics.lowpass;
    lowpass.Q.value = 0.58;
    shelf.type = "highshelf";
    shelf.frequency.value = 2500;
    shelf.gain.value = metrics.highShelfDb;
    panner.pan.value = metrics.pan;
    distanceGain.gain.value = 0.27 * metrics.attenuation;
    drySend.gain.value = 0.92;
    wetSend.gain.value = 0.42 + (metrics.rear ? 0.25 : 0);
    spatialInput.connect(lowpass).connect(shelf).connect(panner).connect(distanceGain);
    distanceGain.connect(drySend).connect(playback.dryBus);
    distanceGain.connect(wetSend).connect(playback.wetBus);

    const modulator = ctx.createGain();
    modulator.gain.setValueAtTime(0.0001, startAt);
    const osc = ctx.createOscillator();
    const overtone = ctx.createOscillator();
    const oscGain = ctx.createGain();
    const overtoneGain = ctx.createGain();
    const vibrato = ctx.createOscillator();
    const vibratoGain = ctx.createGain();
    osc.type = source.id === "beta" ? "triangle" : "sine";
    overtone.type = "sine";
    osc.frequency.value = source.carrier;
    overtone.frequency.value = source.overtone;
    oscGain.gain.value = 0.5;
    overtoneGain.gain.value = 0.2;
    vibrato.frequency.value = source.id === "beta" ? 5.7 : 3.8;
    vibratoGain.gain.value = source.id === "beta" ? 8 : 3;
    vibrato.connect(vibratoGain);
    vibratoGain.connect(osc.frequency);
    vibratoGain.connect(overtone.frequency);
    osc.connect(oscGain).connect(modulator);
    overtone.connect(overtoneGain).connect(modulator);
    modulator.connect(spatialInput);

    const noise = ctx.createBufferSource();
    const noiseFilter = ctx.createBiquadFilter();
    const noiseGain = ctx.createGain();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    noiseFilter.type = "highpass";
    noiseFilter.frequency.value = 2400;
    noiseFilter.Q.value = 0.45;
    noiseGain.gain.value = 0.12;
    noise.connect(noiseFilter).connect(noiseGain).connect(modulator);

    const offset = source.start;
    const pulseTimes = source.id === "beta"
      ? [0, 0.14, 0.28, 0.42, 0.82]
      : [0, 0.23, 0.46, 1.02];
    const period = source.id === "beta" ? 1.72 : 2.16;
    for (let phrase = offset; phrase < playback.duration - 0.2; phrase += period) {
      for (const pulse of pulseTimes) {
        const at = startAt + phrase + pulse;
        this._pulse(modulator.gain, at, source.pulseLength, 0.9);
      }
    }
    const stopAt = startAt + playback.duration + 0.25;
    for (const node of [osc, overtone, vibrato, noise]) {
      node.start(startAt + offset);
      node.stop(stopAt);
      playback.nodes.push(node);
    }
    return { data: source, metrics, nodes: { lowpass, shelf, panner, distanceGain } };
  }

  _pulse(parameter, at, length, amplitude) {
    parameter.setValueAtTime(0.0001, at - 0.008);
    parameter.linearRampToValueAtTime(amplitude, at + 0.012);
    parameter.setValueAtTime(amplitude, at + Math.max(0.018, length * 0.52));
    parameter.exponentialRampToValueAtTime(0.0001, at + length);
  }

  _schedulePulse(parameter, at, length, amplitude) {
    this._pulse(parameter, at, length, amplitude);
  }

  _buildAmbience(playback, startAt) {
    const ctx = this.context;
    const ambience = playback.caseData.ambience;
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    dry.gain.value = 0.92;
    wet.gain.value = 0.36;
    dry.connect(playback.dryBus);
    wet.connect(playback.wetBus);

    const hum = ctx.createOscillator();
    const mains = ctx.createOscillator();
    const humGain = ctx.createGain();
    const humFilter = ctx.createBiquadFilter();
    hum.type = "sine";
    mains.type = "triangle";
    hum.frequency.value = ambience.humHz;
    mains.frequency.value = ambience.mainsHz;
    humGain.gain.value = 0.025;
    humFilter.type = "lowpass";
    humFilter.frequency.value = 180;
    hum.connect(humFilter);
    mains.connect(humFilter);
    humFilter.connect(humGain).connect(dry);
    this._routeWet(humGain, wet, 0.2);

    const hiss = ctx.createBufferSource();
    const hissHigh = ctx.createBiquadFilter();
    const hissLow = ctx.createBiquadFilter();
    const hissGain = ctx.createGain();
    hiss.buffer = this.noiseBuffer;
    hiss.loop = true;
    hissHigh.type = "highpass";
    hissHigh.frequency.value = 260;
    hissLow.type = "lowpass";
    hissLow.frequency.value = 2500;
    hissGain.gain.value = 0.028;
    hiss.connect(hissHigh).connect(hissLow).connect(hissGain);
    hissGain.connect(dry);
    this._routeWet(hissGain, wet, 0.14);

    const stopAt = startAt + playback.duration + 0.15;
    for (const node of [hum, mains, hiss]) {
      node.start(startAt);
      node.stop(stopAt);
      playback.nodes.push(node);
    }
    playback.caseData.ambience.footsteps.forEach((time, index) => {
      this._scheduleFootstep(playback, startAt + time, ((index % 3) - 1) * 0.25);
    });
    playback.caseData.ambience.water.forEach((time, index) => {
      this._scheduleWater(playback, startAt + time, index % 2 ? 0.28 : -0.22);
    });
  }

  _routeWet(node, wetBus, amount) {
    const send = this.context.createGain();
    send.gain.value = amount;
    node.connect(send).connect(wetBus);
  }

  _scheduleFootstep(playback, at, pan) {
    const ctx = this.context;
    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    const dry = ctx.createGain();
    const echo = ctx.createGain();
    thump.type = "sine";
    thump.frequency.setValueAtTime(88, at);
    thump.frequency.exponentialRampToValueAtTime(44, at + 0.12);
    thumpGain.gain.setValueAtTime(0.0001, at);
    thumpGain.gain.exponentialRampToValueAtTime(0.16, at + 0.008);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    panner.pan.value = pan;
    thump.connect(thumpGain).connect(panner);
    dry.gain.value = 0.88;
    echo.gain.value = 0.42;
    panner.connect(dry).connect(playback.dryBus);
    panner.connect(echo).connect(playback.wetBus);
    thump.start(at);
    thump.stop(at + 0.2);
    playback.nodes.push(thump);
    this._scheduleEcho(playback, at + 0.21, -pan * 0.7, 0.045);
  }

  _scheduleEcho(playback, at, pan, level) {
    const ctx = this.context;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    source.buffer = this.noiseBuffer;
    filter.type = "lowpass";
    filter.frequency.value = 520;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
    panner.pan.value = pan;
    source.connect(filter).connect(gain).connect(panner);
    panner.connect(playback.dryBus);
    this._routeWet(panner, playback.wetBus, 0.65);
    source.start(at);
    source.stop(at + 0.18);
    playback.nodes.push(source);
  }

  _scheduleWater(playback, at, pan) {
    const ctx = this.context;
    const drop = ctx.createOscillator();
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    drop.type = "sine";
    drop.frequency.setValueAtTime(1450, at);
    drop.frequency.exponentialRampToValueAtTime(520, at + 0.11);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.045, at + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.15);
    panner.pan.value = pan;
    drop.connect(gain).connect(panner);
    panner.connect(playback.dryBus);
    this._routeWet(panner, playback.wetBus, 0.52);
    drop.start(at);
    drop.stop(at + 0.18);
    playback.nodes.push(drop);
  }
}

function rmsDb(values) {
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) sum += values[i] * values[i];
  const rms = Math.sqrt(sum / values.length);
  return rms > 0 ? Math.max(-90, 20 * Math.log10(rms)) : -90;
}

function peak(values) {
  let value = 0;
  for (let i = 0; i < values.length; i += 1) value = Math.max(value, Math.abs(values[i]));
  return value;
}
