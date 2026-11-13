import { CONFIG, ISLANDS, island, speedFor, burnFor } from "./config.js";
import { Rng } from "./rng.js";
import { generateMission, makeReplacement } from "./generator.js";
import { stepFerry } from "./physics.js";
import { AudioEngine } from "./audio.js";
import { Renderer } from "./renderer.js";

const PHASE = { READY: "ready", SAILING: "sailing", DOCKED: "docked", ENDED: "ended" };

export class Game {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.audio = new AudioEngine();
    this.cb = callbacks;
    this.phase = PHASE.READY;
    this.paused = false;
    this.rafId = null;
    this.lastFrame = 0;
    this.accumulator = 0;
    this.timeScale = 1; // debug hook for automated runs / recordings
    this.toasts = [];
    this._boundFrame = (t) => this.frame(t);
    this.time = 0;
    this.timeLeft = CONFIG.duration;
    this.fuel = 1;
    this.fuelTank = 1;
    this.deliveredCount = 0;
    this.neededDeliveries = CONFIG.passengerTarget;
    this.leavingCount = 0;
    const home0 = island(0);
    this.ferry = { x: home0.x, y: home0.y, heading: 0 };
    this.dockedIsland = 0;
    this.targetIsland = null;
    this.onboard = [];
    this.waiting = [];
    this.trail = [];
    this.over = null;
  }

  start(seed) {
    const mission = generateMission(seed);
    this.mission = mission;
    this.rng = new Rng(`${seed}:live`);
    this.time = 0;
    this.timeLeft = CONFIG.duration;
    this.fuel = mission.reference.tank;
    this.fuelTank = mission.reference.tank;
    this.deliveredCount = 0;
    this.neededDeliveries = CONFIG.passengerTarget;
    this.replacementCounter = 0;
    this.leavingCount = 0;

    const home = island(0);
    this.ferry = { x: home.x, y: home.y, heading: 0 };
    this.dockedIsland = 0;
    this.targetIsland = null;
    this.onboard = [];
    this.waiting = mission.passengers.map((p) => ({ ...p, patienceLeft: p.patience }));
    this.trail = [{ x: home.x, y: home.y }];
    this.trailTimer = 0;
    this.phase = PHASE.DOCKED;
    this.paused = false;
    this.over = null;
    this.toasts = [];
    this.accumulator = 0;

    this.audio.ensure();
    this.audio.updateEngine(false, 0);
    this.emit();
    this.lastFrame = performance.now();
  }

  run() {
    if (!this.rafId) {
      this.lastFrame = performance.now();
      this.rafId = requestAnimationFrame(this._boundFrame);
    }
  }

  // ---- player actions -----------------------------------------------------

  setDestination(islandId) {
    this.audio.ensure();
    if (this.over || this.paused) return;
    if (this.phase === PHASE.DOCKED && islandId === this.dockedIsland) return;
    this.targetIsland = islandId;
    this.phase = PHASE.SAILING;
    this.pushToast(`目的地：${ISLANDS[islandId].name}`, "info", this.ferry.x, this.ferry.y - 26);
    this.emit();
  }

  boardPassenger(passengerId) {
    this.audio.ensure();
    if (this.over || this.paused || this.phase !== PHASE.DOCKED) return;
    if (this.onboard.length >= CONFIG.capacity) return;
    const idx = this.waiting.findIndex(
      (p) => p.id === passengerId && p.from === this.dockedIsland
    );
    if (idx === -1) return;
    const [p] = this.waiting.splice(idx, 1);
    this.onboard.push(p);
    this.audio.board();
    this.pushToast(`${p.name} 上船`, "info", this.ferry.x, this.ferry.y - 30);
    this.emit();
  }

  // Optional: let a passenger back off at the current dock (landing order /
  // load decisions stay fully under the player's control).
  disembarkPassenger(passengerId) {
    if (this.over || this.paused || this.phase !== PHASE.DOCKED) return;
    const idx = this.onboard.findIndex((p) => p.id === passengerId);
    if (idx === -1) return;
    const [p] = this.onboard.splice(idx, 1);
    p.patienceLeft = Math.max(p.patienceLeft, CONFIG.patience.replacementMin * 0.6);
    this.waiting.push(p);
    this.audio.unboard();
    this.emit();
  }

  togglePause() {
    if (this.over) return;
    this.paused = !this.paused;
    if (this.paused) {
      this.audio.suspend();
    } else {
      this.audio.ensure();
      this.audio.resume();
      this.lastFrame = performance.now();
    }
    this.emit();
  }

  setMuted(muted) {
    this.audio.setMuted(muted);
  }

  // ---- simulation ---------------------------------------------------------

  frame(now) {
    this.rafId = requestAnimationFrame(this._boundFrame);
    let elapsed = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.phase === PHASE.READY) {
      return;
    }
    const snap = this.snapshot();
    if (this.paused || this.over) {
      this.renderer.draw(snap);
      return;
    }
    elapsed *= this.timeScale;
    this.accumulator += elapsed;
    const dt = CONFIG.step;
    let guard = 0;
    while (this.accumulator >= dt && guard < 8 && !this.over) {
      this.tick(dt);
      this.accumulator -= dt;
      guard++;
    }
    this.audio.updateEngine(this.phase === PHASE.SAILING, this.onboard.length);
    this.pruneToasts();
    this.renderer.draw(this.snapshot());
  }

  pruneToasts() {
    const before = this.toasts.length;
    this.toasts = this.toasts.filter((t) => this.time - t.born < 1.7);
    if (this.toasts.length !== before) this.cb.onToast?.(this.toasts);
  }

  tick(dt) {
    this.time += dt;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.finish(false, "时间耗尽，末班渡轮没能接完所有人");
      return;
    }

    this.tickPatience(dt);

    if (this.phase === PHASE.SAILING && this.targetIsland !== null) {
      const load = this.onboard.length;
      const burn = burnFor(load) * dt;
      if (this.fuel <= burn) {
        this.fuel = 0;
        this.finish(false, "燃油耗尽，渡轮停在了海面上");
        return;
      }
      this.fuel -= burn;
      const docked = stepFerry(this.ferry, this.targetIsland, load, dt);

      this.trailTimer += dt;
      if (this.trailTimer >= 0.12) {
        this.trailTimer = 0;
        this.trail.push({ x: this.ferry.x, y: this.ferry.y });
        if (this.trail.length > 240) this.trail.shift();
      }

      if (docked) this.onDock(this.targetIsland);
    }
  }

  tickPatience(dt) {
    for (let i = this.waiting.length - 1; i >= 0; i--) {
      const p = this.waiting[i];
      p.patienceLeft -= dt;
      if (p.patienceLeft <= 0) {
        this.waiting.splice(i, 1);
        this.leavingCount += 1;
        this.audio.leave();
        const spot = island(p.from);
        this.pushToast(`${p.name} 耐心耗尽离港`, "bad", spot.x, spot.y - spot.r - 12);
        this.spawnReplacement(p.from);
      }
    }
  }

  spawnReplacement(excludedFrom) {
    this.replacementCounter += 1;
    const r = makeReplacement(this.rng, this.replacementCounter, excludedFrom);
    this.waiting.push({ ...r, patienceLeft: r.patience });
    const spot = island(r.from);
    this.pushToast(`替代乘客 ${r.name} 出现在 ${ISLANDS[r.from].name}`, "info", spot.x, spot.y + spot.r + 14);
  }

  onDock(islandId) {
    this.phase = PHASE.DOCKED;
    this.dockedIsland = islandId;
    this.targetIsland = null;
    this.trail.push({ x: this.ferry.x, y: this.ferry.y });
    this.audio.dock();
    this.pushToast(`靠港 ${ISLANDS[islandId].name}`, "info", this.ferry.x, this.ferry.y - 30);

    // Auto disembark everyone whose destination is here.
    const arrived = this.onboard.filter((p) => p.to === islandId);
    if (arrived.length > 0) {
      this.onboard = this.onboard.filter((p) => p.to !== islandId);
      this.deliveredCount += arrived.length;
      this.audio.deliver();
      const names = arrived.map((p) => p.name).join("、");
      this.pushToast(`${names} 送达 ✓`, "good", this.ferry.x, this.ferry.y - 48);
    }

    if (this.deliveredCount >= this.neededDeliveries) {
      this.finish(true, "八名乘客全部送达，末班渡轮准点收班");
      return;
    }
    this.emit();
  }

  finish(win, reason) {
    this.over = { win, reason, at: this.time };
    this.phase = PHASE.ENDED;
    this.targetIsland = null;
    this.audio.updateEngine(false, this.onboard.length);
    if (win) this.audio.win();
    else this.audio.lose();
    this.emit();
  }

  // ---- view model ---------------------------------------------------------

  snapshot() {
    const waitingByIsland = ISLANDS.map(() => []);
    for (const p of this.waiting) waitingByIsland[p.from].push(p);
    for (const list of waitingByIsland) {
      list.sort((a, b) => a.patienceLeft - b.patienceLeft);
    }
    return {
      time: this.time,
      timeLeft: this.timeLeft,
      phase: this.phase,
      paused: this.paused,
      over: this.over,
      ferry: this.ferry,
      targetIsland: this.targetIsland,
      dockedIsland: this.dockedIsland,
      onboard: this.onboard,
      waiting: this.waiting,
      waitingByIsland,
      trail: this.trail,
      fuel: this.fuel,
      fuelTank: this.fuelTank,
      deliveredCount: this.deliveredCount,
      neededDeliveries: this.neededDeliveries,
      leavingCount: this.leavingCount,
      speed: this.phase === PHASE.SAILING ? speedFor(this.onboard.length) : 0,
      load: this.onboard.length,
      toasts: this.toasts,
    };
  }

  pushToast(text, kind, x, y) {
    const id = `${this.time}-${Math.random().toString(36).slice(2, 7)}`;
    this.toasts.push({ id, text, kind, x, y, born: this.time });
    if (this.toasts.length > 8) this.toasts.shift();
    this.cb.onToast?.(this.toasts);
  }

  emit() {
    this.cb.onState?.(this.snapshot());
  }
}
