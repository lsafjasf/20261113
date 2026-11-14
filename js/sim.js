import { GAME, STATIONS, brakingDistance } from "./config.js";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function windAt(scenario, time) {
  const wave =
    Math.sin(time * 0.16 + scenario.windPhase) * 0.62 +
    Math.sin(time * 0.047 + scenario.windPhase * 2.1) * 0.38;
  return Math.max(1, scenario.windBase + scenario.windGust * wave);
}

export function windSpeedFactor(wind) {
  return 1 - clamp((wind - 6) / 40, 0, 0.34);
}

export function makePassengerState(scenario) {
  return scenario.passengers.map((passenger) => ({
    ...passenger,
    status: "waiting",
    boardedAt: null,
    deliveredAt: null,
  }));
}

export class RopewaySim {
  constructor(scenario, policy, options = {}) {
    this.scenario = scenario;
    this.policy = {
      interval: clamp(policy.interval, GAME.minInterval, GAME.maxInterval),
      stops: [...policy.stops],
    };
    this.dt = options.dt ?? 0.05;
    this.time = 0;
    this.battery = GAME.startBattery;
    this.passengers = makePassengerState(scenario);
    this.events = [];
    this.eventCounter = 0;
    this.emergencyStops = 0;
    this.completedStops = 0;
    this.ended = false;
    this.result = null;
    this.currentWind = windAt(scenario, 0);
    this.cars = [
      this.makeCar(0, "01", 0),
      this.makeCar(1, "02", this.policy.interval),
    ];

    this.emit("shift", "班次启动，01 号吊厢离站。", "neutral");
    this.launchCar(this.cars[0]);
  }

  makeCar(index, code, launchAt) {
    return {
      index,
      code,
      launchAt,
      state: "queued",
      distance: 0,
      speed: 0,
      accel: 0,
      braking: false,
      stationIndex: 0,
      dwellRemaining: 0,
      emergencyRemaining: 0,
      emergencyCooldown: 0,
      passengerIds: [],
      finishedAt: null,
      stopsMade: 0,
      swayPhase: index * 2.7 + 0.7,
    };
  }

  emit(type, text, tone = "neutral", extra = {}) {
    const event = {
      id: ++this.eventCounter,
      time: this.time,
      type,
      text,
      tone,
      ...extra,
    };
    this.events.push(event);
    if (this.events.length > 80) this.events.shift();
    return event;
  }

  passengerById(id) {
    return this.passengers.find((passenger) => passenger.id === id);
  }

  carPassengers(car) {
    return car.passengerIds.map((id) => this.passengerById(id)).filter(Boolean);
  }

  launchCar(car) {
    if (car.state !== "queued" || this.ended) return;
    car.state = "running";
    car.distance = 0;
    car.speed = 0;
    car.accel = 0;
    car.braking = false;
    if (this.policy.stops[0]) {
      this.processStation(car, 0, true);
    }
    if (car.index > 0) {
      this.emit("depart", `${car.code} 号吊厢收到发车许可。`, "info", { car: car.code });
    }
  }

  processStation(car, stationIndex, isDeparture = false) {
    const station = STATIONS[stationIndex];
    const aboard = this.carPassengers(car);
    const arriving = aboard.filter((passenger) => passenger.destination === stationIndex);

    for (const passenger of arriving) {
      passenger.status = "delivered";
      passenger.deliveredAt = this.time;
      car.passengerIds = car.passengerIds.filter((id) => id !== passenger.id);
      this.emit("deliver", `${passenger.name} 在${station.name}下缆。`, "good", {
        passenger: passenger.name,
        station: station.name,
      });
    }

    let seats = GAME.carCapacity - car.passengerIds.length;
    const boarding = this.passengers
      .filter(
        (passenger) =>
          passenger.status === "waiting" &&
          passenger.origin === stationIndex &&
          passenger.patience > 0,
      )
      .slice(0, Math.max(0, seats));

    for (const passenger of boarding) {
      passenger.status = "aboard";
      passenger.boardedAt = this.time;
      passenger.car = car.code;
      car.passengerIds.push(passenger.id);
      this.emit(
        "board",
        `${passenger.name} 登车前往${STATIONS[passenger.destination].name}。`,
        "info",
        { passenger: passenger.name },
      );
    }
    seats = GAME.carCapacity - car.passengerIds.length;

    if (!isDeparture || arriving.length > 0 || boarding.length > 0) {
      const doorState = isDeparture ? "始发" : "停靠";
      this.emit(
        "stop",
        `${car.code} 号${doorState}${station.name}：下 ${arriving.length} / 上 ${boarding.length}。`,
        isDeparture ? "neutral" : "info",
        { car: car.code, station: station.name },
      );
    }
    if (car.passengerIds.length > 0 && seats === 0 && boarding.length > 0) {
      this.emit("capacity", `${car.code} 号满员，余下乘客等待下一班。`, "warn");
    }
    return { arriving: arriving.length, boarding: boarding.length };
  }

