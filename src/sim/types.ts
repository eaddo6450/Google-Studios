export type GamePhase = 'title' | 'playing' | 'paused' | 'gameover' | 'victory';
export type ControlMode = 'mouse' | 'keyboard';
export type CameraMode = 'chase' | 'cockpit' | 'cinematic';
export type WeaponType = 'missile_ir' | 'missile_radar';
export type AircraftId = 'f22' | 'f16' | 'f14' | 'typhoon';
export type WeatherRegime = 'CLEAR' | 'BREEZY' | 'SQUALL' | 'STORM';
export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';
export type MissionType = 'destroy' | 'escort' | 'recon';

export interface MissionWaypoint {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  completed: boolean;
}

export interface MissionSpec {
  id: string;
  title: string;
  briefing: string;
  objectiveType: MissionType;
  timeOfDay: TimeOfDay;
  weatherRegime: WeatherRegime;
  enemyCount: number;
  difficultyMultiplier: number;
  targetName: string;
  sectorLabel: string;
  waypoints: MissionWaypoint[];
  isAiGenerated?: boolean;
}

export interface GraphicsSettings {
  renderScale: number; // 0.5 .. 1.25
  bloomEnabled: boolean;
  motionBlurEnabled: boolean;
  aaEnabled: boolean;
  experimentalWebGpu: boolean;
}

export type ControlAction =
  | 'pitchUp'
  | 'pitchDown'
  | 'rollLeft'
  | 'rollRight'
  | 'yawLeft'
  | 'yawRight'
  | 'throttleUp'
  | 'throttleDown'
  | 'afterburner'
  | 'airbrake'
  | 'fireGun'
  | 'fireMissile'
  | 'flare'
  | 'gear'
  | 'cycleTarget'
  | 'cycleCamera';

export type ControlBindings = Record<ControlAction, string>;

export interface RadioMessage {
  id: string;
  speaker: string;
  channel: 'AWACS' | 'WINGMAN' | 'HOSTILE' | 'COMMAND';
  tone: 'info' | 'warn' | 'alert' | 'hostile';
  text: string;
  timestampSec: number;
}

export interface AdaptiveDifficultyProfile {
  skillTier: 'ROOKIE' | 'VETERAN' | 'ACE';
  aiTurnScale: number;
  aiMissileCooldownScale: number;
  aiAggression: number;
  waveSizeDelta: number;
  coachingNote: string;
}

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
  aiMode?: string;
}

export interface ProjectedWaypoint {
  id: string;
  label: string;
  x: number;
  y: number;
  inFront: boolean;
  distanceMeters: number;
  kind: 'recon' | 'escort' | 'strike';
  completed: boolean;
}

export interface RadarBlip {
  id: string;
  dx: number; // normalized -1..1 in radar space (right)
  dz: number; // normalized -1..1 in radar space (forward is -1 / up)
  isLocked: boolean;
  isMissile: boolean;
  isFriendlyRunway?: boolean;
  isAlly?: boolean;
  isObjective?: boolean;
}

export type SimCommsEventType =
  | 'mission_start'
  | 'splash'
  | 'hull_low'
  | 'missile_inbound'
  | 'enemy_retreat'
  | 'escort_under_fire'
  | 'recon_waypoint'
  | 'weather_shift'
  | 'mission_victory';

export interface SimEventPayload {
  type: SimCommsEventType;
  detail: string;
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
  projectedWaypoints: ProjectedWaypoint[];
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
  glocCount: number;
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
  // Mission, Performance & Time-of-Day
  fps: number;
  renderScaleActual: number;
  webGpuSupported: boolean;
  webGpuFlagActive: boolean;
  timeOfDay: TimeOfDay;
  missionTitle: string;
  missionType: MissionType;
  missionObjectiveText: string;
  missionProgressPct: number;
  escortHullPct: number | null;
  skillTier: AdaptiveDifficultyProfile['skillTier'];
}
