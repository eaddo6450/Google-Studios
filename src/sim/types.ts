export type GamePhase = 'title' | 'playing' | 'paused' | 'gameover' | 'victory';
export type ControlMode = 'mouse' | 'keyboard';
export type CameraMode = 'chase' | 'cockpit' | 'cinematic';
export type WeaponType = 'missile_ir' | 'missile_radar';
export type AircraftId = 'f22' | 'f16' | 'f14' | 'typhoon';
export type WeatherRegime = 'CLEAR' | 'BREEZY' | 'SQUALL' | 'STORM';

export interface ProjectedTarget {
  id: string;
  callsign: string;
  x: number; // screen px
  y: number; // screen px
  inFront: boolean;
  distanceMeters: number;
  closureRateMps: number;
  isLocked: boolean;
  lockProgress: number; // 0..1
  healthRatio: number;
  leadX: number; // gun lead pipper screen px
  leadY: number;
  leadValid: boolean;
  isLockingPlayer: boolean;
  relBearingRad: number; // for radar scope
}

export interface RadarBlip {
  id: string;
  dx: number; // normalized -1..1 in radar space (right)
  dz: number; // normalized -1..1 in radar space (forward is -1 / up)
  isLocked: boolean;
  isMissile: boolean;
  isFriendlyRunway?: boolean;
}

export interface HudTelemetry {
  phase: GamePhase;
  aircraftId: AircraftId;
  aircraftLabel: string;
  airspeedKts: number;
  trueAirspeedMps: number;
  mach: number;
  altitudeFt: number;
  radarAltitudeFt: number;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  aoaDeg: number;
  gForce: number;
  throttlePct: number; // 0..100 (AB > 85)
  afterburner: boolean;
  airbrake: boolean;
  stallWarning: boolean;
  terrainWarning: boolean;
  missileWarning: boolean;
  rwrLockWarning: boolean;
  hullPct: number;
  gunAmmo: number;
  maxGunAmmo: number;
  missilesIr: number;
  missilesRadar: number;
  selectedWeapon: WeaponType;
  flares: number;
  flareCooldown: number;
  score: number;
  kills: number;
  wave: number;
  enemiesRemaining: number;
  lockStatus: 'NONE' | 'TRACK' | 'LOCK';
  lockProgress: number;
  lockedTargetCallsign: string | null;
  lockedTargetRangeKm: number | null;
  fpvX: number; // Flight path vector screen px
  fpvY: number;
  fpvVisible: boolean;
  boreX: number; // Gun boresight screen px
  boreY: number;
  mouseAimX: number; // Mouse aim cursor screen px
  mouseAimY: number;
  targets: ProjectedTarget[];
  radarBlips: RadarBlip[];
  cameraMode: CameraMode;
  controlMode: ControlMode;
  isMuted: boolean;
  gLocActive: boolean;
  gLocIntensity: number; // 0..1 blackout/tunnel vision
  gTolerancePct: number; // 0..100 human G-tolerance reserve
  redoutIntensity: number; // 0..1 redout
  hitMarkerTimer: number;
  killBanner: string | null;
  resupplyNotice: string | null;
  flightTimeSec: number;
  shotsFired: number;
  shotsHit: number;
  // Dynamic weather & landing system
  weatherRegime: WeatherRegime;
  weatherLabel: string;
  windFromDeg: number;
  windSpeedKts: number;
  gustSpeedKts: number;
  windRelativeDeg: number;
  weatherShifting: boolean;
  weatherNextShiftSec: number;
  stormFactor: number; // 0..1
  gearDown: boolean;
  onRunwayGround: boolean;
  runwayDistanceKm: number;
  runwayBearingDeg: number;
  runwayApproachActive: boolean;
  localizerOffset: number; // -1..1 (positive = right of centerline)
  glideslopeOffset: number; // -1..1 (positive = above 3 deg glidepath)
  crosswindKts: number; // signed crosswind relative to runway (+ from right)
  headwindKts: number; // positive = headwind, negative = tailwind
  verticalSpeedFpm: number;
}
