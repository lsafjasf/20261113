import { PROJECT_DURATION, clamp, wrapTime } from "./project-model.js";

const TAU = Math.PI * 2;

const mulberry32 = (seed) => {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const mix = (from, to, amount) => {
  const t = clamp(amount, 0, 1);
  return from.map((value, index) => Math.round(value + (to[index] - value) * t));
};

const rgba = (color, alpha) =>
  `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${clamp(alpha, 0, 1)})`;

export class SceneRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.noisePattern = null;
    this.lastValues = { tide: 0.4, fog: 0.5, light: 0.2 };
    this.lastTime = 0;

    const random = mulberry32(0x1a7f3c2d);
    this.stars = Array.from({ length: 94 }, () => ({
      x: random(),
      y: random() * 0.43,
      radius: 0.35 + random() * 1.15,
      phase: random() * TAU,
      brightness: 0.2 + random() * 0.8,
    }));
    this.foamDots = Array.from({ length: 120 }, (_, index) => ({
      x: random(),
      offset: (random() - 0.5) * 24,
      size: 0.4 + random() * 1.8,
      phase: random() * TAU,
      row: index % 3,
    }));
    this.waterGlints = Array.from({ length: 76 }, () => ({
      x: random(),
      y: random(),
      length: 0.006 + random() * 0.035,
      phase: random() * TAU,
      alpha: 0.1 + random() * 0.45,
    }));
    this.sandRipples = Array.from({ length: 30 }, () => ({
      x: random(),
      y: random(),
      width: 0.025 + random() * 0.12,
      phase: random() * TAU,
    }));
    this.moonCraters = Array.from({ length: 7 }, () => ({
      x: (random() - 0.5) * 0.74,
      y: (random() - 0.5) * 0.74,
      radius: 0.03 + random() * 0.09,
      alpha: 0.02 + random() * 0.045,
    }));
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (
      width === this.canvas.width &&
      height === this.canvas.height &&
      dpr === this.dpr
    ) {
      this.width = rect.width;
      this.height = rect.height;
      return;
    }
    this.canvas.width = width;
    this.canvas.height = height;
    this.dpr = dpr;
    this.width = rect.width;
    this.height = rect.height;
    this.noisePattern = null;
    this.render(this.lastTime, this.lastValues);
  }

  render(time, values) {
    this.lastTime = time;
    this.lastValues = values;
    if (!this.width || !this.height) {
      this.resize();
    }
    const ctx = this.ctx;
    if (!ctx) {
      return;
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawScene(ctx, this.width, this.height, wrapTime(time), values);
  }

  getNoisePattern(ctx) {
    if (this.noisePattern) {
      return this.noisePattern;
    }
    const tile = document.createElement("canvas");
    const size = 144;
    tile.width = size;
    tile.height = size;
    const tileCtx = tile.getContext("2d");
    const image = tileCtx.createImageData(size, size);
    const random = mulberry32(0x7ac4e19b);
    for (let index = 0; index < image.data.length; index += 4) {
      const value = 80 + Math.floor(random() * 118);
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = value;
      image.data[index + 3] = 255;
    }
    tileCtx.putImageData(image, 0, 0);
    this.noisePattern = ctx.createPattern(tile, "repeat");
    return this.noisePattern;
  }

  drawScene(ctx, width, height, time, values) {
    const tide = clamp(values.tide ?? 0.4, 0, 1);
    const fog = clamp(values.fog ?? 0.5, 0, 1);
    const light = clamp(values.light ?? 0.2, 0, 1);
    const phase = (time / PROJECT_DURATION) * TAU;
    const horizon = height * (0.452 - tide * 0.004);
    const shoreY = height * (0.575 + tide * 0.175);
    const moonX = width * 0.735;
    const moonY = height * 0.215;
    const moonRadius = clamp(Math.min(width, height) * 0.045, 15, 58);

    this.drawSky(ctx, width, height, horizon, phase, fog, moonX, moonY);
    this.drawMoon(ctx, width, height, moonX, moonY, moonRadius, phase, fog);
    this.drawDistantLand(ctx, width, horizon, fog, phase);
    this.drawWater(
      ctx,
      width,
      height,
      horizon,
      shoreY,
      tide,
      fog,
      phase,
      moonX,
    );
    this.drawShore(ctx, width, height, shoreY, tide, fog, phase);
    this.drawHazeBanks(ctx, width, height, horizon, fog, phase, 0.42);
    this.drawLighthouse(
      ctx,
      width,
      height,
      horizon,
      light,
      fog,
      phase,
    );
    this.drawHazeBanks(ctx, width, height, shoreY, fog, phase, 0.25);
    this.drawWaterReflections(
      ctx,
      width,
      height,
      horizon,
      shoreY,
      moonX,
      fog,
      light,
      phase,
    );
    this.drawAtmosphere(ctx, width, height, shoreY, fog, phase, light);
    this.drawGrain(ctx, width, height);
    this.drawVignette(ctx, width, height);
  }

  drawSky(ctx, width, height, horizon, phase, fog, moonX, moonY) {
    const gradient = ctx.createLinearGradient(0, 0, 0, horizon * 1.35);
    gradient.addColorStop(0, rgba(mix([3, 11, 16], [7, 18, 21], fog * 0.55), 1));
    gradient.addColorStop(
      0.38,
      rgba(mix([8, 25, 30], [27, 46, 47], fog * 0.7), 1),
    );
    gradient.addColorStop(
      0.78,
      rgba(mix([31, 58, 58], [84, 101, 92], fog * 0.82), 1),
    );
    gradient.addColorStop(
      1,
      rgba(mix([54, 80, 73], [137, 139, 116], fog * 0.9), 1),
    );
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const moonHaze = ctx.createRadialGradient(
      moonX,
      moonY,
      height * 0.01,
      moonX,
      moonY,
      width * 0.36,
    );
    moonHaze.addColorStop(0, `rgba(219, 218, 195, ${0.035 + fog * 0.06})`);
    moonHaze.addColorStop(0.38, `rgba(169, 183, 163, ${0.018 + fog * 0.035})`);
    moonHaze.addColorStop(1, "rgba(120, 145, 133, 0)");
    ctx.fillStyle = moonHaze;
    ctx.fillRect(0, 0, width, horizon);
    ctx.restore();

    for (const star of this.stars) {
      const twinkle =
        0.66 + Math.sin(phase * 2 + star.phase) * 0.2 + Math.sin(phase * 5 + star.phase) * 0.08;
      const alpha =
        star.brightness * twinkle * (1 - fog * 0.72) * (0.64 - star.y * 0.25);
      if (alpha <= 0.012) {
        continue;
      }
      ctx.fillStyle = `rgba(218, 224, 207, ${alpha})`;
      ctx.beginPath();
      ctx.arc(
        star.x * width,
        star.y * horizon,
        star.radius * Math.max(0.8, width / 1280),
        0,
        TAU,
      );
      ctx.fill();
    }
  }

  drawMoon(ctx, width, height, moonX, moonY, moonRadius, phase, fog) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const halo = ctx.createRadialGradient(
      moonX,
      moonY,
      moonRadius * 0.7,
      moonX,
      moonY,
      moonRadius * (5.3 + fog * 2.2),
    );
    halo.addColorStop(0, `rgba(237, 232, 204, ${0.2 + fog * 0.2})`);
    halo.addColorStop(0.18, `rgba(210, 213, 191, ${0.085 + fog * 0.1})`);
    halo.addColorStop(0.52, `rgba(180, 195, 176, ${0.025 + fog * 0.045})`);
    halo.addColorStop(1, "rgba(160, 180, 164, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonRadius * 7.5, 0, TAU);
    ctx.fill();
    ctx.restore();

    const disc = ctx.createRadialGradient(
      moonX - moonRadius * 0.28,
      moonY - moonRadius * 0.32,
      moonRadius * 0.08,
      moonX,
      moonY,
      moonRadius,
    );
    disc.addColorStop(0, `rgba(249, 244, 216, ${0.72 + fog * 0.2})`);
    disc.addColorStop(0.72, `rgba(222, 220, 192, ${0.54 + fog * 0.22})`);
    disc.addColorStop(1, `rgba(177, 187, 167, ${0.28 + fog * 0.18})`);
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonRadius, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonRadius, 0, TAU);
    ctx.clip();
    for (const crater of this.moonCraters) {
      ctx.fillStyle = `rgba(93, 113, 105, ${crater.alpha * (0.65 + fog * 0.35)})`;
      ctx.beginPath();
      ctx.arc(
        moonX + crater.x * moonRadius,
        moonY + crater.y * moonRadius,
        crater.radius * moonRadius,
        0,
        TAU,
      );
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const lowMist = ctx.createLinearGradient(
      moonX - moonRadius * 2,
      moonY,
      moonX + moonRadius * 2,
      moonY + moonRadius * 1.45,
    );
    lowMist.addColorStop(0, "rgba(209, 215, 197, 0)");
    lowMist.addColorStop(0.5, `rgba(207, 214, 197, ${0.04 + fog * 0.09})`);
    lowMist.addColorStop(1, "rgba(209, 215, 197, 0)");
    ctx.fillStyle = lowMist;
    ctx.beginPath();
    ctx.ellipse(
      moonX + Math.sin(phase) * moonRadius * 0.2,
      moonY + moonRadius * 0.65,
      moonRadius * 2.15,
      moonRadius * 0.6,
      -0.04,
      0,
      TAU,
    );
    ctx.fill();
    ctx.restore();
  }

  drawDistantLand(ctx, width, horizon, fog, phase) {
    const landColor = rgba(mix([15, 30, 31], [61, 76, 70], fog * 0.5), 0.76);
    ctx.fillStyle = landColor;
    ctx.beginPath();
    ctx.moveTo(0, horizon + 1);
    ctx.lineTo(0, horizon - width * 0.011);
    for (let index = 0; index <= 18; index += 1) {
      const x = (index / 18) * width * 0.38;
      const y =
        horizon -
        width * 0.008 -
        Math.sin(index * 1.8 + 0.8) * width * 0.009 -
        Math.sin(index * 0.54) * width * 0.005;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width * 0.38, horizon + 1);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = rgba(mix([11, 26, 28], [46, 61, 57], fog * 0.4), 0.5);
    ctx.beginPath();
    ctx.moveTo(width * 0.54, horizon);
    ctx.quadraticCurveTo(
      width * 0.66,
      horizon - width * 0.012 + Math.sin(phase) * 1.5,
      width * 0.82,
      horizon - width * 0.003,
    );
    ctx.lineTo(width * 0.92, horizon);
    ctx.closePath();
    ctx.fill();
  }

  shorelineAt(x, width, shoreY, height, tide, phase) {
    const normalized = x / width;
    const amplitude = height * (0.007 + (1 - tide) * 0.006);
    return (
      shoreY +
      Math.sin(normalized * TAU * 1.25 + phase * 2) * amplitude +
      Math.sin(normalized * TAU * 3.1 - phase + 0.8) * amplitude * 0.36 +
      Math.sin(normalized * TAU * 6.5 + phase * 3) * amplitude * 0.13
    );
  }

  drawWater(ctx, width, height, horizon, shoreY, tide, fog, phase, moonX) {
    const waterGradient = ctx.createLinearGradient(0, horizon, 0, shoreY);
    waterGradient.addColorStop(
      0,
      rgba(mix([69, 96, 87], [143, 143, 117], fog * 0.78), 1),
    );
    waterGradient.addColorStop(
      0.13,
      rgba(mix([24, 55, 55], [61, 81, 74], fog * 0.5), 1),
    );
    waterGradient.addColorStop(
      0.55,
      rgba(mix([10, 36, 41], [19, 50, 51], fog * 0.25), 1),
    );
    waterGradient.addColorStop(
      1,
      rgba(mix([8, 24, 28], [15, 40, 42], tide * 0.25), 1),
    );

    ctx.fillStyle = waterGradient;
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    ctx.lineTo(width, horizon);
    for (let index = 96; index >= 0; index -= 1) {
      const x = (index / 96) * width;
      ctx.lineTo(x, this.shorelineAt(x, width, shoreY, height, tide, phase));
    }
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const horizonShine = ctx.createLinearGradient(0, horizon, 0, horizon + height * 0.08);
    horizonShine.addColorStop(0, `rgba(213, 216, 190, ${0.06 + fog * 0.09})`);
    horizonShine.addColorStop(1, "rgba(160, 180, 165, 0)");
    ctx.fillStyle = horizonShine;
    ctx.fillRect(0, horizon, width, height * 0.085);
    ctx.restore();

    const depth = Math.max(1, shoreY - horizon);
    for (let row = 0; row < 26; row += 1) {
      const ratio = (row + 1) / 27;
      const y =
        horizon +
        depth * ratio +
        Math.sin(phase * 2 + row * 1.31) * height * 0.0025;
      const alpha =
        (0.016 + ratio * 0.025) *
        (0.55 + 0.45 * Math.sin(row * 1.7 + phase * 1.5));
      ctx.strokeStyle = `rgba(180, 208, 196, ${Math.max(0, alpha)})`;
      ctx.lineWidth = ratio > 0.4 ? 0.8 : 0.55;
      ctx.beginPath();
      for (let step = 0; step <= 10; step += 1) {
        const x = width * (0.04 + (step / 10) * 0.92);
        const waveY =
          y +
          Math.sin(step * 1.4 + phase * 2 + row) * height * (0.0008 + ratio * 0.0015);
        if (step === 0) {
          ctx.moveTo(x, waveY);
        } else {
          ctx.lineTo(x, waveY);
        }
      }
      ctx.stroke();
    }

    const moonColumn = width * 0.16;
    for (let index = 0; index < 28; index += 1) {
      const ratio = (index + 1) / 30;
      const y = horizon + depth * ratio;
      const widthFactor = 0.015 + ratio * 0.06;
      const jitter = Math.sin(index * 2.2 + phase * 2.2) * width * 0.024;
      const alpha = (0.02 + fog * 0.035) * (1 - ratio * 0.6);
      ctx.strokeStyle = `rgba(221, 222, 198, ${alpha})`;
      ctx.lineWidth = 0.65;
      ctx.beginPath();
      ctx.moveTo(moonX + jitter - width * widthFactor, y);
      ctx.lineTo(moonX + jitter + width * widthFactor, y);
      ctx.stroke();
    }
  }

  drawShore(ctx, width, height, shoreY, tide, fog, phase) {
    const shoreGradient = ctx.createLinearGradient(0, shoreY, 0, height);
    shoreGradient.addColorStop(
      0,
      rgba(mix([15, 23, 22], [34, 43, 38], fog * 0.3), 1),
    );
    shoreGradient.addColorStop(0.35, "rgba(11, 18, 18, 1)");
    shoreGradient.addColorStop(1, "rgba(5, 10, 11, 1)");

    ctx.fillStyle = shoreGradient;
    ctx.beginPath();
    ctx.moveTo(0, this.shorelineAt(0, width, shoreY, height, tide, phase));
    for (let index = 1; index <= 96; index += 1) {
      const x = (index / 96) * width;
      ctx.lineTo(x, this.shorelineAt(x, width, shoreY, height, tide, phase));
    }
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const wetSheen = ctx.createRadialGradient(
      width * 0.72,
      shoreY + (height - shoreY) * 0.24,
      0,
      width * 0.72,
      shoreY + (height - shoreY) * 0.24,
      width * 0.42,
    );
    wetSheen.addColorStop(0, `rgba(177, 190, 167, ${0.035 + fog * 0.055})`);
    wetSheen.addColorStop(0.42, "rgba(103, 127, 115, 0.022)");
    wetSheen.addColorStop(1, "rgba(54, 76, 69, 0)");
    ctx.fillStyle = wetSheen;
    ctx.beginPath();
    ctx.moveTo(0, shoreY);
    for (let index = 0; index <= 48; index += 1) {
      const x = (index / 48) * width;
      ctx.lineTo(x, this.shorelineAt(x, width, shoreY, height, tide, phase) + 2);
    }
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = `rgba(214, 221, 204, ${0.26 + fog * 0.2})`;
    ctx.lineWidth = 1.05;
    ctx.beginPath();
    for (let index = 0; index <= 160; index += 1) {
      const x = (index / 160) * width;
      const y =
        this.shorelineAt(x, width, shoreY, height, tide, phase) -
        1.2 -
        Math.sin(index * 0.48 + phase * 2) * 0.8;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    ctx.strokeStyle = `rgba(226, 231, 214, ${0.08 + fog * 0.09})`;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    for (let index = 0; index <= 100; index += 1) {
      const x = (index / 100) * width;
      const y =
        this.shorelineAt(x, width, shoreY, height, tide, phase) +
        4 +
        Math.sin(index * 0.22 - phase) * 1.5;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.restore();

    for (const dot of this.foamDots) {
      const x =
        (dot.x + Math.sin(phase * 2 + dot.phase) * 0.008 + 1) % 1 * width;
      const baseY = this.shorelineAt(x, width, shoreY, height, tide, phase);
      const y = baseY + dot.offset * 0.25 + dot.row * 2.4;
      const alpha =
        (0.08 + fog * 0.1) *
        (0.45 + 0.55 * Math.sin(phase * 3 + dot.phase + dot.row));
      ctx.fillStyle = `rgba(224, 231, 215, ${Math.max(0.012, alpha)})`;
      ctx.beginPath();
      ctx.ellipse(
        x,
        y,
        dot.size * 1.5,
        dot.size * 0.48,
        -0.05,
        0,
        TAU,
      );
      ctx.fill();
    }

    const wetLight = ctx.createLinearGradient(0, shoreY, 0, height);
    wetLight.addColorStop(0, "rgba(15, 29, 28, 0)");
    wetLight.addColorStop(0.36, `rgba(9, 19, 19, ${0.18 + tide * 0.15})`);
    wetLight.addColorStop(1, "rgba(3, 7, 8, 0)");
    ctx.fillStyle = wetLight;
    ctx.fillRect(0, shoreY, width, height - shoreY);

    ctx.save();
    ctx.lineCap = "round";
    for (const ripple of this.sandRipples) {
      const y = shoreY + (height - shoreY) * (0.24 + ripple.y * 0.63);
      const x =
        width * ripple.x +
        Math.sin(phase * 2 + ripple.phase) * width * 0.008;
      ctx.strokeStyle = `rgba(117, 146, 134, ${
        0.016 + (1 - tide) * 0.022
      })`;
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(
        x + width * ripple.width * 0.42,
        y + Math.sin(ripple.phase) * 2.4,
        x + width * ripple.width,
        y + 0.7,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  drawHazeBanks(ctx, width, height, centerY, fog, phase, intensity) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const bankCount = 5;
    for (let index = 0; index < bankCount; index += 1) {
      const drift =
        Math.sin(phase * (index % 2 === 0 ? 1 : 2) + index * 1.63) * width * 0.055;
      const x =
        width * (0.22 + index * 0.15) +
        drift +
        Math.sin(phase + index) * width * 0.026;
      const y =
        centerY +
        Math.sin(phase * 2 + index * 1.24) * height * 0.011 +
        (index - 2) * height * 0.014;
      const alpha =
        (0.035 + fog * 0.095) *
        intensity *
        (0.72 + Math.sin(index * 2.2 + phase) * 0.28);
      const radiusX = width * (0.18 + index * 0.014);
      const radiusY = height * (0.022 + fog * 0.022);

      ctx.save();
      ctx.translate(x, y);
      ctx.scale(radiusX, radiusY);
      const haze = ctx.createRadialGradient(0, 0, 0.02, 0, 0, 1);
      haze.addColorStop(0, `rgba(214, 219, 203, ${alpha})`);
      haze.addColorStop(0.46, `rgba(180, 198, 182, ${alpha * 0.55})`);
      haze.addColorStop(1, "rgba(135, 161, 149, 0)");
      ctx.fillStyle = haze;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  drawLighthouse(ctx, width, height, horizon, light, fog, phase) {
    const x = width * 0.805;
    const rockTop = horizon + height * 0.016;
    const towerHeight = height * (0.185 + Math.min(width, height) * 0.00001);
    const towerTop = rockTop - towerHeight;
    const baseHalf = Math.max(6, width * 0.0092);
    const topHalf = baseHalf * 0.55;
    const lanternHeight = height * 0.029;
    const lampY = towerTop - lanternHeight * 0.51;
    const glowPulse = 0.92 + Math.sin(phase * 3 + 0.7) * 0.045;
    const intensity = clamp(light * glowPulse, 0, 1);

    ctx.save();
    ctx.fillStyle = rgba(mix([8, 17, 18], [29, 42, 39], fog * 0.3), 0.98);
    ctx.beginPath();
    ctx.moveTo(x - width * 0.07, rockTop + height * 0.018);
    ctx.lineTo(x - width * 0.048, rockTop - height * 0.008);
    ctx.lineTo(x - width * 0.018, rockTop - height * 0.002);
    ctx.lineTo(x - width * 0.004, rockTop - height * 0.018);
    ctx.lineTo(x + width * 0.019, rockTop - height * 0.006);
    ctx.lineTo(x + width * 0.041, rockTop - height * 0.012);
    ctx.lineTo(x + width * 0.064, rockTop + height * 0.02);
    ctx.lineTo(x + width * 0.03, rockTop + height * 0.032);
    ctx.lineTo(x - width * 0.038, rockTop + height * 0.028);
    ctx.closePath();
    ctx.fill();

    const towerGradient = ctx.createLinearGradient(
      x - baseHalf,
      0,
      x + baseHalf,
      0,
    );
    towerGradient.addColorStop(
      0,
      rgba(mix([17, 27, 28], [49, 59, 53], fog * 0.26), 1),
    );
    towerGradient.addColorStop(
      0.56,
      rgba(mix([64, 75, 68], [114, 116, 98], fog * 0.2), 1),
    );
    towerGradient.addColorStop(1, rgba([34, 44, 42], 1));
    ctx.fillStyle = towerGradient;
    ctx.beginPath();
    ctx.moveTo(x - baseHalf, rockTop + 1);
    ctx.lineTo(x - topHalf, towerTop);
    ctx.lineTo(x + topHalf, towerTop);
    ctx.lineTo(x + baseHalf, rockTop + 1);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(183, 189, 166, 0.2)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(x - baseHalf * 0.72, rockTop);
    ctx.lineTo(x - topHalf * 0.8, towerTop + 3);
    ctx.stroke();

    const halfAt = (y) => {
      const ratio = clamp((rockTop - y) / towerHeight, 0, 1);
      return baseHalf + (topHalf - baseHalf) * ratio;
    };
    const bandTop = rockTop - towerHeight * 0.54;
    const bandBottom = bandTop - height * 0.021;
    ctx.fillStyle = "rgba(20, 29, 28, 0.72)";
    ctx.beginPath();
    ctx.moveTo(x - halfAt(bandTop), bandTop);
    ctx.lineTo(x + halfAt(bandTop), bandTop);
    ctx.lineTo(x + halfAt(bandBottom), bandBottom);
    ctx.lineTo(x - halfAt(bandBottom), bandBottom);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(7, 14, 16, 0.94)";
    ctx.beginPath();
    ctx.moveTo(x - topHalf * 1.28, towerTop + 1);
    ctx.lineTo(x + topHalf * 1.28, towerTop + 1);
    ctx.lineTo(x + topHalf * 1.1, towerTop - 2.5);
    ctx.lineTo(x - topHalf * 1.1, towerTop - 2.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(
      x - topHalf * 0.9,
      towerTop - lanternHeight,
      topHalf * 1.8,
      lanternHeight - 2,
    );
    ctx.fillStyle = `rgba(245, 207, 148, ${0.14 + intensity * 0.2})`;
    ctx.fillRect(
      x - topHalf * 0.65,
      towerTop - lanternHeight + 3,
      topHalf * 1.3,
      lanternHeight - 7,
    );
    ctx.fillStyle = "rgba(7, 14, 16, 0.96)";
    ctx.fillRect(
      x - topHalf * 0.08,
      towerTop - lanternHeight,
      topHalf * 0.16,
      lanternHeight - 2,
    );
    ctx.beginPath();
    ctx.moveTo(x - topHalf * 1.22, towerTop - lanternHeight);
    ctx.lineTo(x, towerTop - lanternHeight - height * 0.021);
    ctx.lineTo(x + topHalf * 1.22, towerTop - lanternHeight);
    ctx.closePath();
    ctx.fill();

    const lampRadius = clamp(width * 0.0048, 2.2, 9);
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    this.drawBeam(
      ctx,
      x,
      lampY,
      width * (0.22 + intensity * 0.21),
      -0.1 + Math.sin(phase + 0.4) * 0.11,
      0.032 + intensity * 0.018,
      intensity,
    );
    this.drawBeam(
      ctx,
      x,
      lampY,
      width * (0.17 + intensity * 0.18),
      Math.PI + 0.07 + Math.sin(phase + 0.4) * 0.09,
      0.026 + intensity * 0.016,
      intensity * 0.72,
    );
    const glowRadius = clamp(width * (0.018 + intensity * 0.115), 10, 230);
    const glow = ctx.createRadialGradient(x, lampY, 0, x, lampY, glowRadius);
    glow.addColorStop(
      0,
      `rgba(255, 235, 183, ${0.58 + intensity * 0.34})`,
    );
    glow.addColorStop(
      0.08,
      `rgba(255, 206, 133, ${0.28 + intensity * 0.27})`,
    );
    glow.addColorStop(
      0.42,
      `rgba(238, 160, 89, ${0.05 + intensity * 0.09})`,
    );
    glow.addColorStop(1, "rgba(238, 160, 89, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, lampY, glowRadius, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.shadowColor = "rgba(255, 203, 128, 0.96)";
    ctx.shadowBlur = 10 + intensity * 28;
    ctx.fillStyle = `rgba(255, 236, 186, ${0.58 + intensity * 0.4})`;
    ctx.beginPath();
    ctx.arc(x, lampY, lampRadius, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  drawBeam(ctx, x, y, length, angle, spread, intensity) {
    if (intensity < 0.008) {
      return;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const beam = ctx.createLinearGradient(0, 0, length, 0);
    beam.addColorStop(0, `rgba(255, 217, 152, ${0.12 * intensity + 0.008})`);
    beam.addColorStop(
      0.12,
      `rgba(255, 204, 132, ${0.085 * intensity + 0.006})`,
    );
    beam.addColorStop(0.7, `rgba(246, 183, 108, ${0.025 * intensity})`);
    beam.addColorStop(1, "rgba(240, 176, 102, 0)");
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(length, -Math.tan(spread) * length);
    ctx.lineTo(length, Math.tan(spread) * length);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawWaterReflections(
    ctx,
    width,
    height,
    horizon,
    shoreY,
    moonX,
    fog,
    light,
    phase,
  ) {
    const depth = Math.max(1, shoreY - horizon);
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (const glint of this.waterGlints) {
      const y = horizon + depth * (0.08 + glint.y * 0.88);
      const x =
        width * glint.x +
        Math.sin(phase * 2 + glint.phase) * width * 0.006;
      const moonAffinity = Math.max(0, 1 - Math.abs(x - moonX) / (width * 0.36));
      const alpha =
        glint.alpha *
        (0.015 + moonAffinity * 0.075 + fog * 0.012) *
        (0.5 + 0.5 * Math.sin(phase * 3 + glint.phase));
      ctx.strokeStyle = `rgba(220, 224, 204, ${Math.max(0, alpha)})`;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + width * glint.length, y + 0.4);
      ctx.stroke();
    }

    if (light > 0.04) {
      const lhX = width * 0.805;
      const centerY = horizon + depth * 0.54;
      ctx.save();
      ctx.translate(lhX, centerY);
      ctx.scale(width * 0.07, depth * 0.56);
      const reflectionGlow = ctx.createRadialGradient(0, 0, 0.02, 0, 0, 1);
      reflectionGlow.addColorStop(
        0,
        `rgba(242, 177, 102, ${0.06 + light * 0.075})`,
      );
      reflectionGlow.addColorStop(0.36, `rgba(238, 168, 96, ${0.022 * light})`);
      reflectionGlow.addColorStop(1, "rgba(238, 168, 96, 0)");
      ctx.fillStyle = reflectionGlow;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, TAU);
      ctx.fill();
      ctx.restore();

      for (let index = 0; index < 23; index += 1) {
        const ratio = (index + 1) / 24;
        const y =
          horizon +
          depth * (0.22 + ratio * 0.76) +
          Math.sin(phase * 2 + index * 1.8) * height * 0.002;
        const halfWidth =
          width * (0.006 + ratio * 0.022) *
          (0.72 + 0.28 * Math.sin(index * 2.3 + phase));
        const jitter =
          Math.sin(index * 2.1 + phase) * width * 0.017;
        const alpha =
          light * (0.018 + ratio * 0.015) * (0.6 + fog * 0.4);
        ctx.strokeStyle = `rgba(244, 182, 110, ${alpha})`;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(lhX + jitter - halfWidth, y);
        ctx.lineTo(lhX + jitter + halfWidth, y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawAtmosphere(ctx, width, height, shoreY, fog, phase, light) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (let index = 0; index < 3; index += 1) {
      const x =
        width * (0.18 + index * 0.31) +
        Math.sin(phase + index * 2.2) * width * 0.06;
      const y =
        shoreY +
        height * (0.045 + index * 0.044) +
        Math.sin(phase * 2 + index) * height * 0.006;
      const haze = ctx.createRadialGradient(x, y, 0, x, y, width * 0.25);
      haze.addColorStop(0, `rgba(194, 207, 191, ${0.012 + fog * 0.025})`);
      haze.addColorStop(1, "rgba(194, 207, 191, 0)");
      ctx.fillStyle = haze;
      ctx.beginPath();
      ctx.ellipse(x, y, width * 0.24, height * 0.035, 0, 0, TAU);
      ctx.fill();
    }

    const lowerGlow = ctx.createLinearGradient(0, height * 0.72, 0, height);
    lowerGlow.addColorStop(
      0,
      `rgba(92, 129, 117, ${0.006 + fog * 0.014 + light * 0.006})`,
    );
    lowerGlow.addColorStop(1, "rgba(9, 15, 16, 0)");
    ctx.fillStyle = lowerGlow;
    ctx.fillRect(0, height * 0.66, width, height * 0.34);
    ctx.restore();
  }

  drawGrain(ctx, width, height) {
    const pattern = this.getNoisePattern(ctx);
    if (!pattern) {
      return;
    }
    ctx.save();
    ctx.globalCompositeOperation = "soft-light";
    ctx.globalAlpha = 0.11;
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  drawVignette(ctx, width, height) {
    const vignette = ctx.createRadialGradient(
      width * 0.48,
      height * 0.5,
      Math.min(width, height) * 0.2,
      width * 0.48,
      height * 0.5,
      Math.max(width, height) * 0.78,
    );
    vignette.addColorStop(0, "rgba(2, 8, 10, 0)");
    vignette.addColorStop(0.7, "rgba(2, 8, 10, 0.06)");
    vignette.addColorStop(1, "rgba(2, 7, 8, 0.4)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    const topShade = ctx.createLinearGradient(0, 0, 0, height * 0.18);
    topShade.addColorStop(0, "rgba(1, 5, 7, 0.16)");
    topShade.addColorStop(1, "rgba(1, 5, 7, 0)");
    ctx.fillStyle = topShade;
    ctx.fillRect(0, 0, width, height * 0.18);
  }

  async exportPNG(time, values) {
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = 1920;
    exportCanvas.height = 1080;
    const exportCtx = exportCanvas.getContext("2d", { alpha: false });
    this.drawScene(
      exportCtx,
      exportCanvas.width,
      exportCanvas.height,
      wrapTime(time),
      values,
    );
    return new Promise((resolve, reject) => {
      exportCanvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("PNG 编码失败"));
        }
      }, "image/png");
    });
  }
}
