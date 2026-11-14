import {
  CARGO_SIZE,
  PHYSICS,
  SLOT_CENTER_Y,
  SLOT_WIDTH,
  STAGING,
  TARGETS,
  WORLD,
} from "./config.js";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const approach = (value, target, delta) => {
  if (value < target) return Math.min(value + delta, target);
  if (value > target) return Math.max(value - delta, target);
  return target;
};

export class CranePhysics {
  constructor() {
    this.reset();
  }

  reset() {
    this.angle = WORLD.defaultAngle;
    this.angleVelocity = 0;
    this.angleAcceleration = 0;
    this.trolley = WORLD.defaultTrolley;
    this.trolleyVelocity = 0;
    this.trolleyAcceleration = 0;
    this.cableLength = WORLD.defaultCable;
    this.cableVelocity = 0;
    this.swingAngle = 0;
    this.swingVelocity = 0;
    this.swingAcceleration = 0;
    this.attachedId = null;
    this.attachGrace = 0;
    this.hasLifted = false;
    this.braking = false;
    this.slewBraking = false;
    this.motorLoad = 0;
    this.wind = PHYSICS.windBase;
    this.anchor = { x: 0, y: 0, ax: 0, ay: 0 };
    this.hook = { x: 0, y: 0, vx: 0, vy: 0 };
    this.cargoes = STAGING.map((cargo) => ({
      ...cargo,
      width: CARGO_SIZE.width,
      height: CARGO_SIZE.height,
      homeX: cargo.x,
      homeY: cargo.y,
      state: "staged",
      rotation: 0,
      respawnAt: 0,
      landedWrong: false,
    }));
    this.events = [];
    this.updateGeometry(1 / 120);
  }

  getCarried() {
    return this.attachedId === null
      ? null
      : this.cargoes.find((cargo) => cargo.id === this.attachedId && cargo.state === "carried");
  }

  get carried() {
    return this.getCarried();
  }

  get loadWeight() {
    return this.getCarried()?.weight ?? 0.22;
  }

