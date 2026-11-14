import {
  alignmentInfo,
  candidateAt,
  clearInput,
  createGame,
  lockProgress,
  signalLevel,
  shiftBand,
  update,
  crossNoiseFor,
} from './engine.js';
import {
  BAND_FREQ_LABELS,
  BAND_NAMES,
  LOCK_HOLD_SECONDS,
  WRONG_LIMIT,
} from './constants.js';
import { blinkState } from './signals.js';
import { InputController } from './input.js';
import { AudioEngine } from './audio.js';
import { drawRadar } from './draw/radar.js';
import {
  drawAzScale,
  drawElGauge,
  drawGainMeter,
  drawLevelMeter,
} from './draw/instruments.js';
import { drawWaterfall } from './draw/waterfall.js';

const $ = (id) => document.getElementById(id);

const els = {
  briefing: $('briefing'),
  dashboard: $('dashboard'),
  result: $('result'),
  debugSwitch: $('debugSwitch'),
  startBtn: $('startBtn'),
  muteBtn: $('muteBtn'),
  restartBtn: $('restartBtn'),
  againBtn: $('againBtn'),
  briefBtn: $('briefBtn'),
  modeLabel: $('modeLabel'),
  timeLabel: $('timeLabel'),
  batteryBar: $('batteryBar'),
  batteryLabel: $('batteryLabel'),
  azValue: $('azValue'),
  azStatus: $('azStatus'),
  elValue: $('elValue'),
  elStatus: $('elStatus'),
  gainValue: $('gainValue'),
  bandLabel: $('bandLabel'),
  bandButtons: $('bandButtons'),
  azScale: $('azScale'),
  elGauge: $('elGauge'),
  gainMeter: $('gainMeter'),
  levelMeter: $('levelMeter'),
  radar: $('radar'),
  leftWaterfall: $('leftWaterfall'),
  rightWaterfall: $('rightWaterfall'),
  leftWfHint: $('leftWfHint'),
  rightWfHint: $('rightWfHint'),
  lockBar: $('lockBar'),
  lockTimer: $('lockTimer'),
  lockTitle: $('lockTitle'),
  targetLabel: $('targetLabel'),
  azErr: $('azErr'),
  elErr: $('elErr'),
  levelDb: $('levelDb'),
  windowTag: $('windowTag'),
  feed: $('feed'),
  lockPips: $('lockPips'),
  wrongPips: $('wrongPips'),
  windLabel: $('windLabel'),
  windArrow: $('windArrow'),
  coopLabel: $('coopLabel'),
  holdLabel: $('holdLabel'),
  resultCard: $('resultCard'),
  resultKicker: $('resultKicker'),
  resultTitle: $('resultTitle'),
  resultDesc: $('resultDesc'),
  rsLocks: $('rsLocks'),
  rsWrong: $('rsWrong'),
  rsBattery: $('rsBattery'),
  rsCoop: $('rsCoop'),
};

const audio = new AudioEngine();
let state = null;
let input = null;
let rafId = 0;
let lastTs = 0;
let debugMode = false;
let debugBadge = null;
let feedItems = [];

function fmtTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function pushFeed(evt) {
  const node = document.createElement('div');
  node.className = `feed-item ${evt.tone || 'info'}`;
  node.textContent = evt.text;
  els.feed.appendChild(node);
  feedItems.push(node);
  if (feedItems.length > 6) {
    const old = feedItems.shift();
    old.remove();
  }
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity 0.6s';
  }, 4200);
  setTimeout(() => {
    node.remove();
    feedItems = feedItems.filter((n) => n !== node);
  }, 5000);
}

function buildBandButtons() {
  els.bandButtons.innerHTML = '';
  BAND_NAMES.forEach((name, i) => {
    const btn = document.createElement('button');
    btn.className = 'band-btn';
    btn.dataset.band = String(i);
    btn.innerHTML = `<b>${name}</b><small>${BAND_FREQ_LABELS[i]}</small>`;
    btn.addEventListener('click', () => {
      if (state.band === i) return;
      const dir = (i - state.band + 3) % 3 === 1 ? 1 : -1;
      // 仅单人调试允许鼠标点按；正式合作模式请用键盘 , / .
      if (debugMode) shiftBand(state, dir);
    });
    els.bandButtons.appendChild(btn);
  });
}

