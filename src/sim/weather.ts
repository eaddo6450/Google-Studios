import * as THREE from 'three';
import type { WeatherRegime } from './types';

export interface TurbulenceSample {
  pitch: number;
  roll: number;
  yaw: number;
}

export interface WeatherSnapshot {
  regime: WeatherRegime;
  label: string;
  windFromDeg: number;
  windSpeedKts: number;
  gustSpeedKts: number;
  windSpeedMps: number;
  windVecX: number; // world-space m/s toward downwind (+X = East)
  windVecZ: number; // world-space m/s toward downwind (+Z = South)
  stormFactor: number; // 0..1 atmospheric overcast/darkening
  rainIntensity: number; // 0..1 visible rain & windshield mist
  turbulenceLevel: number; // 0..1
  isShifting: boolean;
  nextShiftSec: number;
}

export interface WeatherSystem {
  reset: (initialRegime?: WeatherRegime) => void;
  update: (dt: number, elapsed: number) => void;
  sampleWindAt: (
    pos: THREE.Vector3,
    elapsed: number,
    cloudImmersion: number,
    outWind: THREE.Vector3,
    outTurb: TurbulenceSample
  ) => void;
  getSnapshot: () => WeatherSnapshot;
}

const KTS_TO_MPS = 0.514444;
const MPS_TO_KTS = 1.943844;

interface RegimePreset {
  regime: WeatherRegime;
  label: string;
  minKts: number;
  maxKts: number;
  gustRatio: number;
  stormFactor: number;
  rainIntensity: number;
  turbulence: number;
  durationMin: number;
  durationMax: number;
}

const PRESETS: Record<WeatherRegime, RegimePreset> = {
  CLEAR: {
    regime: 'CLEAR',
    label: 'CLEAR SKIES',
    minKts: 7,
    maxKts: 14,
    gustRatio: 0.22,
    stormFactor: 0.0,
    rainIntensity: 0.0,
    turbulence: 0.14,
    durationMin: 36,
    durationMax: 48,
  },
  BREEZY: {
    regime: 'BREEZY',
    label: 'COASTAL X-WIND',
    minKts: 18,
    maxKts: 27,
    gustRatio: 0.34,
    stormFactor: 0.26,
    rainIntensity: 0.06,
    turbulence: 0.36,
    durationMin: 40,
    durationMax: 54,
  },
  SQUALL: {
    regime: 'SQUALL',
    label: 'SQUALL LINE',
    minKts: 27,
    maxKts: 37,
    gustRatio: 0.42,
    stormFactor: 0.68,
    rainIntensity: 0.62,
    turbulence: 0.68,
    durationMin: 38,
    durationMax: 52,
  },
  STORM: {
    regime: 'STORM',
    label: 'STORM FRONT',
    minKts: 35,
    maxKts: 47,
    gustRatio: 0.48,
    stormFactor: 1.0,
    rainIntensity: 1.0,
    turbulence: 0.96,
    durationMin: 34,
    durationMax: 48,
  },
};

const REGIME_SEQUENCE: WeatherRegime[] = ['BREEZY', 'SQUALL', 'STORM', 'CLEAR', 'BREEZY', 'STORM'];

function wrapDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function shortestAngleDiffDeg(from: number, to: number): number {
  let diff = ((to - from + 540) % 360) - 180;
  if (diff < -180) diff += 360;
  return diff;
}

