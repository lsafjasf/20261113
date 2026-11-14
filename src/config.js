(function () {
  "use strict";

  const PHASES = [
    {
      id: "tide",
      name: "涨潮",
      kicker: "第一轮",
      start: 0,
      end: 38,
      icon: "◒",
      weather: "潮水正在上涨",
      hint: "开进水闸，让三池依次蓄水",
    },
    {
      id: "shower",
      name: "阵雨",
      kicker: "第二轮",
      start: 38,
      end: 76,
      icon: "☂",
      weather: "阵雨正在稀释卤水",
      hint: "打开排水闸，防止雨水把池子灌满",
    },
    {
      id: "sun",
      name: "强日照",
      kicker: "第三轮",
      start: 76,
      end: 120,
      icon: "☀",
      weather: "烈日正在蒸发卤水",
      hint: "盐度达标后立即收盐，留意干涸风险",
    },
  ];

  const CONFIG = {
    duration: 120,
    targetBatches: 2,
    safeLevel: { min: 18, max: 92 },
    harvestLevel: { min: 24, max: 84 },
    targetSalinity: 60,
    maxSalinity: 96,
    dryLimit: 10,
    warningLevel: { low: 25, high: 88 },
    phases: PHASES,
    ponds: [
      {
        id: "p1",
        name: "一池",
        x: 0.245,
        width: 0.225,
        level: 47,
        salinity: 43,
        evaporation: 1.04,
      },
      {
        id: "p2",
        name: "二池",
        x: 0.475,
        width: 0.225,
        level: 42,
        salinity: 45,
        evaporation: 1,
      },
      {
        id: "p3",
        name: "三池",
        x: 0.705,
        width: 0.225,
        level: 37,
        salinity: 47,
        evaporation: 0.96,
      },
    ],
    channel: {
      centerX: 0.095,
      width: 0.13,
      baseLevel: 70,
      tides: {
        tide: { inset: 0, rise: 0.65 },
        shower: { inset: 1, rise: 0.08 },
        sun: { inset: 2, rise: -0.2 },
      },
    },
  };

  window.SALT_CONFIG = CONFIG;
})();