function ensureDebugBadge() {
  if (debugBadge) return;
  debugBadge = document.createElement('div');
  debugBadge.className = 'debug-badge';
  debugBadge.innerHTML =
    '单人调试模式 · 非正式记录<br><small>下方按钮可模拟两侧按键，正式合作请两人共用键盘</small>';
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px;';
  const defs = [
    ['A 方位-', 'azLeft'], ['W 增益+', 'gainUp'], ['↑ 仰角+', 'elUp'],
    ['D 方位+', 'azRight'], ['S 增益-', 'gainDown'], ['↓ 仰角-', 'elDown'],
    [', 频段-', 'band-'], ['. 频段+', 'band+'], ['阵风暂停', 'pauseWind'],
  ];
  for (const [label, key] of defs) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'padding:6px 4px;font-size:11px;border:1px solid #c98f45;background:#1a130b;color:#f2b66b;';
    const press = (on) => {
      if (key === 'band-') { if (on) shiftBand(state, -1); return; }
      if (key === 'band+') { if (on) shiftBand(state, 1); return; }
      if (key === 'pauseWind') { if (on) state._windPaused = !state._windPaused; b.textContent = state._windPaused ? '恢复风暴' : label; return; }
      input.setVirtual(key, on);
    };
    b.addEventListener('mousedown', () => press(true));
    b.addEventListener('mouseup', () => press(false));
    b.addEventListener('mouseleave', () => press(false));
    grid.appendChild(b);
  }
  debugBadge.appendChild(grid);
  document.body.appendChild(debugBadge);
}

function startGame() {
  debugMode = els.debugSwitch.checked;
  audio.resume();
  state = createGame({ debug: debugMode });
  state._windPaused = false;
  input = new InputController(state, {
    onBand: () => audio.setBand(state.band),
    onStart: startGame,
  });
  input.attach();
  audio.setBand(state.band);

  els.briefing.classList.add('hidden');
  els.result.classList.add('hidden');
  els.dashboard.classList.remove('hidden');
  els.dashboard.classList.toggle('debug', debugMode);
  els.modeLabel.textContent = debugMode
    ? '单人调试 · 非正式记录'
    : '双人同屏 · 正式合作';
  if (debugMode) ensureDebugBadge();
  if (debugBadge) debugBadge.style.display = debugMode ? 'block' : 'none';

  els.feed.innerHTML = '';
  feedItems = [];
  pushFeed({
    type: 'info',
    tone: 'good',
    text: debugMode
      ? '单人调试已启动：数值辅助已显示，不计入正式合作记录。'
      : '正式合作模式已启动。两名操作员请同时守住两轴。',
  });
  buildBandButtons();
  lastTs = performance.now();
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
}

function backToBriefing() {
  cancelAnimationFrame(rafId);
  input?.detach();
  clearInput(state);
  els.result.classList.add('hidden');
  els.dashboard.classList.add('hidden');
  els.briefing.classList.remove('hidden');
}

function showResult() {
  const won = state.mode === 'won';
  els.resultCard.classList.toggle('lost', !won);
  if (won) {
    els.resultKicker.textContent = 'MISSION COMPLETE';
    els.resultTitle.textContent = '三个异常全部锁定';
    els.resultDesc.textContent = '双镜阵列在风暴抵达前完成验证，三组真异常信号均已归档。';
  } else {
    const map = {
      battery: ['供电故障', '电池耗尽', 'battery', '电池在完成三次锁定前耗尽，阵列断电。'],
      wrong: ['诱饵信号误锁', '任务无效', 'wrong', '连续锁定了两个诱饵回波，观测任务被判定为无效。'],
      timeout: ['风暴抵达', '观测窗口关闭', 'timeout', '风暴前锋抵达阵地，本次观测被迫中止。'],
    };
    const [kicker, title, , desc] = map[state.failReason] || map.timeout;
    els.resultKicker.textContent = kicker;
    els.resultTitle.textContent = title;
    els.resultDesc.textContent = desc;
  }
  els.rsLocks.textContent = `${state.lockCount} / 3`;
  els.rsWrong.textContent = `${state.wrongCount} / ${WRONG_LIMIT}`;
  els.rsBattery.textContent = `${Math.round(state.battery)}%`;
  els.rsCoop.textContent = `${state.coopCount} 次`;
  els.result.classList.remove('hidden');
}

