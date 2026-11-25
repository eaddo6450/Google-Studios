import type { AircraftId } from './types';

export interface AircraftSpec {
  id: AircraftId;
  code: string;
  name: string;
  role: string;
  summary: string;
  massKg: number;
  wingAreaM2: number;
  maxMilThrustN: number;
  maxAbThrustN: number;
  cd0: number;
  inducedK: number;
  maxMach: number;
  pitchRate: number;
  rollRate: number;
  yawRate: number;
  twinEngine: boolean;
  hasCanards: boolean;
  hasSwingWings: boolean;
  gunAmmo: number;
  missilesIr: number;
  missilesRadar: number;
  flares: number;
  fuselageColor: number;
  trimColor: number;
  canopyTint: number;
  camoLabel: string;
}

export const AIRCRAFT_CATALOG: AircraftSpec[] = [
  {
    id: 'f22',
    code: 'F-22A',
    name: 'Raptor',
    role: 'Stealth Air Dominance',
    summary: 'Thrust-vectoring twin-engine stealth fighter with diamond chines, canted twin tails, and supercruise.',
    massKg: 16200,
    wingAreaM2: 76,
    maxMilThrustN: 152000,
    maxAbThrustN: 256000,
    cd0: 0.016,
    inducedK: 0.056,
    maxMach: 2.25,
    pitchRate: 1.58,
    rollRate: 2.95,
    yawRate: 0.72,
    twinEngine: true,
    hasCanards: false,
    hasSwingWings: false,
    gunAmmo: 480,
    missilesIr: 2,
    missilesRadar: 6,
    flares: 16,
    fuselageColor: 0xdbe3ec,
    trimColor: 0x262d36,
    canopyTint: 0xffd584,
    camoLabel: 'Raptor Mod-Grey',
  },
  {
    id: 'f16',
    code: 'F-16C',
    name: 'Viper',
    role: 'Lightweight Dogfighter',
    summary: 'Single-engine bubble-canopy interceptor with unmatched roll snap rate and sustained WVR agility.',
    massKg: 11200,
    wingAreaM2: 46,
    maxMilThrustN: 92000,
    maxAbThrustN: 146000,
    cd0: 0.017,
    inducedK: 0.054,
    maxMach: 2.02,
    pitchRate: 1.7,
    rollRate: 3.65,
    yawRate: 0.68,
    twinEngine: false,
    hasCanards: false,
    hasSwingWings: false,
    gunAmmo: 510,
    missilesIr: 4,
    missilesRadar: 2,
    flares: 20,
    fuselageColor: 0xc2cbd6,
    trimColor: 0x334155,
    canopyTint: 0xffe49e,
    camoLabel: 'Have Glass V',
  },
  {
    id: 'f14',
    code: 'F-14D',
    name: 'Super Tomcat',
    role: 'Variable-Sweep Interceptor',
    summary: 'Heavy twin-engine fleet defender with automated Mach-coupled swing wings and high top speed.',
    massKg: 21400,
    wingAreaM2: 68,
    maxMilThrustN: 164000,
    maxAbThrustN: 268000,
    cd0: 0.0185,
    inducedK: 0.051,
    maxMach: 2.38,
    pitchRate: 1.38,
    rollRate: 2.48,
    yawRate: 0.65,
    twinEngine: true,
    hasCanards: false,
    hasSwingWings: true,
    gunAmmo: 675,
    missilesIr: 2,
    missilesRadar: 6,
    flares: 18,
    fuselageColor: 0xe2e8f0,
    trimColor: 0x1e293b,
    canopyTint: 0xcfe8ff,
    camoLabel: 'VF-31 Gull Grey',
  },
  {
    id: 'typhoon',
    code: 'EF-2000',
    name: 'Typhoon',
    role: 'Canard-Delta Multirole',
    summary: 'Close-coupled foreplane canards and cropped delta wings deliver fierce high-alpha instantaneous turn.',
    massKg: 13600,
    wingAreaM2: 58,
    maxMilThrustN: 132000,
    maxAbThrustN: 212000,
    cd0: 0.0165,
    inducedK: 0.052,
    maxMach: 2.15,
    pitchRate: 1.66,
    rollRate: 3.35,
    yawRate: 0.7,
    twinEngine: true,
    hasCanards: true,
    hasSwingWings: false,
    gunAmmo: 500,
    missilesIr: 2,
    missilesRadar: 4,
    flares: 24,
    fuselageColor: 0xcbd5e1,
    trimColor: 0x334155,
    canopyTint: 0xdbeafe,
    camoLabel: 'Camo Grey Blue',
  },
];

export function getAircraftSpec(id: AircraftId): AircraftSpec {
  return AIRCRAFT_CATALOG.find((a) => a.id === id) ?? AIRCRAFT_CATALOG[0];
}
