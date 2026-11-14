(function (global) {
  "use strict";

  var FP = global.FP || (global.FP = {});
  var clamp = FP.clamp;

  function Simulation(world, opts) {
    opts = opts || {};
    var cfg = FP.CONFIG;
    this.cfg = cfg;
    this.world = world || new FP.World(opts.seed);
    this.reset();
  }

  Simulation.prototype.reset = function () {
    var cfg = this.cfg;
    var a = cfg.anchor;
    this.time = 0;
    this.state = "ready";
    this.lineLength = cfg.line.initial;
    var initialDist = Math.hypot(a.x - 30 - a.x, a.y - cfg.line.initial + 22 - a.y);
    this.lineLength = initialDist;
    this.kite = {
      x: a.x - 30,
      y: a.y - cfg.line.initial + 22,
      vx: 24,
      vy: -8,
      angle: -0.25,
      tumble: 0
    };
    this.input = { left: false, right: false, reelIn: false, reelOut: false, shutter: false };
    this.film = cfg.camera.film;
    this.damage = 100;
    this.slackTimer = 0;
    this.payOutTimer = 0;
    this.overTensionTimer = 0;
    this.tension = 0;
    this.slackRatio = 1;
    this.lockProgress = 0;
    this.lockTarget = null;
    this.recentWind = { x: 0, y: 0, dir: 0, speed: 0 };
    this.events = [];
    this.endReason = null;
    this.shots = 0;
    this.shutterFlash = 0;
  };

  Simulation.prototype.start = function () {
    if (this.state === "ready") {
      this.state = "playing";
    }
  };

  Simulation.prototype.setInput = function (patch) {
    for (var key in patch) {
      if (Object.prototype.hasOwnProperty.call(this.input, key)) {
        this.input[key] = !!patch[key];
      }
    }
  };

  Simulation.prototype.pressShutter = function () {
    this.input.shutter = true;
  };

  Simulation.prototype.fail = function (reason) {
    if (this.state === "playing") {
      this.state = "lost";
      this.endReason = reason;
      this.events.push({ type: "lost", reason: reason, time: this.time });
    }
  };

  Simulation.prototype.altitude = function () {
    return Math.max(0, this.cfg.groundY - this.kite.y);
  };

  Simulation.prototype.landmarksRemaining = function () {
    return this.world.landmarks.filter(function (lm) { return !lm.shot; });
  };

  FP.Simulation = Simulation;

  Simulation.prototype.updateCamera = function (dt) {
    var cfg = this.cfg;
    var k = this.kite;
    var cam = cfg.camera;
    var self = this;
    var speed = Math.hypot(k.vx, k.vy);
    var target = null;
    var best = cam.alignRadius;

    this.world.landmarks.forEach(function (lm) {
      if (lm.shot) {
        return;
      }
      var d = Math.hypot(lm.x - k.x, lm.y - k.y);
      if (d < best) {
        best = d;
        target = lm;
      }
    });

    var stable = !!target && speed < cam.maxLockSpeed;
    if (stable && target === this.lockTarget) {
      this.lockProgress += dt;
    } else if (stable) {
      this.lockTarget = target;
      this.lockProgress = Math.min(this.lockProgress, dt);
    } else {
      this.lockProgress = Math.max(0, this.lockProgress - cam.lockDecay * dt);
      if (this.lockProgress === 0) {
        this.lockTarget = null;
      }
    }

    if (this.input.shutter) {
      this.takePhoto(target, stable, best);
    }
  };

  Simulation.prototype.takePhoto = function (target, stable, distance) {
    if (this.film <= 0) {
      return;
    }
    this.film -= 1;
    this.shutterFlash = 0.28;
    if (target && stable && this.lockProgress >= this.cfg.camera.lockTime) {
      target.shot = true;
      target.shotAt = this.time;
      this.shots += 1;
      this.lockProgress = 0;
      this.lockTarget = null;
      this.events.push({ type: "photo", target: target, time: this.time });
    } else {
      this.events.push({
        type: "miss",
        reason: target ? "unstable" : "no-target",
        distance: distance,
        time: this.time
      });
    }
  };

  Simulation.prototype.updateStatus = function (dt) {
    var cfg = this.cfg;
    var line = cfg.line;
    var k = this.kite;

    if (this.tension > line.tensionSafe) {
      var overload = (this.tension - line.tensionSafe) /
        (line.tensionBreak - line.tensionSafe);
      this.damage -= clamp(overload, 0, 1) * 42 * dt;
      this.overTensionTimer += dt;
    } else {
      this.overTensionTimer = Math.max(0, this.overTensionTimer - dt * 2);
    }

    if (this.input.reelOut) {
      this.payOutTimer += dt;
    } else if (this.input.reelIn) {
      this.payOutTimer = Math.max(0, this.payOutTimer - dt * 3.5);
    } else {
      this.payOutTimer = Math.max(0, this.payOutTimer - dt * 2.2);
    }
    var isSlack = this.slackRatio < 0.85 ||
      (this.payOutTimer > 2.2 && this.tension < line.tensionSafe * 0.12);
    if (isSlack) {
      this.slackTimer += dt;
      if (k.tumble <= 0 && this.slackTimer > 0.35) {
        k.tumble = 1.1;
        this.events.push({ type: "gust", time: this.time });
      }
    } else {
      this.slackTimer = Math.max(0, this.slackTimer - dt * 1.5);
    }

    if (this.damage <= 0 || this.overTensionTimer >= line.overTensionTime) {
      this.fail("line-snapped");
      return;
    }
    if (this.slackTimer >= line.slackTimeLimit) {
      this.fail("blown-away");
      return;
    }
    if (k.x < -120 || k.x > cfg.width + 120 || k.y > cfg.groundY + 40 || k.y < -160) {
      this.fail("blown-away");
      return;
    }
    if (this.time >= cfg.mission.timeLimit) {
      this.fail("timeout");
      return;
    }
    if (this.film === 0 && this.shots < this.world.landmarks.length) {
      this.fail("no-film");
      return;
    }

    if (this.shots >= this.world.landmarks.length) {
      var home = Math.hypot(k.x - cfg.anchor.x, k.y - cfg.anchor.y);
      if (this.lineLength <= cfg.mission.winLineLength &&
          home <= cfg.mission.winRadius) {
        this.state = "won";
        this.events.push({
          type: "won",
          time: this.time,
          filmLeft: this.film,
          damageLeft: Math.max(0, Math.round(this.damage))
        });
      }
    }
  };

  Simulation.prototype.update = function (dt) {
    if (this.state !== "playing") {
      return this.events;
    }
    var cfg = this.cfg;
    var steps = cfg.substeps;
    var h = dt / steps;
    for (var i = 0; i < steps; i++) {
      this.stepPhysics(h);
    }
    this.time += dt;
    this.updateCamera(dt);
    this.updateStatus(dt);
    if (this.shutterFlash > 0) {
      this.shutterFlash = Math.max(0, this.shutterFlash - dt);
    }
    this.input.shutter = false;
    return this.events;
  };

  Simulation.prototype.stepPhysics = function (h) {
    var cfg = this.cfg;
    var k = this.kite;
    var anchor = cfg.anchor;
    var line = cfg.line;
    var kiteCfg = cfg.kite;

    if (this.input.reelIn) {
      this.lineLength = Math.max(line.min, this.lineLength - line.reelSpeed * h);
    }
    if (this.input.reelOut) {
      this.lineLength = Math.min(line.max, this.lineLength + line.reelSpeed * h);
    }

    var wind = this.world.windAt(k.x, k.y, this.time);
    this.recentWind = wind;
    var fog = this.world.fogAt(k.x, k.y, this.time);
    var dx0 = k.x - anchor.x;
    var dy0 = k.y - anchor.y;
    var dist0 = Math.max(0.001, Math.hypot(dx0, dy0));
    var nx0 = dx0 / dist0;
    var ny0 = dy0 / dist0;
    var relx = wind.x - k.vx;
    var rely = wind.y - k.vy;
    var windMag = Math.max(0, Math.hypot(wind.x, wind.y));

    var fx = kiteCfg.mass * (kiteCfg.drag * relx - kiteCfg.airDrag * k.vx);
    var fy = kiteCfg.mass * (kiteCfg.drag * 0.6 * rely - kiteCfg.airDrag * k.vy);
    fy -= kiteCfg.mass * kiteCfg.gravity;

    var lift = kiteCfg.mass * kiteCfg.liftCoef * windMag * windMag;
    fy -= lift;
    fx += windMag * kiteCfg.liftCoef * 26 * Math.sign(wind.x || 1);

    var angleFromVertical = Math.atan2(Math.abs(dx0), Math.max(1, -dy0));
    var windFactor = Math.min(1, 0.45 + windMag / 70);
    var trim = kiteCfg.mass * kiteCfg.gravity * 1.35 * windFactor;
    fx += -nx0 * trim * Math.sin(angleFromVertical) * 0.3;
    fy += -ny0 * trim;
    fy -= kiteCfg.mass * kiteCfg.gravity * 0.55 * windFactor;

    if (this.input.left) {
      fx -= kiteCfg.steerForce;
    }
    if (this.input.right) {
      fx += kiteCfg.steerForce;
    }

    if (k.tumble > 0) {
      var jitter = cfg.wind.turbulence * (0.6 + fog);
      fx += (this.world.rng.next() - 0.5) * jitter * 3;
      fy += (this.world.rng.next() - 0.5) * jitter * 2;
      k.tumble -= h;
    }

    var dx = dx0;
    var dy = dy0;
    var dist = dist0;
    var nx = nx0;
    var ny = ny0;
    var stretch = dist - this.lineLength;
    var radialVel = k.vx * nx + k.vy * ny;
    var tension = 0;
    var constraintX = 0;
    var constraintY = 0;
    var reelLoad = 0;
    if (this.input.reelIn) {
      var altitudeStress = FP.clamp((cfg.groundY - k.y) / 460, 0, 1);
      var windStress = Math.max(0, (windMag - 50) / 130);
      reelLoad = kiteCfg.mass * line.reelSpeed * 2.2 *
        (0.2 + altitudeStress * 2.4 + windStress * windStress * 3.2);
    }
    if (stretch > 0) {
      tension = Math.max(0, kiteCfg.mass *
        (line.stiffness * stretch + line.damping * radialVel)) + reelLoad;
      constraintX = -tension * nx;
      constraintY = -tension * ny;
    } else {
      var inward = kiteCfg.mass *
        (line.stiffness * 0.18 * (this.lineLength - dist) -
          line.damping * 0.9 * radialVel);
      inward = Math.max(0, inward);
      tension = inward + reelLoad * 0.85;
      constraintX = inward * nx;
      constraintY = inward * ny;
    }
    this.tension = tension;
    this.slackRatio = clamp(dist / this.lineLength, 0, 1.15);

    fx += constraintX;
    fy += constraintY;

    k.vx += (fx / kiteCfg.mass) * h;
    k.vy += (fy / kiteCfg.mass) * h;
    var speed = Math.hypot(k.vx, k.vy);
    if (speed > kiteCfg.maxSpeed) {
      var scale = kiteCfg.maxSpeed / speed;
      k.vx *= scale;
      k.vy *= scale;
    }
    k.x += k.vx * h;
    k.y += k.vy * h;

    if (stretch > 0) {
      var d2 = Math.hypot(k.x - anchor.x, k.y - anchor.y);
      if (d2 > this.lineLength) {
        var s = this.lineLength / d2;
        k.x = anchor.x + (k.x - anchor.x) * s;
        k.y = anchor.y + (k.y - anchor.y) * s;
        var rv = k.vx * nx + k.vy * ny;
        if (rv > 0) {
          k.vx -= rv * nx;
          k.vy -= rv * ny;
        }
      }
    }

    var targetAngle = Math.atan2(k.vy, k.vx);
    if (k.tumble > 0) {
      targetAngle += Math.sin(this.time * 22) * 0.9;
    } else {
      targetAngle = clamp(targetAngle, -1.1, 0.35);
    }
    var da = targetAngle - k.angle;
    while (da > Math.PI) { da -= Math.PI * 2; }
    while (da < -Math.PI) { da += Math.PI * 2; }
    k.angle += da * Math.min(1, h * 8);
  };
})(typeof window !== "undefined" ? window : globalThis);
