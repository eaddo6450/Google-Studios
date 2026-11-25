import * as THREE from 'three';

export interface AircraftPhysicsState {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  quaternion: THREE.Quaternion;
  angularVelocity: THREE.Vector3; // local space: x=pitch rate, y=yaw rate, z=roll rate
  throttle: number; // 0..1 (AB engages > 0.85)
  afterburner: boolean;
  airbrake: boolean;
  mach: number;
  iasKts: number;
  tasMps: number;
  aoaDeg: number;
  sideslipDeg: number;
  gForce: number;
  gTolerance: number; // 1.0 = full perfusion, 0.0 = G-LOC unconsciousness
  gLocActive: boolean;
  gLocRecoveryTimer: number;
  gLocIntensity: number; // 0..1 visual tunnel vision & blackout
  redoutIntensity: number; // 0..1 negative-G redout
  stallWarning: boolean;
  crossedMachUp: boolean;
}

export interface ControlInputs {
  pitch: number; // -1..1 (+1 = nose up)
  roll: number;  // -1..1 (+1 = roll right)
  yaw: number;   // -1..1 (+1 = yaw left / right-hand rule +Y)
  throttleDelta: number; // -1..1
  afterburnerBoost: boolean;
  airbrake: boolean;
}

import { getAircraftSpec, type AircraftSpec } from './aircraftCatalog';
import type { TurbulenceSample } from './weather';

// Default spec fallback
const DEFAULT_SPEC = getAircraftSpec('f22');
const GRAVITY = 9.81;

// Human physiological G-tolerance limits (equipped with G-suit & AGSM)
export const HUMAN_SUSTAINED_POS_G_LIMIT = 6.5; // Perfusion begins dropping above +6.5G
export const HUMAN_CRITICAL_POS_G_LIMIT = 9.0;  // Rapid blackout threshold (+9G+)
export const HUMAN_NEG_G_LIMIT = -2.5;          // Negative-G redout threshold
export const GLOC_INCAPACITATION_SEC = 2.6;     // Unconscious window before stick recovery

// Pre-allocated scratch math objects (Zero GC in 60fps loop)
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _localVel = new THREE.Vector3();
const _airVel = new THREE.Vector3();
const _force = new THREE.Vector3();
const _liftDir = new THREE.Vector3();
const _dragDir = new THREE.Vector3();
const _zeroWind = new THREE.Vector3(0, 0, 0);
const _zeroTurb: TurbulenceSample = { pitch: 0, roll: 0, yaw: 0 };
const _worldUp = new THREE.Vector3(0, 1, 0);
const _deltaQuat = new THREE.Quaternion();
const _eulerDelta = new THREE.Euler();
const _attitudeEuler = new THREE.Euler();

export function createInitialAircraftState(): AircraftPhysicsState {
  const state: AircraftPhysicsState = {
    position: new THREE.Vector3(0, 920, 2600),
    velocity: new THREE.Vector3(0, 0, -235),
    quaternion: new THREE.Quaternion(),
    angularVelocity: new THREE.Vector3(0, 0, 0),
    throttle: 0.72,
    afterburner: false,
    airbrake: false,
    mach: 0.7,
    iasKts: 430,
    tasMps: 235,
    aoaDeg: 2.1,
    sideslipDeg: 0,
    gForce: 1.0,
    gTolerance: 1.0,
    gLocActive: false,
    gLocRecoveryTimer: 0,
    gLocIntensity: 0,
    redoutIntensity: 0,
    stallWarning: false,
    crossedMachUp: false,
  };
  return state;
}

export function createSmoothedControlState(): ControlInputs {
  return {
    pitch: 0,
    roll: 0,
    yaw: 0,
    throttleDelta: 0,
    afterburnerBoost: false,
    airbrake: false,
  };
}

/**
 * Fly-by-wire control-input smoothing & speed-dependent stick shaping.
 * Smooths abrupt digital keyboard taps cleanly without introducing sluggishness.
 */
export function smoothControlInputs(
  smoothed: ControlInputs,
  raw: ControlInputs,
  mach: number,
  dt: number
): void {
  const highSpeedDamp = 1 - THREE.MathUtils.clamp((mach - 0.85) * 0.28, 0, 0.35);
  const pitchRate = 11.5 * highSpeedDamp;
  const rollRate = 13.5 * highSpeedDamp;
  const yawRate = 10.0;

  smoothed.pitch = THREE.MathUtils.damp(smoothed.pitch, raw.pitch, pitchRate, dt);
  smoothed.roll = THREE.MathUtils.damp(smoothed.roll, raw.roll, rollRate, dt);
  smoothed.yaw = THREE.MathUtils.damp(smoothed.yaw, raw.yaw, yawRate, dt);
  smoothed.throttleDelta = raw.throttleDelta;
  smoothed.afterburnerBoost = raw.afterburnerBoost;
  smoothed.airbrake = raw.airbrake;
}