function refreshHud() {
  const info = alignmentInfo(state);
  const candidate = candidateAt(state);
  const target = info;

  els.azValue.textContent = `${state.az.toFixed(1)}°`;
  els.elValue.textContent = `${state.el.toFixed(1)}°`;
  els.gainValue.textContent = `${Math.round(state.gain)}%`;
  els.timeLabel.textContent = fmtTime(state.timeLeft);
  els.batteryLabel.textContent = `${Math.round(state.battery)}%`;
  els.batteryBar.style.width = `${state.battery}%`;
  els.batteryBar.style.background =
    state.battery < 22
      ? 'linear-gradient(90deg,#a8433b,#ef7a72)'
      : 'linear-gradient(90deg,#3aa86f,#7fe0a8)';

  els.azStatus.textContent = target?.azWithin ? '● 容差内' : '● 偏离';
  els.azStatus.className = `status ${target?.azWithin ? 'ok' : 'bad'}`;
  els.elStatus.textContent = target?.elWithin ? '● 容差内' : '● 偏离';
  els.elStatus.className = `status ${target?.elWithin ? 'ok' : 'bad'}`;

  els.bandLabel.textContent = `${BAND_NAMES[state.band]}-BAND`;
  [...els.bandButtons.children].forEach((btn, i) =>
    btn.classList.toggle('active', i === state.band));

  // 锁定进度
  const prog = lockProgress(state);
  els.lockBar.style.width = `${prog * 100}%`;
  els.lockTimer.textContent = `${state.lock.hold.toFixed(2)} / ${LOCK_HOLD_SECONDS.toFixed(2)} s`;
  els.lockTitle.textContent = candidate ? '双轴协同锁定' : '双轴校正中';
  if (target) {
    const azD = ((target.signal.az - state.az + 540) % 360) - 180;
    const elD = state.el - target.signal.el;
    els.azErr.textContent = `${azD >= 0 ? '+' : ''}${azD.toFixed(1)}°`;
    els.azErr.style.color = target.azWithin ? 'var(--green)' : 'var(--red)';
    els.elErr.textContent = `${elD >= 0 ? '+' : ''}${elD.toFixed(1)}°`;
    els.elErr.style.color = target.elWithin ? 'var(--green)' : 'var(--red)';
    const realIndex = state.signals
      .filter((s) => s.kind === 'real')
      .indexOf(target.signal);
    els.targetLabel.textContent =
      target.signal.kind === 'real' ? `异常 0${realIndex + 1}` : '诱饵回波 ?';
  }

  // 闪烁窗口标签
  const nearest = target?.signal;
  if (nearest) {
    const blink = blinkState(nearest, state.t);
    els.windowTag.textContent = blink.active
      ? `● ${nearest.kind === 'real' ? '双峰相干' : '单峰回波'}窗口 · ${blink.remaining.toFixed(1)}s`
      : `○ 回波静默 · ${blink.remaining.toFixed(1)}s 后重现`;
  }

  // 信号电平（当前频段内最强可见信号）
  let level = 0;
  for (const signal of state.signals) {
    level = Math.max(level, signalLevel(state, signal));
  }
  const dbm = level ? (-95 + level * 42).toFixed(1) : '—';
  els.levelDb.textContent = level ? `${dbm} dBm` : '无信号 dBm';

  // 底栏
  els.lockPips.innerHTML = [0, 1, 2]
    .map((i) => `<span class="pip ${i < state.lockCount ? 'on' : ''}"></span>`)
    .join('');
  els.wrongPips.innerHTML = [0, 1]
    .map((i) => `<span class="pip bad ${i < state.wrongCount ? 'on' : ''}"></span>`)
    .join('');
  const pct = Math.round((state.storm.strength / 1.15) * 100);
  els.windLabel.textContent = `平稳 · ${pct}%`;
  if (state.storm.warning) {
    const az = state.storm.gustAz > 0 ? 'AZ+' : state.storm.gustAz < 0 ? 'AZ–' : 'AZ·';
    const el = state.storm.gustEl > 0 ? 'EL+' : state.storm.gustEl < 0 ? 'EL–' : 'EL·';
    els.windArrow.textContent = `${az} ${el}`;
    els.windArrow.style.color = 'var(--amber)';
  } else {
    els.windArrow.textContent = 'AZ· EL·';
    els.windArrow.style.color = 'var(--muted)';
  }
  const leftActive = state.input.azLeft || state.input.azRight ||
    state.input.gainUp || state.input.gainDown;
  const rightActive = state.input.elUp || state.input.elDown;
  els.coopLabel.textContent =
    leftActive && rightActive
      ? '● 双人同步输入中'
      : '○ 双人同步输入 · 等待两侧操作';
  els.holdLabel.textContent =
    candidate ? '保持锁定节奏，不要松开两轴' : '两轴同时进入容差并保持 2.00 秒';

  // 画布
  const leftNoise = crossNoiseFor(state, 'left');
  const rightNoise = crossNoiseFor(state, 'right');
  els.leftWfHint.textContent = `仰频 ${Math.round(leftNoise * 100)}%`;
  els.rightWfHint.textContent = `噪声 ${Math.round(rightNoise * 100)}%`;

  drawRadar(els.radar, state);
  drawAzScale(els.azScale, state, target);
  drawElGauge(els.elGauge, state, target);
  drawGainMeter(els.gainMeter, state);
  drawLevelMeter(els.levelMeter, state, level);
  drawWaterfall(els.leftWaterfall, state, leftNoise, 'left');
  drawWaterfall(els.rightWaterfall, state, rightNoise, 'right');

  // 声音：左右声道分别跟随方位、仰角误差
  if (info) {
    audio.updateCues(state, info.azErr, info.elErr, Boolean(candidate));
  }

  if (debugMode) drawDebugOverlay();
}

