// 主控：双人同屏输入、单人调试模式、固定步长循环与界面状态。
import { createGame, makeInput, startGame, restartGame, togglePause, stepGame, TUNE } from './engine.js';
import { render, VIEW } from './render.js';
import { GameAudio } from './audio.js';

const canvas = document.getElementById('game');
canvas.width = VIEW.w;
canvas.height = VIEW.h;
const ctx = canvas.getContext('2d');

const game = createGame();
const input = makeInput();
const audio = new GameAudio();
let debugMode = false;
let showHelp = false;

// 玩家一：W/S 主推，A/D 喷口；玩家二：方向键浮力
const P1_BIND = {
  KeyW: 'mainF',
  KeyS: 'mainR',
  KeyA: 'left',
  KeyD: 'right',
};
const P2_BIND = {
  ArrowUp: 'up',
  ArrowDown: 'down',
};

// 单人调试：右侧手位同时扮演两人，方向键横向、I/K 升降
const DEBUG_P1 = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'mainF',
  ArrowDown: 'mainR',
};
const DEBUG_P2 = {
  KeyI: 'up',
  KeyK: 'down',
};

const HANDLED = new Set([
  ...Object.keys(P1_BIND),
  ...Object.keys(P2_BIND),
  'Space',
  'KeyR',
  'KeyM',
  'KeyH',
  'KeyI',
  'KeyK',
]);

function setKey(code, down) {
  if (debugMode) {
    if (DEBUG_P1[code]) input.p1[DEBUG_P1[code]] = down;
    if (DEBUG_P2[code]) input.p2[DEBUG_P2[code]] = down;
    return;
  }
  if (P1_BIND[code]) input.p1[P1_BIND[code]] = down;
  if (P2_BIND[code]) input.p2[P2_BIND[code]] = down;
}

window.addEventListener('keydown', (e) => {
  if (HANDLED.has(e.code)) e.preventDefault();
  if (e.repeat) return;
  audio.ensure();

  if (e.code === 'Space') {
    if (game.state === 'ready' || game.state === 'won' || game.state === 'lost') startGame(game);
    else togglePause(game);
    return;
  }
  if (e.code === 'KeyR') {
    restartGame(game);
    return;
  }
  if (e.code === 'KeyM') {
    const muted = audio.toggleMute();
    document.getElementById('muteState').textContent = muted ? '静音中' : '声音开';
    return;
  }
  if (e.code === 'KeyH') {
    showHelp = !showHelp;
    return;
  }
  setKey(e.code, true);
});

window.addEventListener('keyup', (e) => {
  if (HANDLED.has(e.code)) e.preventDefault();
  setKey(e.code, false);
});

window.addEventListener('blur', () => {
  Object.keys(input.p1).forEach((k) => (input.p1[k] = false));
  Object.keys(input.p2).forEach((k) => (input.p2[k] = false));
  if (game.state === 'playing') game.state = 'paused';
});

document.getElementById('modeToggle').addEventListener('click', () => {
  audio.ensure();
  debugMode = !debugMode;
  const btn = document.getElementById('modeToggle');
  btn.textContent = debugMode ? '切换到双人模式' : '单人调试模式';
  btn.classList.toggle('debug', debugMode);
  document.getElementById('modeLabel').textContent = debugMode
    ? '单人调试（方向键推进 / I K 升降）'
    : '双人合作（左 WASD · 右 方向键）';
  restartGame(game);
});

// 固定步长，避免不同刷新率下手感漂移
const STEP = 1 / 60;
let acc = 0;
let last = performance.now();

function frame(now) {
  let delta = (now - last) / 1000;
  last = now;
  if (delta > 0.25) delta = 0.25;
  acc += delta;
  while (acc >= STEP) {
    stepGame(game, input, STEP);
    acc -= STEP;
  }

  while (game.events.length) {
    audio.handleEvent(game.events.shift());
  }
  audio.update(game.power, game.hull.vy / TUNE.maxVy);
  render(ctx, game, now / 1000);
  drawOverlay(ctx);
  requestAnimationFrame(frame);
}

function overlayText(lines, boxW = 520) {
  ctx.save();
  ctx.fillStyle = 'rgba(3, 12, 20, 0.82)';
  const boxH = 60 + lines.length * 30;
  ctx.fillRect((VIEW.w - boxW) / 2, VIEW.h / 2 - boxH / 2, boxW, boxH);
  ctx.strokeStyle = 'rgba(127, 212, 232, 0.5)';
  ctx.strokeRect((VIEW.w - boxW) / 2, VIEW.h / 2 - boxH / 2, boxW, boxH);
  ctx.textAlign = 'center';
  lines.forEach((line, i) => {
    ctx.font = i === 0 ? 'bold 26px sans-serif' : '16px sans-serif';
    ctx.fillStyle = i === 0 ? '#bff0ff' : '#cfe0ea';
    ctx.fillText(line, VIEW.w / 2, VIEW.h / 2 - boxH / 2 + 44 + i * 30);
  });
  ctx.restore();
}

function drawOverlay() {
  if (showHelp) {
    overlayText(
      [
        '操作说明',
        debugMode ? '调试：方向键=推进与喷口，I=上浮，K=下沉' : '玩家一 WASD：W/S 主推，A/D 左右喷口',
        debugMode ? '' : '玩家二 方向键：↑ 上浮，↓ 下沉',
        '空格 开始/暂停，R 快速重开，M 静音，H 关闭本页',
        '收齐 3 个样本舱后低速回到入口即胜利',
      ],
      620
    );
    return;
  }
  if (game.state === 'ready') {
    overlayText([
      '双舵沉箱',
      '两名船员共用一艘沉箱，缺一不可',
      debugMode ? '单人调试：方向键推进，I/K 调浮力' : '左位 WASD 负责推进，右位方向键负责浮力',
      '按 空格 开始下潜',
    ]);
  } else if (game.state === 'paused') {
    overlayText(['已暂停', '按 空格 继续，R 重开']);
  } else if (game.state === 'won') {
    overlayText([
      '任务成功',
      `样本舱全部回收，用时 ${game.time.toFixed(1)} 秒`,
      `剩余耐久 ${Math.ceil(game.hull.hp)}，按 R 或空格快速重开`,
    ]);
  } else if (game.state === 'lost') {
    const reason = game.loseReason === 'hull' ? '船体耐久耗尽，沉箱解体' : '氧气耗尽，船员无法继续作业';
    overlayText(['任务失败', reason, '按 R 或空格快速重开']);
  }
}

requestAnimationFrame(frame);
