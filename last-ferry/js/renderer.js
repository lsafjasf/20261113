import { CONFIG, ISLANDS } from "./config.js";

const W = CONFIG.canvas.width;
const H = CONFIG.canvas.height;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.time = 0;
    this.waves = this.buildWaves();
    this.currentArrows = this.buildCurrentArrows();
  }

  buildWaves() {
    const arr = [];
    for (let row = 0; row < 7; row++) {
      for (let i = 0; i < 9; i++) {
        arr.push({
          x: (i / 8) * W + (row % 2) * 40,
          y: 60 + row * 82,
          len: 26 + ((i * 13 + row * 7) % 18),
          speed: 14 + ((i * 5 + row * 3) % 11),
          phase: (i * 0.9 + row * 1.7) % (Math.PI * 2),
        });
      }
    }
    return arr;
  }

  buildCurrentArrows() {
    const arr = [];
    for (let i = 0; i < 26; i++) {
      arr.push({
        x: (i * 137) % W,
        y: 30 + ((i * 89) % (H - 60)),
        speed: 26 + (i % 5) * 7,
      });
    }
    return arr;
  }

  draw(state) {
    const ctx = this.ctx;
    this.time = state.time;
    ctx.clearRect(0, 0, W, H);
    this.drawWater();
    this.drawCurrent();
    this.drawWaves();
    this.drawRoute(state);
    for (const island of ISLANDS) this.drawIsland(island, state);
    this.drawWaitingDots(state);
    this.drawFerry(state);
  }

  drawWater() {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0d3a5c");
    g.addColorStop(0.55, "#0a2c48");
    g.addColorStop(1, "#071f36");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  drawWaves() {
    const ctx = this.ctx;
    ctx.lineWidth = 1.4;
    for (const w of this.waves) {
      const x = (w.x + this.time * w.speed) % (W + 80) - 40;
      const y = w.y + Math.sin(this.time * 1.4 + w.phase) * 4;
      ctx.strokeStyle = "rgba(160, 214, 240, 0.16)";
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + w.len / 2, y - 4, x + w.len, y);
      ctx.stroke();
    }
  }

  drawCurrent() {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "rgba(120, 200, 255, 0.35)";
    ctx.fillStyle = "rgba(120, 200, 255, 0.35)";
    ctx.lineWidth = 1.6;
    for (const a of this.currentArrows) {
      const x = (a.x + this.time * a.speed) % (W + 30) - 15;
      const y = a.y;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 18, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + 18, y);
      ctx.lineTo(x + 12, y - 4);
      ctx.moveTo(x + 18, y);
      ctx.lineTo(x + 12, y + 4);
      ctx.stroke();
    }
    ctx.restore();

    // Current label.
    ctx.save();
    ctx.font = "12px sans-serif";
    ctx.fillStyle = "rgba(160, 214, 240, 0.75)";
    ctx.fillText("横向海流 →", 18, H - 18);
    ctx.restore();
  }

  drawRoute(state) {
    const ctx = this.ctx;
    if (state.trail.length > 1) {
      ctx.save();
      ctx.strokeStyle = "rgba(72, 196, 255, 0.35)";
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 7]);
      ctx.beginPath();
      ctx.moveTo(state.trail[0].x, state.trail[0].y);
      for (const p of state.trail.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.restore();
    }
    if (state.targetIsland !== null && state.phase === "sailing") {
      const target = ISLANDS[state.targetIsland];
      ctx.save();
      ctx.strokeStyle = "rgba(72, 196, 255, 0.55)";
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 8]);
      ctx.lineDashOffset = -this.time * 24;
      ctx.beginPath();
      ctx.moveTo(state.ferry.x, state.ferry.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawIsland(island, state) {
    const ctx = this.ctx;
    const { x, y, r } = island;
    const isTarget = state.targetIsland === island.id && state.phase === "sailing";
    const urgent = state.waitingByIsland[island.id]?.some(
      (p) => p.patienceLeft <= 8
    );

    ctx.save();
    if (isTarget) {
      ctx.strokeStyle = "rgba(72,196,255,.9)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, r + 8 + Math.sin(this.time * 4) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (urgent) {
      ctx.strokeStyle = `rgba(255,107,107,${0.45 + Math.sin(this.time * 6) * 0.3})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, r + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Shore foam ring.
    ctx.fillStyle = "rgba(220, 240, 250, 0.25)";
    ctx.beginPath();
    ctx.arc(x, y, r + 3, 0, Math.PI * 2);
    ctx.fill();

    // Island body with an irregular outline.
    ctx.beginPath();
    const points = 14;
    for (let i = 0; i <= points; i++) {
      const a = (i / points) * Math.PI * 2;
      const wobble = 1 + Math.sin(a * 3 + island.id * 2) * 0.08 + Math.cos(a * 5) * 0.05;
      const px = x + Math.cos(a) * r * wobble;
      const py = y + Math.sin(a) * r * wobble * 0.92;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.2, x, y, r * 1.2);
    g.addColorStop(0, "#e4d4a2");
    g.addColorStop(0.6, island.color);
    g.addColorStop(1, "#7d6a45");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "rgba(60, 45, 25, 0.55)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Lighthouse on island 1, palms hints elsewhere.
    if (island.id === 1) {
      ctx.fillStyle = "#f4f1e6";
      ctx.fillRect(x - 4, y - r - 16, 8, 18);
      ctx.fillStyle = "#d24b4b";
      ctx.fillRect(x - 5, y - r - 20, 10, 6);
      const beam = this.time * 2;
      ctx.strokeStyle = "rgba(255, 230, 150, 0.25)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y - r - 17);
      ctx.lineTo(x + Math.cos(beam) * 46, y - r - 17 + Math.sin(beam) * 18);
      ctx.stroke();
    } else {
      ctx.strokeStyle = "#4f6b3a";
      ctx.lineWidth = 3;
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(x + k * 12, y - r * 0.25);
        ctx.quadraticCurveTo(x + k * 12 + 6, y - r * 0.55, x + k * 12 + 2, y - r * 0.75);
        ctx.stroke();
      }
    }

    // Island name label (also the click target visual).
    ctx.font = "bold 17px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(6, 22, 38, 0.85)";
    ctx.fillText(island.name, x, y + 6);
    ctx.restore();
  }

  drawWaitingDots(state) {
    const ctx = this.ctx;
    for (const island of ISLANDS) {
      const waiters = state.waitingByIsland[island.id] ?? [];
      waiters.slice(0, 8).forEach((p, i) => {
        const angle = -Math.PI / 2 + (i - (waiters.length - 1) / 2) * 0.42;
        const dx = island.x + Math.cos(angle) * (island.r + 16);
        const dy = island.y + Math.sin(angle) * (island.r + 16);
        ctx.beginPath();
        ctx.arc(dx, dy, 7, 0, Math.PI * 2);
        ctx.fillStyle = CONFIG.colors.dest[p.to];
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.8)";
        ctx.lineWidth = 1.4;
        ctx.stroke();
      });
    }
  }

  drawFerry(state) {
    const ctx = this.ctx;
    const { x, y, heading } = state.ferry;
    const bob = Math.sin(this.time * 3.2) * 2;
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.rotate(heading);

    // Wake.
    if (state.phase === "sailing") {
      ctx.fillStyle = "rgba(200, 235, 255, 0.18)";
      ctx.beginPath();
      ctx.moveTo(-18, -5);
      ctx.lineTo(-40 - Math.sin(this.time * 8) * 4, -10);
      ctx.lineTo(-34, 0);
      ctx.lineTo(-40, 10);
      ctx.lineTo(-18, 5);
      ctx.closePath();
      ctx.fill();
    }

    // Hull.
    ctx.beginPath();
    ctx.moveTo(22, 0);
    ctx.quadraticCurveTo(16, -11, -6, -11);
    ctx.lineTo(-18, -8);
    ctx.lineTo(-18, 8);
    ctx.lineTo(-6, 11);
    ctx.quadraticCurveTo(16, 11, 22, 0);
    ctx.closePath();
    const hull = ctx.createLinearGradient(-18, -11, 22, 11);
    hull.addColorStop(0, "#8c3b2e");
    hull.addColorStop(1, "#e07a52");
    ctx.fillStyle = hull;
    ctx.fill();
    ctx.strokeStyle = "#4d2018";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Cabin.
    ctx.fillStyle = "#f2efe6";
    ctx.fillRect(-8, -7, 14, 14);
    ctx.fillStyle = "#2f5d80";
    ctx.fillRect(-5, -5, 8, 4);
    ctx.fillRect(-5, 1, 8, 4);

    // Onboard passenger dots.
    const load = state.onboard.length;
    for (let i = 0; i < load; i++) {
      const px = -13 + (i % 2) * 9;
      const py = -12 - Math.floor(i / 2) * 8;
      ctx.beginPath();
      ctx.arc(px, py, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = CONFIG.colors.dest[state.onboard[i].to];
      ctx.fill();
    }
    ctx.restore();
  }
}
