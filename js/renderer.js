import { GAME, STATIONS } from "./config.js";

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

export class SnowlineRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.scenario = null;
    this.sim = null;
    this.previewStops = STATIONS.map(() => true);
    this.stationPoints = [];
    this.segments = [];
    this.snow = [];
    this.time = 0;
    this.ridges = [];
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.layoutScene();
    this.buildSnow();
  }

  layoutScene() {
    this.stationPoints = STATIONS.map((station) => ({
      x: this.width * station.x,
      y: this.height * (0.17 + station.y * 0.32),
    }));
    this.segments = [];
    for (let index = 0; index < this.stationPoints.length - 1; index += 1) {
      const left = this.stationPoints[index];
      const right = this.stationPoints[index + 1];
      const span = right.x - left.x;
      this.segments.push({
        p0: left,
        p1: right,
        control: {
          x: (left.x + right.x) / 2,
          y: Math.max(left.y, right.y) + Math.max(22, span * 0.1),
        },
      });
    }
    this.buildRidges();
  }

  buildRidges() {
    const definitions = [
      { base: 0.56, amp: 0.16, step: 62, color: "#638694", alpha: 0.24, phase: 1.2 },
      { base: 0.66, amp: 0.12, step: 48, color: "#3c6170", alpha: 0.4, phase: 4.7 },
      { base: 0.78, amp: 0.09, step: 38, color: "#1a3c4c", alpha: 0.75, phase: 8.1 },
    ];
    this.ridges = definitions.map((definition) => {
      const points = [];
      for (let x = -40; x <= this.width + 40; x += definition.step) {
        const ridge =
          Math.sin(x * 0.008 + definition.phase) * definition.amp +
          Math.sin(x * 0.021 + definition.phase * 1.9) * definition.amp * 0.34 +
          Math.sin(x * 0.0037 + definition.phase * 0.7) * definition.amp * 0.58;
        points.push({ x, y: this.height * (definition.base - ridge) });
      }
      return { ...definition, points };
    });
  }

  buildSnow() {
    const target = Math.max(100, Math.round((this.width * this.height) / 5200));
    this.snow = Array.from({ length: target }, () => ({
      x: Math.random() * this.width,
      y: Math.random() * this.height,
      radius: 0.5 + Math.random() * 1.8,
      fall: 14 + Math.random() * 42,
      drift: 0.55 + Math.random() * 0.9,
      alpha: 0.24 + Math.random() * 0.62,
      phase: Math.random() * Math.PI * 2,
    }));
  }

  setScenario(scenario, sim = null) {
    this.scenario = scenario;
    this.sim = sim;
  }

  setPreviewStops(stops) {
    this.previewStops = [...stops];
  }

  pointAt(distance) {
    const total = STATIONS[STATIONS.length - 1].distance;
    const clampedDistance = Math.max(0, Math.min(total, distance));
    let segmentIndex = this.segments.length - 1;
    for (let index = 0; index < STATIONS.length - 1; index += 1) {
      if (clampedDistance <= STATIONS[index + 1].distance) {
        segmentIndex = index;
        break;
      }
    }
    const startDistance = STATIONS[segmentIndex].distance;
    const endDistance = STATIONS[segmentIndex + 1].distance;
    const t = Math.max(
      0,
      Math.min(1, (clampedDistance - startDistance) / (endDistance - startDistance)),
    );
    const segment = this.segments[segmentIndex];
    const inverse = 1 - t;
    return {
      x:
        inverse * inverse * segment.p0.x +
        2 * inverse * t * segment.control.x +
        t * t * segment.p1.x,
      y:
        inverse * inverse * segment.p0.y +
        2 * inverse * t * segment.control.y +
        t * t * segment.p1.y,
      t,
      segmentIndex,
    };
  }

  waitingAt(stationIndex) {
    if (!this.scenario) return 0;
    const passengers = this.sim ? this.sim.passengers : this.scenario.passengers;
    return passengers.filter(
      (passenger) =>
        (passenger.status ?? "waiting") === "waiting" && passenger.origin === stationIndex,
    ).length;
  }

  updateSnow(dt) {
    if (!this.scenario) return;
    const wind = this.sim?.currentWind ?? this.scenario.windBase;
    const carSpeed = this.sim
      ? Math.max(0, ...this.sim.cars.map((car) => car.speed))
      : 0;
    for (const flake of this.snow) {
      flake.phase += dt * 1.2;
      flake.x += (wind * 2.15 * flake.drift + carSpeed * 0.25) * dt;
      flake.y += (flake.fall + Math.sin(flake.phase) * 7) * dt;
      if (flake.y > this.height + 8) {
        flake.y = -8;
        flake.x = Math.random() * this.width - wind * 10;
      }
      if (flake.x > this.width + 20) flake.x = -20;
    }
  }

  drawSky() {
    const { ctx, width, height } = this;
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#081724");
    sky.addColorStop(0.46, "#17384a");
    sky.addColorStop(0.76, "#547884");
    sky.addColorStop(1, "#b8cdd1");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const glow = ctx.createRadialGradient(
      width * 0.82,
      height * 0.17,
      2,
      width * 0.82,
      height * 0.17,
      width * 0.38,
    );
    glow.addColorStop(0, "rgba(255, 210, 141, 0.45)");
    glow.addColorStop(0.24, "rgba(242, 181, 112, 0.14)");
    glow.addColorStop(1, "rgba(242, 181, 112, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "rgba(231, 243, 245, 0.72)";
    ctx.beginPath();
    ctx.arc(width * 0.82, height * 0.17, 22, 0, Math.PI * 2);
    ctx.fill();

    for (let index = 0; index < 4; index += 1) {
      const y = height * (0.12 + index * 0.085);
      const x = ((this.time * (9 + index * 2) + index * width * 0.32) % (width * 1.5)) - width * 0.25;
      const cloud = ctx.createLinearGradient(x, y, x + width * 0.42, y);
      cloud.addColorStop(0, "rgba(207, 227, 230, 0)");
      cloud.addColorStop(0.5, "rgba(207, 227, 230, 0.055)");
      cloud.addColorStop(1, "rgba(207, 227, 230, 0)");
      ctx.fillStyle = cloud;
      ctx.fillRect(x, y, width * 0.46, 10 + index * 3);
    }
  }

  drawMountains() {
    const { ctx, width, height } = this;
    for (const ridge of this.ridges) {
      const gradient = ctx.createLinearGradient(0, height * 0.26, 0, height);
      gradient.addColorStop(0, ridge.color);
      gradient.addColorStop(1, "#102b3a");
      ctx.globalAlpha = ridge.alpha;
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(-40, height);
      for (const point of ridge.points) ctx.lineTo(point.x, point.y);
      ctx.lineTo(width + 40, height);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = "rgba(215, 235, 238, 0.25)";
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (let index = 0; index < ridge.points.length; index += 1) {
        const point = ridge.points[index];
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const fog = ctx.createLinearGradient(0, height * 0.57, 0, height);
    fog.addColorStop(0, "rgba(185, 209, 212, 0)");
    fog.addColorStop(0.36, "rgba(185, 209, 212, 0.16)");
    fog.addColorStop(1, "rgba(210, 227, 229, 0.06)");
    ctx.fillStyle = fog;
    ctx.fillRect(0, height * 0.57, width, height * 0.43);

    const snowfield = ctx.createLinearGradient(0, height * 0.78, 0, height);
    snowfield.addColorStop(0, "rgba(220, 235, 236, 0.22)");
    snowfield.addColorStop(1, "rgba(193, 216, 220, 0.78)");
    ctx.fillStyle = snowfield;
    ctx.beginPath();
    ctx.moveTo(0, height * 0.87);
    ctx.bezierCurveTo(
      width * 0.22,
      height * 0.81,
      width * 0.42,
      height * 0.9,
      width * 0.58,
      height * 0.84,
    );
    ctx.bezierCurveTo(
      width * 0.72,
      height * 0.8,
      width * 0.84,
      height * 0.9,
      width,
      height * 0.82,
    );
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(44, 87, 101, 0.24)";
    ctx.lineWidth = 1;
    for (let index = 0; index < 8; index += 1) {
      const x = (index / 8) * width + Math.sin(index) * 24;
      ctx.beginPath();
      ctx.moveTo(x, height * 0.86);
      ctx.quadraticCurveTo(x + 12, height * 0.92, x - 8, height);
      ctx.stroke();
    }
  }

  drawCable() {
    const { ctx } = this;
    for (const segment of this.segments) {
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(segment.p0.x, segment.p0.y);
        ctx.quadraticCurveTo(
          segment.control.x,
          segment.control.y,
          segment.p1.x,
          segment.p1.y,
        );
      };
      path();
      ctx.strokeStyle = "rgba(4, 12, 18, 0.75)";
      ctx.lineWidth = 5;
      ctx.stroke();
      path();
      ctx.strokeStyle = "rgba(224, 240, 243, 0.78)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      path();
      ctx.setLineDash([2, 11]);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.52)";
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  drawTower(point, index) {
    const { ctx, height } = this;
    const ground = height * (0.83 + (index % 2) * 0.025);
    ctx.save();
    ctx.strokeStyle = "rgba(11, 35, 46, 0.85)";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(point.x - 27, ground);
    ctx.lineTo(point.x - 7, point.y + 48);
    ctx.moveTo(point.x + 27, ground);
    ctx.lineTo(point.x + 7, point.y + 48);
    ctx.stroke();
    ctx.strokeStyle = "rgba(31, 71, 85, 0.86)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(point.x - 20, ground - 40);
    ctx.lineTo(point.x + 19, ground - 40);
    ctx.moveTo(point.x - 15, ground - 40);
    ctx.lineTo(point.x + 13, ground - 86);
    ctx.moveTo(point.x + 15, ground - 40);
    ctx.lineTo(point.x - 13, ground - 86);
    ctx.stroke();
    roundedRect(ctx, point.x - 34, point.y + 43, 68, 9, 4);
    ctx.fillStyle = "rgba(13, 34, 44, 0.92)";
    ctx.fill();
    ctx.fillStyle = "rgba(227, 240, 241, 0.8)";
    ctx.beginPath();
    ctx.moveTo(point.x - 34, point.y + 43);
    ctx.quadraticCurveTo(point.x, point.y + 37, point.x + 34, point.y + 43);
    ctx.lineTo(point.x + 30, point.y + 47);
    ctx.quadraticCurveTo(point.x, point.y + 41, point.x - 30, point.y + 47);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawStation(point, index) {
    const { ctx, height } = this;
    const station = STATIONS[index];
    const ground = height * (0.83 + (index % 2) * 0.025);
    const waiting = this.waitingAt(index);
    const stopEnabled = this.sim ? this.sim.policy.stops[index] : this.previewStops[index];

    this.drawTower(point, index);
    roundedRect(ctx, point.x - 45, point.y + 49, 90, 49, 7);
    ctx.fillStyle = "rgba(9, 28, 39, 0.96)";
    ctx.fill();
    ctx.strokeStyle = "rgba(164, 208, 216, 0.23)";
    ctx.lineWidth = 1;
    ctx.stroke();

    roundedRect(ctx, point.x - 29, point.y + 58, 58, 23, 3);
    const windowGlow = ctx.createLinearGradient(point.x - 29, 0, point.x + 29, 0);
    windowGlow.addColorStop(0, "rgba(239, 177, 85, 0.52)");
    windowGlow.addColorStop(0.5, "rgba(255, 207, 123, 0.9)");
    windowGlow.addColorStop(1, "rgba(239, 177, 85, 0.48)");
    ctx.fillStyle = windowGlow;
    ctx.fill();
    ctx.strokeStyle = "rgba(6, 23, 31, 0.7)";
    ctx.beginPath();
    ctx.moveTo(point.x - 8, point.y + 58);
    ctx.lineTo(point.x - 8, point.y + 81);
    ctx.moveTo(point.x + 10, point.y + 58);
    ctx.lineTo(point.x + 10, point.y + 81);
    ctx.stroke();

    for (let passenger = 0; passenger < Math.min(3, waiting); passenger += 1) {
      ctx.fillStyle = "rgba(15, 41, 49, 0.8)";
      ctx.beginPath();
      ctx.arc(point.x - 20 + passenger * 10, point.y + 74, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "rgba(234, 245, 245, 0.9)";
    ctx.beginPath();
    ctx.moveTo(point.x - 45, point.y + 49);
    ctx.quadraticCurveTo(point.x, point.y + 39, point.x + 45, point.y + 49);
    ctx.lineTo(point.x + 39, point.y + 55);
    ctx.quadraticCurveTo(point.x, point.y + 46, point.x - 39, point.y + 55);
    ctx.closePath();
    ctx.fill();

    ctx.font = "600 11px 'Noto Sans SC', 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(212, 233, 236, 0.63)";
    ctx.fillText(`${station.code}  ${station.name}`, point.x, point.y + 114);

    roundedRect(ctx, point.x - 28, point.y - 32, 56, 22, 11);
    ctx.fillStyle = "rgba(5, 20, 29, 0.76)";
    ctx.fill();
    ctx.strokeStyle = waiting > 0 ? "rgba(246, 188, 80, 0.65)" : "rgba(161, 205, 213, 0.25)";
    ctx.stroke();
    ctx.fillStyle = waiting > 0 ? "#f6c25d" : "rgba(211, 231, 233, 0.75)";
    ctx.font = "700 10px ui-monospace, monospace";
    ctx.fillText(`候车 ${waiting}`, point.x, point.y - 17);

    ctx.beginPath();
    ctx.arc(point.x + 53, point.y - 20, 4, 0, Math.PI * 2);
    ctx.fillStyle = stopEnabled ? "#6ed1a8" : "#e0a54c";
    ctx.fill();
    ctx.font = "600 9px 'Noto Sans SC', 'Segoe UI', sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(220, 236, 238, 0.56)";
    ctx.fillText(stopEnabled ? "停" : "越", point.x + 61, point.y - 17);

    ctx.strokeStyle = "rgba(24, 53, 65, 0.58)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(point.x - 31, point.y + 98);
    ctx.lineTo(point.x - 31, ground);
    ctx.moveTo(point.x + 31, point.y + 98);
    ctx.lineTo(point.x + 31, ground);
    ctx.stroke();
  }

  drawCar(car, point, queued = false) {
    const { ctx } = this;
    const wind = this.sim?.currentWind ?? this.scenario?.windBase ?? 0;
    const swing =
      Math.sin(this.time * 1.65 + car.swayPhase) * (0.015 + (car.speed / GAME.cruiseSpeed) * 0.024) +
      Math.sin(this.time * 0.7 + car.swayPhase * 0.5) * wind * 0.00035;
    const emergencyShake = car.state === "emergency" ? Math.sin(this.time * 24) * 0.06 : 0;
    const angle = swing + emergencyShake;
    const alpha = queued ? 0.5 : 1;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(point.x, point.y);
    ctx.rotate(angle);

    if (car.state === "emergency") {
      const pulse = 0.52 + Math.sin(this.time * 8) * 0.18;
      ctx.strokeStyle = `rgba(244, 92, 82, ${pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 28, 39, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(7, 22, 30, 0.86)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 13);
    ctx.stroke();
    ctx.fillStyle = "#d7e5e6";
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();

    roundedRect(ctx, -29, 12, 58, 44, 9);
    const body = ctx.createLinearGradient(0, 12, 0, 56);
    body.addColorStop(0, car.index === 0 ? "#e2b659" : "#b9d2d4");
    body.addColorStop(0.18, car.index === 0 ? "#c89335" : "#8dabb0");
    body.addColorStop(1, car.index === 0 ? "#7e591e" : "#445f68");
    ctx.fillStyle = body;
    ctx.fill();
    ctx.strokeStyle = "rgba(4, 15, 21, 0.9)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    roundedRect(ctx, -23, 20, 46, 22, 5);
    const glass = ctx.createLinearGradient(0, 20, 0, 42);
    glass.addColorStop(0, "rgba(82, 126, 139, 0.92)");
    glass.addColorStop(0.55, "rgba(30, 67, 82, 0.96)");
    glass.addColorStop(1, "rgba(13, 42, 54, 0.98)");
    ctx.fillStyle = glass;
    ctx.fill();
    ctx.strokeStyle = "rgba(205, 230, 233, 0.28)";
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 232, 185, 0.12)";
    ctx.beginPath();
    ctx.moveTo(-20, 22);
    ctx.lineTo(2, 22);
    ctx.lineTo(-12, 40);
    ctx.lineTo(-20, 40);
    ctx.closePath();
    ctx.fill();

    const passengerCount = car.passengerIds?.length ?? 0;
    for (let passenger = 0; passenger < passengerCount; passenger += 1) {
      ctx.fillStyle = "rgba(9, 28, 36, 0.82)";
      ctx.beginPath();
      ctx.arc(-16 + passenger * 10, 31, 3.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-16 + passenger * 10, 38, 4.2, Math.PI, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "rgba(235, 246, 246, 0.9)";
    roundedRect(ctx, -30, 10, 60, 5, 2.5);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 250, 232, 0.72)";
    ctx.beginPath();
    ctx.moveTo(-30, 11);
    ctx.quadraticCurveTo(-21, 5, -10, 9);
    ctx.quadraticCurveTo(2, 2, 13, 9);
    ctx.quadraticCurveTo(22, 4, 31, 12);
    ctx.lineTo(24, 13);
    ctx.quadraticCurveTo(4, 8, -24, 14);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle =
      car.state === "dwelling"
        ? "rgba(252, 215, 133, 0.95)"
        : "rgba(17, 45, 56, 0.9)";
    roundedRect(ctx, 21, 23, 5, 19, 2);
    ctx.fill();
    ctx.fillStyle = car.braking ? "#f26155" : "#782f2b";
    ctx.beginPath();
    ctx.arc(-22, 50, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#d9f1df";
    ctx.beginPath();
    ctx.arc(22, 50, 2.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = "800 8px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(7, 23, 31, 0.8)";
    ctx.fillText(car.code, 0, 18);
    ctx.restore();

    if (queued) {
      ctx.save();
      ctx.font = "700 9px 'Noto Sans SC', 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(214, 232, 234, 0.6)";
      ctx.fillText(`下一班 +${Math.ceil(car.launchAt - (this.sim?.time ?? 0))}s`, point.x + 54, point.y + 36);
      ctx.restore();
    }
  }

  drawCars() {
    if (!this.sim) {
      const parked = {
        index: 0,
        code: "01",
        speed: 0,
        state: "queued",
        braking: false,
        swayPhase: 0.7,
        passengerIds: [],
      };
      this.drawCar(parked, this.stationPoints[0], false);
      return;
    }

    for (const car of this.sim.cars) {
      if (car.state === "queued") {
        const point = {
          x: this.stationPoints[0].x + 12,
          y: this.stationPoints[0].y - 8,
        };
        this.drawCar(car, point, true);
      } else if (car.state !== "finished") {
        this.drawCar(car, this.pointAt(car.distance));
      }
    }
  }

  drawWind() {
    const { ctx, width, height } = this;
    const wind = this.sim?.currentWind ?? this.scenario?.windBase ?? 0;
    if (wind < 7) return;
    ctx.save();
    ctx.lineCap = "round";
    const strength = Math.min(1, wind / 18);
    for (let index = 0; index < 7; index += 1) {
      const phase = this.time * (0.7 + index * 0.07) + index * 1.8;
      const y = height * (0.12 + (index % 5) * 0.09) + Math.sin(phase) * 8;
      const x = ((phase * 55 + index * width * 0.19) % (width * 1.4)) - width * 0.2;
      ctx.strokeStyle = `rgba(214, 238, 240, ${0.025 + strength * 0.065})`;
      ctx.lineWidth = 1 + (index % 3) * 0.55;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(
        x + width * 0.09,
        y - 9,
        x + width * 0.17,
        y + 8,
        x + width * 0.29,
        y - 2,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  drawSnow() {
    const { ctx } = this;
    const wind = this.sim?.currentWind ?? this.scenario?.windBase ?? 0;
    for (const flake of this.snow) {
      const drift = wind * 0.16 + flake.drift;
      ctx.strokeStyle = `rgba(238, 249, 250, ${flake.alpha})`;
      ctx.lineWidth = flake.radius;
      ctx.beginPath();
      ctx.moveTo(flake.x, flake.y);
      ctx.lineTo(flake.x - drift * 2.2, flake.y - flake.fall * 0.07);
      ctx.stroke();
    }
  }

  drawVignette() {
    const { ctx, width, height } = this;
    const vignette = ctx.createRadialGradient(
      width * 0.5,
      height * 0.44,
      height * 0.2,
      width * 0.5,
      height * 0.5,
      width * 0.72,
    );
    vignette.addColorStop(0, "rgba(4, 14, 21, 0)");
    vignette.addColorStop(1, "rgba(2, 9, 14, 0.6)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }

  render(sim, scenario, dt) {
    this.sim = sim;
    if (scenario !== this.scenario) this.setScenario(scenario, sim);
    const delta = Math.min(0.05, Math.max(0, dt || 0.016));
    this.time += delta;
    this.updateSnow(delta);
    this.drawSky();
    this.drawMountains();
    this.drawCable();
    this.stationPoints.forEach((point, index) => this.drawStation(point, index));
    this.drawCars();
    this.drawWind();
    this.drawSnow();
    this.drawVignette();
  }
}