function drawDebugOverlay() {
  // 调试数值直接画在雷达角上：目标坐标与所需增益
  const ctx = els.radar.getContext('2d');
  ctx.save();
  ctx.fillStyle = 'rgba(242,182,107,0.9)';
  ctx.font = '10px monospace';
  state.signals.forEach((s, i) => {
    const line = `${s.id} ${s.kind === 'real' ? '真' : '诱'} b${s.band} g${Math.round(s.requiredGain)}`;
    ctx.fillText(line, 8, 20 + i * 14);
  });
  ctx.restore();
}

function loop(ts) {
  const dt = Math.min(0.1, (ts - lastTs) / 1000);
  lastTs = ts;
  const events = update(state, dt);
  for (const evt of events) {
    pushFeed(evt);
    audio.handleEvent(evt);
  }
  refreshHud();
  if (state.mode === 'play') {
    rafId = requestAnimationFrame(loop);
  } else {
    setTimeout(showResult, 700);
  }
}

els.startBtn.addEventListener('click', startGame);
els.restartBtn.addEventListener('click', startGame);
els.againBtn.addEventListener('click', startGame);
els.briefBtn.addEventListener('click', backToBriefing);
els.muteBtn.addEventListener('click', () => {
  audio.setMuted(!audio.muted);
  els.muteBtn.textContent = audio.muted ? '▶ 声音关' : '◀ 声音开';
});

buildBandButtons();

// 暴露给自动化验证脚本
window.__DUAL_MIRROR__ = {
  createGame,
  startGame,
  getState: () => state,
  getInput: () => input,
};
