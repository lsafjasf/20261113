export const SHIFT_DURATION = 90;
export const WATER_CAPACITY = 100;
export const OVERHEAT_LIMIT = 31.8;
export const OVERHEAT_GRACE = 4.5;

export const CROPS = {
  lettuce: {
    id: "lettuce",
    name: "奶油生菜",
    shortName: "生菜",
    batch: "A",
    rate: 2.55,
    ideal: {
      moisture: [55, 76],
      temperature: [14, 21],
      light: [28, 68],
    },
    colors: {
      leaf: "#79d37d",
      leafDark: "#3b8d52",
      fruit: "#c8f188",
      mark: "#a9ef86",
    },
  },
  tomato: {
    id: "tomato",
    name: "樱桃番茄",
    shortName: "番茄",
    batch: "B",
    rate: 2.4,
    ideal: {
      moisture: [58, 80],
      temperature: [20, 27],
      light: [48, 84],
    },
    colors: {
      leaf: "#5fbc6e",
      leafDark: "#27643e",
      fruit: "#ff775e",
      mark: "#ff9a78",
    },
  },
  basil: {
    id: "basil",
    name: "甜罗勒",
    shortName: "罗勒",
    batch: "C",
    rate: 2.3,
    ideal: {
      moisture: [46, 68],
      temperature: [22, 29],
      light: [56, 88],
    },
    colors: {
      leaf: "#8bd66f",
      leafDark: "#377f39",
      fruit: "#d7f7a0",
      mark: "#b5ec7b",
    },
  },
};

const BED_LAYOUT = [
  { id: "A1", crop: "lettuce", moisture: 63, temperature: 18.2, light: 42, shade: true },
  { id: "A2", crop: "lettuce", moisture: 58, temperature: 19.1, light: 42, shade: true },
  { id: "B1", crop: "tomato", moisture: 70, temperature: 24.1, light: 70 },
  { id: "B2", crop: "tomato", moisture: 61, temperature: 25.2, light: 70 },
  { id: "C1", crop: "basil", moisture: 58, temperature: 26.4, light: 76 },
  { id: "C2", crop: "basil", moisture: 52, temperature: 27.1, light: 76 },
];

export const WEATHER_EVENTS = [
  {
    type: "cold",
    name: "冷空气",
    startsAt: 15,
    endsAt: 26,
    forecastAt: 10,
    headline: "冷锋穿过温室",
    advice: "关闭通风，给番茄和罗勒加热",
    tempOffset: -10,
    light: 62,
  },
  {
    type: "cloud",
    name: "云层遮光",
    startsAt: 32,
    endsAt: 43,
    forecastAt: 27,
    headline: "厚云遮住日光",
    advice: "关闭遮光帘，生长会暂时放缓",
    tempOffset: -1,
    light: 22,
  },
  {
    type: "heat",
    name: "设备过热",
    startsAt: 48,
    endsAt: 60,
    forecastAt: 43,
    headline: "循环泵与加热管过热",
    advice: "全部打开通风，立刻停止加热",
    tempOffset: 11,
    light: 82,
  },
];

const WEATHER_BASE = {
  type: "clear",
  name: "晴",
  headline: "日照稳定",
  advice: "维持三批作物的舒适区间",
  tempOffset: 0,
  light: 76,
};

const CONTROL_KEYS = ["irrigation", "heating", "ventilation", "shade"];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const inRange = (value, range) => value >= range[0] && value <= range[1];

export class GreenhouseGame {
  constructor(options = {}) {
    this.duration = options.duration ?? SHIFT_DURATION;
    this.waterCapacity = options.waterCapacity ?? WATER_CAPACITY;
    this.reset();
  }

  reset() {
    this.time = 0;
    this.status = "running";
    this.failure = null;
    this.endedAt = null;
    this.water = this.waterCapacity;
    this.events = [];
    this.weather = this.getWeatherAt(0);
    this.beds = BED_LAYOUT.map((entry, index) => {
      const crop = CROPS[entry.crop];
      return {
        id: entry.id,
        index,
        batch: crop.batch,
        cropId: entry.crop,
        crop,
        moisture: entry.moisture,
        temperature: entry.temperature,
        light: entry.light,
        growth: 0,
        matured: false,
        harvested: false,
        overheatTime: 0,
        controls: {
          irrigation: false,
          heating: false,
          ventilation: false,
          shade: Boolean(entry.shade),
        },
      };
    });
  }

  getWeatherAt(time = this.time) {
    const active = WEATHER_EVENTS.find((event) => time >= event.startsAt && time < event.endsAt);
    if (active) {
      return {
        ...WEATHER_BASE,
        ...active,
        active: true,
        forecast: null,
        secondsUntil: 0,
      };
    }

    const upcoming = WEATHER_EVENTS.find((event) => time < event.startsAt);
    const forecast =
      upcoming && time >= upcoming.forecastAt && time < upcoming.startsAt ? upcoming : null;

    return {
      ...WEATHER_BASE,
      active: false,
      forecast,
      next: upcoming || null,
      secondsUntil: upcoming ? Math.max(0, upcoming.startsAt - time) : null,
    };
  }

  toggleControl(bedIndex, control) {
    if (this.status !== "running" || !CONTROL_KEYS.includes(control)) return false;
    const bed = this.beds[bedIndex];
    if (!bed || bed.harvested) return false;
    bed.controls[control] = !bed.controls[control];
    return true;
  }