  update(dt, input, environment = {}) {
    dt = clamp(dt, 1 / 240, 1 / 30);
    this.events.length = 0;
    this.wind =
      PHYSICS.windBase +
      Math.sin((environment.time ?? 0) * 0.53) * 12 +
      Math.sin((environment.time ?? 0) * 1.91 + 1.4) * 9 +
      (environment.gust ?? 0) * PHYSICS.windGust;

    const load = this.loadWeight;
    const inertia = 0.78 + load * 0.3;
    const previousTrolleyVelocity = this.trolleyVelocity;
    const previousAngleVelocity = this.angleVelocity;

    const trolleyInput = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    const slewInput = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const maxTrolleySpeed = PHYSICS.trolleySpeed / (0.84 + load * 0.22);
    const targetTrolleySpeed = trolleyInput * maxTrolleySpeed;
    const reversing = trolleyInput !== 0 && Math.sign(targetTrolleySpeed) !== Math.sign(this.trolleyVelocity);
    const trolleyAccel = trolleyInput === 0
      ? PHYSICS.trolleyBrake / (0.82 + load * 0.12)
      : (reversing ? PHYSICS.trolleyBrake * 1.08 : PHYSICS.trolleyAccel) / inertia;

    this.trolleyVelocity = approach(this.trolleyVelocity, targetTrolleySpeed, trolleyAccel * dt);
    this.trolley = clamp(
      this.trolley + this.trolleyVelocity * dt,
      WORLD.trolleyMin,
      WORLD.trolleyMax,
    );
    if (this.trolley === WORLD.trolleyMin || this.trolley === WORLD.trolleyMax) {
      this.trolleyVelocity = 0;
    }

    const targetSlewSpeed = (slewInput * PHYSICS.slewSpeed) / inertia;
    const slewReversing = slewInput !== 0 && Math.sign(this.angleVelocity) !== Math.sign(targetSlewSpeed);
    const slewAccel = slewInput === 0
      ? PHYSICS.slewBrake
      : (slewReversing ? PHYSICS.slewBrake : PHYSICS.slewAccel) / inertia;
    this.angleVelocity = approach(this.angleVelocity, targetSlewSpeed, slewAccel * dt);
    this.angle = clamp(
      this.angle + this.angleVelocity * dt,
      WORLD.angleMin,
      WORLD.angleMax,
    );
    if (this.angle === WORLD.angleMin || this.angle === WORLD.angleMax) {
      this.angleVelocity = 0;
    }

    const payingOut = Boolean(input.down);
    const previousCableLength = this.cableLength;
    if (payingOut) {
      this.cableVelocity = PHYSICS.payOutSpeed;
    } else if (this.cableLength > WORLD.minCable) {
      this.cableVelocity = -PHYSICS.reelSpeed / (0.88 + load * 0.13);
    } else {
      this.cableVelocity = 0;
    }
    this.cableLength = clamp(
      this.cableLength + this.cableVelocity * dt,
      WORLD.minCable,
      WORLD.maxCable,
    );
    if (this.cableLength === WORLD.minCable || this.cableLength === WORLD.maxCable) {
      this.cableVelocity = 0;
    }

    this.trolleyAcceleration = (this.trolleyVelocity - previousTrolleyVelocity) / dt;
    this.angleAcceleration = (this.angleVelocity - previousAngleVelocity) / dt;
    this.cableVelocity = (this.cableLength - previousCableLength) / dt;
    this.braking = trolleyInput === 0 && Math.abs(this.trolleyVelocity) > 4;
    this.slewBraking = slewInput === 0 && Math.abs(this.angleVelocity) > 0.012;

    this.updateSwing(dt, load);
    this.updateGeometry(dt);
    this.updateCargo(dt, input);

    const throttle = this.braking || this.slewBraking ? 0.18 : Math.abs(trolleyInput) + Math.abs(slewInput);
    this.motorLoad = clamp(
      Math.abs(this.trolleyVelocity) / maxTrolleySpeed * 0.58 +
        Math.abs(this.angleVelocity) / PHYSICS.slewSpeed * 0.34 +
        Math.min(throttle, 1) * 0.24 +
        (payingOut ? 0.22 : 0) +
        (this.getCarried() ? 0.12 + load * 0.18 : 0),
      0,
      1,
    );
    this.attachGrace = Math.max(0, this.attachGrace - dt);
    return this.events;
  }

  updateSwing(dt, load) {
    const length = Math.max(this.cableLength, 40);
    const sin = Math.sin(this.swingAngle);
    const cos = Math.cos(this.swingAngle);
    const a = this.angle;
    const av = this.angleVelocity;
    const aa = this.angleAcceleration;
    const s = this.trolley;
    const sv = this.trolleyVelocity;
    const sa = this.trolleyAcceleration;
    const ax =
      -Math.cos(a) * av * av * s -
      Math.sin(a) * aa * s -
      2 * Math.sin(a) * av * sv +
      Math.cos(a) * sa;
    const ay =
      -Math.sin(a) * av * av * s +
      Math.cos(a) * aa * s +
      2 * Math.cos(a) * av * sv +
      Math.sin(a) * sa;

    this.anchor.ax = ax;
    this.anchor.ay = ay;
    const carried = this.getCarried();
    const damping = carried ? Math.max(0.34, 0.78 - (load - 0.9) * 0.29) : 1.72;
    const windForce = this.wind / (0.82 + load * 0.2);
    const gravityTorque = -(PHYSICS.gravity / length) * sin;
    const supportTorque = -(ax * cos - ay * sin) / length;
    const windTorque = (windForce * cos) / length;
    const lengthTorque = -2 * (this.cableVelocity / length) * this.swingVelocity;
    let guideTorque = 0;
    if (carried) {
      const target = TARGETS.find((slot) => slot.id === carried.id);
      const cargoCenterY = this.anchor.y + cos * length + cos * (carried.height / 2);
      const cargoCenterX = this.anchor.x + sin * (length + carried.height / 2);
      if (
        target &&
        cargoCenterY > WORLD.quayTop - 230 &&
        Math.abs(cargoCenterX - target.x) < 135
      ) {
        const desired = Math.asin(
          clamp((target.x - this.anchor.x) / (length + carried.height / 2), -0.82, 0.82),
        );
        guideTorque = (desired - this.swingAngle) * 7.5 - this.swingVelocity * 1.25;
      }
    }

    this.swingAcceleration =
      gravityTorque +
      supportTorque +
      windTorque +
      lengthTorque +
      guideTorque -
      damping * this.swingVelocity;
    this.swingVelocity += this.swingAcceleration * dt;
    this.swingAngle += this.swingVelocity * dt;

    const limit = 0.78;
    if (Math.abs(this.swingAngle) > limit) {
      this.swingAngle = Math.sign(this.swingAngle) * limit;
      this.swingVelocity *= -0.08;
    }
  }

