import { CONFIG, ISLANDS } from "./config.js";
import { Game } from "./game.js";

const $ = (sel) => document.querySelector(sel);

const canvas = $("#sea");
const game = new Game(canvas, { onState: render, onToast: renderToasts });
game.run();

// Debug / automation hooks used by the Playwright test and recording scripts.
window.__ferry = {
  game,
  start: (seed) => startGame(seed),
  clickIsland: (id) => game.setDestination(id),
  board: (id) => game.boardPassenger(id),
  disembark: (id) => game.disembarkPassenger(id),
  pause: () => game.togglePause(),
  setTimeScale: (s) => { game.timeScale = s; },
};

let muted = false;
let lastSnapshot = null;

function currentSeed() {
  const params = new URLSearchParams(location.search);
  return params.get("seed") || $("#seed-input").value.trim() || "ferry-2026";
}

function startGame(seed) {
  if (seed) $("#seed-input").value = seed;
  $("#start-overlay").classList.add("hidden");
  $("#end-overlay").classList.add("hidden");
  game.start(currentSeed());
  render(game.snapshot());
}

function randomSeed() {
  $("#seed-input").value = `ferry-${Math.random().toString(36).slice(2, 8)}`;
}

// ---- canvas interactions ---------------------------------------------------

canvas.addEventListener("click", (e) => {
  if (game.over || game.paused) return;
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * CONFIG.canvas.width;
  const y = ((e.clientY - rect.top) / rect.height) * CONFIG.canvas.height;
  for (const isl of ISLANDS) {
    if (Math.hypot(x - isl.x, y - isl.y) <= isl.r + 14) {
      game.setDestination(isl.id);
      return;
    }
  }
});

// ---- buttons ---------------------------------------------------------------

$("#btn-start").addEventListener("click", () => startGame());
$("#btn-random-seed").addEventListener("click", randomSeed);
$("#btn-pause").addEventListener("click", () => game.togglePause());
$("#btn-restart").addEventListener("click", () => startGame(currentSeed()));
$("#btn-replay").addEventListener("click", () => startGame(currentSeed()));
$("#btn-new-seed").addEventListener("click", () => {
  randomSeed();
  startGame(currentSeed());
});
$("#btn-mute").addEventListener("click", () => {
  muted = !muted;
  game.setMuted(muted);
  $("#btn-mute").textContent = muted ? "🔇 静音" : "🔊 音效";
});

document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") return;
  if (e.code === "Space") {
    e.preventDefault();
    game.togglePause();
  } else if (e.key >= "1" && e.key <= "3") {
    game.setDestination(Number(e.key) - 1);
  } else if (e.key.toLowerCase() === "r") {
    startGame(currentSeed());
  }
});

// ---- DOM rendering ---------------------------------------------------------

function fmtTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function patienceClass(patienceLeft, patienceMax) {
  const ratio = patienceLeft / patienceMax;
  if (ratio <= 0.2) return "low";
  if (ratio <= 0.45) return "mid";
  return "";
}

function render(s) {
  lastSnapshot = s;

  $("#timer-value").textContent = fmtTime(s.timeLeft);
  $("#timer-value").classList.toggle("danger-text", s.timeLeft <= 20);

  const fuelPct = Math.max(0, (s.fuel / s.fuelTank) * 100);
  const fuelFill = $("#fuel-fill");
  fuelFill.style.width = `${fuelPct}%`;
  fuelFill.classList.toggle("low", fuelPct <= 25);
  $("#fuel-value").textContent = `${Math.ceil(s.fuel)}`;

  $("#load-value").textContent = `${s.load}/${CONFIG.capacity}`;
  $("#speed-value").textContent = `${Math.round(s.speed)}`;

  const pct = (s.deliveredCount / s.neededDeliveries) * 100;
  $("#progress-fill").style.width = `${pct}%`;
  $("#progress-value").textContent = `已送达 ${s.deliveredCount} / ${s.neededDeliveries}`;

  const where =
    s.phase === "sailing"
      ? `驶向 ${ISLANDS[s.targetIsland].name}`
      : `泊位于 ${ISLANDS[s.dockedIsland].name}`;
  $("#current-info").textContent =
    `${where} · 离港 ${s.leavingCount} 人`;

  $("#btn-pause").textContent = s.paused ? "继续" : "暂停";
  $("#pause-banner").classList.toggle("hidden", !s.paused);

  renderIslandLists(s);
  renderOnboard(s);
  renderToasts(s.toasts);

  if (s.over) renderEnd(s);
}

