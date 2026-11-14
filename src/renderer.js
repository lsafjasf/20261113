(function () {
  "use strict";

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const mixColor = (a, b, t) => [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];

  class SaltRenderer {
    constructor(canvas, simulation) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.sim = simulation;
      this.width = 0;
      this.height = 0;
      this.dpr = 1;
      this.time = 0;
      this.renderTime = 0;
      this.rain = [];
      this.evaporation = [];
      this.splashes = [];
      this.bubbles = [];
      this.shake = 0;
      this.flash = 0;
      this.lastPondLevels = simulation.ponds.map((pond) => pond.level);
      this.resize = this.resize.bind(this);
      window.addEventListener("resize", this.resize);
      this.resize();
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.width = Math.max(320, rect.width);
      this.height = Math.max(240, rect.height);
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.canvas.width = Math.round(this.width * this.dpr);
      this.canvas.height = Math.round(this.height * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    get pondTop() { return this.height * 0.35; }
    get pondBottom() { return this.height * 0.83; }
    get horizon() { return this.height * 0.29; }
    get pondHeight() { return this.pondBottom - this.pondTop; }

    pondRect(index) {
      const pond = this.sim.config.ponds[index];
      return {
        x: this.width * pond.x,
        y: this.pondTop,
        w: this.width * pond.width,
        h: this.pondHeight,
      };
    }

    waterY(index) {
      const level = clamp(this.sim.ponds[index].level, 0, 100);
      return this.pondBottom - (level / 100) * this.pondHeight;
    }

    channelY() {
      return this.pondBottom - (clamp(this.sim.tide, 0, 100) / 100) * (this.height * 0.62);
    }

    brineColor(salinity, lightness) {
      const low = [83, 175, 168];
      const middle = [105, 190, 164];
      const rich = [188, 177, 107];
      const high = [213, 161, 78];
      let color;
      if (salinity < 36) color = mixColor(low, middle, clamp((salinity - 26) / 10, 0, 1));
      else if (salinity < 52) color = mixColor(middle, rich, clamp((salinity - 36) / 16, 0, 1));
      else color = mixColor(rich, high, clamp((salinity - 52) / 28, 0, 1));
      if (lightness) {
        return `rgb(${Math.min(255, color[0] + lightness)},${Math.min(255, color[1] + lightness)},${Math.min(255, color[2] + lightness)})`;
      }
      return `rgb(${color[0]},${color[1]},${color[2]})`;
    }

    updateParticles(dt) {
      if (this.sim.status !== "running" || this.sim.paused || this.sim.ended) return;
      const w = this.width;
      const h = this.height;
      const rainRate = this.sim.rainIntensity * 110;
      const rainTarget = Math.floor(clamp(rainRate, 0, 140));
      while (this.rain.length < rainTarget) {
        this.rain.push({
          x: Math.random() * w,
          y: Math.random() * h * 0.65 - h * 0.15,
          speed: 260 + Math.random() * 230,
          length: 5 + Math.random() * 9,
          drift: -22 + Math.random() * 30,
          alpha: 0.2 + Math.random() * 0.35,
        });
      }
      while (this.rain.length > rainTarget) this.rain.pop();
      this.rain.forEach((drop) => {
        drop.y += drop.speed * dt;
        drop.x += drop.drift * dt;
        if (drop.y > h * 1.02) {
          drop.y = -20 - Math.random() * h * 0.3;
          drop.x = Math.random() * w;
        }
      });

      const evaporationRate = this.sim.sunIntensity * 34;
      while (this.evaporation.length < Math.floor(evaporationRate)) {
        const index = Math.floor(Math.random() * 3);
        const rect = this.pondRect(index);
        this.evaporation.push({
          x: rect.x + 8 + Math.random() * (rect.w - 16),
          y: this.waterY(index) - Math.random() * 10,
          life: 0,
          maxLife: 1.3 + Math.random() * 1.7,
          drift: -8 + Math.random() * 16,
          rise: 18 + Math.random() * 28,
          size: 1 + Math.random() * 2,
        });
      }
      if (this.evaporation.length > Math.floor(evaporationRate)) {
        this.evaporation.splice(0, this.evaporation.length - Math.floor(evaporationRate));
      }
      this.evaporation.forEach((particle) => {
        particle.life += dt;
        particle.y -= particle.rise * dt;
        particle.x += particle.drift * dt;
      });
      this.evaporation = this.evaporation.filter((particle) => particle.life < particle.maxLife);

      const flow = this.sim.flows.total;
      if (flow > 0.2 && Math.random() < Math.min(0.7, flow * 0.17)) {
        const index = this.sim.flows.intake > 0.15 ? 0 : this.sim.flows.drain > 0.15 ? 2 : Math.floor(Math.random() * 3);
        const rect = this.pondRect(index);
        this.splashes.push({
          x: rect.x + (this.sim.flows.drain > 0.15 ? rect.w : 0) + (Math.random() - 0.5) * 5,
          y: this.waterY(index) - 2,
          vx: -18 + Math.random() * 36,
          vy: -22 - Math.random() * 35,
          life: 0,
          maxLife: 0.35 + Math.random() * 0.4,
          size: 0.8 + Math.random() * 1.8,
        });
      }
      this.splashes.forEach((drop) => {
        drop.life += dt;
        drop.vy += 110 * dt;
        drop.x += drop.vx * dt;
        drop.y += drop.vy * dt;
      });
      this.splashes = this.splashes.filter((drop) => drop.life < drop.maxLife);

      this.bubbles.forEach((bubble) => {
        bubble.life += dt;
        bubble.y -= bubble.speed * dt;
        bubble.x += Math.sin(bubble.life * 6 + bubble.phase) * 2.4 * dt;
      });
      this.bubbles = this.bubbles.filter((bubble) => bubble.life < bubble.maxLife);
      if (this.sim.flows.pump > 0.1 && Math.random() < 0.14) {
        const pipe = this.pipeGeometry();
        this.bubbles.push({
          x: pipe.x + 7,
          y: pipe.y + pipe.h * 0.5,
          speed: 28 + Math.random() * 24,
          life: 0,
          maxLife: 1.2 + Math.random(),
          phase: Math.random() * 6,
        });
      }
    }

    render(dt) {
      const context = this.ctx;
      if (this.sim.status === "running" && !this.sim.paused && !this.sim.ended) {
        this.time += dt;
      }
      context.save();
      context.clearRect(0, 0, this.width, this.height);
      this.updateParticles(dt);
      this.shake = Math.max(0, this.shake - dt * 9);
      this.flash = Math.max(0, this.flash - dt * 2.5);
      if (this.shake > 0) {
        const amount = Math.min(5, this.shake);
        context.translate((Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount);
      }
      this.drawSky();
      this.drawFarLandscape();
      this.drawChannel();
      this.drawPondBasins();
      this.drawPonds();
      this.drawWeirs();
      this.drawGates();
      this.drawPump();
      this.drawWeather();
      this.drawPondBadges();
      if (this.flash > 0) {
        context.fillStyle = `rgba(255, 218, 156, ${this.flash * 0.16})`;
        context.fillRect(0, 0, this.width, this.height);
      }
      context.restore();
    }

    triggerShake(amount) {
      this.shake = Math.max(this.shake, amount || 5);
    }

    triggerFlash() {
      this.flash = 1;
    }

    drawSky() {
      const ctx = this.ctx;
      const w = this.width;
      const h = this.height;
      const sun = this.sim.sunIntensity;
      const rain = this.sim.rainIntensity;
      const sky = ctx.createLinearGradient(0, 0, 0, this.horizon + 20);
      if (rain > 0.05) {
        sky.addColorStop(0, "#718e91");
        sky.addColorStop(0.6, "#a3b2aa");
        sky.addColorStop(1, "#d0cdb5");
      } else if (sun > 0.3) {
        sky.addColorStop(0, "#7ba4a1");
        sky.addColorStop(0.58, "#bcc6b2");
        sky.addColorStop(1, "#e5d3ad");
      } else {
        sky.addColorStop(0, "#8caaa7");
        sky.addColorStop(0.62, "#c2c9b8");
        sky.addColorStop(1, "#ddd3b9");
      }
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, this.horizon + 40);

      const sunX = w * 0.79;
      const sunY = h * (0.15 - sun * 0.018);
      const glow = ctx.createRadialGradient(sunX, sunY, 3, sunX, sunY, 68 + sun * 48);
      glow.addColorStop(0, `rgba(255, 239, 190, ${0.65 + sun * 0.25})`);
      glow.addColorStop(0.24, `rgba(246, 212, 137, ${0.38 + sun * 0.23})`);
      glow.addColorStop(0.72, "rgba(237, 205, 137, 0.08)");
      glow.addColorStop(1, "rgba(237, 205, 137, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(sunX - 150, sunY - 150, 300, 300);
      ctx.beginPath();
      ctx.arc(sunX, sunY, 14 + sun * 5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 234, 172, ${0.62 + sun * 0.28})`;
      ctx.fill();

      if (sun > 0.45) {
        ctx.save();
        ctx.strokeStyle = `rgba(255, 229, 161, ${sun * 0.2})`;
        ctx.lineWidth = 1;
        for (let i = 0; i < 12; i += 1) {
          const angle = (i / 12) * Math.PI * 2 + this.time * 0.025;
          ctx.beginPath();
          ctx.moveTo(sunX + Math.cos(angle) * (25 + sun * 8), sunY + Math.sin(angle) * (25 + sun * 8));
          ctx.lineTo(sunX + Math.cos(angle) * 85, sunY + Math.sin(angle) * 85);
          ctx.stroke();
        }
        ctx.restore();
      }

      this.drawCloud(w * 0.18 + Math.sin(this.time * 0.018) * 12, h * 0.12, 1.1, rain);
      this.drawCloud(w * 0.52 + Math.sin(this.time * 0.012 + 2) * 15, h * 0.08, 0.72, rain * 0.9);
      this.drawCloud(w * 0.93 - Math.sin(this.time * 0.014 + 1) * 8, h * 0.19, 0.59, rain * 0.55);

      if (rain > 0.12) {
        const overcast = ctx.createLinearGradient(0, 0, 0, this.horizon);
        overcast.addColorStop(0, `rgba(47, 70, 76, ${rain * 0.24})`);
        overcast.addColorStop(1, "rgba(47, 70, 76, 0)");
        ctx.fillStyle = overcast;
        ctx.fillRect(0, 0, w, this.horizon);
      }
    }

    drawCloud(x, y, scale, darkness) {
      const ctx = this.ctx;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.fillStyle = `rgba(${224 - darkness * 40}, ${230 - darkness * 40}, ${220 - darkness * 28}, 0.58)`;
      ctx.beginPath();
      ctx.ellipse(0, 8, 58, 16, 0, 0, Math.PI * 2);
      ctx.ellipse(-26, 1, 27, 17, 0, 0, Math.PI * 2);
      ctx.ellipse(9, -7, 32, 23, 0, 0, Math.PI * 2);
      ctx.ellipse(38, 3, 22, 15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    drawFarLandscape() {
      const ctx = this.ctx;
      const w = this.width;
      const h = this.height;
      const horizon = this.horizon;

      ctx.beginPath();
      ctx.moveTo(0, horizon);
      ctx.lineTo(w * 0.08, horizon - h * 0.045);
      ctx.lineTo(w * 0.19, horizon - h * 0.018);
      ctx.lineTo(w * 0.31, horizon - h * 0.058);
      ctx.lineTo(w * 0.43, horizon - h * 0.022);
      ctx.lineTo(w * 0.55, horizon - h * 0.047);
      ctx.lineTo(w * 0.7, horizon - h * 0.015);
      ctx.lineTo(w * 0.84, horizon - h * 0.04);
      ctx.lineTo(w, horizon - h * 0.01);
      ctx.lineTo(w, horizon + h * 0.19);
      ctx.lineTo(0, horizon + h * 0.19);
      ctx.closePath();
      const hills = ctx.createLinearGradient(0, horizon - 40, 0, horizon + 115);
      hills.addColorStop(0, "rgba(76, 111, 99, 0.67)");
      hills.addColorStop(1, "rgba(75, 103, 82, 0.82)");
      ctx.fillStyle = hills;
      ctx.fill();

      ctx.fillStyle = "rgba(201, 191, 153, 0.72)";
      for (let i = 0; i < 8; i += 1) {
        const x = w * (0.04 + i * 0.135) + Math.sin(i * 4.4) * 14;
        const base = horizon + h * 0.07 + (i % 3) * 5;
        ctx.beginPath();
        ctx.moveTo(x - 17, base);
        ctx.quadraticCurveTo(x - 5, base - 17 - (i % 2) * 8, x + 5, base - 5);
        ctx.quadraticCurveTo(x + 16, base - 13, x + 19, base);
        ctx.closePath();
        ctx.fill();
      }

      ctx.strokeStyle = "rgba(36, 76, 68, 0.38)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, horizon + 1);
      ctx.lineTo(w, horizon + 1);
      ctx.stroke();

      this.drawWindpump(w * 0.12, horizon + h * 0.04, h * 0.07);
      this.drawWindpump(w * 0.89, horizon + h * 0.06, h * 0.055);
    }

    drawWindpump(x, baseY, height) {
      const ctx = this.ctx;
      ctx.save();
      ctx.strokeStyle = "rgba(43, 73, 65, 0.6)";
      ctx.fillStyle = "rgba(49, 81, 72, 0.48)";
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(x - 5, baseY);
      ctx.lineTo(x, baseY - height);
      ctx.lineTo(x + 5, baseY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - height * 0.33, baseY - height * 0.2);
      ctx.lineTo(x + height * 0.34, baseY - height * 0.16);
      ctx.stroke();
      const spin = this.time * 0.45;
      for (let i = 0; i < 8; i += 1) {
        const angle = spin + (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(x, baseY - height);
        ctx.lineTo(x + Math.cos(angle) * height * 0.13, baseY - height + Math.sin(angle) * height * 0.13);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawChannel() {
      const ctx = this.ctx;
      const w = this.width;
      const h = this.height;
      const channelRight = w * 0.173;
      const groundTop = this.horizon + h * 0.035;

      ctx.fillStyle = "#7e906f";
      ctx.fillRect(0, groundTop, channelRight, h - groundTop);
      const earth = ctx.createLinearGradient(0, groundTop, 0, h);
      earth.addColorStop(0, "rgba(137, 143, 103, 0.78)");
      earth.addColorStop(1, "rgba(77, 91, 70, 0.95)");
      ctx.fillStyle = earth;
      ctx.fillRect(0, groundTop, channelRight, h - groundTop);

      const channelSurface = this.channelY();
      const channelWater = ctx.createLinearGradient(0, channelSurface, 0, this.pondBottom);
      channelWater.addColorStop(0, "rgba(78, 167, 163, 0.88)");
      channelWater.addColorStop(0.58, "rgba(46, 123, 125, 0.94)");
      channelWater.addColorStop(1, "rgba(31, 83, 86, 0.98)");
      ctx.fillStyle = channelWater;
      ctx.fillRect(w * 0.018, channelSurface, channelRight - w * 0.018, this.pondBottom - channelSurface);

      ctx.strokeStyle = "rgba(214, 242, 224, 0.42)";
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (let x = w * 0.02; x <= channelRight; x += 8) {
        const y = channelSurface + Math.sin(x * 0.09 + this.time * 0.8) * 1.4;
        if (x === w * 0.02) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.fillStyle = "rgba(233, 242, 218, 0.34)";
      for (let i = 0; i < 5; i += 1) {
        const y = channelSurface + ((this.time * 9 + i * 15) % Math.max(35, this.pondBottom - channelSurface));
        ctx.beginPath();
        ctx.ellipse(w * (0.06 + (i % 3) * 0.034), y, 10 + i * 2, 1, -0.1, 0, Math.PI * 2);
        ctx.fill();
      }

      const bank = ctx.createLinearGradient(channelRight - w * 0.022, 0, channelRight + w * 0.008, 0);
      bank.addColorStop(0, "#8e896d");
      bank.addColorStop(0.26, "#b2aa84");
      bank.addColorStop(0.56, "#89876b");
      bank.addColorStop(1, "#76745d");
      ctx.fillStyle = bank;
      ctx.beginPath();
      ctx.moveTo(channelRight - w * 0.023, this.pondBottom + 4);
      ctx.lineTo(channelRight - w * 0.02, groundTop);
      ctx.lineTo(channelRight + w * 0.002, groundTop);
      ctx.lineTo(channelRight + w * 0.005, this.pondBottom + 6);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = "rgba(62, 66, 50, 0.34)";
      ctx.lineWidth = 1;
      for (let y = groundTop + 10; y < this.pondBottom; y += 11) {
        ctx.beginPath();
        ctx.moveTo(channelRight - w * 0.019, y);
        ctx.lineTo(channelRight - w * 0.001, y + 2);
        ctx.stroke();
      }

      for (let i = 0; i < 6; i += 1) {
        const x = w * 0.022 + i * w * 0.022;
        const base = this.pondBottom - 4;
        ctx.strokeStyle = "rgba(53, 85, 63, 0.65)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, base);
        ctx.quadraticCurveTo(x - 4, base - 18 - (i % 3) * 4, x - 9, base - 28 - (i % 3) * 5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + 2, base);
        ctx.quadraticCurveTo(x + 8, base - 15, x + 12, base - 23 + (i % 2) * 5);
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(21, 50, 49, 0.78)";
      ctx.fillRect(w * 0.019, channelSurface - 3, w * 0.014, 3);
      ctx.strokeStyle = "rgba(239, 233, 198, 0.42)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 7; i += 1) {
        const y = this.pondBottom - (i / 7) * h * 0.55;
        ctx.beginPath();
        ctx.moveTo(w * 0.021, y);
        ctx.lineTo(w * 0.031, y);
        ctx.stroke();
      }
    }

    drawPondBasins() {
      const ctx = this.ctx;
      const w = this.width;
      const h = this.height;
      const groundTop = this.pondTop - h * 0.035;

      const field = ctx.createLinearGradient(0, groundTop, 0, h);
      field.addColorStop(0, "#a9aa82");
      field.addColorStop(0.55, "#8d966f");
      field.addColorStop(1, "#61715b");
      ctx.fillStyle = field;
      ctx.fillRect(w * 0.176, groundTop, w * 0.824, h - groundTop);

      ctx.fillStyle = "rgba(110, 104, 77, 0.32)";
      for (let i = 0; i < 34; i += 1) {
        const x = w * (0.19 + i * 0.025) + Math.sin(i * 3.2) * 6;
        const y = groundTop + 13 + (i % 5) * 7;
        ctx.beginPath();
        ctx.arc(x, y, 0.8 + (i % 3) * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }

      this.sim.config.ponds.forEach((source, index) => {
        const rect = this.pondRect(index);
        const wall = w * 0.013;
        ctx.fillStyle = "rgba(45, 55, 44, 0.5)";
        ctx.fillRect(rect.x - wall * 0.6, rect.y + 3, rect.w + wall * 1.2, rect.h + 9);
        ctx.fillStyle = "#5f6451";
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        const basin = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.h);
        basin.addColorStop(0, "rgba(43, 54, 48, 0.35)");
        basin.addColorStop(1, "rgba(32, 47, 41, 0.82)");
        ctx.fillStyle = basin;
        ctx.fillRect(rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 2);
      });
    }

    drawPonds() {
      const ctx = this.ctx;
      this.sim.ponds.forEach((pond, index) => {
        const rect = this.pondRect(index);
        const surfaceY = this.waterY(index);
        const waterHeight = this.pondBottom - surfaceY;
        const color = this.brineColor(pond.salinity);
        const colorLight = this.brineColor(pond.salinity, 18);
        const colorDark = this.brineColor(pond.salinity, -24);

        ctx.save();
        ctx.beginPath();
        ctx.rect(rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 2);
        ctx.clip();

        const mud = ctx.createLinearGradient(0, this.pondBottom - 16, 0, this.pondBottom);
        mud.addColorStop(0, "rgba(58, 69, 52, 0.52)");
        mud.addColorStop(1, "rgba(39, 53, 44, 0.86)");
        ctx.fillStyle = mud;
        ctx.fillRect(rect.x, this.pondBottom - 17, rect.w, 17);

        const water = ctx.createLinearGradient(0, surfaceY, 0, this.pondBottom);
        water.addColorStop(0, colorLight);
        water.addColorStop(0.38, color);
        water.addColorStop(1, colorDark);
        ctx.globalAlpha = 0.91;
        ctx.fillStyle = water;
        ctx.fillRect(rect.x, surfaceY, rect.w, waterHeight);
        ctx.globalAlpha = 1;

        const bandCount = 4;
        for (let band = 0; band < bandCount; band += 1) {
          const bandY = surfaceY + (waterHeight * (band + 1)) / (bandCount + 1);
          const bandH = Math.max(3, waterHeight * 0.035);
          ctx.globalAlpha = 0.055 + band * 0.025;
          ctx.fillStyle = band % 2 === 0 ? "#f4e4ac" : "#2a807c";
          ctx.fillRect(rect.x, bandY + Math.sin(this.time * 0.35 + band + index) * 1.4, rect.w, bandH);
        }
        ctx.globalAlpha = 1;

        ctx.globalAlpha = 0.12;
        ctx.strokeStyle = "#f4ecd7";
        ctx.lineWidth = 1;
        for (let line = 0; line < 5; line += 1) {
          const lineY = surfaceY + 17 + line * (waterHeight / 6);
          ctx.beginPath();
          for (let x = rect.x + 7; x < rect.x + rect.w - 6; x += 11) {
            const y = lineY + Math.sin(x * 0.065 + this.time * 0.42 + line) * 1.1;
            if (x === rect.x + 7) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;

        const saltDeposit = clamp((pond.salinity - 43) / 25, 0, 1);
        if (saltDeposit > 0.02) {
          this.drawSaltCrust(rect, pond, index, saltDeposit, surfaceY);
        }

        const surface = ctx.createLinearGradient(0, surfaceY - 4, 0, surfaceY + 5);
        surface.addColorStop(0, "rgba(238, 247, 220, 0.84)");
        surface.addColorStop(1, "rgba(106, 181, 165, 0.38)");
        ctx.fillStyle = surface;
        ctx.beginPath();
        ctx.moveTo(rect.x, surfaceY);
        for (let x = rect.x; x <= rect.x + rect.w; x += 8) {
          const y = surfaceY + Math.sin(x * 0.08 + this.time * 0.75 + index) * 1.4;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(rect.x + rect.w, surfaceY + 4);
        ctx.lineTo(rect.x, surfaceY + 4);
        ctx.closePath();
        ctx.fill();

        this.drawPondWall(rect, index, pond.level);
        ctx.restore();

        ctx.save();
        ctx.strokeStyle = "rgba(239, 227, 190, 0.6)";
        ctx.lineWidth = 1;
        const rulerX = rect.x + rect.w - 8;
        for (let tick = 0; tick <= 10; tick += 1) {
          const y = this.pondBottom - (tick / 10) * rect.h;
          ctx.globalAlpha = tick % 5 === 0 ? 0.65 : 0.25;
          ctx.beginPath();
          ctx.moveTo(rulerX - (tick % 5 === 0 ? 8 : 4), y);
          ctx.lineTo(rulerX, y);
          ctx.stroke();
        }
        const warningY = this.pondBottom - (18 / 100) * rect.h;
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = "rgba(255, 179, 130, 0.72)";
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(rect.x + 2, warningY);
        ctx.lineTo(rect.x + rect.w - 2, warningY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;

        ctx.fillStyle = "rgba(244, 237, 215, 0.7)";
        ctx.font = '600 9px "Salt Sans", sans-serif';
        ctx.fillText(`水位 ${pond.level.toFixed(0)}%`, rect.x + 8, this.pondBottom - 6);
        ctx.restore();
      });
    }

    drawSaltCrust(rect, pond, index, amount, surfaceY) {
      const ctx = this.ctx;
      ctx.save();
      ctx.globalAlpha = 0.18 + amount * 0.68;
      ctx.fillStyle = "#f1ead2";
      const count = 5 + Math.floor(amount * 7);
      for (let i = 0; i < count; i += 1) {
        const seed = i * 13.37 + index * 27.1;
        const x = rect.x + 9 + ((Math.sin(seed) + 1) / 2) * (rect.w - 18);
        const y = this.pondBottom - 5 - ((Math.cos(seed * 1.3) + 1) / 2) * (this.pondBottom - surfaceY) * 0.72;
        const size = 2.4 + (i % 4) * 1.25 + amount * 2.2;
        ctx.beginPath();
        ctx.moveTo(x, y - size);
        ctx.lineTo(x + size, y + size * 0.35);
        ctx.lineTo(x - size * 0.7, y + size * 0.55);
        ctx.closePath();
        ctx.fill();
      }
      if (amount > 0.4) {
        ctx.globalAlpha = amount * 0.26;
        ctx.strokeStyle = "#fff8e2";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < 12; i += 1) {
          const x = rect.x + 7 + i * (rect.w - 14) / 11;
          const y = surfaceY + 2 + Math.sin(i * 2.7) * 1.4;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    drawPondWall(rect, index, level) {
      const ctx = this.ctx;
      const wallW = 4;
      const left = ctx.createLinearGradient(rect.x, 0, rect.x + wallW, 0);
      left.addColorStop(0, "rgba(109, 105, 79, 0.94)");
      left.addColorStop(1, "rgba(72, 78, 62, 0.36)");
      ctx.fillStyle = left;
      ctx.fillRect(rect.x, rect.y, wallW, rect.h);
      const right = ctx.createLinearGradient(rect.x + rect.w - wallW, 0, rect.x + rect.w, 0);
      right.addColorStop(0, "rgba(72, 78, 62, 0.36)");
      right.addColorStop(1, "rgba(109, 105, 79, 0.94)");
      ctx.fillStyle = right;
      ctx.fillRect(rect.x + rect.w - wallW, rect.y, wallW, rect.h);
      ctx.fillStyle = "rgba(232, 223, 190, 0.34)";
      ctx.fillRect(rect.x, rect.y, rect.w, 3);
      ctx.fillStyle = "rgba(54, 70, 53, 0.56)";
      ctx.fillRect(rect.x, rect.y + 3, rect.w, 5);
      if (level > 88) {
        ctx.globalAlpha = 0.45 + Math.sin(this.time * 8) * 0.15;
        ctx.fillStyle = "#ffb083";
        ctx.fillRect(rect.x, rect.y - 2, rect.w, 3);
        ctx.globalAlpha = 1;
      }
    }

    drawWeirs() {
      const ctx = this.ctx;
      const w = this.width;
      const gaps = [
        { x: this.pondRect(0).x + this.pondRect(0).w, flow: this.sim.flows.weir12, upstream: 0, notchLevel: 57 },
        { x: this.pondRect(1).x + this.pondRect(1).w, flow: this.sim.flows.weir23, upstream: 1, notchLevel: 55 },
      ];
      gaps.forEach((gap) => {
        const x = gap.x + w * 0.0035;
        const notchY = this.pondBottom - (gap.notchLevel / 100) * this.pondHeight;
        ctx.fillStyle = "#6c7059";
        ctx.fillRect(x - w * 0.004, this.pondTop, w * 0.008, this.pondHeight);
        ctx.fillStyle = "#494f40";
        ctx.fillRect(x - w * 0.0055, notchY, w * 0.011, this.pondBottom - notchY);
        ctx.fillStyle = "rgba(209, 198, 160, 0.7)";
        ctx.fillRect(x - w * 0.006, notchY - 3, w * 0.012, 4);
        ctx.fillStyle = "rgba(36, 50, 44, 0.7)";
        ctx.fillRect(x - w * 0.0038, notchY + 3, w * 0.0076, this.pondBottom - notchY - 3);

        if (gap.flow > 0.14) {
          const upstreamY = this.waterY(gap.upstream);
          const downstreamY = this.waterY(gap.upstream + 1);
          const startY = Math.min(upstreamY + 2, notchY + 8);
          const stream = ctx.createLinearGradient(0, startY, 0, Math.max(startY + 8, downstreamY));
          stream.addColorStop(0, "rgba(134, 210, 196, 0.82)");
          stream.addColorStop(1, "rgba(62, 151, 145, 0.5)");
          ctx.fillStyle = stream;
          ctx.beginPath();
          ctx.moveTo(x - w * 0.0032, startY);
          ctx.quadraticCurveTo(x - w * 0.0007, notchY + 2, x + w * 0.0008, notchY + 4);
          ctx.quadraticCurveTo(x + w * 0.0032, Math.max(notchY + 10, downstreamY + 5), x + w * 0.0042, downstreamY + 3);
          ctx.lineTo(x + w * 0.0073, downstreamY + 4);
          ctx.quadraticCurveTo(x + w * 0.0065, notchY + 5, x + w * 0.0027, notchY + 3);
          ctx.quadraticCurveTo(x + w * 0.0017, notchY, x + w * 0.0007, startY);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 0.4;
          ctx.fillStyle = "#e6f3df";
          for (let i = 0; i < 3; i += 1) {
            const py = notchY + 8 + ((this.time * 46 + i * 21) % Math.max(10, downstreamY - notchY + 10));
            ctx.beginPath();
            ctx.arc(x + (i - 1) * 3.5, py, 1.2, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
      });
    }

    drawGates() {
      this.drawGateA();
      this.drawGateB();
    }

    drawGateA() {
      const ctx = this.ctx;
      const rect = this.pondRect(0);
      const gateX = rect.x - this.width * 0.018;
      const frameTop = this.pondTop + this.height * 0.035;
      const frameBottom = this.pondBottom - this.height * 0.025;
      const opening = this.sim.gates.a;

      this.drawGateFrame(gateX, frameTop, frameBottom, opening, false);

      if (this.sim.flows.intake > 0.08) {
        const channelSurface = this.channelY();
        const pondSurface = this.waterY(0);
        const startY = Math.max(channelSurface, pondSurface) + 11;
        const endY = pondSurface + 4;
        const stream = ctx.createLinearGradient(0, startY, 0, endY);
        stream.addColorStop(0, "rgba(104, 196, 184, 0.7)");
        stream.addColorStop(0.56, "rgba(142, 219, 202, 0.92)");
        stream.addColorStop(1, "rgba(87, 177, 165, 0.74)");
        ctx.fillStyle = stream;
        ctx.beginPath();
        ctx.moveTo(this.width * 0.163, startY);
        ctx.quadraticCurveTo(gateX, startY - 9, rect.x + 2, endY);
        ctx.lineTo(rect.x + 2, endY + 8 + Math.min(14, this.sim.flows.intake * 2));
        ctx.quadraticCurveTo(gateX, startY + 8, this.width * 0.163, startY + 10);
        ctx.closePath();
        ctx.fill();

        ctx.globalAlpha = 0.7;
        ctx.fillStyle = "#e9f7e7";
        for (let i = 0; i < 5; i += 1) {
          const t = (this.time * 0.8 + i * 0.18) % 1;
          const x = lerp(this.width * 0.164, rect.x, t);
          const y = lerp(startY + 4, endY + 3, t) + Math.sin(t * Math.PI) * 4;
          ctx.beginPath();
          ctx.arc(x, y, 1.2 + (i % 2), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      ctx.fillStyle = "rgba(27, 53, 50, 0.7)";
      ctx.font = '600 9px "Salt Sans", sans-serif';
      ctx.fillText("A · 进水", gateX - 9, frameTop - 6);
    }

    drawGateB() {
      const ctx = this.ctx;
      const rect = this.pondRect(2);
      const gateX = rect.x + rect.w + this.width * 0.016;
      const frameTop = this.pondTop + this.height * 0.05;
      const frameBottom = this.pondBottom - this.height * 0.018;
      const opening = this.sim.gates.b;
      const drainSurface = this.pondBottom - 7;

      const flume = ctx.createLinearGradient(0, drainSurface - 12, 0, this.pondBottom + 8);
      flume.addColorStop(0, "rgba(90, 165, 156, 0.76)");
      flume.addColorStop(1, "rgba(41, 99, 96, 0.94)");
      ctx.fillStyle = flume;
      ctx.fillRect(rect.x + rect.w + this.width * 0.006, drainSurface - 4, this.width - (rect.x + rect.w) - this.width * 0.006, this.pondBottom - drainSurface + 8);

      if (this.sim.flows.drain > 0.08) {
        const pondSurface = this.waterY(2);
        const stream = ctx.createLinearGradient(0, pondSurface, 0, drainSurface);
        stream.addColorStop(0, "rgba(133, 204, 184, 0.95)");
        stream.addColorStop(1, "rgba(54, 135, 131, 0.66)");
        ctx.fillStyle = stream;
        ctx.beginPath();
        ctx.moveTo(rect.x + rect.w - 1, pondSurface + 2);
        ctx.quadraticCurveTo(rect.x + rect.w + 10, pondSurface + 7, gateX - 4, drainSurface - 2);
        ctx.lineTo(gateX + 3, drainSurface + 1);
        ctx.quadraticCurveTo(rect.x + rect.w + 3, Math.min(pondSurface + 18, drainSurface - 10), rect.x + rect.w - 1, pondSurface + 9);
        ctx.closePath();
        ctx.fill();
      }
      this.drawGateFrame(gateX, frameTop, frameBottom, opening, true);
      ctx.fillStyle = "rgba(27, 53, 50, 0.7)";
      ctx.font = '600 9px "Salt Sans", sans-serif';
      ctx.fillText("B · 排水", gateX - 8, frameTop - 6);
    }

    drawGateFrame(x, top, bottom, opening, drain) {
      const ctx = this.ctx;
      const frameW = 18;
      const metal = drain ? "#7f6857" : "#526e68";
      ctx.fillStyle = "rgba(35, 48, 40, 0.38)";
      ctx.fillRect(x - frameW / 2 - 4, top, frameW + 8, bottom - top);
      ctx.fillStyle = "#706d58";
      ctx.fillRect(x - frameW / 2 - 4, top, 5, bottom - top);
      ctx.fillRect(x + frameW / 2 - 1, top, 5, bottom - top);
      ctx.fillStyle = "#454c3e";
      ctx.fillRect(x - frameW / 2 + 1, top + 8, frameW - 2, bottom - top - 12);

      const leafTravel = 48;
      const leafY = top + 7 - opening * leafTravel * 0.78;
      const leafH = Math.max(21, (bottom - top) * 0.28);
      const leaf = ctx.createLinearGradient(x - frameW / 2, 0, x + frameW / 2, 0);
      leaf.addColorStop(0, "#4a554d");
      leaf.addColorStop(0.35, metal);
      leaf.addColorStop(0.52, "#9aa99c");
      leaf.addColorStop(0.74, metal);
      leaf.addColorStop(1, "#38453f");
      ctx.fillStyle = leaf;
      ctx.fillRect(x - frameW / 2 + 1, leafY, frameW - 2, leafH);
      ctx.strokeStyle = "rgba(20, 40, 38, 0.46)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x - frameW / 2 + 1, leafY, frameW - 2, leafH);
      for (let i = 1; i < 4; i += 1) {
        ctx.beginPath();
        ctx.moveTo(x - frameW / 2 + 2, leafY + (leafH / 4) * i);
        ctx.lineTo(x + frameW / 2 - 2, leafY + (leafH / 4) * i);
        ctx.stroke();
      }

      const wheelY = top - 6;
      ctx.strokeStyle = drain ? "#b37a59" : "#c3ad7a";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(x, wheelY, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, wheelY + 7);
      ctx.stroke();
      const wheelAngle = opening * Math.PI * 2.2;
      for (let i = 0; i < 4; i += 1) {
        const angle = wheelAngle + (i / 4) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(x, wheelY);
        ctx.lineTo(x + Math.cos(angle) * 6, wheelY + Math.sin(angle) * 6);
        ctx.stroke();
      }
    }

    pipeGeometry() {
      const first = this.pondRect(0);
      const last = this.pondRect(2);
      const y = this.pondTop - this.height * 0.036;
      return {
        x: first.x + this.width * 0.02,
        y,
        w: last.x + last.w - (first.x + this.width * 0.02),
        h: 8,
      };
    }

    drawPump() {
      const ctx = this.ctx;
      const pipe = this.pipeGeometry();
      const housingX = pipe.x + pipe.w * 0.54;
      const housingY = pipe.y + pipe.h / 2;
      const on = this.sim.pump.on && this.sim.ponds[2].level > 18;

      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#1d352f";
      ctx.fillRect(pipe.x + 3, pipe.y + 4, pipe.w, pipe.h + 2);
      ctx.beginPath();
      ctx.arc(housingX, housingY + 4, 17, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.strokeStyle = "#435b52";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(this.pondRect(0).x + this.width * 0.004, this.pondTop + 15);
      ctx.lineTo(pipe.x, pipe.y + pipe.h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(this.pondRect(2).x + this.pondRect(2).w - this.width * 0.008, this.pondTop + 15);
      ctx.lineTo(pipe.x + pipe.w, pipe.y + pipe.h);
      ctx.stroke();

      const pipeFill = ctx.createLinearGradient(0, pipe.y, 0, pipe.y + pipe.h);
      pipeFill.addColorStop(0, "#6d8174");
      pipeFill.addColorStop(0.3, "#aab2a0");
      pipeFill.addColorStop(1, "#4e6057");
      ctx.fillStyle = pipeFill;
      ctx.fillRect(pipe.x, pipe.y, pipe.w, pipe.h);
      ctx.strokeStyle = "rgba(39, 57, 49, 0.68)";
      ctx.lineWidth = 1;
      ctx.strokeRect(pipe.x, pipe.y, pipe.w, pipe.h);

      if (on) {
        ctx.globalAlpha = 0.72;
        ctx.fillStyle = "#9ddbd0";
        const dashOffset = (this.time * 38) % 14;
        for (let x = pipe.x + pipe.w - 4 + dashOffset; x > pipe.x; x -= 14) {
          ctx.fillRect(x, pipe.y + 2, 7, 2);
        }
        ctx.globalAlpha = 1;
      }

      ctx.fillStyle = "#314b45";
      ctx.beginPath();
      ctx.roundRect(housingX - 19, housingY - 13, 38, 26, 3);
      ctx.fill();
      ctx.strokeStyle = "rgba(232, 225, 196, 0.44)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = on ? "#d4ad68" : "#7d8b7e";
      ctx.beginPath();
      ctx.arc(housingX, housingY, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#263e38";
      const spin = on ? this.time * 4.5 : 0.7;
      for (let i = 0; i < 3; i += 1) {
        const angle = spin + (i / 3) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(housingX, housingY);
        ctx.lineTo(housingX + Math.cos(angle) * 6.5, housingY + Math.sin(angle) * 6.5);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(239, 233, 210, 0.66)";
      ctx.font = '600 8px "Salt Sans", sans-serif';
      ctx.fillText("P-01 循环泵", housingX - 26, housingY - 17);
      ctx.restore();
    }

    drawWeather() {
      const ctx = this.ctx;
      if (this.rain.length) {
        ctx.save();
        ctx.strokeStyle = "rgba(214, 237, 238, 0.68)";
        ctx.lineWidth = 1;
        this.rain.forEach((drop) => {
          ctx.globalAlpha = drop.alpha;
          ctx.beginPath();
          ctx.moveTo(drop.x, drop.y);
          ctx.lineTo(drop.x + drop.drift * 0.07, drop.y + drop.length);
          ctx.stroke();
        });
        ctx.restore();
      }

      if (this.evaporation.length) {
        ctx.save();
        this.evaporation.forEach((particle) => {
          const progress = particle.life / particle.maxLife;
          ctx.globalAlpha = Math.sin(progress * Math.PI) * 0.42;
          ctx.strokeStyle = "#eaf0d6";
          ctx.lineWidth = particle.size * 0.65;
          ctx.beginPath();
          ctx.moveTo(particle.x, particle.y + 5);
          ctx.quadraticCurveTo(
            particle.x + Math.sin(progress * 5 + particle.x) * 4,
            particle.y + 1,
            particle.x,
            particle.y - 3
          );
          ctx.stroke();
        });
        ctx.restore();
      }

      if (this.splashes.length) {
        ctx.fillStyle = "rgba(221, 241, 226, 0.7)";
        this.splashes.forEach((drop) => {
          ctx.globalAlpha = 1 - drop.life / drop.maxLife;
          ctx.beginPath();
          ctx.arc(drop.x, drop.y, drop.size, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
      }

      if (this.bubbles.length) {
        const pipe = this.pipeGeometry();
        ctx.save();
        ctx.beginPath();
        ctx.rect(pipe.x, pipe.y, pipe.w, pipe.h);
        ctx.clip();
        ctx.strokeStyle = "rgba(224, 250, 233, 0.68)";
        ctx.lineWidth = 1;
        this.bubbles.forEach((bubble) => {
          ctx.globalAlpha = 1 - bubble.life / bubble.maxLife;
          ctx.beginPath();
          ctx.arc(bubble.x, bubble.y, 1.4, 0, Math.PI * 2);
          ctx.stroke();
        });
        ctx.restore();
      }
    }

    drawPondBadges() {
      const ctx = this.ctx;
      this.sim.ponds.forEach((pond, index) => {
        const rect = this.pondRect(index);
        const state = this.sim.pondState(pond);
        const isDanger = state.key === "danger";
        const isReady = state.key === "ready";
        const x = rect.x + rect.w / 2;
        const y = this.pondTop + 13;

        ctx.save();
        ctx.fillStyle = "rgba(21, 54, 52, 0.68)";
        ctx.beginPath();
        ctx.roundRect(rect.x + 9, y - 9, Math.min(rect.w - 18, 86), 18, 2);
        ctx.fill();
        ctx.fillStyle = "rgba(245, 240, 220, 0.9)";
        ctx.font = '600 9px "Salt Sans", sans-serif';
        ctx.fillText(`${pond.name} · ${pond.salinity.toFixed(0)}‰`, rect.x + 15, y + 3);
        ctx.fillStyle = pond.level < 25 || pond.level > 88 ? "#ffb69a" : "rgba(194, 230, 213, 0.88)";
        ctx.textAlign = "right";
        ctx.fillText(`${pond.level.toFixed(0)}%`, rect.x + rect.w - 14, y + 3);
        ctx.textAlign = "left";

        if (isDanger) {
          const pulse = 0.72 + Math.sin(this.time * 6) * 0.18;
          ctx.globalAlpha = pulse;
          ctx.fillStyle = "#a43e2f";
          ctx.beginPath();
          ctx.roundRect(x - 42, this.pondBottom - this.pondHeight * 0.81, 84, 20, 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.fillStyle = "#ffeddc";
          ctx.font = '700 9px "Salt Sans", sans-serif';
          ctx.textAlign = "center";
          const label = pond.drySeconds > 0
            ? `${pond.name}干涸 ${Math.max(0, 10 - pond.drySeconds).toFixed(1)}s`
            : pond.level >= 92 ? `${pond.name}即将满溢` : `${pond.name}水位异常`;
          ctx.fillText(label, x, this.pondBottom - this.pondHeight * 0.81 + 13);
          ctx.textAlign = "left";
        } else if (isReady) {
          const pulse = 1 + Math.sin(this.time * 4.5) * 0.035;
          ctx.save();
          ctx.translate(x, this.waterY(index) - 15);
          ctx.scale(pulse, pulse);
          ctx.fillStyle = "#b45b3d";
          ctx.beginPath();
          ctx.roundRect(-33, -11, 66, 21, 2);
          ctx.fill();
          ctx.fillStyle = "#fff4df";
          ctx.font = '700 9px "Salt Sans", sans-serif';
          ctx.textAlign = "center";
          ctx.fillText("盐度达标 · 可收", 0, 3);
          ctx.textAlign = "left";
          ctx.restore();
        }
        ctx.restore();
      });
    }
  }

  window.SaltRenderer = SaltRenderer;
})();
