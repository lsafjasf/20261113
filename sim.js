// 风机调度小游戏 - 物理/规则核心（浏览器与 Node 共用）
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WindSim = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const DURATION = 120; // 秒
  const N_TURBINES = 3;
  const RATED_KW = 38; // 单机额定功率
  const BATTERY_CAP = 100; // 电池容量(能量单位)
  const MAX_GAPS = 3;

  // 两次阵风的时间窗与峰值
  const GUSTS = [
    { t0: 36, t1: 52, peak: 21 },
    { t0: 78, t1: 94, peak: 23 },
  ];
  // 三次负荷高峰
  const PEAKS = [
    { t: 30, w: 9, h: 46 },
    { t: 64, w: 10, h: 52 },
    { t: 100, w: 9, h: 48 },
  ];

  function gauss(x, mu, sig) {
    const d = (x - mu) / sig;
    return Math.exp(-0.5 * d * d);
  }

  // 风速 m/s：基础风缓慢起伏 + 阵风
  function windSpeedAt(t) {
    let v = 9.0 + 1.6 * Math.sin(t * 0.11) + 0.8 * Math.sin(t * 0.031 + 2);
    for (const g of GUSTS) {
      if (t > g.t0 - 4 && t < g.t1 + 4) {
        const mid = (g.t0 + g.t1) / 2;
        v += (g.peak - 9.0) * gauss(t, mid, (g.t1 - g.t0) / 4);
      }
    }
    return Math.max(3, v);
  }

  // 风向(度, 0=东, 逆时针)，缓慢摆动，阵风期间略转
  function windDirAt(t) {
    let d = 250 + 18 * Math.sin(t * 0.05);
    for (const g of GUSTS) {
      if (t > g.t0 - 4 && t < g.t1 + 4) {
        const mid = (g.t0 + g.t1) / 2;
        d += 22 * gauss(t, mid, (g.t1 - g.t0) / 4);
      }
    }
    return d;
  }

  // 锋面位置 0..1（用于绘制扫过地图的锋线），无锋面时返回 -1
  function frontAt(t) {
    for (const g of GUSTS) {
      if (t >= g.t0 - 6 && t <= g.t1 + 6) {
        return (t - (g.t0 - 6)) / (g.t1 + 6 - (g.t0 - 6));
      }
    }
    return -1;
  }

  // 小镇用电需求 kW
  function demandAt(t) {
    let d = 42 + 5 * Math.sin(t * 0.07 + 1);
    for (const p of PEAKS) d += p.h * gauss(t, p.t, p.w / 2.4);
    return d;
  }

  function createTurbine(i) {
    return {
      id: i,
      yaw: 250,      // 朝向(度)
      pitch: 10,     // 桨距角(度)：0=最陡(满捕风)，85=顺桨
      rpm: 0,
      power: 0,      // 当前输出 kW
      damage: 0,     // 机械损伤 0..100
      stress: 0,     // 当前应力(用于显示)
    };
  }

  function createState() {
    return {
      t: 0,
      turbines: [createTurbine(0), createTurbine(1), createTurbine(2)],
      battery: 55,        // 电池电量
      batteryHealth: 100, // 过充会损伤，归零=冲爆
      gaps: 0,            // 供电缺口次数
      gapTimer: 0,        // 持续缺电计时
      over: false,
      win: false,
      failReason: "",
      log: [],
    };
  }

  function degDiff(a, b) {
    let d = (a - b) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  }

  // 单步推进。inputs: [{yawDelta, pitchDelta}] 为 -1..1 归一变化率
  function step(state, dt, inputs) {
    if (state.over) return state;
    state.t += dt;
    const t = state.t;
    const wind = windSpeedAt(t);
    const wdir = windDirAt(t);
    const demand = demandAt(t);

    let gen = 0;
    state.turbines.forEach((tb, i) => {
      const inp = inputs[i] || {};
      tb.yaw = (tb.yaw + (inp.yawDelta || 0) * 60 * dt + 360) % 360;
      tb.pitch = Math.min(85, Math.max(0, tb.pitch + (inp.pitchDelta || 0) * 30 * dt));

      const align = Math.max(0, Math.cos((degDiff(tb.yaw, wdir) * Math.PI) / 180));
      const capture = Math.max(0, Math.cos((tb.pitch * Math.PI) / 180));
      const aero = Math.min(1, Math.pow(wind / 12, 3));
      const healthF = Math.max(0, 1 - tb.damage / 120);
      tb.power = RATED_KW * aero * align * capture * healthF;
      tb.rpm = 26 * aero * align * capture * (tb.damage >= 100 ? 0 : 1);

      // 机械应力：风大且桨距过陡 -> 损伤累积
      const safePitch = Math.min(70, Math.max(0, (wind - 11) * 7)); // 风越大需要的顺桨角
      const excess = safePitch - tb.pitch;
      if (wind > 12 && excess > 0 && tb.damage < 100) {
        tb.stress = (excess / 40) * ((wind - 12) / 10);
        tb.damage = Math.min(100, tb.damage + tb.stress * 6 * dt);
      } else {
        tb.stress = 0;
      }
      gen += tb.power;
    });

    // 电池充放（电量以百分比计，30kW 净功率 1 秒改变 1%）
    const net = gen - demand;
    const eRate = net / 30; // %/s
    if (eRate >= 0) {
      const room = BATTERY_CAP - state.battery;
      const add = Math.min(eRate * dt, room);
      state.battery += add;
      const overflow = eRate * dt - add;
      if (overflow > 0.001) {
        // 电池已满仍硬灌：被"冲"，健康下降
        state.batteryHealth = Math.max(0, state.batteryHealth - overflow * 8);
      }
      // 充电功率过高(>36kW)：即使没满也在冲爆电池
      const rush = eRate - 1.2;
      if (rush > 0) {
        state.batteryHealth = Math.max(0, state.batteryHealth - rush * 8 * dt);
      }
    } else {
      state.battery += eRate * dt; // 放电
    }

    // 供电缺口：发电不足且电池已放空
    if (net < 0 && state.battery <= 0.01) {
      state.gapTimer += dt;
      if (state.gapTimer >= 2.5) {
        state.gaps += 1;
        state.gapTimer = 0;
        state.log.push({ t, msg: "供电缺口 #" + state.gaps });
      }
    } else {
      state.gapTimer = Math.max(0, state.gapTimer - dt * 2);
    }

    // 失败/胜利判定
    if (state.battery <= 0) {
      state.battery = 0;
      state.over = true;
      state.failReason = "电池归零，小镇停电";
    } else if (state.batteryHealth <= 0) {
      state.over = true;
      state.failReason = "电池过充冲爆";
    } else if (state.gaps >= MAX_GAPS) {
      state.over = true;
      state.failReason = "出现三次供电缺口";
    } else if (t >= DURATION) {
      state.over = true;
      state.win = true;
    }
    return state;
  }

  return {
    DURATION, N_TURBINES, RATED_KW, BATTERY_CAP, MAX_GAPS,
    GUSTS, PEAKS,
    windSpeedAt, windDirAt, frontAt, demandAt,
    createState, step, degDiff,
  };
});
