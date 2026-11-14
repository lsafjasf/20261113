import { OVERHEAT_LIMIT, stageForGrowth } from "./simulation.js";

const WIDTH = 1200;
const HEIGHT = 660;
const COLUMNS = [32, 430, 828];
const ROWS = [
  { y: 350, height: 142 },
  { y: 511, height: 120 },
];

const BED_RECTS = COLUMNS.flatMap((x, columnIndex) =>
  ROWS.map((row, rowIndex) => {
    const index = columnIndex * 2 + rowIndex;
    return {
      index,
      x,
      y: row.y,
      width: 340,
      height: row.height,
    };
  }),
);

const CONTROL_LABELS = {
  irrigation: "I",
  heating: "H",
  ventilation: "V",
  shade: "S",
};

const CONTROL_COLORS = {
  irrigation: "#72d7ea",
  heating: "#ff9b5d",
  ventilation: "#a5e6bd",
  shade: "#d3bf82",
};

const easeOut = (value) => 1 - Math.pow(1 - Math.max(0, Math.min(1, value)), 2.4);
const lerp = (from, to, amount) => from + (to - from) * amount;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class GreenhouseRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.bedRects = BED_RECTS;
    this.dpr = 1;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = WIDTH * this.dpr;
    this.canvas.height = HEIGHT * this.dpr;
  }

  bedAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * WIDTH;
    const y = ((clientY - rect.top) / rect.height) * HEIGHT;
    return this.bedRects.find(
      (bed) => x >= bed.x && x <= bed.x + bed.width && y >= bed.y && y <= bed.y + bed.height,
    )?.index;
  }

  draw(game, selectedIndex, phase, now = performance.now()) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.save();

    this.drawSky(game, now);
    this.drawOutdoorWeather(game, now);
    this.drawGlasshouse(game, now);
    this.drawInterior(game, now);
    this.drawLight(game, now);
    this.drawEquipment(game, now);

    game.beds.forEach((bed, index) => {
      this.drawBed(bed, this.bedRects[index], index === selectedIndex, game, now);
    });

    this.drawForegroundWeather(game, now);
    this.drawAtmosphere(game, now);
    this.drawSceneDetails(game, phase, now);
    ctx.restore();
  }

  drawSky(game, now) {
    const ctx = this.ctx;
    const sky = ctx.createLinearGradient(0, 0, 0, 330);
    if (game.weather.type === "cold") {
      sky.addColorStop(0, "#102b3b");
      sky.addColorStop(0.6, "#193b47");
      sky.addColorStop(1, "#293e3c");
    } else if (game.weather.type === "heat") {
      sky.addColorStop(0, "#251b16");
      sky.addColorStop(0.6, "#39271c");
      sky.addColorStop(1, "#2f3424");
    } else if (game.weather.type === "cloud") {
      sky.addColorStop(0, "#182728");
      sky.addColorStop(0.65, "#253532");
      sky.addColorStop(1, "#35463b");
    } else {
      sky.addColorStop(0, "#0c272c");
      sky.addColorStop(0.52, "#173d3b");
      sky.addColorStop(1, "#40513a");
    }
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const halo = ctx.createRadialGradient(965, 66, 4, 965, 66, 200);
    if (game.weather.type === "clear") {
      halo.addColorStop(0, "rgba(255, 222, 151, 0.42)");
      halo.addColorStop(0.16, "rgba(255, 209, 122, 0.12)");
    } else if (game.weather.type === "cold") {
      halo.addColorStop(0, "rgba(155, 227, 255, 0.17)");
      halo.addColorStop(0.16, "rgba(125, 207, 238, 0.05)");
    } else if (game.weather.type === "heat") {
      halo.addColorStop(0, "rgba(255, 137, 86, 0.28)");
      halo.addColorStop(0.16, "rgba(255, 107, 72, 0.07)");
    } else {
      halo.addColorStop(0, "rgba(188, 207, 198, 0.1)");
      halo.addColorStop(0.16, "rgba(188, 207, 198, 0.025)");
    }
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, WIDTH, 330);

    if (game.weather.type === "clear" || game.weather.type === "heat") {
      ctx.save();
      ctx.translate(965, 66);
      ctx.rotate(now * 0.000035);
      ctx.strokeStyle =
        game.weather.type === "heat" ? "rgba(255, 174, 112, 0.16)" : "rgba(255, 224, 156, 0.14)";
      ctx.lineWidth = 1;
      for (let index = 0; index < 12; index += 1) {
        const angle = (index / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * 44, Math.sin(angle) * 44);
        ctx.lineTo(Math.cos(angle) * 82, Math.sin(angle) * 82);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawOutdoorWeather(game, now) {
    const ctx = this.ctx;
    const weather = game.weather.type;

    if (weather === "clear") {
      this.drawStars(now);
      ctx.fillStyle = "#f3d78c";
      ctx.beginPath();
      ctx.ellipse(965, 66, 17, 17, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 241, 185, 0.55)";
      ctx.beginPath();
      ctx.arc(960, 60, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (weather === "cloud" || weather === "cold") {
      const drift = (now * 0.006) % (WIDTH + 300);
      this.drawCloud(160 + drift * 0.34, 86, 1, weather === "cold" ? "#899ca1" : "#748686");
      this.drawCloud(890 - drift * 0.22, 52, 0.72, weather === "cold" ? "#a2b6b9" : "#8a9997");
      this.drawCloud(530 + drift * 0.12, 138, 0.48, weather === "cold" ? "#72888d" : "#697b7b");
    }

    if (weather === "cold") {
      for (let index = 0; index < 48; index += 1) {
        const speed = 7 + (index % 7) * 1.5;
        const x = ((index * 173 + now * 0.022 * speed) % (WIDTH + 40)) - 20;
        const y = ((index * 83 + now * 0.018 * speed) % 300) + 8;
        ctx.fillStyle = `rgba(201, 242, 250, ${0.16 + (index % 5) * 0.045})`;
        ctx.beginPath();
        ctx.arc(x, y, 0.9 + (index % 3) * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (weather === "heat") {
      ctx.save();
      ctx.strokeStyle = "rgba(255, 145, 93, 0.13)";
      ctx.lineWidth = 1.2;
      for (let index = 0; index < 6; index += 1) {
        const y = 34 + index * 32;
        ctx.beginPath();
        for (let x = 20; x <= WIDTH - 20; x += 16) {
          const wave = Math.sin(x * 0.035 + now * 0.002 + index) * 3;
          if (x === 20) ctx.moveTo(x, y + wave);
          else ctx.lineTo(x, y + wave);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawStars(now) {
    const ctx = this.ctx;
    for (let index = 0; index < 40; index += 1) {
      const x = (index * 241) % WIDTH;
      const y = 15 + ((index * 59) % 245);
      if (x > 70 && x < 1130 && y > 55 && y < 300) continue;
      const twinkle = 0.18 + (Math.sin(now * 0.001 + index) + 1) * 0.09;
      ctx.fillStyle = `rgba(211, 231, 210, ${twinkle})`;
      ctx.beginPath();
      ctx.arc(x, y, 0.8 + (index % 3) * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawCloud(x, y, scale, color) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.15;
    ctx.beginPath();
    ctx.ellipse(0, 24, 94, 27, 0, 0, Math.PI * 2);
    ctx.ellipse(-48, 11, 44, 29, 0, 0, Math.PI * 2);
    ctx.ellipse(4, 0, 57, 37, 0, 0, Math.PI * 2);
    ctx.ellipse(57, 15, 42, 25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawGlasshouse(game, now) {
    const ctx = this.ctx;
    const glassPath = new Path2D();
    glassPath.moveTo(18, 322);
    glassPath.lineTo(64, 111);
    glassPath.lineTo(600, 17);
    glassPath.lineTo(1136, 111);
    glassPath.lineTo(1182, 322);
    glassPath.closePath();

    const glass = ctx.createLinearGradient(200, 20, 900, 320);
    glass.addColorStop(0, "rgba(101, 149, 132, 0.13)");
    glass.addColorStop(0.5, "rgba(65, 114, 102, 0.07)");
    glass.addColorStop(1, "rgba(27, 64, 52, 0.1)");
    ctx.fillStyle = glass;
    ctx.fill(glassPath);

    ctx.save();
    ctx.clip(glassPath);
    ctx.strokeStyle = "rgba(193, 225, 202, 0.075)";
    ctx.lineWidth = 1;
    for (let x = 80; x < WIDTH; x += 118) {
      const roofY = x < 600 ? lerp(111, 17, (x - 64) / 536) : lerp(17, 111, (x - 600) / 536);
      ctx.beginPath();
      ctx.moveTo(x, roofY);
      ctx.lineTo(x, 322);
      ctx.stroke();
    }
    for (let y = 137; y < 322; y += 47) {
      const left = y < 111 ? 64 + 536 * ((111 - y) / 94) : 18;
      const right = y < 111 ? 600 + 536 * ((y - 17) / 94) : 1182;
      ctx.beginPath();
      ctx.moveTo(Math.max(18, left), y);
      ctx.lineTo(Math.min(1182, right), y);
      ctx.stroke();
    }

    const reflection = ctx.createLinearGradient(80, 50, 430, 300);
    reflection.addColorStop(0, "rgba(210, 241, 225, 0.045)");
    reflection.addColorStop(0.5, "rgba(210, 241, 225, 0.005)");
    reflection.addColorStop(1, "rgba(210, 241, 225, 0)");
    ctx.fillStyle = reflection;
    ctx.beginPath();
    ctx.moveTo(130, 320);
    ctx.lineTo(360, 85);
    ctx.lineTo(470, 81);
    ctx.lineTo(265, 320);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "rgba(160, 198, 173, 0.38)";
    ctx.lineWidth = 4;
    ctx.stroke(glassPath);
    ctx.strokeStyle = "rgba(195, 225, 199, 0.36)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(18, 322);
    ctx.lineTo(64, 111);
    ctx.lineTo(600, 17);
    ctx.lineTo(1136, 111);
    ctx.lineTo(1182, 322);
    ctx.stroke();

    ctx.fillStyle = "rgba(9, 21, 16, 0.9)";
    ctx.fillRect(18, 316, 1164, 12);
    ctx.strokeStyle = "rgba(172, 210, 177, 0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(18, 328);
    ctx.lineTo(1182, 328);
    ctx.stroke();

    this.drawRoofVent(game, now);
  }

  drawRoofVent(game, now) {
    const ctx = this.ctx;
    const active = game.beds.some((bed) => bed.controls.ventilation);
    ctx.save();
    ctx.translate(600, 21);
    ctx.rotate(active ? -0.2 : -0.05);
    ctx.fillStyle = "rgba(12, 29, 23, 0.95)";
    ctx.strokeStyle = active ? "rgba(165, 230, 189, 0.58)" : "rgba(165, 195, 172, 0.28)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-42, -12, 84, 23, 5);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "rgba(188, 221, 193, 0.18)";
    ctx.lineWidth = 1;
    for (let x = -31; x <= 31; x += 10) {
      ctx.beginPath();
      ctx.moveTo(x, -7);
      ctx.lineTo(x, 7);
      ctx.stroke();
    }
    if (active) {
      ctx.strokeStyle = "rgba(181, 239, 198, 0.28)";
      for (let index = 0; index < 3; index += 1) {
        const offset = ((now * 0.025 + index * 17) % 33) + 4;
        ctx.beginPath();
        ctx.moveTo(-28 + index * 27, -20 - offset);
        ctx.quadraticCurveTo(-24 + index * 27, -30 - offset, -18 + index * 27, -38 - offset);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawInterior(game, now) {
    const ctx = this.ctx;
    const wall = ctx.createLinearGradient(0, 312, 0, HEIGHT);
    wall.addColorStop(0, "#263b2d");
    wall.addColorStop(0.35, "#213629");
    wall.addColorStop(1, "#15271d");
    ctx.fillStyle = wall;
    ctx.fillRect(18, 328, 1164, HEIGHT - 328);

    ctx.save();
    ctx.strokeStyle = "rgba(170, 203, 173, 0.055)";
    ctx.lineWidth = 1;
    for (let x = 30; x < 1180; x += 62) {
      ctx.beginPath();
      ctx.moveTo(x, 330);
      ctx.lineTo(x, 654);
      ctx.stroke();
    }
    for (let y = 348; y < 655; y += 42) {
      ctx.beginPath();
      ctx.moveTo(18, y);
      ctx.lineTo(1182, y);
      ctx.stroke();
    }
    ctx.restore();

    const floor = ctx.createLinearGradient(0, 590, 0, 660);
    floor.addColorStop(0, "#18281e");
    floor.addColorStop(1, "#0d1a13");
    ctx.fillStyle = floor;
    ctx.fillRect(18, 596, 1164, 64);

    const ambient = ctx.createRadialGradient(600, 380, 30, 600, 420, 650);
    ambient.addColorStop(0, "rgba(255, 206, 129, 0.045)");
    ambient.addColorStop(1, "rgba(38, 77, 49, 0)");
    ctx.fillStyle = ambient;
    ctx.fillRect(18, 328, 1164, 332);

    ctx.strokeStyle = "rgba(126, 162, 133, 0.2)";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(30, 342);
    ctx.lineTo(1170, 342);
    ctx.stroke();
    ctx.strokeStyle = "rgba(36, 59, 43, 0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(30, 341);
    ctx.lineTo(1170, 341);
    ctx.stroke();
    ctx.lineCap = "butt";
  }

  drawLight(game, now) {
    const ctx = this.ctx;
    const intensity =
      game.weather.type === "cloud" ? 0.2 : game.weather.type === "cold" ? 0.65 : 1;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (let index = 0; index < 4; index += 1) {
      const x = 230 + index * 245;
      const beam = ctx.createLinearGradient(x, 70, x + 65, 570);
      beam.addColorStop(0, `rgba(255, 225, 158, ${0.052 * intensity})`);
      beam.addColorStop(0.7, `rgba(255, 213, 130, ${0.018 * intensity})`);
      beam.addColorStop(1, "rgba(255, 213, 130, 0)");
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(x - 22, 38);
      ctx.lineTo(x + 50, 43);
      ctx.lineTo(x + 145, 585);
      ctx.lineTo(x + 1, 585);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawEquipment(game, now) {
    const ctx = this.ctx;
    const anyHeating = game.beds.some((bed) => bed.controls.heating);
    const anyVent = game.beds.some((bed) => bed.controls.ventilation);
    const hot = game.weather.type === "heat";

    ctx.save();
    ctx.translate(63, 304);
    ctx.fillStyle = "rgba(12, 26, 20, 0.9)";
    ctx.strokeStyle = "rgba(150, 198, 168, 0.24)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(0, 0, 174, 31, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(7, 18, 13, 0.85)";
    ctx.beginPath();
    ctx.roundRect(7, 6, 160, 19, 5);
    ctx.fill();
    const waterWidth = 158 * (game.water / game.waterCapacity);
    const waterGradient = ctx.createLinearGradient(8, 0, 168, 0);
    waterGradient.addColorStop(0, game.water < 24 ? "#d7644d" : "#2c98b4");
    waterGradient.addColorStop(1, game.water < 24 ? "#f0a35d" : "#8fe8f4");
    ctx.fillStyle = waterGradient;
    ctx.globalAlpha = 0.78;
    ctx.beginPath();
    ctx.roundRect(8, 7, waterWidth, 17, 4);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(218, 236, 218, 0.52)";
    ctx.font = "8px ui-monospace, monospace";
    ctx.fillText("H₂O", 13, 18);
    ctx.textAlign = "right";
    ctx.fillText(`${Math.ceil(game.water)}L`, 158, 18);
    ctx.textAlign = "left";
    ctx.restore();

    ctx.save();
    ctx.translate(376, 304);
    const heaterColor = hot ? "#ff684f" : anyHeating ? "#ff9b5d" : "#68816f";
    if (anyHeating || hot) {
      const glow = ctx.createRadialGradient(76, 14, 2, 76, 14, 110);
      glow.addColorStop(0, hot ? "rgba(255, 95, 70, 0.2)" : "rgba(255, 134, 79, 0.12)");
      glow.addColorStop(1, "rgba(255, 112, 63, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(-50, -70, 260, 135);
    }
    ctx.fillStyle = "rgba(12, 26, 20, 0.9)";
    ctx.strokeStyle = "rgba(150, 198, 168, 0.2)";
    ctx.beginPath();
    ctx.roundRect(0, 0, 154, 26, 7);
    ctx.fill();
    ctx.stroke();
    for (let x = 12; x < 145; x += 13) {
      ctx.strokeStyle = heaterColor;
      ctx.globalAlpha = 0.32 + (x % 3) * 0.08;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 5);
      ctx.lineTo(x, 21);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = heaterColor;
    ctx.font = "8px ui-monospace, monospace";
    ctx.fillText(anyHeating ? "HEATER · ON" : hot ? "HEATER · FAULT" : "HEATER · STANDBY", 10, -6);
    ctx.restore();

    ctx.save();
    ctx.translate(1020, 302);
    ctx.fillStyle = "rgba(11, 26, 19, 0.94)";
    ctx.strokeStyle = anyVent ? "rgba(165, 230, 189, 0.38)" : "rgba(150, 198, 168, 0.18)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(15, 15, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.translate(15, 15);
    ctx.rotate(anyVent ? now * 0.008 : 0);
    ctx.fillStyle = anyVent ? "rgba(165, 230, 189, 0.52)" : "rgba(142, 168, 148, 0.2)";
    for (let index = 0; index < 4; index += 1) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.ellipse(0, -8, 4, 9, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(9, 20, 15, 0.95)";
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "rgba(188, 221, 193, 0.28)";
    ctx.font = "8px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.fillText(anyVent ? "FAN · RUNNING" : "FAN · IDLE", 1110, 337);
    ctx.textAlign = "left";

    const pipeGradient = ctx.createLinearGradient(0, 341, 0, 348);
    pipeGradient.addColorStop(0, hot ? "#b64835" : "#6b8874");
    pipeGradient.addColorStop(1, "#33493a");
    ctx.strokeStyle = pipeGradient;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(232, 338);
    ctx.lineTo(360, 338);
    ctx.moveTo(535, 338);
    ctx.lineTo(715, 338);
    ctx.moveTo(900, 338);
    ctx.lineTo(1020, 338);
    ctx.stroke();
    ctx.lineCap = "butt";

    if (hot) {
      ctx.save();
      ctx.strokeStyle = "rgba(255, 111, 76, 0.34)";
      ctx.lineWidth = 1;
      for (let index = 0; index < 4; index += 1) {
        const x = 400 + index * 31;
        ctx.beginPath();
        ctx.moveTo(x, 290);
        ctx.quadraticCurveTo(x - 6, 278, x + 2, 266);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawBed(bed, rect, selected, game, now) {
    const ctx = this.ctx;
    const progress = bed.growth / 100;
    const unsafe =
      !bed.harvested &&
      !bed.matured &&
      !game.getConditionStatus(bed).all &&
      game.status === "running";
    const overheat = bed.temperature >= OVERHEAT_LIMIT;

    ctx.save();
    if (selected) {
      ctx.shadowColor = "rgba(176, 239, 152, 0.24)";
      ctx.shadowBlur = 24;
    }
    ctx.fillStyle = "rgba(5, 13, 9, 0.4)";
    this.roundRect(rect.x + 4, rect.y + 7, rect.width, rect.height, 14);
    ctx.fill();
    ctx.restore();

    if (selected) {
      ctx.save();
      ctx.strokeStyle = "rgba(197, 245, 157, 0.72)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.roundRect(rect.x - 3, rect.y - 3, rect.width + 6, rect.height + 6, 16);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    if (bed.matured && !bed.harvested) {
      const pulse = 0.5 + Math.sin(now * 0.004 + bed.index) * 0.16;
      ctx.save();
      ctx.shadowColor = `rgba(244, 215, 132, ${pulse * 0.55})`;
      ctx.shadowBlur = 28;
      ctx.strokeStyle = `rgba(244, 215, 132, ${pulse})`;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.roundRect(rect.x - 2, rect.y - 2, rect.width + 4, rect.height + 4, 15);
      ctx.stroke();
      ctx.restore();
    }

    if (overheat) {
      const pulse = 0.35 + Math.abs(Math.sin(now * 0.009)) * 0.4;
      ctx.save();
      ctx.shadowColor = `rgba(255, 76, 54, ${pulse})`;
      ctx.shadowBlur = 34;
      ctx.strokeStyle = `rgba(255, 94, 69, ${pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(rect.x - 2, rect.y - 2, rect.width + 4, rect.height + 4, 15);
      ctx.stroke();
      ctx.restore();
    }

    const frame = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.height);
    frame.addColorStop(0, "#253a2c");
    frame.addColorStop(1, "#1a2c21");
    ctx.fillStyle = frame;
    this.roundRect(rect.x, rect.y, rect.width, rect.height, 13);
    ctx.fill();
    ctx.strokeStyle = unsafe ? "rgba(255, 112, 91, 0.28)" : "rgba(179, 211, 180, 0.17)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1, 13);
    ctx.stroke();

    ctx.fillStyle = "rgba(175, 207, 177, 0.07)";
    this.roundRect(rect.x + 8, rect.y + 7, rect.width - 16, 24, 7);
    ctx.fill();

    this.drawBedLabel(bed, rect, game, now);
    this.drawSoil(bed, rect, game, now);
    this.drawCrop(bed, rect, progress, now);
    this.drawTempBand(bed, rect);
    this.drawBedControls(bed, rect);
    this.drawBedMeters(bed, rect);

    if (bed.controls.irrigation && !bed.harvested) {
      this.drawWaterSpray(bed, rect, now);
    }
    if (bed.controls.ventilation && !bed.harvested) {
      this.drawVentilation(bed, rect, now);
    }
    if (bed.controls.heating && !bed.harvested) {
      this.drawHeaterGlow(bed, rect, now);
    }
    if (bed.controls.shade && !bed.harvested) {
      this.drawShade(bed, rect);
    }

    if (unsafe) {
      const pulse = 0.6 + Math.sin(now * 0.005 + bed.index) * 0.2;
      ctx.fillStyle = `rgba(255, 113, 91, ${pulse})`;
      ctx.beginPath();
      ctx.arc(rect.x + rect.width - 19, rect.y + rect.height - 12, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    if (bed.matured && !bed.harvested) {
      ctx.save();
      ctx.fillStyle = "rgba(34, 43, 24, 0.92)";
      ctx.strokeStyle = "rgba(244, 215, 132, 0.34)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(rect.x + rect.width / 2 - 34, rect.y - 13, 68, 20, 10);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#f1d98d";
      ctx.font = "600 9px 'Greenhouse Sans', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("可以收获", rect.x + rect.width / 2, rect.y + 1);
      ctx.textAlign = "left";
      ctx.restore();
    }

    if (bed.harvested) {
      ctx.fillStyle = "rgba(5, 15, 10, 0.2)";
      this.roundRect(rect.x + 9, rect.y + 35, rect.width - 18, rect.height - 54, 8);
      ctx.fill();
    }
  }

  drawBedLabel(bed, rect, game, now) {
    const ctx = this.ctx;
    ctx.fillStyle = "#dce9d9";
    ctx.font = "600 10px 'Greenhouse Sans', sans-serif";
    ctx.fillText(`${bed.id}  ${bed.crop.name}`, rect.x + 16, rect.y + 22);

    if (bed.harvested) {
      ctx.fillStyle = "#9de08d";
      ctx.font = "8px 'Greenhouse Sans', sans-serif";
      ctx.fillText("已入库", rect.x + rect.width - 55, rect.y + 22);
      return;
    }

    const status = game.getConditionStatus(bed);
    const lights = [
      { key: "moisture", color: "#72d7ea" },
      { key: "temperature", color: "#ff9b5d" },
      { key: "light", color: "#f4d784" },
    ];
    lights.forEach((entry, index) => {
      ctx.fillStyle = status[entry.key] ? entry.color : "rgba(255, 105, 86, 0.9)";
      ctx.globalAlpha = status[entry.key] ? 0.8 : 0.65 + Math.sin(now * 0.007 + index) * 0.2;
      ctx.beginPath();
      ctx.arc(rect.x + rect.width - 78 + index * 10, rect.y + 19, 2.2, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    ctx.fillStyle = "rgba(219, 234, 218, 0.58)";
    ctx.font = "8px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.fillText(`${Math.round(bed.growth)}%`, rect.x + rect.width - 91, rect.y + 22);
    ctx.textAlign = "left";
  }

  drawSoil(bed, rect, game, now) {
    const ctx = this.ctx;
    const x = rect.x + 10;
    const y = rect.y + 35;
    const width = rect.width - 20;
    const height = rect.height - 55;

    const soil = ctx.createLinearGradient(0, y, 0, y + height);
    soil.addColorStop(0, "#4b3928");
    soil.addColorStop(0.35, "#37291d");
    soil.addColorStop(1, "#241b14");
    ctx.fillStyle = soil;
    this.roundRect(x, y, width, height, 8);
    ctx.fill();

    const moistureLevel = clamp(bed.moisture / 100, 0, 1);
    ctx.save();
    this.roundRect(x, y, width, height, 8);
    ctx.clip();
    const water = ctx.createLinearGradient(0, y + height * (1 - moistureLevel), 0, y + height);
    water.addColorStop(0, "rgba(62, 141, 155, 0.08)");
    water.addColorStop(1, "rgba(54, 151, 170, 0.34)");
    ctx.fillStyle = water;
    ctx.fillRect(x, y + height * (1 - moistureLevel), width, height * moistureLevel);

    ctx.strokeStyle = "rgba(214, 194, 154, 0.055)";
    ctx.lineWidth = 1;
    for (let index = 0; index < 9; index += 1) {
      const grainX = x + 11 + ((index * 79 + bed.index * 31) % (width - 22));
      const grainY = y + 9 + ((index * 37) % (height - 16));
      ctx.beginPath();
      ctx.moveTo(grainX - 3, grainY);
      ctx.lineTo(grainX + 3, grainY + 1);
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = "rgba(184, 148, 102, 0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + 0.5);
    ctx.lineTo(x + width, y + 0.5);
    ctx.stroke();

    if (game.weather.type === "clear") {
      const lightPool = ctx.createRadialGradient(
        x + width / 2,
        y + 18,
        4,
        x + width / 2,
        y + 20,
        width * 0.44,
      );
      lightPool.addColorStop(0, "rgba(255, 218, 141, 0.07)");
      lightPool.addColorStop(1, "rgba(255, 218, 141, 0)");
      ctx.fillStyle = lightPool;
      ctx.fillRect(x, y, width, height);
    }

    if (bed.temperature > 29 && !bed.harvested) {
      ctx.fillStyle = `rgba(255, 86, 56, ${0.025 + (bed.temperature - 29) * 0.008})`;
      this.roundRect(x, y, width, height, 8);
      ctx.fill();
    }
  }

  drawCrop(bed, rect, progress, now) {
    const ctx = this.ctx;
    const baseX = rect.x + rect.width * 0.49;
    const baseY = rect.y + rect.height - 35;
    const cropScale = rect.height < 130 ? 0.82 : 1;
    const sway = Math.sin(now * 0.0013 + bed.index * 1.7) * (1 + progress * 2.4);
    const stage = stageForGrowth(bed.growth);

    ctx.save();
    ctx.translate(baseX + sway, baseY);
    ctx.scale(cropScale, cropScale);

    if (bed.harvested) {
      this.drawHarvestedCrop(bed, now);
      ctx.restore();
      return;
    }

    if (bed.cropId === "lettuce") this.drawLettuce(bed, progress, stage, now);
    if (bed.cropId === "tomato") this.drawTomato(bed, progress, stage, now);
    if (bed.cropId === "basil") this.drawBasil(bed, progress, stage, now);
    ctx.restore();
  }

  drawLettuce(bed, progress, stage, now) {
    const ctx = this.ctx;
    const grown = easeOut(progress);
    const count = 4 + Math.floor(progress * 12);
    const baseRadius = 12 + grown * 27;
    ctx.save();
    ctx.translate(0, -3);
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      const ring = index % 3 === 0 ? 0.7 : 1;
      const leafX = Math.cos(angle) * baseRadius * ring;
      const leafY = Math.sin(angle) * baseRadius * 0.42 - 7;
      ctx.save();
      ctx.translate(leafX, leafY);
      ctx.rotate(angle * 0.34 + Math.sin(now * 0.001 + index) * 0.015);
      ctx.fillStyle = index % 2 === 0 ? bed.crop.colors.leaf : bed.crop.colors.leafDark;
      ctx.globalAlpha = 0.76 + (index % 4) * 0.06;
      ctx.beginPath();
      ctx.ellipse(0, 0, 8 + grown * 12, 4.2 + grown * 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.27;
      ctx.strokeStyle = "#c9f8ad";
      ctx.beginPath();
      ctx.moveTo(-6 * grown, 0);
      ctx.quadraticCurveTo(0, -3 * grown, 7 * grown, 0);
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = bed.crop.colors.leaf;
    ctx.beginPath();
    ctx.ellipse(0, -14 * grown, 10 + grown * 9, 9 + grown * 11, 0, 0, Math.PI * 2);
    ctx.fill();
    if (bed.matured) {
      ctx.strokeStyle = "rgba(244, 215, 132, 0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, -12, 30 + Math.sin(now * 0.004) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawTomato(bed, progress, stage, now) {
    const ctx = this.ctx;
    const grown = easeOut(progress);
    const height = 15 + grown * 58;
    ctx.strokeStyle = "#5f9e61";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-3, -height * 0.5, 0, -height);
    ctx.stroke();
    ctx.lineCap = "butt";

    const leafCount = 2 + Math.floor(progress * 6);
    for (let index = 0; index < leafCount; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      const leafY = -height * (0.26 + index * 0.095);
      ctx.save();
      ctx.translate(side * (3 + grown * 4), leafY);
      ctx.rotate(side * (0.36 + Math.sin(now * 0.001 + index) * 0.02));
      ctx.fillStyle = index % 3 === 0 ? bed.crop.colors.leafDark : bed.crop.colors.leaf;
      ctx.beginPath();
      ctx.ellipse(side * 10 * grown, 0, 9 + grown * 6, 4 + grown * 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const fruitCount = Math.min(5, Math.floor(progress * 5.6));
    const fruitLayout = [
      [-10, 0.54],
      [12, 0.49],
      [-6, 0.38],
      [9, 0.33],
      [0, 0.62],
    ];
    for (let index = 0; index < fruitCount; index += 1) {
      const [x, factor] = fruitLayout[index];
      const radius = 4.5 + grown * 4;
      const y = -height * factor;
      const fruit = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, 1, x, y, radius);
      fruit.addColorStop(0, "#ffb19c");
      fruit.addColorStop(0.3, bed.crop.colors.fruit);
      fruit.addColorStop(1, "#c33f32");
      ctx.fillStyle = fruit;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(174, 224, 133, 0.85)";
      ctx.beginPath();
      ctx.ellipse(x, y - radius, 3.4, 1.4, 0.2, 0, Math.PI * 2);
      ctx.fill();
    }

    if (bed.matured) {
      ctx.strokeStyle = "rgba(244, 215, 132, 0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, -height * 0.5, 30 + Math.sin(now * 0.004) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawBasil(bed, progress, stage, now) {
    const ctx = this.ctx;
    const grown = easeOut(progress);
    const stems = progress > 0.42 ? 3 : progress > 0.14 ? 2 : 1;
    for (let stem = 0; stem < stems; stem += 1) {
      const offset = (stem - (stems - 1) / 2) * 10;
      const height = (22 + grown * 40) * (stem === 1 ? 1.08 : 0.86);
      ctx.strokeStyle = "#4c9250";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(offset, 0);
      ctx.quadraticCurveTo(offset - 2, -height * 0.55, offset + stem - 1, -height);
      ctx.stroke();

      const pairs = 2 + Math.floor(progress * 4);
      for (let pair = 0; pair < pairs; pair += 1) {
        const y = -height * (0.3 + pair * 0.14);
        for (const side of [-1, 1]) {
          ctx.save();
          ctx.translate(offset + side * 5, y);
          ctx.rotate(side * (0.6 + Math.sin(now * 0.0012 + pair + stem) * 0.02));
          ctx.fillStyle = pair % 2 === 0 ? bed.crop.colors.leaf : bed.crop.colors.leafDark;
          ctx.beginPath();
          ctx.ellipse(side * (4 + grown * 2), 0, 5 + grown * 4.5, 2.8 + grown * 3, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      if (bed.matured) {
        ctx.fillStyle = "#f3e9c0";
        for (let bud = 0; bud < 3; bud += 1) {
          ctx.beginPath();
          ctx.arc(offset + stem - 1 + (bud - 1) * 2.6, -height - 2 - Math.abs(bud - 1) * 1.8, 1.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    if (bed.matured) {
      ctx.strokeStyle = "rgba(244, 215, 132, 0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, -28, 30 + Math.sin(now * 0.004) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawHarvestedCrop(bed, now) {
    const ctx = this.ctx;
    ctx.strokeStyle = "rgba(120, 151, 99, 0.7)";
    ctx.lineWidth = 2;
    for (let index = 0; index < 3; index += 1) {
      const x = -12 + index * 12;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, -7 - index * 2);
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(26, -2);
    ctx.fillStyle = "rgba(82, 60, 35, 0.9)";
    ctx.strokeStyle = "rgba(217, 183, 121, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-10, -13, 21, 15, 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "rgba(217, 183, 121, 0.2)";
    ctx.beginPath();
    ctx.moveTo(-8, -8);
    ctx.lineTo(9, -8);
    ctx.moveTo(-8, -4);
    ctx.lineTo(9, -4);
    ctx.stroke();
    ctx.restore();
    if (bed.matured) {
      ctx.fillStyle = `rgba(244, 215, 132, ${0.2 + Math.sin(now * 0.003) * 0.06})`;
      ctx.beginPath();
      ctx.arc(0, -13, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawTempBand(bed, rect) {
    const ctx = this.ctx;
    const x = rect.x + rect.width - 18;
    const y = rect.y + 39;
    const height = rect.height - 58;
    const gradient = ctx.createLinearGradient(0, y + height, 0, y);
    gradient.addColorStop(0, "#69c9e8");
    gradient.addColorStop(0.35, "#a8d3a5");
    gradient.addColorStop(0.65, "#f3ce79");
    gradient.addColorStop(1, "#ff765f");
    ctx.fillStyle = gradient;
    ctx.globalAlpha = 0.66;
    this.roundRect(x, y, 4, height, 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    const [idealLow, idealHigh] = bed.crop.ideal.temperature;
    const tempToY = (temp) => y + height - ((clamp(temp, 8, 38) - 8) / 30) * height;
    ctx.strokeStyle = "rgba(233, 245, 232, 0.38)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 3, tempToY(idealLow));
    ctx.lineTo(x + 5, tempToY(idealLow));
    ctx.moveTo(x - 3, tempToY(idealHigh));
    ctx.lineTo(x + 5, tempToY(idealHigh));
    ctx.stroke();

    const markerY = tempToY(bed.temperature);
    ctx.fillStyle = "#eef6e8";
    ctx.strokeStyle = "rgba(18, 29, 20, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x + 2, markerY, 3.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  drawBedControls(bed, rect) {
    const ctx = this.ctx;
    Object.entries(CONTROL_LABELS).forEach(([control, label], index) => {
      const x = rect.x + rect.width - 174 + index * 18;
      const y = rect.y + rect.height - 10;
      const active = bed.controls[control];
      ctx.fillStyle = active ? CONTROL_COLORS[control] : "rgba(218, 232, 214, 0.12)";
      ctx.globalAlpha = active ? 0.92 : 0.7;
      ctx.beginPath();
      ctx.arc(x, y - 2, 5.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = active ? "#102119" : "rgba(219, 230, 217, 0.38)";
      ctx.font = "700 6px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(label, x, y);
      ctx.textAlign = "left";
    });
  }

  drawBedMeters(bed, rect) {
    const ctx = this.ctx;
    const y = rect.y + rect.height - 9;
    const startX = rect.x + 14;
    const entries = [
      { value: bed.moisture, range: bed.crop.ideal.moisture, color: "#72d7ea" },
      { value: bed.temperature, range: bed.crop.ideal.temperature, color: "#f3c97d", max: 38, min: 8 },
      { value: bed.light, range: bed.crop.ideal.light, color: "#efd990" },
    ];
    entries.forEach((entry, index) => {
      const width = 31;
      const x = startX + index * 37;
      const min = entry.min ?? 0;
      const max = entry.max ?? 100;
      const normalized = clamp((entry.value - min) / (max - min), 0, 1);
      const valid = entry.value >= entry.range[0] && entry.value <= entry.range[1];
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      this.roundRect(x, y, width, 2.5, 2);
      ctx.fill();
      ctx.fillStyle = valid ? entry.color : "#ff705d";
      ctx.globalAlpha = valid ? 0.76 : 0.9;
      this.roundRect(x, y, width * normalized, 2.5, 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });
  }

  drawWaterSpray(bed, rect, now) {
    const ctx = this.ctx;
    const nozzleX = rect.x + rect.width - 39;
    const nozzleY = rect.y + 34;
    ctx.fillStyle = "rgba(150, 221, 231, 0.45)";
    this.roundRect(nozzleX - 10, nozzleY - 2, 20, 3, 2);
    ctx.fill();
    for (let index = 0; index < 9; index += 1) {
      const cycle = (now * 0.04 + index * 73 + bed.index * 19) % 100;
      const x = nozzleX + Math.sin(index * 2.4 + now * 0.002) * (4 + (cycle / 100) * 22);
      const y = nozzleY + 4 + (cycle / 100) * 49;
      ctx.fillStyle = `rgba(130, 224, 240, ${0.66 - cycle / 160})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 1.2, 2.6, 0.08, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawVentilation(bed, rect, now) {
    const ctx = this.ctx;
    const x = rect.x + rect.width - 39;
    const y = rect.y + 50;
    ctx.strokeStyle = "rgba(171, 235, 196, 0.36)";
    ctx.lineWidth = 1;
    for (let index = 0; index < 3; index += 1) {
      const offset = ((now * 0.045 + index * 13) % 28) - 5;
      ctx.beginPath();
      ctx.moveTo(x + 11 + offset, y + index * 8);
      ctx.quadraticCurveTo(x + 25 + offset, y - 4 + index * 8, x + 38 + offset, y + 2 + index * 8);
      ctx.stroke();
    }
  }

  drawHeaterGlow(bed, rect, now) {
    const ctx = this.ctx;
    const pulse = 0.45 + Math.sin(now * 0.004 + bed.index) * 0.16;
    const x = rect.x + 32;
    const y = rect.y + rect.height - 36;
    const glow = ctx.createRadialGradient(x, y, 1, x, y, 38);
    glow.addColorStop(0, `rgba(255, 117, 70, ${pulse * 0.2})`);
    glow.addColorStop(1, "rgba(255, 117, 70, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x - 40, y - 40, 80, 80);
    for (let index = 0; index < 2; index += 1) {
      ctx.strokeStyle = `rgba(255, 155, 99, ${0.19 + pulse * 0.15})`;
      ctx.beginPath();
      ctx.moveTo(x - 4 + index * 8, y + 5);
      ctx.quadraticCurveTo(x - 9 + index * 8, y - 8, x - 2 + index * 8, y - 17);
      ctx.stroke();
    }
  }

  drawShade(bed, rect) {
    const ctx = this.ctx;
    ctx.save();
    this.roundRect(rect.x + 11, rect.y + 37, rect.width - 38, rect.height - 58, 7);
    ctx.clip();
    ctx.strokeStyle = "rgba(211, 191, 130, 0.1)";
    ctx.lineWidth = 1;
    for (let x = -rect.height; x < rect.width; x += 12) {
      ctx.beginPath();
      ctx.moveTo(rect.x + x, rect.y + rect.height);
      ctx.lineTo(rect.x + x + rect.height, rect.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawForegroundWeather(game, now) {
    const ctx = this.ctx;
    if (game.weather.type === "cloud") {
      ctx.fillStyle = "rgba(88, 111, 108, 0.09)";
      ctx.fillRect(18, 328, 1164, 332);
    }
    if (game.weather.type === "cold") {
      const haze = ctx.createLinearGradient(0, 328, 0, 660);
      haze.addColorStop(0, "rgba(91, 177, 206, 0.07)");
      haze.addColorStop(1, "rgba(72, 139, 153, 0.015)");
      ctx.fillStyle = haze;
      ctx.fillRect(18, 328, 1164, 332);
    }
    if (game.weather.type === "heat") {
      const glow = ctx.createRadialGradient(455, 318, 5, 455, 360, 390);
      glow.addColorStop(0, "rgba(255, 87, 54, 0.08)");
      glow.addColorStop(0.55, "rgba(255, 102, 54, 0.025)");
      glow.addColorStop(1, "rgba(255, 102, 54, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(18, 318, 1164, 342);

      const alarm = 0.18 + Math.abs(Math.sin(now * 0.007)) * 0.26;
      ctx.fillStyle = `rgba(255, 83, 57, ${alarm})`;
      ctx.beginPath();
      ctx.arc(390, 317, 2.8, 0, Math.PI * 2);
      ctx.fill();
      if (Math.sin(now * 0.007) > 0.4) {
        ctx.strokeStyle = `rgba(255, 101, 77, ${alarm})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(390, 317, 8, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  drawAtmosphere(game, now) {
    const ctx = this.ctx;
    const vignette = ctx.createRadialGradient(600, 330, 260, 600, 330, 780);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(0.72, "rgba(0, 0, 0, 0.06)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.38)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    if (game.status === "lost") {
      ctx.fillStyle = "rgba(76, 9, 6, 0.08)";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
    if (game.status === "won") {
      const warm = ctx.createLinearGradient(0, 0, 0, HEIGHT);
      warm.addColorStop(0, "rgba(246, 215, 134, 0.025)");
      warm.addColorStop(1, "rgba(246, 215, 134, 0.07)");
      ctx.fillStyle = warm;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
  }

  drawSceneDetails(game, phase, now) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(210, 228, 210, 0.19)";
    ctx.font = "8px ui-monospace, monospace";
    ctx.fillText("NORTH BAY · 18°C", 40, 345);
    ctx.textAlign = "right";
    ctx.fillText("03 / NIGHT CREW", 1158, 345);
    ctx.textAlign = "left";

    if (phase === "ready") {
      ctx.fillStyle = "rgba(5, 15, 11, 0.1)";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
  }

  roundRect(x, y, width, height, radius) {
    this.ctx.beginPath();
    this.ctx.roundRect(x, y, width, height, radius);
  }
}