  updateGeometry(dt) {
    const previousHookX = this.hook.x;
    const previousHookY = this.hook.y;
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    this.anchor.x = WORLD.pivotX + cos * this.trolley;
    this.anchor.y = WORLD.pivotY + sin * this.trolley;
    this.hook.x = this.anchor.x + Math.sin(this.swingAngle) * this.cableLength;
    this.hook.y = this.anchor.y + Math.cos(this.swingAngle) * this.cableLength;
    if (previousHookX !== 0 || previousHookY !== 0) {
      this.hook.vx = (this.hook.x - previousHookX) / dt;
      this.hook.vy = (this.hook.y - previousHookY) / dt;
    } else {
      this.hook.vx = 0;
      this.hook.vy = 0;
    }
  }

  supportAt(x) {
    if (x < WORLD.quayRight) return { type: "quay", y: WORLD.quayTop };
    if (x >= WORLD.shipLeft - 8 && x <= WORLD.shipRight + 8) {
      return { type: "deck", y: WORLD.shipDeckY };
    }
    return { type: "water", y: WORLD.waterY + 20 };
  }

  placeCargoTransform(cargo) {
    const theta = this.swingAngle;
    cargo.x = this.hook.x + Math.sin(theta) * (cargo.height / 2);
    cargo.y = this.hook.y + Math.cos(theta) * (cargo.height / 2);
    cargo.rotation = theta;
  }

  cargoBottom(cargo) {
    return cargo.y + Math.cos(cargo.rotation) * (cargo.height / 2) +
      Math.abs(Math.sin(cargo.rotation)) * (cargo.width / 2);
  }

  updateCargo(dt, input) {
    for (const cargo of this.cargoes) {
      if (cargo.state === "lost") {
        cargo.lostTimer = (cargo.lostTimer ?? 0) - dt;
        if (cargo.lostTimer <= 0) this.respawnCargo(cargo);
      }
    }

    const carried = this.getCarried();
    if (!carried && input.down && this.attachGrace <= 0) this.tryGrab();

    const active = this.getCarried();
    if (!active) return;

    const previousX = active.x;
    const previousY = active.y;
    this.placeCargoTransform(active);
    const surface = this.supportAt(active.x);
    let bottom = this.cargoBottom(active);

    if (!this.hasLifted) {
      if (bottom > surface.y) {
        const correction = bottom - surface.y;
        this.cableLength = Math.max(WORLD.minCable, this.cableLength - correction);
        this.updateGeometry(dt);
        this.placeCargoTransform(active);
        bottom = this.cargoBottom(active);
      }
      if (bottom < surface.y - 7) this.hasLifted = true;
    }

    active.vx = (active.x - previousX) / dt;
    active.vy = (active.y - previousY) / dt;
    active.rotation = this.swingAngle;
    if (!this.hasLifted || this.attachGrace > 0) return;
    if (bottom < surface.y - 1) return;

    const speed = Math.hypot(active.vx, active.vy);
    if (surface.type === "water") {
      this.loseCargo(active, speed);
      return;
    }

    const target = surface.type === "quay"
      ? TARGETS.find((slot) => Math.abs(active.x - slot.x) <= SLOT_WIDTH * 0.58)
      : null;
    if (target && target.id === active.id) {
      this.completePlacement(active, target, speed);
      return;
    }

    this.releaseCargo(active, surface, speed, target ? "wrong-slot" : "landed");
  }

