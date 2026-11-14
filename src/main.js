import { AudioEngine } from "./audio.js";
import { CARGO_SIZE, PHYSICS, TARGETS } from "./config.js";
import { CranePhysics } from "./crane.js";
import { Renderer } from "./renderer.js";

const canvas = document.querySelector("#game");
const startScreen = document.querySelector("#start-screen");
const endScreen = document.querySelector("#end-screen");
const startButton = document.querySelector("#start-button");
const restartButton = document.querySelector("#restart-button");
const endKicker = document.querySelector("#end-kicker");
const endTitle = document.querySelector("#end-title");
const endDetail = document.querySelector("#end-detail");
const endStats = document.querySelector("#end-stats");
const toast = document.querySelector("#toast");

class HarborGame {
  constructor() {
    this.crane = new CranePhysics();
    this.renderer = new Renderer(canvas);
    this.audio = new AudioEngine();
    this.phase = "ready";
    this.totalTime = 120;
    this.timeLeft = 120;
    this.durability = 100;
    this.impactStrikes = 0;
    this.delivered = 0;
    this.elapsed = 0;
    this.pendingEnd = null;
    this.trail = [];
    this.trailClock = 0;
    this.toastTimer = 0;
    this.pressed = new Set();
    this.input = { left: false, right: false, forward: false, back: false, down: false };
    this.lastTime = performance.now();
    this.bindEvents();
    requestAnimationFrame((time) => this.loop(time));
  }

  bindEvents() {
    const gameKeys = new Set(["KeyA", "KeyD", "KeyW", "KeyS", "Space"]);
    window.addEventListener("keydown", (event) => {
      if (gameKeys.has(event.code)) {
        event.preventDefault();
        if (!this.pressed.has(event.code)) {
          this.pressed.add(event.code);
          this.syncInput();
        }
      }
      if (event.code === "Enter" && this.phase === "ready" && !event.repeat) {
        this.startGame();
      }
      if (event.code === "KeyR" && (this.phase === "won" || this.phase === "lost") && !event.repeat) {
        this.startGame();
      }
    });
    window.addEventListener("keyup", (event) => {
      if (!gameKeys.has(event.code)) return;
      event.preventDefault();
      this.pressed.delete(event.code);
      this.syncInput();
    });
    window.addEventListener("blur", () => {
      this.pressed.clear();
      this.syncInput();
    });
    startButton.addEventListener("click", () => this.startGame());
    restartButton.addEventListener("click", () => this.startGame());
  }

  syncInput() {
    this.input.left = this.pressed.has("KeyA");
    this.input.right = this.pressed.has("KeyD");
    this.input.forward = this.pressed.has("KeyW");
    this.input.back = this.pressed.has("KeyS");
    this.input.down = this.pressed.has("Space");
  }

  async startGame() {
    this.audio.start();
    this.audio.click();
    this.crane.reset();
    this.phase = "playing";
    this.timeLeft = this.totalTime;
    this.durability = 100;
    this.impactStrikes = 0;
    this.delivered = 0;
    this.elapsed = 0;
    this.pendingEnd = null;
    this.trail = [];
    this.trailClock = 0;
    this.pressed.clear();
    this.syncInput();
    startScreen.classList.add("is-hidden");
    endScreen.classList.add("is-hidden");
    this.showToast("吊机启动 · 用 A/D 对位，W/S 移车，按住空格下钩");
  }

  endGame(won, reason) {
    if (this.phase === "won" || this.phase === "lost") return;
    this.phase = won ? "won" : "lost";
    this.pendingEnd = null;
    this.pressed.clear();
    this.syncInput();
    const remaining = Math.max(0, Math.ceil(this.timeLeft));
    endKicker.textContent = won ? "SHIFT COMPLETE" : "SHIFT ABORTED";
    endTitle.textContent = won ? "全部入位" : "作业中止";
    endDetail.textContent = reason;
    endStats.innerHTML = `
      <div><strong>${this.delivered}/6</strong><span>已入位</span></div>
      <div><strong>${Math.round(this.durability)}%</strong><span>吊机耐久</span></div>
      <div><strong>${remaining}s</strong><span>剩余时间</span></div>
    `;
    endScreen.classList.remove("is-hidden");
    toast.classList.remove("show");
    if (won) this.audio.win();
    else this.audio.fail();
    if (won) this.renderer.addSuccess(800, 440, "#d8f06b");
    this.lastTime = performance.now();
  }

