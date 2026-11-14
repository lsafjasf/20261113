import {
  CARGO_SIZE,
  SLOT_CENTER_Y,
  SLOT_WIDTH,
  TARGETS,
  VIEW,
  WORLD,
} from "./config.js";

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - (1 - t) ** 3;

function roundedRect(ctx, x, y, w, h, radius = 0) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function seeded(seed) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function line(ctx, x1, y1, x2, y2, color, width = 1) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function mono(ctx, size, weight = 600) {
  ctx.font = `${weight} ${size}px "IBM Plex Mono", "Cascadia Mono", "Noto Sans SC Variable", monospace`;
}

function sans(ctx, size, weight = 700) {
  ctx.font = `${weight} ${size}px "Noto Sans SC Variable", "Noto Sans SC", "Microsoft YaHei", sans-serif`;
}

function cargoColor(id) {
  return TARGETS.find((target) => target.id === id)?.color ?? "#d8e6d6";
}

function lighten(hex, amount) {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, ((value >> 16) & 255) + Math.round(255 * amount));
  const g = Math.min(255, ((value >> 8) & 255) + Math.round(255 * amount));
  const b = Math.min(255, (value & 255) + Math.round(255 * amount));
  return `rgb(${r}, ${g}, ${b})`;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.particles = [];
    this.shake = 0;
    this.shakePhase = 0;
    this.flash = 0;
    this.hookFlash = 0;
    this.lastCarryId = null;
    const random = seeded(4127);
    this.stars = Array.from({ length: 48 }, () => ({
      x: random() * VIEW.width,
      y: 35 + random() * 280,
      size: 0.5 + random() * 1.5,
      alpha: 0.18 + random() * 0.5,
      phase: random() * TAU,
    }));
    this.motes = Array.from({ length: 34 }, () => ({
      x: random() * VIEW.width,
      y: 290 + random() * 520,
      speed: 18 + random() * 44,
      length: 8 + random() * 24,
      alpha: 0.03 + random() * 0.12,
    }));
  }

  update(dt) {
    this.shake = Math.max(0, this.shake - dt * 26);
    this.flash = Math.max(0, this.flash - dt * 3.2);
    this.hookFlash = Math.max(0, this.hookFlash - dt * 2.8);
    const windRatio = 0.7;
    for (const mote of this.motes) {
      mote.x += mote.speed * windRatio * dt;
      mote.y += 2.4 * dt;
      if (mote.x > VIEW.width + 40) mote.x = -40;
      if (mote.y > 850) mote.y = 300;
    }
    for (const particle of this.particles) {
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += (particle.gravity ?? 0) * dt;
      particle.vx *= Math.exp(-(particle.drag ?? 1.5) * dt);
    }
    this.particles = this.particles.filter((particle) => particle.life > 0);
  }

  burst(x, y, options = {}) {
    const count = options.count ?? 12;
    const color = options.color ?? "#ffd27a";
    for (let i = 0; i < count; i += 1) {
      const angle = (options.angle ?? -Math.PI / 2) + (Math.random() - 0.5) * (options.spread ?? 2.2);
      const speed = (options.speed ?? 90) * (0.35 + Math.random() * 0.9);
      this.particles.push({
        type: options.type ?? "spark",
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity: options.gravity ?? 220,
        drag: options.drag ?? 1.2,
        life: (options.life ?? 0.55) * (0.6 + Math.random() * 0.7),
        maxLife: options.life ?? 0.55,
        size: (options.size ?? 3) * (0.5 + Math.random()),
        color,
      });
    }
  }

  addImpact(x, y, hard) {
    this.burst(x, y, {
      count: hard ? 26 : 12,
      color: hard ? "#ff8b56" : "#d6b77a",
      speed: hard ? 210 : 100,
      life: hard ? 0.8 : 0.45,
      size: hard ? 4 : 2.4,
    });
    this.shake = Math.max(this.shake, hard ? 14 : 5);
  }

  addSplash(x) {
    this.burst(x, WORLD.waterY + 16, {
      count: 36,
      angle: -Math.PI / 2,
      spread: 1.5,
      speed: 245,
      gravity: 380,
      drag: 0.5,
      life: 1.15,
      size: 4,
      color: "#b8eef0",
    });
    this.shake = Math.max(this.shake, 9);
    this.flash = 0.55;
  }

  addSuccess(x, y, color) {
    for (let count = 0; count < 3; count += 1) {
      this.burst(x, y, {
        count: 10,
        angle: -Math.PI / 2 + (count - 1) * 0.7,
        spread: 0.6,
        speed: 120,
        gravity: 90,
        life: 0.9,
        size: 3,
        color,
      });
    }
  }

  draw(game, time, dt) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, VIEW.width, VIEW.height);
    ctx.save();
    if (this.shake > 0.2) {
      this.shakePhase += dt * 48;
      ctx.translate(
        Math.cos(this.shakePhase * 1.7) * this.shake * 0.45,
        Math.sin(this.shakePhase) * this.shake * 0.3,
      );
    }
    this.drawSky(time);
    this.drawSea(time);
    this.drawFarPort(time);
    this.drawQuay(time);
    this.drawShip(time, game);
    this.drawSlots(game, time);
    this.drawShadows(game, time);
    this.drawCrane(game, time, false);
    this.drawTrajectory(game);
    this.drawCargoes(game, time);
    this.drawCrane(game, time, true);
    this.drawWind(time, game);
    this.drawParticles();
    this.drawLampGlow(game, time);
    ctx.restore();
    this.drawHUD(game, time);
    this.drawFlash();
  }

  drawSky(time) {
    const ctx = this.ctx;
    const gradient = ctx.createLinearGradient(0, 0, 0, WORLD.horizonY);
    gradient.addColorStop(0, "#07141b");
    gradient.addColorStop(0.46, "#102a31");
    gradient.addColorStop(0.78, "#284b4e");
    gradient.addColorStop(1, "#816451");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, VIEW.width, WORLD.horizonY + 6);

    const glow = ctx.createRadialGradient(1274, 366, 20, 1274, 366, 430);
    glow.addColorStop(0, "rgba(240, 171, 104, 0.22)");
    glow.addColorStop(0.42, "rgba(205, 124, 82, 0.08)");
    glow.addColorStop(1, "rgba(4, 17, 22, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(760, 0, 840, 480);

    for (const star of this.stars) {
      ctx.globalAlpha = star.alpha * (0.65 + Math.sin(time * 0.8 + star.phase) * 0.35);
      ctx.fillStyle = "#e9e8cf";
      ctx.fillRect(star.x, star.y, star.size, star.size);
    }
    ctx.globalAlpha = 1;
    this.drawCloud(82, 170, 0.8, time, 0.004);
    this.drawCloud(470, 96, 0.52, time, 0.007);
    this.drawCloud(1040, 214, 0.7, time, 0.003);
  }

  drawCloud(x, y, scale, time, drift) {
    const ctx = this.ctx;
    const offset = (time * drift * 300) % 1700;
    const cloudX = ((x + offset + 200) % 1800) - 100;
    ctx.save();
    ctx.translate(cloudX, y);
    ctx.scale(scale, scale * 0.62);
    const gradient = ctx.createLinearGradient(0, -60, 0, 45);
    gradient.addColorStop(0, "rgba(80, 112, 112, 0.16)");
    gradient.addColorStop(1, "rgba(10, 31, 36, 0.02)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(-90, 0, 120, 32, 0, 0, TAU);
    ctx.ellipse(-28, -18, 120, 49, 0, 0, TAU);
    ctx.ellipse(84, -4, 128, 38, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawSea(time) {
    const ctx = this.ctx;
    const gradient = ctx.createLinearGradient(0, WORLD.horizonY, 0, VIEW.height);
    gradient.addColorStop(0, "#385650");
    gradient.addColorStop(0.17, "#153d43");
    gradient.addColorStop(0.56, "#082b35");
    gradient.addColorStop(1, "#04151e");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, WORLD.horizonY, VIEW.width, VIEW.height - WORLD.horizonY);

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (let row = 0; row < 18; row += 1) {
      const y = WORLD.horizonY + 9 + row * 24;
      const alpha = 0.025 + (row / 18) * 0.06;
      ctx.beginPath();
      for (let x = -20; x <= VIEW.width + 20; x += 16) {
        const wave = Math.sin(x * 0.018 + time * (0.7 + row * 0.02) + row * 0.76) * (2 + row * 0.25);
        if (x === -20) ctx.moveTo(x, y + wave);
        else ctx.lineTo(x, y + wave);
      }
      ctx.strokeStyle = `rgba(172, 224, 207, ${alpha})`;
      ctx.lineWidth = row > 11 ? 1.4 : 0.7;
      ctx.stroke();
    }
    ctx.restore();

    const horizon = ctx.createLinearGradient(0, WORLD.horizonY - 2, 0, WORLD.horizonY + 28);
    horizon.addColorStop(0, "rgba(255, 178, 113, 0.2)");
    horizon.addColorStop(1, "rgba(255, 178, 113, 0)");
    ctx.fillStyle = horizon;
    ctx.fillRect(0, WORLD.horizonY - 2, VIEW.width, 30);
  }

  drawFarPort(time) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(7, 24, 28, 0.62)";
    ctx.fillRect(0, WORLD.horizonY - 56, VIEW.width, 68);
    ctx.fillStyle = "#102c2e";
    for (let i = 0; i < 19; i += 1) {
      const x = 44 + i * 88;
      const width = 48 + ((i * 29) % 55);
      const height = 18 + ((i * 17) % 42);
      ctx.fillRect(x, WORLD.horizonY - height, width, height);
    }

    ctx.strokeStyle = "rgba(129, 158, 146, 0.28)";
    ctx.lineWidth = 2;
    for (let x = 260; x < 1400; x += 420) {
      const top = WORLD.horizonY - 125 - ((x / 10) % 35);
      line(ctx, x, WORLD.horizonY, x, top, "rgba(102, 137, 129, 0.24)", 3);
      line(ctx, x - 18, WORLD.horizonY, x - 42, top, "rgba(102, 137, 129, 0.24)", 1.5);
      line(ctx, x + 18, WORLD.horizonY, x + 52, top, "rgba(102, 137, 129, 0.24)", 1.5);
      line(ctx, x - 46, WORLD.horizonY, x + 58, top, "rgba(102, 137, 129, 0.22)", 2);
    }

    const glowX = 1240;
    const reflection = ctx.createLinearGradient(0, WORLD.horizonY, 0, 650);
    reflection.addColorStop(0, "rgba(255, 171, 98, 0.14)");
    reflection.addColorStop(1, "rgba(255, 171, 98, 0)");
    ctx.fillStyle = reflection;
    ctx.beginPath();
    ctx.moveTo(glowX - 44, WORLD.horizonY);
    ctx.lineTo(glowX + 50, WORLD.horizonY);
    ctx.lineTo(glowX + 160, 640);
    ctx.lineTo(glowX - 130, 640);
    ctx.fill();

    ctx.strokeStyle = "rgba(171, 189, 177, 0.4)";
    ctx.lineWidth = 1.5;
    const gullY = 208 + Math.sin(time * 0.4) * 8;
    for (let i = 0; i < 3; i += 1) {
      const x = 994 + i * 30 + Math.sin(time * 0.22 + i) * 7;
      ctx.beginPath();
      ctx.moveTo(x - 9, gullY + i * 5);
      ctx.quadraticCurveTo(x - 3, gullY - 4 + i * 5, x + 1, gullY + i * 5);
      ctx.quadraticCurveTo(x + 5, gullY - 4 + i * 5, x + 11, gullY + i * 5);
      ctx.stroke();
    }

    const haze = ctx.createLinearGradient(0, WORLD.horizonY - 40, 0, WORLD.horizonY + 18);
    haze.addColorStop(0, "rgba(206, 157, 114, 0)");
    haze.addColorStop(0.7, "rgba(217, 159, 111, 0.07)");
    haze.addColorStop(1, "rgba(217, 159, 111, 0)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, WORLD.horizonY - 40, VIEW.width, 58);
  }

  drawQuay(time) {
    const ctx = this.ctx;
    const quayGradient = ctx.createLinearGradient(0, WORLD.quayTop - 16, 0, VIEW.height);
    quayGradient.addColorStop(0, "#293435");
    quayGradient.addColorStop(0.25, "#182627");
    quayGradient.addColorStop(1, "#0c171b");
    ctx.fillStyle = quayGradient;
    ctx.beginPath();
    ctx.moveTo(0, WORLD.quayTop);
    ctx.lineTo(WORLD.quayRight, WORLD.quayTop);
    ctx.lineTo(WORLD.quayRight + 3, VIEW.height);
    ctx.lineTo(0, VIEW.height);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#64706a";
    ctx.fillRect(0, WORLD.quayTop - 2, WORLD.quayRight + 3, 4);
    ctx.fillStyle = "rgba(10, 19, 21, 0.48)";
    ctx.fillRect(0, WORLD.quayTop + 2, WORLD.quayRight + 3, 9);

    ctx.strokeStyle = "rgba(183, 193, 164, 0.055)";
    ctx.lineWidth = 2;
    for (let y = WORLD.quayTop + 24; y < VIEW.height; y += 44) {
      line(ctx, 0, y, WORLD.quayRight, y + 4, "rgba(183, 193, 164, 0.08)", 1);
    }
    for (let x = 40; x < WORLD.quayRight; x += 160) {
      line(ctx, x, WORLD.quayTop, x - 38, VIEW.height, "rgba(0, 0, 0, 0.13)", 1.5);
    }

    ctx.strokeStyle = "rgba(214, 187, 82, 0.5)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, WORLD.quayTop + 23);
    ctx.lineTo(WORLD.quayRight - 26, WORLD.quayTop + 23);
    ctx.stroke();
    ctx.strokeStyle = "rgba(8, 13, 15, 0.72)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([13, 13]);
    ctx.beginPath();
    ctx.moveTo(0, WORLD.quayTop + 23);
    ctx.lineTo(WORLD.quayRight - 26, WORLD.quayTop + 23);
    ctx.stroke();
    ctx.setLineDash([]);

    for (const x of [52, 318, 632, 842]) {
      this.drawBollard(x, WORLD.quayTop + 1);
    }

    const edgeGlow = ctx.createLinearGradient(WORLD.quayRight - 20, 0, WORLD.quayRight + 20, 0);
    edgeGlow.addColorStop(0, "rgba(126, 188, 173, 0.03)");
    edgeGlow.addColorStop(0.52, "rgba(193, 237, 216, 0.22)");
    edgeGlow.addColorStop(1, "rgba(126, 188, 173, 0)");
    ctx.fillStyle = edgeGlow;
    ctx.fillRect(WORLD.quayRight - 20, WORLD.quayTop - 9, 40, 270);

    const wave = Math.sin(time * 1.6) * 8;
    ctx.strokeStyle = "rgba(188, 232, 217, 0.12)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(WORLD.quayRight - 30 + wave, WORLD.quayTop + 30);
    ctx.bezierCurveTo(
      WORLD.quayRight + 38,
      WORLD.quayTop + 18,
      WORLD.quayRight + 26,
      WORLD.quayTop + 58,
      WORLD.quayRight + 80,
      WORLD.quayTop + 48,
    );
    ctx.stroke();
  }

  drawBollard(x, y) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
    ctx.beginPath();
    ctx.ellipse(8, 9, 20, 7, 0, 0, TAU);
    ctx.fill();
    const gradient = ctx.createLinearGradient(-9, 0, 12, 0);
    gradient.addColorStop(0, "#343f3d");
    gradient.addColorStop(0.45, "#81877a");
    gradient.addColorStop(1, "#242e2e");
    ctx.fillStyle = gradient;
    roundedRect(ctx, -10, -26, 20, 27, 7);
    ctx.fill();
    ctx.fillStyle = "#111b1d";
    ctx.fillRect(-7, -9, 14, 3);
    ctx.restore();
  }

  drawShip(time, game) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.17;
    ctx.fillStyle = "#02090c";
    ctx.beginPath();
    ctx.ellipse(1050, 818 + Math.sin(time * 1.1) * 3, 270, 42, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    const hull = ctx.createLinearGradient(0, WORLD.shipDeckY, 0, 820);
    hull.addColorStop(0, "#193638");
    hull.addColorStop(0.35, "#10282e");
    hull.addColorStop(0.86, "#0a1c23");
    hull.addColorStop(1, "#071319");
    ctx.fillStyle = hull;
    ctx.beginPath();
    ctx.moveTo(875, WORLD.shipDeckY - 7);
    ctx.lineTo(1362, WORLD.shipDeckY - 7);
    ctx.lineTo(1392, 762);
    ctx.quadraticCurveTo(1350, 812, 1288, 824);
    ctx.lineTo(944, 828);
    ctx.quadraticCurveTo(888, 810, 866, 775);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(138, 175, 163, 0.3)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(886, 783);
    ctx.bezierCurveTo(1010, 803, 1170, 795, 1275, 775);
    ctx.stroke();
    ctx.strokeStyle = "rgba(177, 72, 57, 0.65)";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(918, 814);
    ctx.lineTo(1290, 800);
    ctx.stroke();

    ctx.fillStyle = "#415652";
    ctx.fillRect(875, WORLD.shipDeckY - 9, 489, 8);
    ctx.fillStyle = "#1d2d2c";
    ctx.fillRect(875, WORLD.shipDeckY - 1, 489, 5);
    ctx.strokeStyle = "rgba(230, 205, 131, 0.36)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(884, WORLD.shipDeckY - 10);
    ctx.lineTo(1358, WORLD.shipDeckY - 10);
    ctx.stroke();

    for (let x = 890; x <= 1210; x += 55) {
      ctx.fillStyle = "rgba(7, 19, 23, 0.45)";
      ctx.fillRect(x, WORLD.shipDeckY - 8, 3, 6);
    }

    this.drawShipCabin(time, game);
    this.drawDeckRails();
    this.drawShipLights(time);
  }

  drawShipCabin(time, game) {
    const ctx = this.ctx;
    const x = 1282;
    const y = WORLD.shipDeckY - 132;
    ctx.fillStyle = "#13282c";
    roundedRect(ctx, x, y, 116, 126, 4);
    ctx.fill();
    ctx.fillStyle = "#203c3e";
    ctx.fillRect(x + 8, y - 8, 100, 10);
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        const lit = (row * 4 + col) % 5 === 0;
        ctx.fillStyle = lit ? "rgba(244, 191, 111, 0.65)" : "rgba(73, 118, 119, 0.34)";
        ctx.fillRect(x + 12 + col * 25, y + 15 + row * 27, 16, 12);
      }
    }
    ctx.fillStyle = "#0a171c";
    ctx.fillRect(x + 35, y - 46, 18, 46);
    ctx.strokeStyle = "rgba(130, 168, 156, 0.3)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 35, y - 64, 18, 18);
    if (game.phase === "playing") {
      ctx.fillStyle = "rgba(255, 89, 72, 0.65)";
      ctx.beginPath();
      ctx.arc(x + 54, y - 43, 3 + Math.sin(time * 2.2), 0, TAU);
      ctx.fill();
    }
  }

  drawDeckRails() {
    const ctx = this.ctx;
    ctx.strokeStyle = "rgba(151, 181, 167, 0.28)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(882, WORLD.shipDeckY - 34);
    ctx.lineTo(1247, WORLD.shipDeckY - 34);
    ctx.moveTo(882, WORLD.shipDeckY - 18);
    ctx.lineTo(1247, WORLD.shipDeckY - 18);
    ctx.stroke();
    for (let x = 884; x < 1245; x += 62) {
      line(ctx, x, WORLD.shipDeckY - 2, x, WORLD.shipDeckY - 36, "rgba(151, 181, 167, 0.28)", 2);
    }
  }

  drawShipLights(time) {
    const ctx = this.ctx;
    const pulse = 0.55 + Math.sin(time * 1.8) * 0.25;
    ctx.fillStyle = `rgba(211, 240, 166, ${pulse})`;
    ctx.beginPath();
    ctx.arc(880, WORLD.shipDeckY - 24, 3.2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = `rgba(255, 112, 82, ${pulse})`;
    ctx.beginPath();
    ctx.arc(1368, 711, 4, 0, TAU);
    ctx.fill();
    const glow = ctx.createRadialGradient(1368, 711, 1, 1368, 711, 26);
    glow.addColorStop(0, "rgba(255, 97, 76, 0.28)");
    glow.addColorStop(1, "rgba(255, 97, 76, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(1368, 711, 26, 0, TAU);
    ctx.fill();
  }

  drawSlots(game, time) {
    const ctx = this.ctx;
    const activeId = game.crane.carried?.id;
    for (const target of TARGETS) {
      const placed = game.crane.cargoes.find(
        (cargo) => cargo.state === "placed" && cargo.id === target.id,
      );
      const active = activeId === target.id;
      const x = target.x - SLOT_WIDTH / 2;
      const y = WORLD.quayTop - 48;
      if (active) {
        const glow = ctx.createRadialGradient(target.x, WORLD.quayTop, 8, target.x, WORLD.quayTop, 74);
        glow.addColorStop(0, `${target.color}48`);
        glow.addColorStop(0.5, `${target.color}18`);
        glow.addColorStop(1, `${target.color}00`);
        ctx.fillStyle = glow;
        ctx.fillRect(target.x - 82, y - 48, 164, 120);
      }
      ctx.fillStyle = "rgba(3, 13, 16, 0.62)";
      ctx.fillRect(x, y, SLOT_WIDTH, 50);
      ctx.strokeStyle = target.color;
      ctx.globalAlpha = active ? 0.95 : placed ? 0.22 : 0.52;
      ctx.lineWidth = active ? 2.5 : 1.5;
      ctx.strokeRect(x + 0.8, y + 0.8, SLOT_WIDTH - 1.6, 49);
      ctx.globalAlpha = 1;
      ctx.fillStyle = target.color;
      ctx.globalAlpha = active ? 0.78 : 0.36;
      ctx.fillRect(x + 5, y - 9, 16, 4);
      ctx.globalAlpha = 1;
      mono(ctx, 11, 700);
      ctx.fillStyle = active ? target.color : "rgba(179, 198, 188, 0.42)";
      ctx.fillText(`SLOT 0${target.id}`, x + 5, y - 14);
      ctx.fillStyle = "rgba(226, 235, 221, 0.32)";
      ctx.fillText(placed ? "SECURED" : "STORAGE", x + 5, y + 42);
      if (active && !placed) {
        const arrowY = y - 25 + Math.sin(time * 4) * 4;
        ctx.fillStyle = target.color;
        ctx.beginPath();
        ctx.moveTo(target.x, arrowY + 10);
        ctx.lineTo(target.x - 7, arrowY);
        ctx.lineTo(target.x + 7, arrowY);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  surfaceY(x) {
    if (x < WORLD.quayRight) return WORLD.quayTop + 2;
    if (x >= WORLD.shipLeft - 8 && x <= WORLD.shipRight + 8) return WORLD.shipDeckY + 2;
    return WORLD.waterY + 18;
  }

  drawShadows(game, time) {
    const ctx = this.ctx;
    for (const cargo of game.crane.cargoes) {
      if (cargo.state === "lost") continue;
      const floor = this.surfaceY(cargo.x);
      const height = Math.max(0, floor - cargo.y - cargo.height / 2);
      const fade = clamp(1 - height / 760, 0.26, 1);
      const scale = lerp(1.06, 0.42, clamp(height / 700, 0, 1));
      ctx.save();
      ctx.globalAlpha = 0.22 * fade;
      ctx.fillStyle = cargo.state === "carried" ? "#031014" : "#02090b";
      ctx.beginPath();
      ctx.ellipse(
        cargo.x + height * 0.045,
        floor + 2,
        cargo.width * 0.72 * scale,
        7.5 * scale,
        0,
        0,
        TAU,
      );
      ctx.fill();
      ctx.restore();
    }
    const hookFloor = this.surfaceY(game.crane.hook.x);
    const hookHeight = Math.max(0, hookFloor - game.crane.hook.y);
    ctx.save();
    ctx.globalAlpha = 0.12 * clamp(1 - hookHeight / 700, 0.2, 1);
    ctx.fillStyle = "#061014";
    ctx.beginPath();
    ctx.ellipse(game.crane.hook.x, hookFloor + 2, 12, 4, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawCrane(game, time, front) {
    const crane = game.crane;
    const pivot = { x: WORLD.pivotX, y: WORLD.pivotY };
    const ux = Math.cos(crane.angle);
    const uy = Math.sin(crane.angle);
    const nx = -uy;
    const ny = ux;
    if (!front) {
      this.drawCraneBase(time, game);
      this.drawBoom(pivot, ux, uy, nx, ny, time, game);
      this.drawCab(time, game);
    } else {
      this.drawTrolley(crane, pivot, ux, uy, nx, ny, time, game);
      this.drawCable(crane, time, game);
    }
  }

  drawCraneBase(time, game) {
    const ctx = this.ctx;
    const px = WORLD.pivotX;
    const py = WORLD.pivotY;
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
    ctx.beginPath();
    ctx.ellipse(158, 727, 96, 14, 0, 0, TAU);
    ctx.fill();

    const steel = ctx.createLinearGradient(104, 0, 216, 0);
    steel.addColorStop(0, "#131e20");
    steel.addColorStop(0.3, "#46514b");
    steel.addColorStop(0.55, "#8b865c");
    steel.addColorStop(0.8, "#313b39");
    steel.addColorStop(1, "#101a1d");
    ctx.fillStyle = steel;
    ctx.fillRect(104, 332, 108, 376);
    ctx.fillStyle = "#0d171a";
    ctx.fillRect(120, 348, 76, 354);
    ctx.strokeStyle = "#8b8556";
    ctx.lineWidth = 3;
    line(ctx, 120, 348, 142, py + 44, "#9b925c", 4);
    line(ctx, 196, 348, 174, py + 44, "#9b925c", 4);
    for (let y = 385; y < 710; y += 42) {
      line(ctx, 121, y, 195, y + 28, "#56563f", 2);
      line(ctx, 195, y, 121, y + 28, "#56563f", 2);
    }
    ctx.fillStyle = "#151f1f";
    ctx.fillRect(76, 706, 166, 22);
    ctx.fillStyle = "#c6a548";
    ctx.fillRect(76, 706, 166, 4);
    for (const x of [86, 150, 226]) {
      ctx.fillStyle = "#0a1113";
      ctx.beginPath();
      ctx.arc(x, 717, 14, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "rgba(182, 191, 155, 0.28)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(190, 205, 174, 0.26)";
    ctx.lineWidth = 2;
    for (let y = 368; y < 690; y += 30) {
      line(ctx, 209, y, 234, y - 18, "rgba(190, 205, 174, 0.25)", 2);
    }

    ctx.strokeStyle = "#c0a24e";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px - 2, 147);
    ctx.stroke();
    line(ctx, px - 2, 147, px - 40, 207, "#847a4c", 3);
    line(ctx, px - 2, 147, px + 30, 202, "#847a4c", 3);
    line(ctx, px - 2, 147, px + 228, py - 30, "rgba(190, 176, 110, 0.42)", 1.5);
    line(ctx, px - 2, 147, px - 154, py - 18, "rgba(190, 176, 110, 0.35)", 1.5);

    if (game.phase === "playing") {
      const pulse = 0.5 + Math.sin(time * 3.1) * 0.5;
      ctx.fillStyle = `rgba(255, 81, 62, ${0.45 + pulse * 0.4})`;
      ctx.beginPath();
      ctx.arc(px - 2, 144, 4.5, 0, TAU);
      ctx.fill();
      const glow = ctx.createRadialGradient(px - 2, 144, 1, px - 2, 144, 25);
      glow.addColorStop(0, `rgba(255, 74, 56, ${0.22 + pulse * 0.13})`);
      glow.addColorStop(1, "rgba(255, 74, 56, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(px - 2, 144, 25, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawBoom(pivot, ux, uy, nx, ny, time, game) {
    const ctx = this.ctx;
    const len = WORLD.boomLength;
    const top = { x: pivot.x, y: pivot.y };
    const tip = { x: pivot.x + ux * len, y: pivot.y + uy * len };
    ctx.save();
    ctx.lineCap = "butt";

    ctx.strokeStyle = "#161c1c";
    ctx.lineWidth = 29;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    ctx.strokeStyle = "#9b8540";
    ctx.lineWidth = 22;
    ctx.stroke();
    ctx.strokeStyle = "#d1ae54";
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(pivot.x + nx * 10, pivot.y + ny * 10);
    ctx.lineTo(tip.x + nx * 8, tip.y + ny * 8);
    ctx.stroke();

    ctx.lineWidth = 2;
    for (let s = 24; s < len - 16; s += 37) {
      const x = pivot.x + ux * s;
      const y = pivot.y + uy * s;
      const half = s < 160 ? 12 : 10;
      line(
        ctx,
        x + nx * half,
        y + ny * half,
        x + ux * 34 - nx * half,
        y + uy * 34 - ny * half,
        "rgba(48, 46, 27, 0.86)",
        2,
      );
      line(
        ctx,
        x - nx * half,
        y - ny * half,
        x + ux * 34 + nx * half,
        y + uy * 34 + ny * half,
        "rgba(48, 46, 27, 0.74)",
        1.5,
      );
    }

    ctx.fillStyle = "#202725";
    ctx.beginPath();
    ctx.arc(pivot.x, pivot.y, 17, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#d4ae50";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = "#b39143";
    ctx.beginPath();
    ctx.arc(pivot.x, pivot.y, 6, 0, TAU);
    ctx.fill();

    const counterLength = 160;
    const cx = pivot.x - ux * counterLength;
    const cy = pivot.y - uy * counterLength;
    ctx.strokeStyle = "#7b6e43";
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(pivot.x, pivot.y);
    ctx.lineTo(cx, cy);
    ctx.stroke();
    ctx.fillStyle = "#282d2a";
    ctx.strokeStyle = "#8a7844";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + nx * 26 - ux * 12, cy + ny * 26 - uy * 12);
    ctx.lineTo(cx - nx * 26 - ux * 12, cy - ny * 26 - uy * 12);
    ctx.lineTo(cx - nx * 26 + ux * 22, cy - ny * 26 + uy * 22);
    ctx.lineTo(cx + nx * 26 + ux * 22, cy + ny * 26 + uy * 22);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#d5ad4f";
    ctx.fillRect(cx - ux * 5 - 4, cy - uy * 5 - 4, 8, 8);

    const tipGlow = ctx.createRadialGradient(tip.x, tip.y, 2, tip.x, tip.y, 26);
    tipGlow.addColorStop(0, "rgba(229, 194, 105, 0.12)");
    tipGlow.addColorStop(1, "rgba(229, 194, 105, 0)");
    ctx.fillStyle = tipGlow;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 26, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawCab(time, game) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = "#1b2828";
    roundedRect(ctx, 53, 263, 101, 81, 5);
    ctx.fill();
    ctx.strokeStyle = "#a28a4d";
    ctx.lineWidth = 2;
    ctx.stroke();
    const windowGlow = ctx.createLinearGradient(64, 274, 142, 323);
    windowGlow.addColorStop(0, "rgba(157, 201, 178, 0.64)");
    windowGlow.addColorStop(1, "rgba(46, 94, 94, 0.5)");
    ctx.fillStyle = windowGlow;
    roundedRect(ctx, 65, 275, 77, 38, 3);
    ctx.fill();
    ctx.fillStyle = "rgba(12, 27, 29, 0.82)";
    ctx.beginPath();
    ctx.ellipse(119, 307, 15, 20, -0.2, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(119, 291, 9, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(218, 238, 208, 0.24)";
    ctx.lineWidth = 1.5;
    line(ctx, 65, 295, 142, 295, "rgba(218, 238, 208, 0.24)", 1.5);
    ctx.fillStyle = game.phase === "playing" ? "#d7ef73" : "#42584f";
    ctx.fillRect(67, 326, 20, 3);
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.fillRect(53, 334, 101, 5);
    ctx.restore();
  }

  drawTrolley(crane, pivot, ux, uy, nx, ny, time, game) {
    const ctx = this.ctx;
    const x = crane.anchor.x;
    const y = crane.anchor.y;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(crane.angle);
    ctx.fillStyle = "rgba(3, 9, 10, 0.28)";
    ctx.fillRect(-27, 14, 58, 10);
    ctx.fillStyle = "#202925";
    roundedRect(ctx, -31, -11, 62, 25, 4);
    ctx.fill();
    ctx.strokeStyle = "#9d8041";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#b9a259";
    ctx.fillRect(-34, 8, 68, 3);
    ctx.fillStyle = "#101718";
    for (const wheelX of [-18, 18]) {
      ctx.beginPath();
      ctx.arc(wheelX, -13, 7, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "rgba(200, 199, 155, 0.42)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      const spoke = time * 2;
      line(
        ctx,
        wheelX + Math.cos(spoke) * 4,
        -13 + Math.sin(spoke) * 4,
        wheelX - Math.cos(spoke) * 4,
        -13 - Math.sin(spoke) * 4,
        "rgba(200, 199, 155, 0.36)",
        1,
      );
    }
    ctx.fillStyle = "#709b78";
    ctx.fillRect(8, -5, 6, 5);
    if (crane.braking) {
      const pulse = 0.42 + Math.sin(time * 16) * 0.22;
      const hot = ctx.createRadialGradient(0, -18, 2, 0, -18, 42);
      hot.addColorStop(0, `rgba(255, 126, 51, ${pulse * 0.52})`);
      hot.addColorStop(1, "rgba(255, 90, 36, 0)");
      ctx.fillStyle = hot;
      ctx.beginPath();
      ctx.arc(0, -18, 42, 0, TAU);
      ctx.fill();
      ctx.fillStyle = `rgba(255, 162, 76, ${pulse})`;
      ctx.fillRect(-27, -17, 8, 3);
      ctx.fillRect(19, -17, 8, 3);
    }
    ctx.restore();

    const tipX = pivot.x + ux * WORLD.boomLength;
    const tipY = pivot.y + uy * WORLD.boomLength;
    ctx.strokeStyle = "rgba(176, 159, 101, 0.34)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.quadraticCurveTo(x + 10, y - 30, x, y);
    ctx.stroke();
  }

  drawCable(crane, time, game) {
    const ctx = this.ctx;
    const x1 = crane.anchor.x;
    const y1 = crane.anchor.y;
    const x2 = crane.hook.x;
    const y2 = crane.hook.y;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy) || 1;
    const px = -dy / length;
    const py = dx / length;
    const load = crane.carried?.weight ?? 0.2;
    const tension = clamp(1.35 - load * 0.46, 0.5, 1.1);
    const bend = (Math.sin(time * 2.2) * 2.2 + crane.wind * 0.23) * tension;
    const vibration = crane.braking && load > 1 ? Math.sin(time * 25) * 1.2 : 0;
    const cx1 = x1 + dx * 0.34 + px * (bend + vibration);
    const cy1 = y1 + dy * 0.34 + py * (bend + vibration);
    const cx2 = x1 + dx * 0.68 + px * (bend * 0.55 - vibration * 0.5);
    const cy2 = y1 + dy * 0.68 + py * (bend * 0.55 - vibration * 0.5);

    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(5, 8, 8, 0.9)";
    ctx.lineWidth = 5.2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(cx1, cy1, cx2, cy2, x2, y2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(197, 187, 131, 0.82)";
    ctx.lineWidth = 1.7;
    ctx.stroke();
    ctx.strokeStyle = "rgba(236, 230, 184, 0.32)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x1 - px * 1.6, y1 - py * 1.6);
    ctx.bezierCurveTo(cx1 - px * 1.6, cy1 - py * 1.6, cx2 - px * 1.6, cy2 - py * 1.6, x2, y2);
    ctx.stroke();
    ctx.setLineDash([4, 9]);
    ctx.strokeStyle = "rgba(221, 239, 191, 0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(cx1, cy1, cx2, cy2, x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
    this.drawHookBlock(crane, time, game);
    ctx.restore();
  }

  drawHookBlock(crane, time, game) {
    const ctx = this.ctx;
    const x = crane.hook.x;
    const y = crane.hook.y;
    const theta = crane.swingAngle;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(theta * 0.45);
    ctx.fillStyle = "#0b1213";
    roundedRect(ctx, -9, -19, 18, 25, 3);
    ctx.fill();
    ctx.strokeStyle = "#bba254";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#2d3530";
    ctx.beginPath();
    ctx.arc(0, -20, 7, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(227, 218, 166, 0.55)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.strokeStyle = "#c9b15e";
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(-5, 5);
    ctx.quadraticCurveTo(-12, 12, -5, 17);
    ctx.quadraticCurveTo(2, 21, 4, 13);
    ctx.stroke();
    if (crane.attachedId !== null) {
      ctx.fillStyle = cargoColor(crane.attachedId);
      ctx.globalAlpha = 0.9;
      ctx.fillRect(-11, 7, 22, 4);
      ctx.globalAlpha = 1;
    }
    if (this.hookFlash > 0) {
      const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 44);
      glow.addColorStop(0, `rgba(225, 250, 163, ${this.hookFlash * 0.62})`);
      glow.addColorStop(1, "rgba(225, 250, 163, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, 44, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawTrajectory(game) {
    const ctx = this.ctx;
    if (!game.trail?.length) return;
    for (let i = 0; i < game.trail.length; i += 1) {
      const point = game.trail[i];
      const progress = i / game.trail.length;
      ctx.globalAlpha = progress * 0.34;
      ctx.fillStyle = game.crane.carried ? game.crane.carried.color : "#dfe9d1";
      ctx.beginPath();
      ctx.arc(point.x, point.y, 1.5 + progress * 2.2, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const target = game.crane.carried
      ? TARGETS.find((slot) => slot.id === game.crane.carried.id)
      : null;
    if (!target) return;
    ctx.save();
    ctx.setLineDash([5, 10]);
    ctx.strokeStyle = `${target.color}3d`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(target.x, WORLD.shipDeckY - 26);
    ctx.lineTo(target.x, WORLD.quayTop - 60);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawCargoes(game, time) {
    const cargoes = [...game.crane.cargoes].sort((a, b) => {
      if (a.state === "carried") return 1;
      if (b.state === "carried") return -1;
      return a.y - b.y;
    });
    for (const cargo of cargoes) {
      if (cargo.state === "lost") continue;
      this.drawCargo(cargo, time, game);
    }
  }

  drawCargo(cargo, time, game) {
    const ctx = this.ctx;
    const target = TARGETS.find((slot) => slot.id === cargo.id);
    const selected = cargo.state === "staged" &&
      Math.hypot(
        game.crane.hook.x - cargo.x,
        game.crane.hook.y - (cargo.y - cargo.height / 2),
      ) < 58;
    const w = cargo.width;
    const h = cargo.height;
    ctx.save();
    ctx.translate(cargo.x, cargo.y);
    ctx.rotate(cargo.rotation || 0);
    if (selected) {
      ctx.shadowColor = target.color;
      ctx.shadowBlur = 16;
    }
    const body = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
    body.addColorStop(0, lighten(cargo.color, 0.22));
    body.addColorStop(0.34, cargo.color);
    body.addColorStop(1, cargo.dark);
    ctx.fillStyle = body;
    roundedRect(ctx, -w / 2, -h / 2, w, h, 3);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(5, 15, 18, 0.84)";
    ctx.lineWidth = 2;
    ctx.stroke();

    const top = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    top.addColorStop(0, "rgba(255, 255, 255, 0.28)");
    top.addColorStop(0.18, "rgba(255, 255, 255, 0.03)");
    top.addColorStop(1, "rgba(0, 0, 0, 0.2)");
    ctx.fillStyle = top;
    ctx.fillRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4);

    ctx.strokeStyle = "rgba(0, 0, 0, 0.2)";
    ctx.lineWidth = 1;
    for (let x = -w / 2 + 9; x < w / 2 - 4; x += 9) {
      line(ctx, x, -h / 2 + 5, x, h / 2 - 5, "rgba(0, 0, 0, 0.18)", 1);
    }
    ctx.fillStyle = "rgba(4, 11, 12, 0.76)";
    ctx.fillRect(-12, -9, 24, 18);
    ctx.strokeStyle = "rgba(237, 240, 210, 0.45)";
    ctx.lineWidth = 1;
    ctx.strokeRect(-12, -9, 24, 18);
    mono(ctx, 14, 800);
    ctx.fillStyle = "#f5f4dc";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(cargo.id), 0, 1);

    ctx.fillStyle = "rgba(5, 13, 15, 0.8)";
    for (const [cornerX, cornerY] of [
      [-w / 2 + 2, -h / 2 + 2],
      [w / 2 - 10, -h / 2 + 2],
      [-w / 2 + 2, h / 2 - 8],
      [w / 2 - 10, h / 2 - 8],
    ]) {
      ctx.fillRect(cornerX, cornerY, 8, 5);
    }
    mono(ctx, 6.5, 700);
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(240, 242, 214, 0.72)";
    ctx.fillText(`${(cargo.weight * 12.4).toFixed(1)}T`, -w / 2 + 5, h / 2 - 5);
    ctx.textAlign = "right";
    ctx.fillText(`X${cargo.id}`, w / 2 - 5, h / 2 - 5);

    if (cargo.state === "placed") {
      ctx.strokeStyle = "rgba(208, 242, 171, 0.8)";
      ctx.lineWidth = 2;
      ctx.strokeRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8);
    }
    if (cargo.state === "carried") {
      const strap = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      strap.addColorStop(0, "rgba(245, 225, 150, 0)");
      strap.addColorStop(0.5, `rgba(245, 225, 150, ${0.48 + Math.sin(time * 4) * 0.08})`);
      strap.addColorStop(1, "rgba(245, 225, 150, 0)");
      ctx.fillStyle = strap;
      ctx.fillRect(-w / 2, -h / 2 - 2, w, 3);
    }
    if (cargo.landedWrong) {
      ctx.fillStyle = "rgba(255, 91, 74, 0.9)";
      ctx.beginPath();
      ctx.arc(w / 2 - 5, -h / 2 + 5, 3, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawWind(time, game) {
    const ctx = this.ctx;
    const strength = clamp(Math.abs(game.crane.wind) / 76, 0.18, 1.2);
    ctx.save();
    ctx.lineCap = "round";
    for (const mote of this.motes) {
      const alpha = mote.alpha * (0.5 + strength * 0.55);
      const x = mote.x;
      const y = mote.y;
      const lineLength = mote.length * (0.5 + strength * 0.8);
      ctx.strokeStyle = `rgba(198, 226, 213, ${alpha})`;
      ctx.lineWidth = 0.8 + strength * 0.7;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - lineLength, y + 1.5);
      ctx.stroke();
    }

    for (let i = 0; i < 8; i += 1) {
      const x = 1060 + i * 62 + ((time * 22) % 62);
      const y = 733 + (i % 3) * 13;
      ctx.strokeStyle = `rgba(194, 235, 224, ${0.03 + strength * 0.035})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 12, y - 4, x + 25, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawParticles() {
    const ctx = this.ctx;
    for (const particle of this.particles) {
      const alpha = clamp(particle.life / Math.max(particle.maxLife * 0.7, 0.01), 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(particle.x, particle.y);
      if (particle.type === "spark") {
        ctx.strokeStyle = particle.color;
        ctx.lineWidth = Math.max(0.8, particle.size * 0.55);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-particle.vx * 0.025, -particle.vy * 0.025);
        ctx.stroke();
      } else {
        ctx.fillStyle = particle.color;
        ctx.beginPath();
        ctx.arc(0, 0, particle.size * (0.5 + alpha), 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawLampGlow(game, time) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const cabin = ctx.createRadialGradient(103, 305, 4, 103, 305, 210);
    cabin.addColorStop(0, "rgba(190, 205, 139, 0.12)");
    cabin.addColorStop(0.55, "rgba(142, 166, 119, 0.035)");
    cabin.addColorStop(1, "rgba(142, 166, 119, 0)");
    ctx.fillStyle = cabin;
    ctx.fillRect(0, 140, 460, 590);

    const target = game.crane.carried
      ? TARGETS.find((slot) => slot.id === game.crane.carried.id)
      : null;
    if (target) {
      const pulse = 0.65 + Math.sin(time * 3.2) * 0.18;
      const glow = ctx.createRadialGradient(
        target.x,
        WORLD.quayTop - 18,
        4,
        target.x,
        WORLD.quayTop - 18,
        96,
      );
      glow.addColorStop(0, `${target.color}2e`);
      glow.addColorStop(1, `${target.color}00`);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = glow;
      ctx.fillRect(target.x - 100, WORLD.quayTop - 120, 200, 130);
    }
    const stern = ctx.createRadialGradient(1368, 711, 2, 1368, 711, 90);
    stern.addColorStop(0, "rgba(255, 101, 69, 0.09)");
    stern.addColorStop(1, "rgba(255, 101, 69, 0)");
    ctx.globalAlpha = 1;
    ctx.fillStyle = stern;
    ctx.fillRect(1270, 590, 210, 220);
    ctx.restore();
  }

  drawHUD(game, time) {
    const ctx = this.ctx;
    ctx.save();
    this.drawBrandPanel(game);
    this.drawTimerPanel(game, time);
    this.drawStatusPanel(game, time);
    this.drawPlanPanel(game, time);
    this.drawTelemetryPanel(game);
    if (game.phase === "playing" && game.timeLeft < 20) {
      const pulse = 0.5 + Math.sin(time * 5.5) * 0.5;
      const vignette = ctx.createRadialGradient(800, 460, 300, 800, 460, 780);
      vignette.addColorStop(0, "rgba(255, 54, 43, 0)");
      vignette.addColorStop(0.75, "rgba(255, 54, 43, 0)");
      vignette.addColorStop(1, `rgba(225, 48, 38, ${0.1 + pulse * 0.08})`);
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    }
    ctx.restore();
  }

  panel(x, y, w, h, accent = "rgba(173, 214, 200, 0.18)") {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(5, 17, 22, 0.76)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = accent;
    ctx.fillRect(x, y, 3, h);
  }

  drawBrandPanel(game) {
    const ctx = this.ctx;
    this.panel(28, 24, 396, 111, "rgba(216, 240, 107, 0.38)");
    mono(ctx, 10, 700);
    ctx.fillStyle = "#d8f06b";
    ctx.fillText("TIDEWORKS / BERTH 06", 48, 47);
    sans(ctx, 31, 900);
    ctx.fillStyle = "#edf4e8";
    ctx.fillText("潮汐吊装", 46, 83);
    mono(ctx, 9, 500);
    ctx.fillStyle = "rgba(174, 199, 189, 0.62)";
    const status = game.phase === "playing" ? "NIGHT SHIFT ACTIVE" : game.phase.toUpperCase();
    ctx.fillText(`${status}  ·  WIND ${(Math.abs(game.crane.wind) / 8).toFixed(1)} M/S`, 48, 108);
    ctx.fillStyle = game.phase === "playing" ? "#d8f06b" : "#7b8d84";
    ctx.beginPath();
    ctx.arc(406, 43, 3.3, 0, TAU);
    ctx.fill();
  }

  drawTimerPanel(game, time) {
    const ctx = this.ctx;
    const seconds = Math.max(0, Math.ceil(game.timeLeft));
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    const label = `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
    const danger = game.phase === "playing" && game.timeLeft < 20;
    this.panel(655, 24, 290, 111, danger ? "rgba(255, 98, 94, 0.55)" : "rgba(173, 214, 200, 0.2)");
    mono(ctx, 9, 700);
    ctx.fillStyle = danger ? "#ff8176" : "rgba(190, 211, 199, 0.68)";
    ctx.textAlign = "center";
    ctx.fillText("SHIFT CLOCK", 800, 46);
    mono(ctx, 49, 800);
    ctx.fillStyle = danger
      ? `rgba(255, ${112 + Math.sin(time * 8) * 22}, 101, 1)`
      : "#f1f2d9";
    ctx.fillText(label, 800, 89);
    const ratio = clamp(game.timeLeft / game.totalTime, 0, 1);
    ctx.fillStyle = "rgba(121, 139, 128, 0.22)";
    ctx.fillRect(683, 112, 234, 4);
    ctx.fillStyle = danger ? "#ff625e" : "#d8f06b";
    ctx.fillRect(683, 112, 234 * ratio, 4);
    ctx.textAlign = "left";
  }

  drawStatusPanel(game, time) {
    const ctx = this.ctx;
    const integrity = clamp(game.durability, 0, 100);
    const low = integrity <= 35;
    this.panel(1170, 24, 402, 111, low ? "rgba(255, 98, 94, 0.48)" : "rgba(173, 214, 200, 0.2)");
    mono(ctx, 9, 700);
    ctx.fillStyle = low ? "#ff8e7d" : "rgba(190, 211, 199, 0.7)";
    ctx.fillText("CRANE INTEGRITY", 1190, 47);
    mono(ctx, 22, 800);
    ctx.fillStyle = low ? "#ff7166" : "#e9f0da";
    ctx.textAlign = "right";
    ctx.fillText(`${Math.round(integrity)}%`, 1552, 48);
    ctx.textAlign = "left";
    const segments = 12;
    const segmentWidth = 330 / segments;
    for (let i = 0; i < segments; i += 1) {
      const filled = integrity / 100 > i / segments;
      ctx.fillStyle = filled
        ? (low ? "#e76151" : i < 8 ? "#c7dd59" : "#e8a94f")
        : "rgba(124, 147, 133, 0.18)";
      ctx.fillRect(1190 + i * segmentWidth, 59, segmentWidth - 3, 9);
    }
    const strikes = game.impactStrikes ?? 0;
    mono(ctx, 9, 600);
    ctx.fillStyle = "rgba(178, 199, 188, 0.58)";
    ctx.fillText("HARD IMPACT", 1190, 91);
    for (let i = 0; i < 3; i += 1) {
      const active = i < strikes;
      ctx.fillStyle = active ? "#ff6158" : "rgba(255, 97, 88, 0.14)";
      ctx.beginPath();
      ctx.moveTo(1282 + i * 17, 85);
      ctx.lineTo(1289 + i * 17, 92);
      ctx.lineTo(1282 + i * 17, 99);
      ctx.lineTo(1275 + i * 17, 92);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "rgba(116, 145, 132, 0.3)";
    ctx.fillRect(1364, 78, 1, 24);
    const wind = Math.abs(game.crane.wind);
    const angle = -0.2 + clamp(wind / 110, 0, 1) * 0.35;
    const arrowX = 1414;
    const arrowY = 90;
    ctx.save();
    ctx.translate(arrowX, arrowY);
    ctx.rotate(angle);
    ctx.strokeStyle = "#bfe8d3";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-18, 0);
    ctx.lineTo(13, 0);
    ctx.lineTo(5, -6);
    ctx.moveTo(13, 0);
    ctx.lineTo(5, 6);
    ctx.stroke();
    ctx.restore();
    mono(ctx, 12, 700);
    ctx.fillStyle = "#dce9d6";
    ctx.fillText(`${(wind / 8).toFixed(1)}`, 1444, 94);
    mono(ctx, 8, 500);
    ctx.fillStyle = "rgba(181, 202, 190, 0.5)";
    ctx.fillText("M/S", 1471, 94);
    ctx.fillText("SIDE WIND", 1414, 111);
    const gust = clamp((wind - 45) / 40, 0, 1);
    ctx.fillStyle = "rgba(95, 120, 111, 0.22)";
    ctx.fillRect(1516, 84, 38, 5);
    ctx.fillStyle = gust > 0.35 ? "#ff9d54" : "#91d4b7";
    ctx.fillRect(1516, 84, 38 * gust, 5);
  }

  drawPlanPanel(game, time) {
    const ctx = this.ctx;
    this.panel(28, 752, 365, 122, "rgba(216, 240, 107, 0.2)");
    mono(ctx, 9, 700);
    ctx.fillStyle = "rgba(193, 213, 199, 0.66)";
    ctx.fillText("LOAD PLAN / 06", 47, 775);
    TARGETS.forEach((target, index) => {
      const delivered = game.crane.cargoes.some(
        (cargo) => cargo.id === target.id && cargo.state === "placed",
      );
      const x = 49 + index * 54;
      ctx.fillStyle = delivered ? target.color : "rgba(70, 89, 81, 0.26)";
      roundedRect(ctx, x, 789, 40, 20, 2);
      ctx.fill();
      ctx.strokeStyle = delivered ? target.color : "rgba(183, 204, 190, 0.2)";
      ctx.lineWidth = 1;
      ctx.stroke();
      mono(ctx, 9, 700);
      ctx.fillStyle = delivered ? "#0d1a18" : "rgba(201, 217, 205, 0.48)";
      ctx.textAlign = "center";
      ctx.fillText(delivered ? "✓" : `0${target.id}`, x + 20, 803);
      ctx.textAlign = "left";
    });
    this.drawControlBadge(49, 823, "A", "D", game.input.left || game.input.right, "旋转吊臂");
    this.drawControlBadge(49, 848, "W", "S", game.input.forward || game.input.back, "移动小车");
    this.drawSpaceBadge(249, 846, game.input.down);
  }

  drawControlBadge(x, y, left, right, active, label) {
    const ctx = this.ctx;
    for (const [key, offset] of [[left, 0], [right, 29]]) {
      ctx.fillStyle = active ? "#d8f06b" : "rgba(211, 225, 209, 0.1)";
      roundedRect(ctx, x + offset, y, 25, 19, 2);
      ctx.fill();
      ctx.strokeStyle = active ? "rgba(216, 240, 107, 0.75)" : "rgba(197, 219, 202, 0.25)";
      ctx.stroke();
      mono(ctx, 9, 800);
      ctx.fillStyle = active ? "#101b18" : "rgba(229, 239, 221, 0.8)";
      ctx.textAlign = "center";
      ctx.fillText(key, x + offset + 12.5, y + 13);
    }
    mono(ctx, 8, 600);
    ctx.fillStyle = "rgba(184, 204, 192, 0.66)";
    ctx.textAlign = "left";
    ctx.fillText(label, x + 62, y + 13);
  }

  drawSpaceBadge(x, y, active) {
    const ctx = this.ctx;
    ctx.fillStyle = active ? "#d8f06b" : "rgba(211, 225, 209, 0.1)";
    roundedRect(ctx, x, y, 66, 19, 2);
    ctx.fill();
    ctx.strokeStyle = active ? "rgba(216, 240, 107, 0.75)" : "rgba(197, 219, 202, 0.25)";
    ctx.stroke();
    mono(ctx, 8, 800);
    ctx.fillStyle = active ? "#101b18" : "rgba(229, 239, 221, 0.8)";
    ctx.textAlign = "center";
    ctx.fillText("SPACE", x + 33, y + 13);
    ctx.textAlign = "left";
  }

  drawTelemetryPanel(game) {
    const ctx = this.ctx;
    const crane = game.crane;
    this.panel(1172, 752, 400, 122, "rgba(129, 189, 168, 0.2)");
    mono(ctx, 9, 700);
    ctx.fillStyle = "rgba(188, 211, 197, 0.68)";
    ctx.fillText("LIVE TELEMETRY", 1192, 775);
    const brake = crane.braking || crane.slewBraking;
    ctx.textAlign = "right";
    ctx.fillStyle = brake ? "#ff9d54" : "rgba(159, 205, 184, 0.74)";
    ctx.fillText(brake ? "BRAKE ENGAGED" : "MOTOR CRUISE", 1551, 775);
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(114, 142, 129, 0.22)";
    ctx.fillRect(1192, 784, 359, 5);
    ctx.fillStyle = brake ? "#ff9d54" : "#9edcb8";
    ctx.fillRect(1192, 784, 359 * crane.motorLoad, 5);
    mono(ctx, 19, 700);
    ctx.fillStyle = "#e2ecdb";
    ctx.fillText(`${Math.round(crane.motorLoad * 100)}%`, 1192, 817);
    mono(ctx, 9, 500);
    ctx.fillStyle = "rgba(167, 194, 179, 0.5)";
    ctx.fillText("MOTOR LOAD", 1268, 815);
    const sway = Math.abs(crane.swingAngle) * 180 / Math.PI;
    ctx.textAlign = "right";
    mono(ctx, 18, 700);
    ctx.fillStyle = crane.swingAngle > 0.12 || crane.swingAngle < -0.12 ? "#ffc26e" : "#e2ecdb";
    ctx.fillText(`${sway.toFixed(1)}°`, 1550, 817);
    ctx.textAlign = "left";
    mono(ctx, 8, 500);
    ctx.fillStyle = "rgba(167, 194, 179, 0.5)";
    ctx.fillText("HOOK SWAY", 1455, 815);
    ctx.fillStyle = "rgba(126, 153, 139, 0.22)";
    ctx.fillRect(1192, 830, 359, 1);
    mono(ctx, 9, 600);
    ctx.fillStyle = "rgba(183, 205, 191, 0.62)";
    ctx.fillText(`TROLLEY  ${(Math.abs(crane.trolleyVelocity) / 22).toFixed(1)} M/S`, 1192, 853);
    ctx.fillText(`SWING V  ${(crane.swingVelocity * 18).toFixed(1)}`, 1340, 853);
    const load = crane.carried;
    ctx.fillStyle = load ? load.color : "rgba(183, 205, 191, 0.35)";
    ctx.fillText(load ? `LOAD 0${load.id} / ${(load.weight * 12.4).toFixed(1)}T` : "LOAD / EMPTY", 1192, 869);
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(183, 205, 191, 0.5)";
    ctx.fillText(game.input.down ? "PAY OUT" : "REEL IN", 1550, 869);
    ctx.textAlign = "left";
  }

  drawFlash() {
    if (this.flash <= 0) return;
    const ctx = this.ctx;
    ctx.fillStyle = `rgba(190, 238, 236, ${this.flash * 0.18})`;
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
  }
}
