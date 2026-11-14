// Node 下用最小 Canvas 2D mock 跑通渲染与界面逻辑，避免浏览器 API 漏用报错。
import { createGame, startGame, stepGame, makeInput } from '../src/engine.js';
import { render, VIEW } from '../src/render.js';

function makeCtx() {
  const grad = { addColorStop() {} };
  return {
    canvas: { width: VIEW.w, height: VIEW.h },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    globalAlpha: 1,
    shadowBlur: 0,
    shadowColor: '',
    setLineDash() {},
    createLinearGradient() {
      return grad;
    },
    createRadialGradient() {
      return grad;
    },
    fillRect() {},
    strokeRect() {},
    clearRect() {},
    fillText() {},
    beginPath() {},
    closePath() {},
    roundRect() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    fill() {},
    stroke() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
  };
}

globalThis.performance = { now: () => Date.now() };

const g = createGame();
const ctx = makeCtx();
let ok = true;
try {
  render(ctx, g, 0); // ready 态
  startGame(g);
  const input = makeInput();
  input.p1.mainF = true;
  input.p2.down = true;
  for (let i = 0; i < 120; i++) stepGame(g, input, 1 / 60);
  render(ctx, g, 2);
  g.state = 'paused';
  render(ctx, g, 2.1);
  g.state = 'won';
  render(ctx, g, 2.2);
  g.state = 'lost';
  g.loseReason = 'oxygen';
  render(ctx, g, 2.3);
} catch (err) {
  ok = false;
  console.error(err);
}
console.log(`${ok ? 'PASS' : 'FAIL'}  渲染层各状态冒烟（ready/playing/paused/won/lost）`);
process.exit(ok ? 0 : 1);
