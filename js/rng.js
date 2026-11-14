(function (global) {
  "use strict";

  var FP = global.FP || (global.FP = {});

  function mulberry32(seed) {
    var state = seed >>> 0;
    return function () {
      state = (state + 0x6d2b79f5) >>> 0;
      var t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRng(seed) {
    var next = mulberry32(seed);
    return {
      next: next,
      range: function (min, max) {
        return min + (max - min) * next();
      },
      int: function (min, max) {
        return Math.floor(min + (max - min + 1) * next());
      },
      pick: function (arr) {
        return arr[Math.floor(next() * arr.length)];
      }
    };
  }

  function valueNoise1D(rng) {
    var size = 256;
    var table = new Float32Array(size);
    for (var i = 0; i < size; i++) {
      table[i] = rng.next() * 2 - 1;
    }
    function fade(t) {
      return t * t * (3 - 2 * t);
    }
    return function (x) {
      var xi = Math.floor(x);
      var xf = x - xi;
      var a = table[((xi % size) + size) % size];
      var b = table[(((xi + 1) % size) + size) % size];
      var t = fade(xf);
      return a + (b - a) * t;
    };
  }

  FP.rng = { mulberry32: mulberry32, makeRng: makeRng, valueNoise1D: valueNoise1D };
})(typeof window !== "undefined" ? window : globalThis);
