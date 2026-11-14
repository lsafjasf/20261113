(function (global) {
  "use strict";

  var FP = global.FP || (global.FP = {});

  FP.CONFIG = {
    seed: 20261114,
    width: 960,
    height: 600,
    anchor: { x: 480, y: 560 },
    groundY: 560,

    dt: 1 / 60,
    substeps: 2,

    kite: {
      mass: 1.1,
      radius: 15,
      gravity: 110,
      drag: 0.0045,
      airDrag: 0.32,
      liftCoef: 0.03,
      steerForce: 820,
      maxSpeed: 300
    },

    line: {
      initial: 215,
      min: 70,
      max: 520,
      reelSpeed: 62,
      stiffness: 26,
      damping: 11.5,
      slackTimeLimit: 3.5,
      tensionSafe: 650,
      tensionBreak: 1400,
      overTensionTime: 0.9
    },

    camera: {
      film: 6,
      view: 64,
      alignRadius: 62,
      maxLockSpeed: 34,
      lockTime: 1.0,
      lockDecay: 1.4
    },

    mission: {
      timeLimit: 120,
      winLineLength: 95,
      winRadius: 78
    },

    wind: {
      bands: [
        { yTop: 300, yBottom: 392, speed: 78, period: 17, phase: 0.0 },
        { yTop: 196, yBottom: 300, speed: 118, period: 13, phase: 3.2 },
        { yTop: 96,  yBottom: 196, speed: 168, period: 10, phase: 6.1 },
        { yTop: 0,   yBottom: 96,  speed: 212, period: 8,  phase: 1.7 }
      ],
      lowSpeed: 26,
      gustAmp: 0.34,
      gustPeriod: 5.3,
      turbulence: 42
    },

    clouds: [
      { yTop: 250, yBottom: 326, density: 0.55, turbulence: 1.35 },
      { yTop: 120, yBottom: 186, density: 0.75, turbulence: 1.7 },
      { yTop: 24,  yBottom: 78,  density: 0.5,  turbulence: 1.2 }
    ]
  };
})(typeof window !== "undefined" ? window : globalThis);
