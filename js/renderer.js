(function (global) {
  "use strict";

  var FP = global.FP || (global.FP = {});

  var PALETTE = {
    skyTop: "#16283a",
    skyMid: "#274357",
    skyLow: "#3c5a68",
    cloud: "#c7d6d3",
    line: "#d8e2dc",
    lineTight: "#e8a04a",
    lineDanger: "#d9634f",
    kite: "#e8a04a",
    kiteDark: "#b96f2e",
    camera: "#16222e",
    view: "#e8efe9",
    target: "#7fbf8e",
    targetLocked: "#e8a04a",
    fog: "#a9bfc2"
  };

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.streaks = [];
    var rng = FP.rng.makeRng(FP.CONFIG.seed ^ 0x9e3779b9);
    for (var i = 0; i < 46; i++) {
      this.streaks.push({
        x: rng.range(0, FP.CONFIG.width),
        y: rng.range(40, 420),
        len: rng.range(18, 46),
        speed: rng.range(0.5, 1.3),
        alpha: rng.range(0.08, 0.26)
      });
    }
    this.palette = PALETTE;
  }

  FP.Renderer = Renderer;

  Renderer.prototype.render = function (sim, dt) {
    var ctx = this.ctx;
    var cfg = FP.CONFIG;
    var w = cfg.width;
    var h = cfg.height;
    this.drawSky(ctx, w, h);
    this.drawStreaks(ctx, sim, dt);
    this.drawRidges(ctx, sim, w, h);
    this.drawLandmarks(ctx, sim);
    this.drawClouds(ctx, sim, dt);
    this.drawAnchor(ctx, sim);
    this.drawLine(ctx, sim);
    this.drawKite(ctx, sim);
    this.drawViewfinder(ctx, sim);
    this.drawFogOverlay(ctx, sim);
    this.drawFlash(ctx, sim, w, h);
  };

  Renderer.prototype.drawSky = function (ctx, w, h) {
    var grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, PALETTE.skyTop);
    grad.addColorStop(0.55, PALETTE.skyMid);
    grad.addColorStop(1, PALETTE.skyLow);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#e8dcc0";
    ctx.beginPath();
    ctx.arc(w * 0.82, 86, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.14;
    ctx.beginPath();
    ctx.arc(w * 0.82, 86, 40, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  Renderer.prototype.drawStreaks = function (ctx, sim, dt) {
    var cfg = FP.CONFIG;
    ctx.save();
    ctx.lineCap = "round";
    this.streaks.forEach(function (s) {
      var wind = sim.world.windAt(s.x, s.y, sim.time);
      s.x += wind.x * s.speed * dt;
      if (s.x > cfg.width + 60) { s.x = -60; }
      if (s.x < -60) { s.x = cfg.width + 60; }
      var len = s.len * Math.min(2.2, 0.4 + Math.abs(wind.x) / 120);
      ctx.globalAlpha = s.alpha * Math.min(1, 0.3 + Math.abs(wind.x) / 140);
      ctx.strokeStyle = PALETTE.cloud;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - Math.sign(wind.x || 1) * len, s.y + wind.dir * 1.5);
      ctx.stroke();
    });
    ctx.restore();
  };

  Renderer.prototype.drawRidges = function (ctx, sim, w, h) {
    var self = this;
    sim.world.ridges.forEach(function (ridge) {
      var offset = -sim.kite.x * ridge.parallax * 0.12 + FP.CONFIG.anchor.x * ridge.parallax * 0.12;
      ctx.save();
      ctx.translate(offset, 0);
      ctx.fillStyle = ridge.color;
      ctx.beginPath();
      ctx.moveTo(ridge.points[0].x, h);
      ridge.points.forEach(function (p) {
        ctx.lineTo(p.x, p.y);
      });
      ctx.lineTo(ridge.points[ridge.points.length - 1].x, h);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });
    ctx.fillStyle = "#14232c";
    ctx.fillRect(0, FP.CONFIG.groundY, w, h - FP.CONFIG.groundY);
  };

  Renderer.prototype.drawLandmarks = function (ctx, sim) {
    sim.world.landmarks.forEach(function (lm) {
      ctx.save();
      ctx.translate(lm.x, lm.y);
      ctx.lineWidth = 2;
      ctx.strokeStyle = lm.shot ? PALETTE.target : "#d9e3dc";
      ctx.fillStyle = lm.shot ? "rgba(127,191,142,0.22)" : "rgba(232,239,233,0.12)";
      if (lm.kind === "tower") {
        ctx.beginPath();
        ctx.moveTo(0, -26);
        ctx.lineTo(-14, 24);
        ctx.lineTo(14, 24);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-8, 4);
        ctx.lineTo(8, 4);
        ctx.moveTo(-11, 15);
        ctx.lineTo(11, 15);
        ctx.stroke();
      } else if (lm.kind === "bridge") {
        ctx.beginPath();
        ctx.moveTo(-26, 18);
        ctx.quadraticCurveTo(0, -24, 26, 18);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-20, 18);
        ctx.lineTo(-20, -6);
        ctx.moveTo(20, 18);
        ctx.lineTo(20, -6);
        ctx.moveTo(-26, 18);
        ctx.lineTo(26, 18);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.ellipse(0, 8, 26, 12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-18, 2);
        ctx.quadraticCurveTo(0, -12, 18, 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.85;
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = lm.shot ? PALETTE.target : PALETTE.cloud;
      ctx.fillText(lm.shot ? "✓ " + lm.name : lm.name, 0, -36);
      if (!lm.shot) {
        var pulse = 6 + Math.sin(sim.time * 3 + lm.seed) * 3;
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = PALETTE.targetLocked;
        ctx.beginPath();
        ctx.arc(0, 0, lm.r + pulse, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    });
  };

  Renderer.prototype.drawClouds = function (ctx, sim, dt) {
    var cfg = FP.CONFIG;
    ctx.save();
    sim.world.clouds.forEach(function (c) {
      c.x += c.speed * dt;
      if (c.x > cfg.width + c.r) { c.x = -c.r; }
      if (c.x < -c.r) { c.x = cfg.width + c.r; }
      var g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r);
      g.addColorStop(0, "rgba(199,214,211," + c.alpha + ")");
      g.addColorStop(1, "rgba(199,214,211,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  };

  Renderer.prototype.drawAnchor = function (ctx, sim) {
    var a = FP.CONFIG.anchor;
    ctx.save();
    ctx.strokeStyle = PALETTE.line;
    ctx.fillStyle = "#223744";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(a.x, a.y + 8);
    ctx.lineTo(a.x - 10, a.y + 20);
    ctx.moveTo(a.x, a.y + 8);
    ctx.lineTo(a.x + 10, a.y + 20);
    ctx.stroke();
    ctx.restore();
  };

  Renderer.prototype.drawLine = function (ctx, sim) {
    var anchor = FP.CONFIG.anchor;
    var k = sim.kite;
    var dx = k.x - anchor.x;
    var dy = k.y - anchor.y;
    var dist = Math.max(1, Math.hypot(dx, dy));
    var nx = dx / dist;
    var ny = dy / dist;
    var slack = Math.max(0, 1 - sim.slackRatio);
    var sag = slack * 46 + 8;
    var wind = sim.recentWind;
    var bow = FP.clamp(wind.x / 220, -1, 1) * (10 + slack * 22);
    var cx = (anchor.x + k.x) / 2 - ny * bow + nx * 0;
    var cy = (anchor.y + k.y) / 2 + nx * bow + sag;

    var ratio = sim.tension / FP.CONFIG.line.tensionSafe;
    var color = PALETTE.line;
    if (ratio > 1) {
      color = ratio > 1.45 ? PALETTE.lineDanger : PALETTE.lineTight;
    }
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(anchor.x, anchor.y);
    ctx.quadraticCurveTo(cx, cy, k.x, k.y);
    ctx.stroke();

    if (slack > 0.12) {
      ctx.globalAlpha = 0.35 * slack;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y);
      ctx.quadraticCurveTo(cx, cy + 6, k.x, k.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  };

  Renderer.prototype.drawKite = function (ctx, sim) {
    var k = sim.kite;
    ctx.save();
    ctx.translate(k.x, k.y);
    ctx.rotate(k.angle + 0.35);
    ctx.lineWidth = 2;
    ctx.strokeStyle = PALETTE.kiteDark;
    ctx.fillStyle = PALETTE.kite;
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(14, 0);
    ctx.lineTo(0, 18);
    ctx.lineTo(-14, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(0, 18);
    ctx.moveTo(-14, 0);
    ctx.lineTo(14, 0);
    ctx.stroke();
    ctx.strokeStyle = PALETTE.line;
    ctx.beginPath();
    ctx.moveTo(0, 18);
    ctx.bezierCurveTo(4, 28, -5, 36, 2, 46);
    ctx.stroke();
    ctx.fillStyle = PALETTE.camera;
    ctx.fillRect(-6, -4, 12, 8);
    ctx.fillStyle = PALETTE.cloud;
    ctx.beginPath();
    ctx.arc(0, 0, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  Renderer.prototype.drawViewfinder = function (ctx, sim) {
    var k = sim.kite;
    var view = FP.CONFIG.camera.view;
    var locked = sim.lockTarget;
    var pct = FP.clamp(sim.lockProgress / FP.CONFIG.camera.lockTime, 0, 1);
    ctx.save();
    ctx.translate(k.x, k.y);
    ctx.strokeStyle = locked ? PALETTE.targetLocked : PALETTE.view;
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 1.5;
    var corner = 12;
    var gap = 4;
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (sg) {
      ctx.beginPath();
      ctx.moveTo(sg[0] * (view - gap), sg[1] * (view - corner));
      ctx.lineTo(sg[0] * (view - gap), sg[1] * (view - gap));
      ctx.lineTo(sg[0] * (view - corner), sg[1] * (view - gap));
      ctx.stroke();
    });
    ctx.beginPath();
    ctx.moveTo(-6, 0);
    ctx.lineTo(6, 0);
    ctx.moveTo(0, -6);
    ctx.lineTo(0, 6);
    ctx.stroke();
    if (pct > 0) {
      ctx.strokeStyle = PALETTE.target;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, view + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
      ctx.stroke();
    }
    ctx.restore();
  };

  Renderer.prototype.drawFogOverlay = function (ctx, sim) {
    var fog = sim.world.fogAt(sim.kite.x, sim.kite.y, sim.time);
    if (fog <= 0.02) {
      return;
    }
    ctx.save();
    ctx.globalAlpha = fog * 0.72;
    ctx.fillStyle = PALETTE.fog;
    ctx.fillRect(0, 0, FP.CONFIG.width, FP.CONFIG.height);
    var vignette = ctx.createRadialGradient(
      sim.kite.x, sim.kite.y, 40,
      sim.kite.x, sim.kite.y, 340
    );
    vignette.addColorStop(0, "rgba(169,191,194,0)");
    vignette.addColorStop(1, "rgba(169,191,194," + (fog * 0.55) + ")");
    ctx.globalAlpha = 1;
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, FP.CONFIG.width, FP.CONFIG.height);
    ctx.restore();
  };

  Renderer.prototype.drawFlash = function (ctx, sim, w, h) {
    if (sim.shutterFlash <= 0) {
      return;
    }
    ctx.save();
    ctx.globalAlpha = (sim.shutterFlash / 0.28) * 0.75;
    ctx.fillStyle = "#f4f6ee";
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  };
})(typeof window !== "undefined" ? window : globalThis);
