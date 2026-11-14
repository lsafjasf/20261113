(function (global) {
  "use strict";

  var FP = global.FP || (global.FP = {});
  var makeRng = FP.rng.makeRng;
  var valueNoise1D = FP.rng.valueNoise1D;

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function smoothstep(edge0, edge1, x) {
    var t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function buildRidges(cfg, rng) {
    var layers = [
      { base: 318, amp: 46, freq: 0.0042, parallax: 0.18, color: "#3c5466" },
      { base: 392, amp: 60, freq: 0.0058, parallax: 0.34, color: "#2f4554" },
      { base: 470, amp: 52, freq: 0.0082, parallax: 0.55, color: "#243744" },
      { base: 536, amp: 34, freq: 0.012,  parallax: 0.85, color: "#1b2b36" }
    ];
    return layers.map(function (layer, index) {
      var noise = valueNoise1D(rng);
      var points = [];
      for (var x = -40; x <= cfg.width + 40; x += 16) {
        var n = noise(x * layer.freq + index * 13.7);
        points.push({ x: x, y: layer.base + n * layer.amp });
      }
      return {
        points: points,
        parallax: layer.parallax,
        color: layer.color,
        base: layer.base
      };
    });
  }

  function buildClouds(cfg, rng) {
    var puffs = [];
    cfg.clouds.forEach(function (band, bandIndex) {
      var count = Math.round(10 + band.density * 12);
      for (var i = 0; i < count; i++) {
        puffs.push({
          x: rng.range(-60, cfg.width + 60),
          y: rng.range(band.yTop, band.yBottom),
          r: rng.range(34, 86),
          speed: rng.range(5, 13) * (bandIndex % 2 === 0 ? 1 : -1),
          alpha: rng.range(0.1, 0.22) * (0.6 + band.density),
          band: bandIndex
        });
      }
    });
    return puffs;
  }

  function buildLandmarks(cfg, rng) {
    var specs = [
      { kind: "tower",  name: "孤峰塔", x: 178, y: 312, r: 30 },
      { kind: "bridge", name: "雾中桥", x: 506, y: 196, r: 34 },
      { kind: "lake",   name: "镜湖湾", x: 802, y: 372, r: 32 }
    ];
    return specs.map(function (spec) {
      return {
        kind: spec.kind,
        name: spec.name,
        x: spec.x,
        y: spec.y,
        r: spec.r,
        seed: rng.int(1, 9999),
        shot: false,
        shotAt: null
      };
    });
  }

  function World(seed) {
    var cfg = FP.CONFIG;
    var rng = makeRng(seed == null ? cfg.seed : seed);
    this.rng = rng;
    this.ridges = buildRidges(cfg, rng);
    this.clouds = buildClouds(cfg, rng);
    this.landmarks = buildLandmarks(cfg, rng);
  }

  World.prototype.fogAt = function (x, y, t) {
    var cfg = FP.CONFIG;
    var density = 0;
    cfg.clouds.forEach(function (band) {
      if (y < band.yTop || y > band.yBottom) {
        return;
      }
      var fade = Math.min(
        smoothstep(band.yTop, band.yTop + 18, y),
        1 - smoothstep(band.yBottom - 18, band.yBottom, y)
      );
      density = Math.max(density, band.density * fade);
    });
    var pulse = 0.85 + 0.15 * Math.sin(t * 0.31 + x * 0.012);
    return clamp(density * pulse, 0, 0.82);
  };

  World.prototype.windAt = function (x, y, t) {
    var cfg = FP.CONFIG.wind;
    var band = null;
    for (var i = 0; i < cfg.bands.length; i++) {
      if (y >= cfg.bands[i].yTop && y < cfg.bands[i].yBottom) {
        band = cfg.bands[i];
        break;
      }
    }
    if (!band) {
      var groundBlend = smoothstep(392, 470, y);
      band = cfg.bands[0];
      var groundSpeed = cfg.lowSpeed + (band.speed - cfg.lowSpeed) * (1 - groundBlend);
      var groundDir = Math.sin(t * (Math.PI * 2 / band.period) + band.phase) >= 0 ? 1 : -1;
      var gs = Math.max(54, groundSpeed);
      return { x: groundDir * gs, y: 0, dir: groundDir, speed: gs };
    }

    var angle = t * (Math.PI * 2 / band.period) + band.phase;
    var dir = 0.35 + 0.65 * Math.sin(angle);
    var gust = 1 + cfg.gustAmp * Math.sin(t * (Math.PI * 2 / cfg.gustPeriod) + y * 0.02);
    var speed = band.speed * gust;
    var vx = dir * speed;
    var vy = Math.cos(angle * 0.7) * 14 + Math.sin(x * 0.01 + t * 0.9) * 10;
    return { x: vx, y: vy, dir: dir, speed: Math.abs(vx), band: band };
  };

  FP.World = World;
  FP.clamp = clamp;
  FP.smoothstep = smoothstep;
})(typeof window !== "undefined" ? window : globalThis);