function renderIslandLists(s) {
  const root = $("#island-list");
  root.innerHTML = "";
  ISLANDS.forEach((isl) => {
    const waiters = s.waitingByIsland[isl.id];
    const card = document.createElement("div");
    card.className = "island-card";
    if (s.targetIsland === isl.id && s.phase === "sailing") card.classList.add("target");

    const head = document.createElement("div");
    head.className = "island-head";
    const btn = document.createElement("button");
    btn.className = "island-name";
    btn.type = "button";
    btn.innerHTML = `${isl.name}<span class="set-hint">点此设为下一站 [${isl.id + 1}]</span>`;
    btn.addEventListener("click", () => game.setDestination(isl.id));
    const meta = document.createElement("span");
    meta.className = "island-meta";
    meta.textContent = `候船 ${waiters.length} 人`;
    head.append(btn, meta);
    card.append(head);

    const ul = document.createElement("ul");
    ul.className = "waiter-list";
    if (waiters.length === 0) {
      const li = document.createElement("p");
      li.className = "empty-line";
      li.textContent = "岛上暂无候船乘客";
      card.append(li);
    } else {
      for (const p of waiters) {
        const li = document.createElement("li");
        const full = s.onboard.length >= CONFIG.capacity;
        const notHere = s.phase !== "docked" || s.dockedIsland !== isl.id;
        li.className = "waiter";
          if (p.patienceLeft <= 8) li.classList.add("leaving");
        if (notHere || full) {
          li.classList.add("disabled");
          li.style.opacity = ".55";
          li.style.cursor = "not-allowed";
        }
        const pPct = Math.max(0, Math.min(100, (p.patienceLeft / p.patience) * 100));
        li.innerHTML = `
          <span class="who">
            <span class="dot" style="width:9px;height:9px;border-radius:50%;display:inline-block;background:${CONFIG.colors.dest[p.to]}"></span>
            <span class="pname">${p.name}</span>
            <span class="arrow">→ ${ISLANDS[p.to].name}</span>
            ${p.replacement ? '<span class="dim">(替代)</span>' : ""}
          </span>
          <span class="dim">${Math.ceil(p.patienceLeft)}s</span>
          <span class="patience"><i class="${patienceClass(p.patienceLeft, p.patience)}" style="width:${pPct}%"></i></span>`;
        if (!notHere && !full) {
          li.addEventListener("click", () => game.boardPassenger(p.id));
        }
        ul.append(li);
      }
      card.append(ul);
      if (s.onboard.length >= CONFIG.capacity) {
        const warn = document.createElement("p");
        warn.className = "full-warn";
        warn.textContent = "船舱已满（4/4），先送达再接人";
        card.append(warn);
      }
    }
    root.append(card);
  });
}

function renderOnboard(s) {
  const ul = $("#onboard-list");
  $("#onboard-cap").textContent = `(${s.onboard.length}/${CONFIG.capacity})`;
  ul.innerHTML = "";
  if (s.onboard.length === 0) {
    ul.innerHTML = '<li class="dim empty-hint">船舱空着</li>';
    return;
  }
  const canDrop = s.phase === "docked";
  for (const p of s.onboard) {
    const li = document.createElement("li");
    if (canDrop) li.classList.add("drop");
    li.innerHTML = `
      <span>${p.name} <span class="dim">→ ${ISLANDS[p.to].name}</span></span>
      ${canDrop ? '<span class="dim">点击请其下船</span>' : ""}`;
    if (canDrop) li.addEventListener("click", () => game.disembarkPassenger(p.id));
    ul.append(li);
  }
}

function renderToasts(toasts) {
  const layer = $("#toast-layer");
  const alive = (toasts ?? []).filter((t) => lastSnapshot && lastSnapshot.time - t.born < 1.7);
  layer.innerHTML = "";
  const scaleX = canvas.clientWidth / CONFIG.canvas.width;
  const scaleY = canvas.clientHeight / CONFIG.canvas.height;
  for (const t of alive) {
    const el = document.createElement("div");
    el.className = `toast ${t.kind}`;
    el.textContent = t.text;
    el.style.left = `${Math.min(Math.max(t.x * scaleX, 10), canvas.clientWidth - 130)}px`;
    el.style.top = `${Math.min(Math.max(t.y * scaleY, 8), canvas.clientHeight - 30)}px`;
    layer.append(el);
  }
}

function renderEnd(s) {
  $("#end-overlay").classList.remove("hidden");
  $("#end-title").textContent = s.over.win ? "任务成功" : "任务失败";
  $("#end-title").style.color = s.over.win ? "var(--ok)" : "var(--danger)";
  $("#end-detail").textContent = s.over.reason;
  $("#end-stats").innerHTML = `
    <div>用时<b>${s.time.toFixed(1)}s</b></div>
    <div>送达<b>${s.deliveredCount}/${s.neededDeliveries}</b></div>
    <div>剩余燃油<b>${Math.ceil(s.fuel)}</b></div>
    <div>乘客离港<b>${s.leavingCount}</b></div>`;
}

// Initial idle view behind the start overlay.
render(game.snapshot());
