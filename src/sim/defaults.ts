import type {
  AdaptiveDifficultyProfile,
  ControlAction,
  ControlBindings,
  GraphicsSettings,
  MissionSpec,
  MissionType,
} from './types';

export const DEFAULT_GRAPHICS_SETTINGS: GraphicsSettings = {
  renderScale: 1.0,
  bloomEnabled: true,
  motionBlurEnabled: true,
  aaEnabled: true,
  experimentalWebGpu: false,
};

export const DEFAULT_CONTROL_BINDINGS: ControlBindings = {
  pitchDown: 'KeyW',
  pitchUp: 'KeyS',
  rollLeft: 'KeyA',
  rollRight: 'KeyD',
  yawLeft: 'KeyQ',
  yawRight: 'KeyZ',
  throttleUp: 'Equal',
  throttleDown: 'Minus',
  afterburner: 'ShiftLeft',
  airbrake: 'KeyB',
  fireGun: 'Space',
  fireMissile: 'KeyE',
  flare: 'KeyF',
  gear: 'KeyG',
  cycleTarget: 'Tab',
  cycleCamera: 'KeyC',
};

export const CONTROL_ACTION_LABELS: Record<ControlAction, string> = {
  pitchDown: 'Pitch Nose Down',
  pitchUp: 'Pitch Nose Up',
  rollLeft: 'Roll Left',
  rollRight: 'Roll Right',
  yawLeft: 'Rudder Left',
  yawRight: 'Rudder Right',
  throttleUp: 'Throttle Increase',
  throttleDown: 'Throttle Decrease',
  afterburner: 'Afterburner Boost',
  airbrake: 'Airbrake / Wheel Brake',
  fireGun: '20mm Rotary Cannon',
  fireMissile: 'Launch Selected Missile',
  flare: 'Deploy Flares',
  gear: 'Toggle Landing Gear',
  cycleTarget: 'Cycle Radar Target',
  cycleCamera: 'Cycle Camera View',
};

export function formatKeyCode(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  switch (code) {
    case 'ShiftLeft':
    case 'ShiftRight':
      return 'Shift';
    case 'Equal':
      return '+ / =';
    case 'Minus':
      return '-';
    case 'Space':
      return 'Space';
    case 'Tab':
      return 'Tab';
    case 'BracketLeft':
      return '[';
    case 'BracketRight':
      return ']';
    default:
      return code;
  }
}

export const DEFAULT_DIFFICULTY_PROFILE: AdaptiveDifficultyProfile = {
  skillTier: 'VETERAN',
  aiTurnScale: 1.0,
  aiMissileCooldownScale: 1.0,
  aiAggression: 1.0,
  waveSizeDelta: 0,
  coachingNote: 'Hold corner airspeed (360-440 KTS) in turns and deploy flares on RWR launch warnings.',
};

export const PRESET_MISSIONS: Record<MissionType, MissionSpec> = {
  destroy: {
    id: 'preset_destroy',
    title: 'OPERATION IRON FJORD',
    briefing: 'Aggressive fighter sweep detected inbound over the coastal channel. Intercept and neutralize all hostile interceptors.',
    objectiveType: 'destroy',
    timeOfDay: 'day',
    weatherRegime: 'BREEZY',
    enemyCount: 3,
    difficultyMultiplier: 1.0,
    targetName: 'KESTREL SQUADRON',
    sectorLabel: 'NORTH CHANNEL',
    waypoints: [
      { id: 'wp_1', label: 'INTERCEPT CAP', x: 0, y: 1100, z: -2800, radius: 550, completed: false },
    ],
  },
  escort: {
    id: 'preset_escort',
    title: 'GUARDIAN CORRIDOR',
    briefing: 'Protect heavy tanker GUARDIAN-1 along its coastal transit route while screening hostile bandit interceptors.',
    objectiveType: 'escort',
    timeOfDay: 'dawn',
    weatherRegime: 'CLEAR',
    enemyCount: 3,
    difficultyMultiplier: 1.0,
    targetName: 'GUARDIAN-1 KC-130',
    sectorLabel: 'COASTAL CORRIDOR',
    waypoints: [
      { id: 'wp_1', label: 'ESCORT ALPHA', x: -1600, y: 980, z: -1800, radius: 420, completed: false },
      { id: 'wp_2', label: 'ESCORT BRAVO', x: 1200, y: 1050, z: -4200, radius: 450, completed: false },
    ],
  },
  recon: {
    id: 'preset_recon',
    title: 'EYES IN THE SQUALL',
    briefing: 'Fly through all three fjord reconnaissance gates under radar coverage and survive enemy CAP patrols.',
    objectiveType: 'recon',
    timeOfDay: 'dusk',
    weatherRegime: 'SQUALL',
    enemyCount: 3,
    difficultyMultiplier: 1.05,
    targetName: 'FJORD RADAR SITES',
    sectorLabel: 'ALPINE TRENCH',
    waypoints: [
      { id: 'wp_1', label: 'RECON GATE 1', x: -2400, y: 720, z: -1600, radius: 380, completed: false },
      { id: 'wp_2', label: 'RECON GATE 2', x: 1800, y: 840, z: -3800, radius: 380, completed: false },
      { id: 'wp_3', label: 'RECON GATE 3', x: -600, y: 680, z: -5600, radius: 380, completed: false },
    ],
  },
};