  arriveAtStation(car, stationIndex) {
    const station = STATIONS[stationIndex];
    car.distance = station.distance;
    car.speed = 0;
    car.accel = 0;
    car.braking = false;
    car.stationIndex = stationIndex;

    if (!this.policy.stops[stationIndex]) {
      if (stationIndex === STATIONS.length - 1) {
        this.finishCar(car);
      } else {
        car.state = "running";
      }
      return;
    }

    car.state = "dwelling";
    car.dwellRemaining = GAME.stationDwell;
    car.stopsMade += 1;
    this.battery = Math.max(0, this.battery - GAME.stationPowerCost);
    this.completedStops += 1;
    this.processStation(car, stationIndex);
  }

  finishCar(car) {
    if (car.state === "finished") return;
    car.state = "finished";
    car.distance = STATIONS[STATIONS.length - 1].distance;
    car.speed = 0;
    car.accel = 0;
    car.finishedAt = this.time;
    this.emit("finish", `${car.code} 号吊厢抵达云顶，全程完成。`, "good", {
      car: car.code,
    });
  }

  updateMovement(car, dt) {
    if (car.state !== "running") return;

    const nextStationIndex = STATIONS.findIndex(
      (station) => station.distance > car.distance + 0.02,
    );
    const targetIndex = nextStationIndex === -1 ? STATIONS.length - 1 : nextStationIndex;
    const target = STATIONS[targetIndex];
    const isTerminal = targetIndex === STATIONS.length - 1;
    const shouldStop = this.policy.stops[targetIndex] || isTerminal;
    const distanceLeft = Math.max(0, target.distance - car.distance);
    const deceleration = GAME.baseDeceleration / (1 + this.scenario.ice * 0.9);
    const stopEnvelope = brakingDistance(car.speed, this.scenario.ice) + 3;
    const wind = this.currentWind;
    const speedLimit = GAME.cruiseSpeed * windSpeedFactor(wind);
    const previousSpeed = car.speed;

    car.braking = shouldStop && distanceLeft <= stopEnvelope;
    if (car.braking) {
      car.speed = Math.max(0, car.speed - deceleration * dt);
    } else {
      car.speed = Math.min(speedLimit, car.speed + GAME.acceleration * dt);
    }
    car.accel = (car.speed - previousSpeed) / Math.max(dt, 0.0001);
    car.distance += car.speed * dt;

    if (shouldStop && distanceLeft < 5 && car.speed < 0.35) {
      car.speed = 0;
      this.arriveAtStation(car, targetIndex);
    } else if (car.distance >= target.distance - 0.01 && shouldStop) {
      this.arriveAtStation(car, targetIndex);
    } else if (car.distance >= STATIONS[STATIONS.length - 1].distance) {
      this.finishCar(car);
    }
  }

  updateDwell(car, dt) {
    if (car.state !== "dwelling") return;
    car.dwellRemaining -= dt;
    if (car.dwellRemaining > 0) return;

    if (car.stationIndex === STATIONS.length - 1) {
      this.finishCar(car);
    } else {
      car.state = "running";
      car.braking = false;
      this.emit("depart", `${car.code} 号驶离${STATIONS[car.stationIndex].name}。`, "neutral", {
        car: car.code,
      });
    }
  }

  updateEmergency(car, dt) {
    if (car.state !== "emergency") return;
    car.speed = 0;
    car.accel = 0;
    car.emergencyRemaining -= dt;
    if (car.emergencyRemaining <= 0) {
      car.state = "running";
      car.emergencyRemaining = 0;
      car.emergencyCooldown = 3;
      this.emit("resume", `${car.code} 号复位，重新起步。`, "info", { car: car.code });
    }
  }

  checkHeadway() {
    const [lead, follower] = this.cars;
    if (lead.state === "finished" || follower.state === "finished") return;
    if (follower.state !== "running" || follower.emergencyCooldown > 0) return;
    if (lead.state === "queued") return;

    const gap = lead.distance - follower.distance - GAME.carLength;
    const safeGap =
      brakingDistance(follower.speed, this.scenario.ice) +
      GAME.headwayBuffer +
      follower.speed * 0.55;
    const closing = lead.speed < follower.speed - 0.35 || lead.state === "dwelling";

    if (gap < safeGap && closing) {
      follower.state = "emergency";
      follower.speed = 0;
      follower.accel = 0;
      follower.emergencyRemaining = GAME.emergencyHold;
      follower.emergencyCooldown = 8;
      this.emergencyStops += 1;
      this.battery = Math.max(0, this.battery - GAME.emergencyPowerCost);
      this.emit(
        "emergency",
        `${follower.code} 号间距过近，防撞急停 ${GAME.emergencyHold.toFixed(0)} 秒。`,
        "danger",
        {
          car: follower.code,
          gap: Math.max(0, gap),
        },
      );
    }
  }