  showToast(message, danger = false) {
    toast.textContent = message;
    toast.classList.toggle("danger", danger);
    toast.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3200);
  }

  handleEvents(events) {
    for (const event of events) {
      if (event.type === "attach") {
        this.audio.hook();
        this.renderer.hookFlash = 1;
        this.renderer.burst(this.crane.hook.x, this.crane.hook.y, {
          count: 10,
          color: "#f2dc8d",
          speed: 75,
          life: 0.42,
        });
        this.showToast(`挂钩锁定 · 0${event.cargo.id} 号箱 / ${(event.cargo.weight * 12.4).toFixed(1)}T`);
        this.trail = [];
      }
      if (event.type === "landed") {
        this.audio.release();
        this.audio.impact(event.hard);
        this.renderer.addImpact(
          event.cargo.x,
          event.cargo.y + CARGO_SIZE.height / 2,
          event.hard,
        );
        if (event.hard) {
          this.impactStrikes = Math.min(3, this.impactStrikes + 1);
          this.applyDamage(PHYSICS.durabilityLoss, "硬冲击");
        }
        if (event.reason === "wrong-slot") {
          this.showToast(`箱号不匹配 · 0${event.cargo.id} 号需放回 0${event.cargo.id} 号泊位`, true);
        } else if (!event.hard) {
          this.showToast("货箱已落地 · 可重新挂钩");
        }
      }
      if (event.type === "placed") {
        this.audio.success();
        this.renderer.addSuccess(event.target.x, event.cargo.y, event.target.color);
        this.delivered = this.crane.cargoes.filter((cargo) => cargo.state === "placed").length;
        this.showToast(`0${event.cargo.id} 号入位 · 进度 ${this.delivered}/6`);
        if (this.delivered === 6 && !this.pendingEnd) {
          this.pendingEnd = { won: true, delay: 0.85, reason: "六只货箱全部进入对应存放位。" };
        }
      }
      if (event.type === "impact") {
        this.impactStrikes = Math.min(3, this.impactStrikes + 1);
        this.applyDamage(PHYSICS.durabilityLoss, "入位硬冲击");
      }
      if (event.type === "splash") {
        this.audio.splash();
        this.renderer.addSplash(event.cargo.splashX ?? event.cargo.x);
        this.impactStrikes = Math.min(3, this.impactStrikes + 1);
        this.applyDamage(PHYSICS.lostCargoLoss, "货箱落海");
        this.showToast(`0${event.cargo.id} 号落海 · 耐久 -${PHYSICS.lostCargoLoss} · 正在打捞`, true);
      }
      if (event.type === "respawn") {
        this.audio.click();
        this.showToast(`0${event.cargo.id} 号已打捞回船 · 重新挂钩`);
      }
    }
  }

  applyDamage(amount, reason) {
    this.durability = Math.max(0, this.durability - amount);
    this.renderer.flash = 0.6;
    if (this.durability <= 0 || this.impactStrikes >= 3) {
      this.endGame(false, `${reason}使起重机超出安全阈值。点击重开或按 R 再试。`);
    } else if (reason === "硬冲击") {
      this.showToast(`硬冲击 · 耐久 -${amount} · 冲击 ${this.impactStrikes}/3`, true);
    }
  }

  update(dt, time) {
    this.renderer.update(dt);
    const running = this.phase === "playing";
    const input = running ? this.input : { left: false, right: false, forward: false, back: false, down: false };
    const gust = Math.max(0, Math.sin(this.elapsed * 0.47 + 1.1)) ** 4;

    if (running) {
      this.elapsed += dt;
      this.timeLeft -= dt;
      if (this.pendingEnd) {
        this.pendingEnd.delay -= dt;
        if (this.pendingEnd.delay <= 0) {
          this.endGame(this.pendingEnd.won, this.pendingEnd.reason);
          return;
        }
      } else if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.endGame(false, "换班时间到，仍有货箱未完成入位。");
        return;
      }
    }

    const events = this.crane.update(dt, input, { time, gust });
    if (running) this.handleEvents(events);
    this.updateTrail(dt);
    this.audio.setMotor(
      this.crane.motorLoad,
      this.crane.braking || this.crane.slewBraking,
      running,
      this.crane.wind,
    );
  }

  updateTrail(dt) {
    const carried = this.crane.carried;
    for (const point of this.trail) point.age += dt;
    this.trail = this.trail.filter((point) => point.age < 1.35);
    if (!carried) return;
    this.trailClock += dt;
    if (this.trailClock < 0.055) return;
    this.trailClock = 0;
    this.trail.push({ x: carried.x, y: carried.y, age: 0 });
    if (this.trail.length > 38) this.trail.shift();
  }

  loop(time) {
    const dt = Math.min(0.05, Math.max(0, (time - this.lastTime) / 1000));
    this.lastTime = time;
    this.update(dt, time / 1000);
    this.renderer.draw(this, time / 1000, dt);
    requestAnimationFrame((nextTime) => this.loop(nextTime));
  }

  getSnapshot() {
    return {
      phase: this.phase,
      totalTime: this.totalTime,
      timeLeft: this.timeLeft,
      elapsed: this.elapsed,
      durability: this.durability,
      impactStrikes: this.impactStrikes,
      delivered: this.delivered,
      crane: this.crane.snapshot(),
      targets: TARGETS,
      input: { ...this.input },
    };
  }
}

const game = new HarborGame();
window.__craneGame = {
  getSnapshot: () => game.getSnapshot(),
  start: () => game.startGame(),
};