  setControl(bedIndex, control, enabled) {
    if (this.status !== "running" || !CONTROL_KEYS.includes(control)) return false;
    const bed = this.beds[bedIndex];
    if (!bed || bed.harvested) return false;
    bed.controls[control] = Boolean(enabled);
    return true;
  }

  harvest(bedIndex) {
    if (this.status !== "running") return false;
    const bed = this.beds[bedIndex];
    if (!bed || !bed.matured || bed.harvested) return false;
    bed.harvested = true;
    bed.controls.irrigation = false;
    bed.controls.heating = false;
    bed.controls.ventilation = false;
    this.events.push({ type: "harvest", bedId: bed.id, batch: bed.batch });
    if (this.beds.every((item) => item.harvested)) {
      this.status = "won";
      this.endedAt = this.time;
      this.events.push({ type: "win" });
    }
    return true;
  }

  tick(deltaSeconds) {
    let remaining = Math.max(0, Number(deltaSeconds) || 0);
    while (remaining > 0 && this.status === "running") {
      const step = Math.min(remaining, 0.05);
      this.updateStep(step);
      remaining -= step;
    }
  }

  updateStep(dt) {
    this.time = Math.min(this.duration, this.time + dt);
    this.weather = this.getWeatherAt(this.time);

    for (const bed of this.beds) {
      if (bed.harvested) continue;

      const controls = bed.controls;
      const tempTarget =
        23 +
        this.weather.tempOffset +
        (controls.heating ? 10 : 0) -
        (controls.ventilation ? 8 : 0) -
        (controls.shade ? 0.7 : 0);
      const tempResponse = 1 - Math.exp(-0.82 * dt);
      bed.temperature += (tempTarget - bed.temperature) * tempResponse;

      const evaporation =
        0.3 +
        (controls.heating ? 0.13 : 0) +
        (controls.ventilation ? 0.05 : 0) -
        (controls.shade ? 0.035 : 0) +
        Math.max(0, bed.temperature - 26) * 0.035;

      if (controls.irrigation && this.water > 0) {
        bed.moisture += 5.5 * dt;
        this.water = Math.max(0, this.water - 1.8 * dt);
      } else {
        bed.moisture -= evaporation * dt;
      }

      const lightTarget = this.weather.light - (controls.shade ? 36 : 0);
      const lightResponse = 1 - Math.exp(-1.4 * dt);
      bed.light += (lightTarget - bed.light) * lightResponse;

      bed.moisture = clamp(bed.moisture, 0, 100);
      bed.temperature = clamp(bed.temperature, 4, 48);
      bed.light = clamp(bed.light, 0, 100);

      const conditions = this.getConditionStatus(bed);
      if (conditions.all && !bed.matured) {
        bed.growth = Math.min(100, bed.growth + bed.crop.rate * dt);
        if (bed.growth >= 100) {
          bed.growth = 100;
          bed.matured = true;
          this.events.push({ type: "mature", bedId: bed.id, batch: bed.batch });
        }
      }

      bed.overheatTime =
        bed.temperature >= OVERHEAT_LIMIT ? bed.overheatTime + dt : Math.max(0, bed.overheatTime - dt * 2);

      if (bed.overheatTime >= OVERHEAT_GRACE) {
        this.fail(
          "overheat",
          `${bed.id} · ${bed.crop.name} 连续过热 ${OVERHEAT_GRACE.toFixed(1)} 秒，根系灼伤。`,
          bed.index,
        );
        return;
      }
    }

    if (this.water <= 0.0001) {
      this.fail("water", "水箱耗尽，灌溉泵空转停机。");
      return;
    }

    if (this.time >= this.duration) {
      const remaining = this.beds.filter((bed) => !bed.harvested).length;
      this.fail("timeout", `90 秒轮班结束，仍有 ${remaining} 床作物未收获。`);
    }
  }

  fail(code, message, bedIndex = null) {
    if (this.status !== "running") return;
    this.status = "lost";
    this.endedAt = this.time;
    this.failure = { code, message, bedIndex };
    this.events.push({ type: "failure", code, bedIndex });
  }

  getConditionStatus(bed) {
    const moisture = inRange(bed.moisture, bed.crop.ideal.moisture);
    const temperature = inRange(bed.temperature, bed.crop.ideal.temperature);
    const light = inRange(bed.light, bed.crop.ideal.light);
    return {
      moisture,
      temperature,
      light,
      all: moisture && temperature && light,
    };
  }

  getBatchProgress() {
    return ["A", "B", "C"].map((batch) => {
      const beds = this.beds.filter((bed) => bed.batch === batch);
      return {
        batch,
        harvested: beds.filter((bed) => bed.harvested).length,
        matured: beds.filter((bed) => bed.matured).length,
        total: beds.length,
      };
    });
  }

  consumeEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  getSummary() {
    return {
      status: this.status,
      time: this.time,
      water: this.water,
      failure: this.failure,
      beds: this.beds.map((bed) => ({
        id: bed.id,
        crop: bed.crop.name,
        batch: bed.batch,
        growth: bed.growth,
        matured: bed.matured,
        harvested: bed.harvested,
        moisture: bed.moisture,
        temperature: bed.temperature,
        light: bed.light,
        controls: { ...bed.controls },
      })),
    };
  }
}

export function stageForGrowth(growth) {
  if (growth >= 100) return 4;
  if (growth >= 68) return 3;
  if (growth >= 34) return 2;
  if (growth >= 10) return 1;
  return 0;
}