  tryGrab() {
    let nearest = null;
    let nearestDistance = PHYSICS.hookGrabRadius;
    for (const cargo of this.cargoes) {
      if (cargo.state !== "staged") continue;
      const topX = cargo.x;
      const topY = cargo.y - cargo.height / 2;
      const distance = Math.hypot(this.hook.x - topX, this.hook.y - topY);
      if (distance < nearestDistance) {
        nearest = cargo;
        nearestDistance = distance;
      }
    }
    if (!nearest) return;

    nearest.state = "carried";
    nearest.rotation = this.swingAngle;
    this.attachedId = nearest.id;
    this.attachGrace = 0.3;
    this.hasLifted = false;
    this.events.push({ type: "attach", cargo: nearest, weight: nearest.weight });
  }

  releaseCargo(cargo, surface, speed, reason) {
    cargo.state = "staged";
    cargo.rotation = 0;
    cargo.x = clamp(cargo.x, cargo.width / 2 + 4, 1600 - cargo.width / 2 - 4);
    cargo.y = surface.y - cargo.height / 2;
    cargo.vx = 0;
    cargo.vy = 0;
    cargo.landedWrong = reason === "wrong-slot";
    this.detach();
    this.events.push({
      type: "landed",
      cargo,
      speed,
      hard: speed > PHYSICS.impactSpeed,
      reason,
      surface: surface.type,
    });
  }

  completePlacement(cargo, target, speed) {
    cargo.state = "placed";
    cargo.x = target.x;
    cargo.y = SLOT_CENTER_Y;
    cargo.rotation = 0;
    cargo.vx = 0;
    cargo.vy = 0;
    cargo.landedWrong = false;
    this.detach();
    this.events.push({ type: "placed", cargo, target, speed });
    if (speed > PHYSICS.impactSpeed) {
      this.events.push({ type: "impact", cargo, speed, placed: true });
    }
  }

  loseCargo(cargo, speed) {
    cargo.state = "lost";
    cargo.lostTimer = 2.35;
    cargo.rotation = 0;
    cargo.vx = 0;
    cargo.vy = 0;
    cargo.splashX = cargo.x;
    this.detach();
    this.events.push({ type: "splash", cargo, speed });
  }

  respawnCargo(cargo) {
    cargo.state = "staged";
    cargo.x = cargo.homeX;
    cargo.y = cargo.homeY;
    cargo.rotation = 0;
    cargo.lostTimer = 0;
    cargo.splashX = null;
    this.events.push({ type: "respawn", cargo });
  }

  detach() {
    this.attachedId = null;
    this.attachGrace = 0.18;
    this.hasLifted = false;
  }

  snapshot() {
    const carried = this.getCarried();
    return {
      angle: this.angle,
      angleVelocity: this.angleVelocity,
      trolleyDistance: this.trolley,
      trolleySpeed: this.trolleyVelocity,
      trolleyAcceleration: this.trolleyAcceleration,
      cableLength: this.cableLength,
      cableSpeed: this.cableVelocity,
      swingAngle: this.swingAngle,
      swingVelocity: this.swingVelocity,
      swingAcceleration: this.swingAcceleration,
      braking: this.braking,
      slewBraking: this.slewBraking,
      motorLoad: this.motorLoad,
      wind: this.wind,
      attachedId: this.attachedId,
      carryingWeight: carried?.weight ?? 0,
      anchor: { ...this.anchor },
      hook: { ...this.hook },
      carriedCargo: carried
        ? { id: carried.id, x: carried.x, y: carried.y, vx: carried.vx, vy: carried.vy }
        : null,
      cargoes: this.cargoes.map((cargo) => ({
        id: cargo.id,
        x: cargo.x,
        y: cargo.y,
        state: cargo.state,
      })),
    };
  }
}