export function createWeatherSystem(): WeatherSystem {
  let seqIdx = 0;
  let currentRegime: WeatherRegime = 'BREEZY';
  let currentLabel = PRESETS.BREEZY.label;

  // Current damped atmospheric state
  let windFromDeg = 278; // Strong West crosswind across Runway 09R/27L (N-S aligned)
  let windSpeedKts = 21;
  let gustRatio = 0.34;
  let stormFactor = 0.25;
  let rainIntensity = 0.05;
  let turbulenceLevel = 0.36;

  // Target weather front state
  let targetWindFromDeg = 278;
  let targetWindSpeedKts = 21;
  let targetGustRatio = 0.34;
  let targetStormFactor = 0.25;
  let targetRainIntensity = 0.05;
  let targetTurbulence = 0.36;

  let shiftCountdown = 42;
  let shiftAnnounceTimer = 0;

  // Live snapshot cache (avoid object allocation in telemetry loop)
  const snapshot: WeatherSnapshot = {
    regime: currentRegime,
    label: currentLabel,
    windFromDeg,
    windSpeedKts,
    gustSpeedKts: Math.round(windSpeedKts * (1 + gustRatio)),
    windSpeedMps: windSpeedKts * KTS_TO_MPS,
    windVecX: 0,
    windVecZ: 0,
    stormFactor,
    rainIntensity,
    turbulenceLevel,
    isShifting: false,
    nextShiftSec: Math.ceil(shiftCountdown),
  };

  const syncWindComponents = (gustBoostKts = 0) => {
    // Wind FROM bearing theta moves TOWARD (theta + 180 deg)
    // In Three.js: North (0 deg) = -Z, East (90 deg) = +X -> toward dir is (sin(rad), -cos(rad))
    // Therefore downwind motion vector = (-sin(rad), cos(rad))
    const rad = THREE.MathUtils.degToRad(windFromDeg);
    const totalKts = windSpeedKts + gustBoostKts;
    const totalMps = totalKts * KTS_TO_MPS;
    snapshot.regime = currentRegime;
    snapshot.label = currentLabel;
    snapshot.windFromDeg = Math.round(wrapDeg(windFromDeg));
    snapshot.windSpeedKts = Math.round(windSpeedKts);
    snapshot.gustSpeedKts = Math.round(windSpeedKts * (1 + gustRatio));
    snapshot.windSpeedMps = totalMps;
    snapshot.windVecX = -Math.sin(rad) * totalMps;
    snapshot.windVecZ = Math.cos(rad) * totalMps;
    snapshot.stormFactor = stormFactor;
    snapshot.rainIntensity = rainIntensity;
    snapshot.turbulenceLevel = turbulenceLevel;
    snapshot.isShifting = shiftAnnounceTimer > 0;
    snapshot.nextShiftSec = Math.max(0, Math.ceil(shiftCountdown));
  };

  const scheduleNextWeatherFront = () => {
    seqIdx = (seqIdx + 1) % REGIME_SEQUENCE.length;
    const nextRegime = REGIME_SEQUENCE[seqIdx];
    const preset = PRESETS[nextRegime];

    currentRegime = preset.regime;
    currentLabel = preset.label;

    // Periodic wind shift: significant heading shift (40..135 deg) biased toward crosswind runway angles
    const shiftSign = Math.random() < 0.5 ? -1 : 1;
    const shiftDelta = shiftSign * (45 + Math.random() * 85);
    targetWindFromDeg = wrapDeg(targetWindFromDeg + shiftDelta);
    targetWindSpeedKts = preset.minKts + Math.random() * (preset.maxKts - preset.minKts);
    targetGustRatio = preset.gustRatio;
    targetStormFactor = preset.stormFactor;
    targetRainIntensity = preset.rainIntensity;
    targetTurbulence = preset.turbulence;

    shiftCountdown = preset.durationMin + Math.random() * (preset.durationMax - preset.durationMin);
    shiftAnnounceTimer = 7.5;
  };

  const reset = (initialRegime?: WeatherRegime) => {
    const startRegime: WeatherRegime = initialRegime && PRESETS[initialRegime] ? initialRegime : 'BREEZY';
    const preset = PRESETS[startRegime];
    seqIdx = 0;
    currentRegime = startRegime;
    currentLabel = preset.label;
    windFromDeg = startRegime === 'CLEAR' ? 245 : startRegime === 'STORM' ? 295 : 278;
    windSpeedKts = Math.round((preset.minKts + preset.maxKts) * 0.5);
    gustRatio = preset.gustRatio;
    stormFactor = preset.stormFactor;
    rainIntensity = preset.rainIntensity;
    turbulenceLevel = preset.turbulence;

    targetWindFromDeg = windFromDeg;
    targetWindSpeedKts = windSpeedKts;
    targetGustRatio = gustRatio;
    targetStormFactor = stormFactor;
    targetRainIntensity = rainIntensity;
    targetTurbulence = turbulenceLevel;

    shiftCountdown = 38;
    shiftAnnounceTimer = 0;
    syncWindComponents(0);
  };

  reset();

  const update = (dt: number, elapsed: number) => {
    const safeDt = Math.min(dt, 0.05);
    shiftCountdown -= safeDt;
    if (shiftCountdown <= 0) {
      scheduleNextWeatherFront();
    }
    if (shiftAnnounceTimer > 0) {
      shiftAnnounceTimer = Math.max(0, shiftAnnounceTimer - safeDt);
    }

    // Smooth front transition (~10s exponential damping)
    const angDiff = shortestAngleDiffDeg(windFromDeg, targetWindFromDeg);
    windFromDeg = wrapDeg(windFromDeg + angDiff * (1 - Math.exp(-0.28 * safeDt)));
    windSpeedKts = THREE.MathUtils.damp(windSpeedKts, targetWindSpeedKts, 0.32, safeDt);
    gustRatio = THREE.MathUtils.damp(gustRatio, targetGustRatio, 0.35, safeDt);
    stormFactor = THREE.MathUtils.damp(stormFactor, targetStormFactor, 0.25, safeDt);
    rainIntensity = THREE.MathUtils.damp(rainIntensity, targetRainIntensity, 0.3, safeDt);
    turbulenceLevel = THREE.MathUtils.damp(turbulenceLevel, targetTurbulence, 0.32, safeDt);

    // Subtle macro gust breathing reflected in live surface wind indicator
    const macroGust =
      (Math.sin(elapsed * 0.42) * 0.55 + Math.sin(elapsed * 1.13) * 0.45) *
      windSpeedKts *
      gustRatio *
      0.55;
    syncWindComponents(Math.max(-windSpeedKts * 0.25, macroGust));
  };

  const sampleWindAt = (
    pos: THREE.Vector3,
    elapsed: number,
    cloudImmersion: number,
    outWind: THREE.Vector3,
    outTurb: TurbulenceSample
  ) => {
    const alt = Math.max(0, pos.y);

    // Boundary layer wind shear: weaker at surface (0.72x) -> ramps cleanly up to 500m -> jet stream boost > 2500m
    const surfaceShear = THREE.MathUtils.lerp(0.72, 1.0, THREE.MathUtils.clamp(alt / 450, 0, 1));
    const jetStreamBoost = 1.0 + THREE.MathUtils.clamp((alt - 2200) / 3800, 0, 0.42);
    const altFactor = surfaceShear * jetStreamBoost;

    // Direction veers slightly with altitude (Ekman spiral ~14 deg clockwise aloft)
    const dirVeerRad = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(alt / 1600, 0, 1) * 14);
    const baseRad = THREE.MathUtils.degToRad(windFromDeg) + dirVeerRad;

    // Spatial + temporal gust eddies (adds authentic wind shear & uneven runway approach gusts)
    const phase = pos.x * 0.0045 + pos.z * 0.0038;
    const gustWave =
      Math.sin(elapsed * 0.85 + phase) * 0.5 +
      Math.sin(elapsed * 2.15 - pos.z * 0.006) * 0.32 +
      Math.cos(elapsed * 3.7 + pos.x * 0.007) * 0.18;

    const gustAmpMps = snapshot.windSpeedMps * gustRatio * (0.65 + cloudImmersion * 0.65);
    const localSpeedMps = Math.max(0.5, snapshot.windSpeedMps * altFactor + gustWave * gustAmpMps);

    // Cross-eddy perpendicular shift + convective vertical updrafts/downdrafts
    const eddyAngle = gustWave * (0.14 + turbulenceLevel * 0.16);
    const windTheta = baseRad + eddyAngle;

    outWind.x = -Math.sin(windTheta) * localSpeedMps;
    outWind.z = Math.cos(windTheta) * localSpeedMps;

    // Vertical wind shear / thermal downdrafts (amplified in storm clouds & near coastal ridge/runway approach)
    const shearProximity = alt < 240 ? 1.15 : 0.75;
    const vertWave =
      Math.sin(elapsed * 1.6 + pos.x * 0.005) * 0.6 +
      Math.cos(elapsed * 3.2 - pos.z * 0.004) * 0.4;
    outWind.y = vertWave * (1.2 + turbulenceLevel * 3.6 + cloudImmersion * 3.2) * shearProximity;

    // Aerodynamic turbulence angular buffeting (rad/s^2 scaled disturbance)
    const turbScale =
      (turbulenceLevel * 0.95 + cloudImmersion * 0.75) * (alt < 220 ? 1.25 : 0.95);
    outTurb.roll =
      (Math.sin(elapsed * 4.3 + phase) * 0.65 + Math.cos(elapsed * 7.9) * 0.35) *
      0.16 *
      turbScale;
    outTurb.pitch =
      (Math.cos(elapsed * 3.6 - phase) * 0.6 + Math.sin(elapsed * 6.4) * 0.4) *
      0.085 *
      turbScale;
    outTurb.yaw =
      (Math.sin(elapsed * 2.9 + pos.z * 0.004) * 0.7 + Math.cos(elapsed * 5.7) * 0.3) *
      0.065 *
      turbScale;
  };

  return {
    reset,
    update,
    sampleWindAt,
    getSnapshot: () => snapshot,
  };
}