export function stepAircraftPhysics(
  s: AircraftPhysicsState,
  input: ControlInputs,
  dt: number,
  spec: AircraftSpec = DEFAULT_SPEC,
  hullPct = 100,
  windVel: THREE.Vector3 = _zeroWind,
  turb: TurbulenceSample = _zeroTurb,
  gearDown = false,
  onGround = false
): void {
  const prevMach = s.mach;

  // 1. Throttle & Afterburner spool
  if (input.afterburnerBoost) {
    s.throttle = THREE.MathUtils.clamp(s.throttle + dt * 0.75, 0, 1);
    if (s.throttle < 0.92) s.throttle = THREE.MathUtils.lerp(s.throttle, 1.0, dt * 3.0);
  } else {
    s.throttle = THREE.MathUtils.clamp(s.throttle + input.throttleDelta * dt * 0.52, 0.05, 1.0);
  }
  s.airbrake = input.airbrake;
  s.afterburner = (s.throttle > 0.85 || input.afterburnerBoost) && !s.airbrake;

  // 2. Atmospheric model vs altitude
  const alt = Math.max(0, s.position.y);
  const rho = 1.225 * Math.exp(-alt / 8500); // kg/m^3
  const speedOfSound = Math.max(295, 340.3 - 0.004 * Math.min(alt, 11000));

  // 3. Body basis vectors in world space (-Z forward, +Y up, +X right)
  _fwd.set(0, 0, -1).applyQuaternion(s.quaternion).normalize();
  _up.set(0, 1, 0).applyQuaternion(s.quaternion).normalize();
  _right.set(1, 0, 0).applyQuaternion(s.quaternion).normalize();

  // 4. Air-Relative Airflow (ground velocity minus ambient wind & gusts)
  _airVel.copy(s.velocity).sub(windVel);
  const vFwd = _airVel.dot(_fwd);
  const vUp = _airVel.dot(_up);
  const vRight = _airVel.dot(_right);
  const airspeed = _airVel.length();
  s.tasMps = airspeed;
  s.mach = airspeed / speedOfSound;
  s.crossedMachUp = prevMach < 1.0 && s.mach >= 1.0;

  // Indicated Airspeed (scales with sqrt(rho / rho0))
  const eas = airspeed * Math.sqrt(rho / 1.225);
  s.iasKts = eas * 1.94384;

  // Angle of attack (alpha) & sideslip (beta)
  const fwdSafe = Math.max(12, Math.abs(vFwd));
  const aoaRad = Math.atan2(-vUp, fwdSafe);
  const betaRad = Math.atan2(vRight, fwdSafe);
  s.aoaDeg = THREE.MathUtils.radToDeg(aoaRad);
  s.sideslipDeg = THREE.MathUtils.radToDeg(betaRad);

  // 5. Dynamic Pressure q = 0.5 * rho * V_air^2
  const q = 0.5 * rho * airspeed * airspeed;

  // Airframe-specific wing sweep & canard high-alpha lift envelope
  const sweepFactor = spec.hasSwingWings
    ? THREE.MathUtils.clamp((s.mach - 0.55) / 0.55, 0, 1) // 0=extended low-speed, 1=swept supersonic
    : 0.5;
  const effectiveWingArea = spec.hasSwingWings
    ? spec.wingAreaM2 * (1.12 - sweepFactor * 0.22)
    : spec.wingAreaM2;
  const stallAoaLimit = spec.hasCanards ? 23.0 : spec.hasSwingWings && sweepFactor < 0.4 ? 20.5 : 19.0;
  const liftSlope = spec.hasCanards ? 4.45 : spec.hasSwingWings ? 4.45 - sweepFactor * 0.4 : 4.2;

  const effectiveAoa = aoaRad + 0.032; // slight wing incidence for level cruise
  const absAoaDeg = Math.abs(s.aoaDeg);
  let cl = 0;
  if (absAoaDeg < stallAoaLimit) {
    cl = liftSlope * effectiveAoa;
  } else {
    const stallDrop = Math.max(0.28, 1 - (absAoaDeg - stallAoaLimit) / 26);
    cl = liftSlope * Math.sign(effectiveAoa) * THREE.MathUtils.degToRad(stallAoaLimit) * stallDrop;
  }
  cl = THREE.MathUtils.clamp(cl, -1.7, 1.98);
  s.stallWarning = !onGround && (absAoaDeg > stallAoaLimit - 1.5 || (airspeed < 64 && alt > 40));

  // Drag Coefficient: Parasitic + Induced + Transonic Wave Drag + Airbrake + Landing Gear
  const wavePeak = spec.hasSwingWings ? 0.021 : 0.028;
  const waveDrag = Math.exp(-Math.pow((s.mach - 1.02) / 0.12, 2)) * wavePeak;
  const brakeDrag = s.airbrake ? 0.078 : 0;
  const gearDrag = gearDown ? 0.044 : 0;
  const effectiveInducedK = spec.hasSwingWings ? spec.inducedK * (0.85 + sweepFactor * 0.25) : spec.inducedK;
  const cd = spec.cd0 + effectiveInducedK * cl * cl + waveDrag + brakeDrag + gearDrag;

  // Sideforce (weathervane keel stability reacting to crosswind & sideslip)
  const cy = -1.75 * betaRad;

  // Aerodynamic Lift, Drag, Sideforce vectors (aligned with air-relative flow)
  const liftMag = q * effectiveWingArea * cl;
  const dragMag = q * effectiveWingArea * cd;
  const sideMag = q * effectiveWingArea * cy;

  _force.set(0, 0, 0);

  if (airspeed > 1) {
    _dragDir.copy(_airVel).divideScalar(-airspeed);
    _force.addScaledVector(_dragDir, dragMag);

    _liftDir.copy(_up).addScaledVector(_dragDir, _up.dot(_dragDir) * -1);
    if (_liftDir.lengthSq() > 0.0001) {
      _liftDir.normalize();
    } else {
      _liftDir.copy(_up);
    }
    _force.addScaledVector(_liftDir, liftMag);
    _force.addScaledVector(_right, sideMag);
  }

  // 6. Thrust Force (altitude density recovery + engine battle damage loss below 50% hull)
  const thrustRatio = Math.pow(rho / 1.225, 0.55);
  let baseThrustN = s.afterburner
    ? THREE.MathUtils.lerp(
        spec.maxMilThrustN,
        spec.maxAbThrustN,
        THREE.MathUtils.clamp((s.throttle - 0.8) / 0.2, 0.4, 1)
      )
    : spec.maxMilThrustN * (s.throttle / 0.85);

  if (hullPct < 50) {
    // Damaged engine loses 28%..48% thrust
    const dmgFactor = hullPct < 25 ? 0.52 : 0.72;
    baseThrustN *= dmgFactor;
  }
  _force.addScaledVector(_fwd, baseThrustN * thrustRatio);

  // 7. Gravity
  _force.y -= spec.massKg * GRAVITY;

  // 8. G-Force Load Factor (normal acceleration along aircraft +Y)
  _localVel.copy(_force);
  _localVel.y += spec.massKg * GRAVITY;
  const normalG = onGround ? 1.0 : _localVel.dot(_up) / (spec.massKg * GRAVITY);
  s.gForce = THREE.MathUtils.lerp(s.gForce, THREE.MathUtils.clamp(normalG, -5.5, 11.5), Math.min(1, dt * 10));

  // Integrate linear velocity & position
  s.velocity.addScaledVector(_force, dt / spec.massKg);

  // Runway Ground Rollout Friction, Wheel Brakes & Tire Lateral Grip
  if (onGround) {
    const fwdGround = s.velocity.dot(_fwd);
    const rightGround = s.velocity.dot(_right);

    // Wheel brakes engage automatically on airbrake [B] or idle throttle
    const braking = s.airbrake || s.throttle < 0.28;
    const decelRate = braking ? 22.0 : 4.2;
    if (Math.abs(fwdGround) > 0.1) {
      const nextFwd = Math.max(0, Math.abs(fwdGround) - decelRate * dt) * Math.sign(fwdGround);
      s.velocity.addScaledVector(_fwd, nextFwd - fwdGround);
    }

    // Tire cornering stiffness resists lateral wind scrub (stronger at slower rollout, still leaves crosswind challenge)
    const scrubDamp = Math.exp(-3.2 * dt);
    s.velocity.addScaledVector(_right, rightGround * (scrubDamp - 1));

    // Stay on runway surface unless rotating for takeoff with sufficient speed & pitch up
    const rotatingLift = airspeed > 66 && input.pitch > 0.14;
    if (!rotatingLift && s.velocity.y < 0) {
      s.velocity.y = 0;
    }
  }

  // Airframe Mach structural limit
  const maxSpeed = speedOfSound * spec.maxMach;
  if (s.velocity.length() > maxSpeed) {
    s.velocity.setLength(maxSpeed);
  }
  s.position.addScaledVector(s.velocity, dt);

  // 9. Human G-LOC Physiology & Control Authority
  if (s.gForce > HUMAN_SUSTAINED_POS_G_LIMIT) {
    const excessG = s.gForce - HUMAN_SUSTAINED_POS_G_LIMIT;
    const criticalFactor = s.gForce >= HUMAN_CRITICAL_POS_G_LIMIT ? 1.45 : 1.0;
    const drainRate = (0.12 + excessG * 0.115) * criticalFactor;
    s.gTolerance = Math.max(0, s.gTolerance - drainRate * dt);
    if (s.gTolerance <= 0.02 && !s.gLocActive) {
      s.gLocActive = true;
      s.gLocRecoveryTimer = GLOC_INCAPACITATION_SEC;
    }
  } else {
    const recoverScale = s.gForce < 4.5 ? 1.0 : 0.35;
    s.gTolerance = Math.min(1.0, s.gTolerance + 0.32 * recoverScale * dt);
  }

  if (s.gLocActive) {
    s.gLocRecoveryTimer = Math.max(0, s.gLocRecoveryTimer - dt);
    if (s.gLocRecoveryTimer <= 0 && s.gTolerance >= 0.34) {
      s.gLocActive = false;
    }
  }

  const targetGlocVisual = s.gLocActive
    ? 0.96
    : THREE.MathUtils.clamp((0.88 - s.gTolerance) / 0.88, 0, 0.9);
  s.gLocIntensity = THREE.MathUtils.damp(s.gLocIntensity, targetGlocVisual, 7.5, dt);

  const targetRedout = s.gForce < HUMAN_NEG_G_LIMIT
    ? THREE.MathUtils.clamp((HUMAN_NEG_G_LIMIT - s.gForce) / 2.5, 0, 0.85)
    : 0;
  s.redoutIntensity = THREE.MathUtils.damp(s.redoutIntensity, targetRedout, 6.5, dt);

  const activePitch = s.gLocActive ? 0 : input.pitch;
  const activeRoll = s.gLocActive ? 0 : input.roll;
  const activeYaw = s.gLocActive ? 0 : input.yaw;

  const authority = THREE.MathUtils.clamp(q / 13500, 0.28, 1.15);
  const highSpeedCompression = 1 / (1 + Math.max(0, s.mach - 1.1) * 0.26);

  const targetPitchRate = activePitch * spec.pitchRate * authority * highSpeedCompression;
  const targetRollRate = onGround ? 0 : -activeRoll * spec.rollRate * authority;
  // Nosewheel steering + rudder authority on ground
  const yawAuth = onGround ? 0.65 : authority;
  const targetYawRate = activeYaw * spec.yawRate * yawAuth;

  const pitchStab = Math.abs(activePitch) < 0.05 ? -aoaRad * 0.55 : 0;
  const yawStab = onGround ? -betaRad * 0.45 : -betaRad * 1.45;
  // Asymmetric port flameout yaw/roll pull when damaged
  const dmgYawPull = hullPct < 50 && spec.twinEngine ? 0.055 * (1 - hullPct / 50) : 0;

  // Gust & wind-shear aerodynamic buffeting scaled down gently on ground wheels
  const turbMul = onGround ? 0.18 : 1.0;

  s.angularVelocity.x = THREE.MathUtils.damp(
    s.angularVelocity.x,
    targetPitchRate + pitchStab + turb.pitch * turbMul,
    6.5,
    dt
  );
  s.angularVelocity.y = THREE.MathUtils.damp(
    s.angularVelocity.y,
    targetYawRate + yawStab + dmgYawPull + turb.yaw * turbMul,
    5.5,
    dt
  );
  s.angularVelocity.z = THREE.MathUtils.damp(
    s.angularVelocity.z,
    targetRollRate + turb.roll * turbMul,
    8.0,
    dt
  );

  _eulerDelta.set(
    s.angularVelocity.x * dt,
    s.angularVelocity.y * dt,
    s.angularVelocity.z * dt,
    'YXZ'
  );
  _deltaQuat.setFromEuler(_eulerDelta);
  s.quaternion.multiply(_deltaQuat).normalize();

  if (onGround) {
    // Keep tricycle gear planted level with runway (clamp roll to 0, pitch in [-0.03..0.24] rad)
    _attitudeEuler.setFromQuaternion(s.quaternion, 'YXZ');
    _attitudeEuler.z = THREE.MathUtils.damp(_attitudeEuler.z, 0, 12, dt);
    _attitudeEuler.x = THREE.MathUtils.clamp(
      THREE.MathUtils.damp(_attitudeEuler.x, Math.max(0, activePitch * 0.16), 6, dt),
      -0.02,
      0.24
    );
    s.quaternion.setFromEuler(_attitudeEuler);
  } else if (s.stallWarning && s.position.y > 40) {
    const noseDrop = _worldUp.dot(_fwd) * 0.15;
    if (noseDrop > -0.2) {
      _eulerDelta.set(-0.22 * dt, 0, 0);
      _deltaQuat.setFromEuler(_eulerDelta);
      s.quaternion.multiply(_deltaQuat).normalize();
    }
  }
}