  updateBattery(dt) {
    const activeCars = this.cars.filter((car) =>
      ["running", "dwelling", "emergency"].includes(car.state),
    ).length;
    const movingCars = this.cars.filter((car) => car.state === "running" && car.speed > 0.2);
    const averageSpeed =
      movingCars.length > 0
        ? movingCars.reduce((sum, car) => sum + car.speed, 0) / movingCars.length
        : 0;
    const drain =
      0.09 +
      activeCars * 0.1 +
      (averageSpeed / GAME.cruiseSpeed) * 0.15 +
      this.currentWind * 0.0045;
    this.battery = Math.max(0, this.battery - drain * dt);
  }

  updatePassengers(dt) {
    for (const passenger of this.passengers) {
      if (passenger.status !== "waiting") continue;
      passenger.patience = Math.max(0, passenger.patience - dt);
      if (passenger.patience <= 0) {
        passenger.status = "left";
        this.emit("lost", `${passenger.name} 等待超时，离开${STATIONS[passenger.origin].name}。`, "danger", {
          passenger: passenger.name,
        });
      }
    }
  }

  evaluate() {
    if (this.ended) return;
    const delivered = this.passengers.filter((passenger) => passenger.status === "delivered").length;
    const left = this.passengers.filter((passenger) => passenger.status === "left").length;
    const aboard = this.passengers.filter((passenger) => passenger.status === "aboard").length;
    const waiting = this.passengers.filter((passenger) => passenger.status === "waiting").length;
    const bothFinished = this.cars.every((car) => car.state === "finished");

    if (left > 0) {
      this.end(false, "passengers", `有 ${left} 名乘客等待超时，班次无法完成。`);
      return;
    }
    if (this.battery < GAME.minimumBattery) {
      this.end(false, "battery", "电量跌破安全线，索道保护性停机。");
      return;
    }
    if (this.time >= GAME.shiftLimit) {
      this.end(false, "timeout", "班次超出调度窗口，风雪吞没了索道。");
      return;
    }
    if (bothFinished) {
      if (delivered === this.passengers.length && this.battery >= GAME.minimumBattery) {
        this.end(true, "success", "八名乘客全部抵达，双车完成全程。");
      } else {
        this.end(false, "incomplete", `${delivered} / ${this.passengers.length} 名乘客完成行程。`);
      }
      return;
    }
    if (waiting === 0 && aboard === 0 && delivered < this.passengers.length) {
      this.end(false, "incomplete", "站台已清空，但仍有乘客未能抵达。");
    }
  }

  end(success, reason, message) {
    this.ended = true;
    const delivered = this.passengers.filter((passenger) => passenger.status === "delivered").length;
    this.result = {
      success,
      reason,
      message,
      delivered,
      total: this.passengers.length,
      battery: this.battery,
      time: this.time,
      emergencyStops: this.emergencyStops,
      completedStops: this.completedStops,
      interval: this.policy.interval,
      stops: [...this.policy.stops],
    };
    this.emit(success ? "success" : "failure", message, success ? "good" : "danger");
  }

  step(dt = this.dt) {
    if (this.ended) return this.result;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    this.currentWind = windAt(this.scenario, this.time);

    for (const car of this.cars) {
      car.emergencyCooldown = Math.max(0, car.emergencyCooldown - dt);
      if (car.state === "queued" && this.time >= car.launchAt) this.launchCar(car);
    }

    this.updatePassengers(dt);
    this.updateBattery(dt);
    for (const car of this.cars) {
      this.updateEmergency(car, dt);
      this.updateDwell(car, dt);
      this.updateMovement(car, dt);
    }
    this.checkHeadway();
    this.evaluate();
    return this.result;
  }

  advance(seconds, dt = this.dt) {
    let remaining = seconds;
    while (remaining > 0 && !this.ended) {
      const slice = Math.min(dt, remaining);
      this.step(slice);
      remaining -= slice;
    }
    return this.result;
  }
}

export function simulate(scenario, policy, options = {}) {
  const sim = new RopewaySim(scenario, policy, options);
  sim.advance(options.maxTime ?? GAME.shiftLimit + 1, options.dt ?? 0.05);
  return sim;
}

export function validatePolicy(scenario, policy) {
  const sim = simulate(scenario, policy);
  return {
    ok: Boolean(sim.result?.success),
    sim,
    result: sim.result,
  };
}

