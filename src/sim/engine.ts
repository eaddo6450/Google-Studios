import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { getAircraftSpec, type AircraftSpec } from './aircraftCatalog';
import {
  createAlliedTransportModel,
  createPlayerFighterModel,
  type FighterVisualRig,
} from './aircraftModel';
import { spawnEnemyWave, updateEnemyAi, type EnemyAircraft } from './ai';
import { AviationAudio } from './audio';
import { cloudDensityAtAltitude } from './clouds';
import {
  DEFAULT_CONTROL_BINDINGS,
  DEFAULT_DIFFICULTY_PROFILE,
  DEFAULT_GRAPHICS_SETTINGS,
  PRESET_MISSIONS,
} from './defaults';
import { createMaterialLibrary, type SimMaterialLibrary } from './materials';
import {
  createInitialAircraftState,
  createSmoothedControlState,
  smoothControlInputs,
  stepAircraftPhysics,
  type AircraftPhysicsState,
  type ControlInputs,
} from './physics';
import { createPostProcessingPipeline, type PostProcessingPipeline } from './postprocessing';
import {
  createWorldEnvironment,
  getTimeOfDayPreset,
  groundHeightAt,
  RUNWAY_CENTER,
  RUNWAY_LENGTH,
  RUNWAY_WIDTH,
  type WorldEnvironment,
} from './terrain';
import type {
  AdaptiveDifficultyProfile,
  AircraftId,
  CameraMode,
  ControlBindings,
  ControlMode,
  GamePhase,
  GraphicsSettings,
  HudTelemetry,
  MissionSpec,
  ProjectedTarget,
  ProjectedWaypoint,
  RadarBlip,
  SimEventPayload,
  TimeOfDay,
  WeaponType,
} from './types';
import { computeGunLeadPoint, WeaponsSystem } from './weapons';
import { createWeatherSystem, type TurbulenceSample, type WeatherSystem } from './weather';

// Pre-allocated math helpers for zero GC in 60fps loop
const _camTargetPos = new THREE.Vector3();
const _camLookAt = new THREE.Vector3();
const _camUp = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _proj = new THREE.Vector3();
const _leadWorld = new THREE.Vector3();
const _windVec = new THREE.Vector3();
const _sunDir = new THREE.Vector3();
const _turbSample: TurbulenceSample = { pitch: 0, roll: 0, yaw: 0 };
const _euler = new THREE.Euler();
const _lookMat = new THREE.Matrix4();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _origin = new THREE.Vector3(0, 0, 0);
const _clearFogColor = new THREE.Color(0xc4dbed);
const _cloudFogColor = new THREE.Color(0xe6eff6);
const _stratFogColor = new THREE.Color(0x9bc0e3);

export class JetSimulatorEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private sunLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private isSoftwareGl: boolean;

  private mats: SimMaterialLibrary;
  private world: WorldEnvironment;
  private playerRig: FighterVisualRig;
  private weapons: WeaponsSystem;
  private weather: WeatherSystem;
  private postfx: PostProcessingPipeline | null = null;
  public audio: AviationAudio;

  private state: AircraftPhysicsState;
  private smoothedControls: ControlInputs = createSmoothedControlState();
  private enemies: EnemyAircraft[] = [];

  // Escort & Recon mission 3D assets
  private escortRig: ReturnType<typeof createAlliedTransportModel> | null = null;
  private escortPos = new THREE.Vector3(0, 960, -1400);
  private escortVel = new THREE.Vector3(0, 0, -135);
  private escortQuat = new THREE.Quaternion();
  private escortHull = 100;
  private escortWpIndex = 0;

  private reconGateGroup = new THREE.Group();
  private reconGateMeshes: THREE.Mesh[] = [];
  private reconGateGeo: THREE.TorusGeometry;
  private reconGateMat: THREE.MeshBasicMaterial;

  // Settings, Bindings, Mission & Adaptive Difficulty
  private graphicsSettings: GraphicsSettings = { ...DEFAULT_GRAPHICS_SETTINGS };
  private controlBindings: ControlBindings = { ...DEFAULT_CONTROL_BINDINGS };
  private activeMission: MissionSpec = structuredClone(PRESET_MISSIONS.destroy);
  private timeOfDay: TimeOfDay = 'day';
  private difficultyProfile: AdaptiveDifficultyProfile = { ...DEFAULT_DIFFICULTY_PROFILE };
  private webGpuSupported = false;
  private webGpuAdapterVerified = false;
  private inputCaptureSuppressed = false;

  // Game & mission state
  private phase: GamePhase = 'title';
  private selectedAircraftId: AircraftId = 'f22';
  private aircraftSpec: AircraftSpec = getAircraftSpec('f22');
  private controlMode: ControlMode = 'mouse';
  private cameraMode: CameraMode = 'chase';
  private selectedWeapon: WeaponType = 'missile_ir';

  private hull = 100;
  private gunAmmo = 480;
  private maxGunAmmo = 480;
  private missilesIr = 2;
  private missilesRadar = 6;
  private flares = 16;
  private flareCooldown = 0;
  private gunCooldown = 0;
  private missileFireCooldown = 0;

  private score = 0;
  private kills = 0;
  private wave = 1;
  private flightTimeSec = 0;
  private shotsFired = 0;
  private shotsHit = 0;
  private glocCount = 0;
  private prevGlocActive = false;

  private lockedEnemyId: string | null = null;
  private lockProgress = 0;
  private hitMarkerTimer = 0;
  private hitstopTimer = 0;
  private cameraShake = 0;
  private killBanner: string | null = null;
  private killBannerTimer = 0;
  private resupplyNotice: string | null = null;
  private resupplyTimer = 0;
  private resupplyCooldown = 0;
  private contrailAccum = 0;
  private damageSmokeAccum = 0;
  private damageDebrisAccum = 0;
  private endlessMode = false;

  // Event throttling for radio chatter
  private lastMissileWarnEventTime = -10;
  private lastEscortWarnEventTime = -10;
  private hullLowEventSent = false;

  // Dynamic weather & landing sequence state
  private cloudImmersion = 0;
  private gearDown = false;
  private manualGearOverride: boolean | null = null;
  private onRunwayGround = false;
  private runwayTouchdownScored = false;
  private lastWeatherRegime = 'BREEZY';

  // FPS estimation
  private fpsSamples = 0;
  private fpsAccumDt = 0;
  private currentFps = 60;

  // Input state
  private heldKeys = new Set<string>();
  private mouseNormX = 0;
  private mouseNormY = 0;
  private mouseLeftDown = false;

  // Timing & lifecycle
  private clock = new THREE.Clock();
  private elapsed = 0;
  private frameId = 0;
  private disposed = false;
  private onTelemetry: (t: HudTelemetry) => void;
  private onSimEvent?: (ev: SimEventPayload) => void;
  private contextLost = false;

  // Bound listeners
  private handleResizeBound: () => void;
  private handleKeyDownBound: (e: KeyboardEvent) => void;
  private handleKeyUpBound: (e: KeyboardEvent) => void;
  private handleBlurBound: () => void;
  private handleMouseMoveBound: (e: MouseEvent) => void;
  private handleMouseDownBound: (e: MouseEvent) => void;
  private handleMouseUpBound: (e: MouseEvent) => void;
  private handleWheelBound: (e: WheelEvent) => void;
  private handleContextMenuBound: (e: MouseEvent) => void;
  private handleContextLostBound: (e: Event) => void;
  private handleContextRestoredBound: () => void;

  constructor(
    container: HTMLElement,
    onTelemetry: (t: HudTelemetry) => void,
    onSimEvent?: (ev: SimEventPayload) => void
  ) {
    this.container = container;
    this.onTelemetry = onTelemetry;
    this.onSimEvent = onSimEvent;

    this.webGpuSupported = typeof navigator !== 'undefined' && 'gpu' in navigator;

    // 1. Software WebGL Detection
    this.isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    // 2. Renderer Configuration (scalable pixel ratio for 4K or 60fps laptop tuning)
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.applyRendererScale();
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    // 3. Scene, Camera, Fog & RoomEnvironment Reflections
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xc4dbed, 0.000058);

    const aspect = (container.clientWidth || window.innerWidth) / (container.clientHeight || window.innerHeight);
    this.camera = new THREE.PerspectiveCamera(64, aspect, 0.25, 36000);

    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // 4. Three-point Sun / Sky / Rim Lighting Rig
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.3);
    sun.position.set(1800, 1200, -2400);
    sun.castShadow = !this.isSoftwareGl;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 100;
    sun.shadow.camera.far = 6500;
    const d = 1400;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sunLight = sun;

    const hemi = new THREE.HemisphereLight(0x9bd0ff, 0x3b4856, 0.85);
    this.scene.add(hemi);
    this.hemiLight = hemi;

    const rim = new THREE.DirectionalLight(0x93c5fd, 0.55);
    rim.position.set(-1400, 600, 1600);
    this.scene.add(rim);

    // 5. Materials, World, Player Jet, Recon Ring Pool, Weapons, Audio
    this.mats = createMaterialLibrary(this.renderer, this.isSoftwareGl);
    this.world = createWorldEnvironment(this.mats, this.isSoftwareGl);
    this.scene.add(this.world.group);

    this.reconGateGeo = new THREE.TorusGeometry(95, 4.5, 10, 32);
    this.reconGateMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.72,
    });
    this.scene.add(this.reconGateGroup);

    this.playerRig = createPlayerFighterModel(this.mats, this.selectedAircraftId);
    this.scene.add(this.playerRig.root);

    this.weapons = new WeaponsSystem(this.scene, this.mats);
    this.weather = createWeatherSystem();
    this.audio = new AviationAudio();

    this.state = createInitialAircraftState();
    this.syncTitleFlybyState();

    // Pre-compile shaders and initialize HDR post-processing on real GPUs
    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
      this.postfx = createPostProcessingPipeline(this.renderer, this.scene, this.camera);
      this.postfx.setOptions({
        bloomEnabled: this.graphicsSettings.bloomEnabled,
        motionBlurEnabled: this.graphicsSettings.motionBlurEnabled,
        aaEnabled: this.graphicsSettings.aaEnabled,
      });
    }

    // Bind events
    this.handleResizeBound = this.onResize.bind(this);
    this.handleKeyDownBound = this.onKeyDown.bind(this);
    this.handleKeyUpBound = this.onKeyUp.bind(this);
    this.handleBlurBound = this.onBlur.bind(this);
    this.handleMouseMoveBound = this.onMouseMove.bind(this);
    this.handleMouseDownBound = this.onMouseDown.bind(this);
    this.handleMouseUpBound = this.onMouseUp.bind(this);
    this.handleWheelBound = this.onWheel.bind(this);
    this.handleContextMenuBound = (e: MouseEvent) => e.preventDefault();
    this.handleContextLostBound = (e: Event) => {
      e.preventDefault();
      this.contextLost = true;
    };
    this.handleContextRestoredBound = () => {
      this.contextLost = false;
    };

    window.addEventListener('resize', this.handleResizeBound);
    window.addEventListener('keydown', this.handleKeyDownBound);
    window.addEventListener('keyup', this.handleKeyUpBound);
    window.addEventListener('blur', this.handleBlurBound);
    this.renderer.domElement.addEventListener('mousemove', this.handleMouseMoveBound);
    this.renderer.domElement.addEventListener('mousedown', this.handleMouseDownBound);
    window.addEventListener('mouseup', this.handleMouseUpBound);
    this.renderer.domElement.addEventListener('wheel', this.handleWheelBound, { passive: true });
    this.renderer.domElement.addEventListener('contextmenu', this.handleContextMenuBound);
    this.renderer.domElement.addEventListener('webglcontextlost', this.handleContextLostBound);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.handleContextRestoredBound);

    this.clock.start();
    this.tick();
  }

  private applyRendererScale(): number {
    const baseDpr = this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    const scale = this.isSoftwareGl
      ? Math.min(1, this.graphicsSettings.renderScale)
      : this.graphicsSettings.renderScale;
    const effective = THREE.MathUtils.clamp(baseDpr * scale, 0.5, 2.25);
    this.renderer.setPixelRatio(effective);
    return effective;
  }

  public setGraphicsSettings(next: GraphicsSettings): void {
    this.graphicsSettings = { ...next };
    this.applyRendererScale();
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.postfx?.resize(w, h);
    this.postfx?.setOptions({
      bloomEnabled: next.bloomEnabled,
      motionBlurEnabled: next.motionBlurEnabled,
      aaEnabled: next.aaEnabled,
    });

    if (next.experimentalWebGpu && this.webGpuSupported && !this.webGpuAdapterVerified) {
      const gpuApi = (navigator as unknown as { gpu?: { requestAdapter?: () => Promise<unknown> } }).gpu;
      gpuApi?.requestAdapter?.().then((adapter) => {
        if (!this.disposed && adapter) {
          this.webGpuAdapterVerified = true;
          this.emitTelemetry();
        }
      }).catch(() => {
        // Silently stay on WebGL2 fallback if WebGPU adapter fails
      });
    }
    this.emitTelemetry();
  }

  public setControlBindings(next: ControlBindings): void {
    this.controlBindings = { ...next };
  }

  public setInputCaptureSuppressed(suppressed: boolean): void {
    this.inputCaptureSuppressed = suppressed;
    if (suppressed) {
      this.heldKeys.clear();
      this.mouseLeftDown = false;
    }
  }

  public setMission(mission: MissionSpec): void {
    this.activeMission = structuredClone(mission);
    this.timeOfDay = mission.timeOfDay;
    this.weather.reset(mission.weatherRegime);
    this.emitTelemetry();
  }

  public setTimeOfDay(tod: TimeOfDay): void {
    this.timeOfDay = tod;
    this.activeMission.timeOfDay = tod;
    this.emitTelemetry();
  }

  public setDifficultyProfile(profile: AdaptiveDifficultyProfile): void {
    this.difficultyProfile = { ...profile };
    this.emitTelemetry();
  }

  private syncTitleFlybyState(): void {
    this.state = createInitialAircraftState();
    this.state.position.set(-450, 920, 1200);
    this.state.quaternion.setFromEuler(new THREE.Euler(0.04, -0.25, -0.18, 'YXZ'));
    this.playerRig.root.position.copy(this.state.position);
    this.playerRig.root.quaternion.copy(this.state.quaternion);
    this.camera.position.set(-432, 926, 1222);
    this.camera.lookAt(this.state.position);
  }

  public setAircraft(id: AircraftId): void {
    if (this.selectedAircraftId === id) return;
    this.selectedAircraftId = id;
    this.aircraftSpec = getAircraftSpec(id);
    this.maxGunAmmo = this.aircraftSpec.gunAmmo;
    this.gunAmmo = this.aircraftSpec.gunAmmo;
    this.missilesIr = this.aircraftSpec.missilesIr;
    this.missilesRadar = this.aircraftSpec.missilesRadar;
    this.flares = this.aircraftSpec.flares;

    const prevPos = this.playerRig.root.position.clone();
    const prevQuat = this.playerRig.root.quaternion.clone();
    this.scene.remove(this.playerRig.root);
    this.playerRig.dispose();

    this.playerRig = createPlayerFighterModel(this.mats, id);
    this.playerRig.root.position.copy(prevPos);
    this.playerRig.root.quaternion.copy(prevQuat);
    this.scene.add(this.playerRig.root);
    this.emitTelemetry();
  }

  private clearMissionProps(): void {
    if (this.escortRig) {
      this.scene.remove(this.escortRig.root);
      this.escortRig.dispose();
      this.escortRig = null;
    }
    for (const m of this.reconGateMeshes) {
      this.reconGateGroup.remove(m);
    }
    this.reconGateMeshes = [];
  }

  public startSortie(continueEndless = false): void {
    this.audio.init();
    this.clearEnemies();
    this.clearMissionProps();
    this.weapons.clearAll();

    this.endlessMode = continueEndless;
    if (!continueEndless) {
      // Reset mission waypoints cleanly
      this.activeMission.waypoints.forEach((wp) => {
        wp.completed = false;
      });
    }

    this.state = createInitialAircraftState();
    this.smoothedControls = createSmoothedControlState();
    this.hull = 100;
    this.maxGunAmmo = this.aircraftSpec.gunAmmo;
    this.gunAmmo = this.aircraftSpec.gunAmmo;
    this.missilesIr = this.aircraftSpec.missilesIr;
    this.missilesRadar = this.aircraftSpec.missilesRadar;
    this.flares = this.aircraftSpec.flares;
    this.flareCooldown = 0;
    this.gunCooldown = 0;
    this.missileFireCooldown = 0;
    this.score = continueEndless ? this.score : 0;
    this.kills = continueEndless ? this.kills : 0;
    this.wave = continueEndless ? this.wave + 1 : 1;
    this.flightTimeSec = continueEndless ? this.flightTimeSec : 0;
    this.shotsFired = continueEndless ? this.shotsFired : 0;
    this.shotsHit = continueEndless ? this.shotsHit : 0;
    this.glocCount = 0;
    this.prevGlocActive = false;
    this.hullLowEventSent = false;

    this.lockedEnemyId = null;
    this.lockProgress = 0;
    this.killBanner = null;
    this.resupplyNotice = `${this.activeMission.title} · ${this.activeMission.objectiveType.toUpperCase()}`;
    this.resupplyTimer = 3.6;
    this.damageSmokeAccum = 0;
    this.damageDebrisAccum = 0;
    this.gearDown = false;
    this.manualGearOverride = null;
    this.onRunwayGround = false;
    this.runwayTouchdownScored = false;

    this.timeOfDay = this.activeMission.timeOfDay;
    this.weather.reset(this.activeMission.weatherRegime);
    this.lastWeatherRegime = this.weather.getSnapshot().regime;
    this.mouseNormX = 0;
    this.mouseNormY = 0;

    // Mission-specific world entities
    if (!continueEndless && this.activeMission.objectiveType === 'escort') {
      this.escortRig = createAlliedTransportModel(this.mats);
      this.escortPos.set(0, 960, 400);
      this.escortVel.set(0, 0, -135);
      this.escortHull = 100;
      this.escortWpIndex = 0;
      this.escortRig.root.position.copy(this.escortPos);
      this.scene.add(this.escortRig.root);
    } else if (!continueEndless && this.activeMission.objectiveType === 'recon') {
      for (const wp of this.activeMission.waypoints) {
        const ring = new THREE.Mesh(this.reconGateGeo, this.reconGateMat);
        ring.position.set(wp.x, wp.y, wp.z);
        this.reconGateGroup.add(ring);
        this.reconGateMeshes.push(ring);
      }
    }

    const baseEnemyCount = Math.max(
      2,
      this.activeMission.enemyCount + this.difficultyProfile.waveSizeDelta
    );
    this.enemies = spawnEnemyWave(
      this.wave,
      this.state.position,
      this.mats,
      this.scene,
      baseEnemyCount,
      this.activeMission.difficultyMultiplier,
      this.activeMission.objectiveType === 'recon'
    );

    this.phase = 'playing';
    this.cameraMode = 'chase';
    this.emitTelemetry();

    this.onSimEvent?.({
      type: 'mission_start',
      detail: `${this.activeMission.title} (${this.activeMission.objectiveType}), sector ${this.activeMission.sectorLabel}, ${this.enemies.length} bandits tracked.`,
    });
  }

  public setPhase(next: GamePhase): void {
    this.phase = next;
    if (next !== 'playing') {
      this.heldKeys.clear();
      this.mouseLeftDown = false;
    }
    this.emitTelemetry();
  }

  public togglePause(): void {
    if (this.phase === 'playing') {
      this.setPhase('paused');
    } else if (this.phase === 'paused') {
      this.audio.init();
      this.clock.getDelta();
      this.setPhase('playing');
    }
  }

  public setControlMode(mode: ControlMode): void {
    this.controlMode = mode;
    this.mouseNormX = 0;
    this.mouseNormY = 0;
    this.emitTelemetry();
  }

  public cycleCamera(): void {
    const order: CameraMode[] = ['chase', 'cockpit', 'cinematic'];
    const idx = order.indexOf(this.cameraMode);
    this.cameraMode = order[(idx + 1) % order.length];
    this.emitTelemetry();
  }

  public setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
    this.emitTelemetry();
  }

  public setWeapon(w: WeaponType): void {
    this.selectedWeapon = w;
    this.lockProgress = 0;
    this.emitTelemetry();
  }

  public toggleGear(): void {
    if (this.phase !== 'playing') return;
    if (this.onRunwayGround) return;
    this.gearDown = !this.gearDown;
    this.manualGearOverride = this.gearDown;
    this.resupplyNotice = this.gearDown ? 'LANDING GEAR DOWN · ILS ARMED' : 'LANDING GEAR UP';
    this.resupplyTimer = 2.0;
    this.emitTelemetry();
  }

  public toggleMute(): boolean {
    this.audio.init();
    const m = this.audio.toggleMute();
    this.emitTelemetry();
    return m;
  }

  public triggerFlare(): void {
    if (this.phase !== 'playing' || this.state.gLocActive || this.flares <= 0 || this.flareCooldown > 0) return;
    this.flares--;
    this.flareCooldown = 0.85;
    this.weapons.deployFlareSalvo(this.state.position, this.state.velocity, this.state.quaternion);
    this.audio.playFlarePop();
  }

  public fireMissile(): void {
    if (this.phase !== 'playing' || this.state.gLocActive || this.missileFireCooldown > 0) return;
    const isIr = this.selectedWeapon === 'missile_ir';
    if (isIr && this.missilesIr <= 0) {
      if (this.missilesRadar > 0) this.selectedWeapon = 'missile_radar';
      else return;
    } else if (!isIr && this.missilesRadar <= 0) {
      if (this.missilesIr > 0) this.selectedWeapon = 'missile_ir';
      else return;
    }

    const activeKind = this.selectedWeapon === 'missile_ir' ? 'ir' : 'radar';
    if (activeKind === 'ir') this.missilesIr--;
    else this.missilesRadar--;

    this.missileFireCooldown = 0.6;
    const railSide = ((this.missilesIr + this.missilesRadar) % 2 === 0 ? 1 : -1) * 3.1;
    _v1.set(railSide, -0.45, 0.5).applyQuaternion(this.state.quaternion).add(this.state.position);

    const targetId = this.lockProgress >= 0.85 ? this.lockedEnemyId : null;
    this.weapons.spawnMissile(
      _v1,
      this.state.quaternion,
      this.state.tasMps,
      true,
      activeKind,
      targetId,
      false
    );
    this.audio.playMissileLaunch();
    this.cameraShake = Math.max(this.cameraShake, 0.25);
  }

  public cycleTarget(): void {
    const alive = this.enemies.filter((e) => e.alive);
    if (alive.length === 0) {
      this.lockedEnemyId = null;
      return;
    }
    const curIdx = alive.findIndex((e) => e.id === this.lockedEnemyId);
    const next = alive[(curIdx + 1) % alive.length];
    this.lockedEnemyId = next.id;
    this.lockProgress = 0;
  }

  private clearEnemies(): void {
    for (const e of this.enemies) {
      this.scene.remove(e.model.root);
      e.model.dispose();
    }
    this.enemies = [];
  }

  private onResize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.applyRendererScale();
    this.postfx?.resize(w, h);
  }

  private onBlur(): void {
    this.heldKeys.clear();
    this.mouseLeftDown = false;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.inputCaptureSuppressed) return;
    const activeTag = (document.activeElement as HTMLElement | null)?.tagName;
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

    const code = e.code;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(code)) {
      e.preventDefault();
    }

    if (code === 'Escape') {
      if (this.phase === 'playing' || this.phase === 'paused') {
        this.togglePause();
      }
      return;
    }

    if (this.phase === 'title' && (code === 'Enter' || code === 'Space')) {
      if (activeTag === 'BUTTON' || activeTag === 'A' || activeTag === 'SELECT') return;
      this.startSortie();
      return;
    }

    if (this.phase !== 'playing') return;

    const firstPress = !this.heldKeys.has(code);
    this.heldKeys.add(code);

    if (!firstPress) return;

    const b = this.controlBindings;
    if (code === b.fireMissile || code === 'KeyR' || code === 'Enter') {
      this.fireMissile();
    } else if (code === b.flare || code === 'KeyX') {
      this.triggerFlare();
    } else if (code === b.cycleTarget || code === 'KeyT') {
      this.cycleTarget();
    } else if (code === b.cycleCamera) {
      this.cycleCamera();
    } else if (code === 'KeyM') {
      this.toggleMute();
    } else if (code === b.gear) {
      this.toggleGear();
    } else if (code === 'Digit1') {
      this.setWeapon('missile_ir');
    } else if (code === 'Digit2') {
      this.setWeapon('missile_radar');
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.heldKeys.delete(e.code);
  }

  private onMouseMove(e: MouseEvent): void {
    if (this.phase !== 'playing' || this.controlMode !== 'mouse') return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    this.mouseNormX = THREE.MathUtils.clamp(nx, -1, 1);
    this.mouseNormY = THREE.MathUtils.clamp(ny, -1, 1);
  }

  private onMouseDown(e: MouseEvent): void {
    if (this.phase !== 'playing' || this.inputCaptureSuppressed) return;
    this.audio.init();
    if (e.button === 0) {
      this.mouseLeftDown = true;
    } else if (e.button === 2) {
      this.fireMissile();
    }
  }

  private onMouseUp(e: MouseEvent): void {
    if (e.button === 0) {
      this.mouseLeftDown = false;
    }
  }

  private onWheel(e: WheelEvent): void {
    if (this.phase !== 'playing') return;
    this.state.throttle = THREE.MathUtils.clamp(this.state.throttle - e.deltaY * 0.0005, 0.05, 1.0);
  }

  private buildControlInputs(): ControlInputs {
    let pitch = 0;
    let roll = 0;
    let yaw = 0;
    const b = this.controlBindings;

    if (this.heldKeys.has(b.pitchDown) || this.heldKeys.has('ArrowUp')) pitch -= 1;
    if (this.heldKeys.has(b.pitchUp) || this.heldKeys.has('ArrowDown')) pitch += 1;
    if (this.heldKeys.has(b.rollLeft) || this.heldKeys.has('ArrowLeft')) roll -= 1;
    if (this.heldKeys.has(b.rollRight) || this.heldKeys.has('ArrowRight')) roll += 1;
    if (this.heldKeys.has(b.yawLeft)) yaw += 1;
    if (this.heldKeys.has(b.yawRight)) yaw -= 1;

    if (this.controlMode === 'mouse') {
      const dead = 0.03;
      const mx = Math.abs(this.mouseNormX) < dead ? 0 : this.mouseNormX;
      const my = Math.abs(this.mouseNormY) < dead ? 0 : this.mouseNormY;

      if (Math.abs(pitch) < 0.01 && Math.abs(roll) < 0.01 && (mx !== 0 || my !== 0)) {
        _v1.set(mx * 0.65, my * 0.65, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
        _up.set(0, 1, 0).applyQuaternion(this.state.quaternion).normalize();
        _right.set(1, 0, 0).applyQuaternion(this.state.quaternion).normalize();

        const localX = _v1.dot(_right);
        const localY = _v1.dot(_up);

        const targetBankRoll = THREE.MathUtils.clamp(localX * 3.4, -1, 1);
        const levelRollAssist = _right.y * 0.45;
        roll = THREE.MathUtils.clamp(targetBankRoll + (Math.abs(localX) < 0.08 ? levelRollAssist : 0), -1, 1);
        pitch = THREE.MathUtils.clamp(localY * 3.8 + Math.abs(localX) * 0.35, -1, 1);
        yaw = THREE.MathUtils.clamp(-localX * 0.45, -0.5, 0.5);
      } else if (Math.abs(roll) < 0.01) {
        _right.set(1, 0, 0).applyQuaternion(this.state.quaternion);
        roll = THREE.MathUtils.clamp(_right.y * 0.35, -0.35, 0.35);
      }
    }

    let throttleDelta = 0;
    if (this.heldKeys.has(b.throttleUp) || this.heldKeys.has('BracketRight')) throttleDelta += 1;
    if (this.heldKeys.has(b.throttleDown) || this.heldKeys.has('BracketLeft')) throttleDelta -= 1;

    const afterburnerBoost =
      this.heldKeys.has(b.afterburner) || this.heldKeys.has('ShiftLeft') || this.heldKeys.has('ShiftRight');
    const airbrake = this.heldKeys.has(b.airbrake);

    return {
      pitch: THREE.MathUtils.clamp(pitch, -1, 1),
      roll: THREE.MathUtils.clamp(roll, -1, 1),
      yaw: THREE.MathUtils.clamp(yaw, -1, 1),
      throttleDelta,
      afterburnerBoost,
      airbrake,
    };
  }

  private tick = (): void => {
    if (this.disposed) return;

    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    this.elapsed += dt;

    // FPS tracker (every ~0.5s window)
    if (rawDt > 0.0005 && rawDt < 0.5) {
      this.fpsSamples++;
      this.fpsAccumDt += rawDt;
      if (this.fpsAccumDt >= 0.45) {
        this.currentFps = Math.min(240, Math.round(this.fpsSamples / this.fpsAccumDt));
        this.fpsSamples = 0;
        this.fpsAccumDt = 0;
      }
    }

    if (!this.contextLost) {
      if (this.phase === 'title' || this.phase === 'playing') {
        this.weather.update(dt, this.elapsed);
      }

      if (this.phase === 'title') {
        this.updateTitleFlyby(dt);
      } else if (this.phase === 'playing') {
        if (this.hitstopTimer > 0) {
          this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
        } else {
          this.updatePlaying(dt);
        }
      } else {
        this.audio.updateContinuous(false, 0, false, 0, 0, 0, false, false, false, false, false);
      }

      const wSnap = this.weather.getSnapshot();
      this.cloudImmersion = this.world.update(
        this.elapsed,
        dt,
        this.camera.position,
        this.state.position,
        wSnap.windVecX,
        wSnap.windVecZ,
        wSnap.windSpeedKts,
        wSnap.stormFactor,
        wSnap.rainIntensity,
        this.timeOfDay
      );

      // Dynamic Time-of-Day Sunlight & Fog Synchronization
      const todPreset = getTimeOfDayPreset(this.timeOfDay);
      this.world.getHorizonFogColor(_clearFogColor);
      this.world.getSunDirection(_sunDir);

      const altDensity = cloudDensityAtAltitude(this.state.position.y);
      if (this.scene.fog instanceof THREE.FogExp2) {
        const highAltClear = THREE.MathUtils.clamp((this.state.position.y - 2800) / 3500, 0, 1);
        const targetDensity =
          (0.000046 + wSnap.stormFactor * 0.000038) * (1 - highAltClear * 0.45) +
          altDensity * 0.000018 +
          this.cloudImmersion * 0.00042;
        this.scene.fog.density = THREE.MathUtils.damp(this.scene.fog.density, targetDensity, 4.5, dt);

        if (this.timeOfDay === 'day') {
          _clearFogColor.lerp(_stratFogColor, highAltClear);
        }
        this.scene.fog.color.lerpColors(_clearFogColor, _cloudFogColor, Math.min(1, this.cloudImmersion * 1.15));
      }

      this.sunLight.color.lerp(todPreset.sunColor, Math.min(1, dt * 1.4));
      this.sunLight.intensity = THREE.MathUtils.damp(
        this.sunLight.intensity,
        todPreset.sunIntensity * THREE.MathUtils.lerp(1.0, 0.55, wSnap.stormFactor),
        2.0,
        dt
      );
      this.hemiLight.intensity = THREE.MathUtils.damp(
        this.hemiLight.intensity,
        todPreset.hemiIntensity,
        2.0,
        dt
      );

      this.sunLight.position.set(
        this.state.position.x + _sunDir.x * 3200,
        this.state.position.y + Math.max(400, _sunDir.y * 3200),
        this.state.position.z + _sunDir.z * 3200
      );
      this.sunLight.target.position.copy(this.state.position);
      this.sunLight.target.updateMatrixWorld();

      if (!this.isSoftwareGl && this.postfx) {
        let centerX = 0.5;
        let centerY = 0.5;
        if (this.phase === 'playing' && this.cameraMode !== 'cinematic') {
          _v1.copy(this.state.velocity);
          if (_v1.lengthSq() > 1) _v1.normalize();
          else _v1.set(0, 0, -1).applyQuaternion(this.state.quaternion).normalize();
          _proj.copy(this.camera.position).addScaledVector(_v1, 500).project(this.camera);
          centerX = (_proj.x + 1) * 0.5;
          centerY = (_proj.y + 1) * 0.5;
        }
        this.postfx.update({
          dt,
          mach: this.state.mach,
          afterburner: this.state.afterburner,
          angPitchRate: this.state.angularVelocity.x,
          angYawRate: this.state.angularVelocity.y,
          angRollRate: this.state.angularVelocity.z,
          cameraShake: this.cameraShake,
          isCockpit: this.cameraMode === 'cockpit',
          isTitle: this.phase === 'title',
          isPaused: this.phase === 'paused' || this.phase === 'gameover' || this.phase === 'victory',
          centerX,
          centerY,
        });
        this.postfx.render();
      } else {
        this.renderer.render(this.scene, this.camera);
      }
    }

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private updateTitleFlyby(dt: number): void {
    const t = this.elapsed * 0.14;
    const px = Math.sin(t) * 1800;
    const pz = Math.cos(t * 0.7) * 2200 - 400;
    const py = 740 + Math.sin(t * 1.4) * 140;

    const nextT = t + 0.02;
    const nx = Math.sin(nextT) * 1800;
    const nz = Math.cos(nextT * 0.7) * 2200 - 400;
    const ny = 740 + Math.sin(nextT * 1.4) * 140;

    this.state.position.set(px, py, pz);
    _v1.set(nx - px, ny - py, nz - pz).normalize();
    _camLookAt.copy(this.state.position).add(_v1);
    this.playerRig.root.position.copy(this.state.position);
    this.playerRig.root.lookAt(_camLookAt);
    this.playerRig.root.rotateZ(Math.cos(t) * 0.36);

    this.playerRig.updateVisuals({
      pitchInput: 0.05,
      rollInput: Math.cos(t) * 0.4,
      yawInput: 0,
      throttle01: 0.88,
      afterburner: true,
      airbrake: false,
      mach: 0.92,
      iasKts: 520,
      altitudeFt: Math.round(py * 3.28084),
      pitchDeg: 4,
      rollDeg: -THREE.MathUtils.radToDeg(Math.cos(t) * 0.36),
      aoaDeg: 3.2,
      gForce: 1.4,
      firingGun: false,
      gunAmmo: this.aircraftSpec.gunAmmo,
      irMissilesLeft: this.aircraftSpec.missilesIr,
      radarMissilesLeft: this.aircraftSpec.missilesRadar,
      flares: this.aircraftSpec.flares,
      stallWarning: false,
      missileWarning: false,
      isCockpitCam: false,
      hullPct: 100,
      gearDown: false,
      windFromDeg: this.weather.getSnapshot().windFromDeg,
      windSpeedKts: this.weather.getSnapshot().windSpeedKts,
      weatherRegime: this.weather.getSnapshot().regime,
      elapsed: this.elapsed,
      dt,
    });

    const camAngle = this.elapsed * 0.22;
    _v2.set(Math.sin(camAngle) * 24, 5.5 + Math.sin(this.elapsed * 0.4) * 2.5, Math.cos(camAngle) * 24);
    _camTargetPos.copy(this.state.position).add(_v2);
    this.camera.position.lerp(_camTargetPos, Math.min(1, dt * 4));
    this.camera.lookAt(this.state.position);
    this.camera.up.set(0, 1, 0);

    this.audio.updateContinuous(false, 0, false, 0, 0, 0, false, false, false, false, false);
  }

  private updateMissionObjectives(dt: number): boolean {
    if (this.endlessMode) return false;

    if (this.activeMission.objectiveType === 'escort' && this.escortRig) {
      const wps = this.activeMission.waypoints;
      const wp = wps[Math.min(this.escortWpIndex, wps.length - 1)];
      if (wp) {
        _v1.set(wp.x - this.escortPos.x, wp.y - this.escortPos.y, wp.z - this.escortPos.z);
        const dist = _v1.length();
        if (dist < 260) {
          wp.completed = true;
          if (this.escortWpIndex < wps.length - 1) {
            this.escortWpIndex++;
            this.resupplyNotice = `ESCORT REACHED ${wp.label}`;
            this.resupplyTimer = 3.0;
          } else {
            // Escort safely extracted
            this.score += 1200;
            this.phase = 'victory';
            this.onSimEvent?.({
              type: 'mission_victory',
              detail: `${this.activeMission.targetName} safely cleared the corridor.`,
            });
            return true;
          }
        } else {
          _v1.divideScalar(Math.max(1, dist));
          this.escortVel.copy(_v1).multiplyScalar(118);
          this.escortPos.addScaledVector(this.escortVel, dt);
          _lookMat.lookAt(_origin, _v1, _worldUp);
          this.escortQuat.setFromRotationMatrix(_lookMat);
          this.escortRig.root.position.copy(this.escortPos);
          this.escortRig.root.quaternion.copy(this.escortQuat);
        }
      }
    } else if (this.activeMission.objectiveType === 'recon') {
      let allDone = true;
      for (let i = 0; i < this.activeMission.waypoints.length; i++) {
        const wp = this.activeMission.waypoints[i];
        const gate = this.reconGateMeshes[i];
        if (gate) {
          gate.visible = !wp.completed;
          if (!wp.completed) {
            gate.rotation.z = this.elapsed * 0.6 + i;
            gate.lookAt(this.camera.position);
          }
        }
        if (!wp.completed) {
          const dist = Math.hypot(
            this.state.position.x - wp.x,
            this.state.position.y - wp.y,
            this.state.position.z - wp.z
          );
          if (dist <= wp.radius) {
            wp.completed = true;
            this.score += 450;
            this.audio.playTouchdown(0.95);
            this.resupplyNotice = `RECON DATA CAPTURED · ${wp.label}`;
            this.resupplyTimer = 3.0;
            this.onSimEvent?.({
              type: 'recon_waypoint',
              detail: `Recon telemetry secured at ${wp.label}.`,
            });
          } else {
            allDone = false;
          }
        }
      }
      if (allDone && this.activeMission.waypoints.length > 0) {
        this.score += 1000;
        this.phase = 'victory';
        this.onSimEvent?.({
          type: 'mission_victory',
          detail: `All reconnaissance gates imaged in ${this.activeMission.sectorLabel}.`,
        });
        return true;
      }
    }

    return false;
  }

  private updatePlaying(dt: number): void {
    this.flightTimeSec += dt;
    this.flareCooldown = Math.max(0, this.flareCooldown - dt);
    this.gunCooldown = Math.max(0, this.gunCooldown - dt);
    this.missileFireCooldown = Math.max(0, this.missileFireCooldown - dt);
    this.hitMarkerTimer = Math.max(0, this.hitMarkerTimer - dt);
    this.cameraShake = Math.max(0, this.cameraShake - dt * 2.2);
    this.resupplyCooldown = Math.max(0, this.resupplyCooldown - dt);

    if (this.killBannerTimer > 0) {
      this.killBannerTimer -= dt;
      if (this.killBannerTimer <= 0) this.killBanner = null;
    }
    if (this.resupplyTimer > 0) {
      this.resupplyTimer -= dt;
      if (this.resupplyTimer <= 0) this.resupplyNotice = null;
    }

    const wSnap = this.weather.getSnapshot();
    if (wSnap.regime !== this.lastWeatherRegime) {
      this.lastWeatherRegime = wSnap.regime;
      if (!this.resupplyNotice) {
        this.resupplyNotice = `WEATHER SHIFT · ${wSnap.label} · WIND ${String(wSnap.windFromDeg).padStart(3, '0')}°/${wSnap.windSpeedKts}KT`;
        this.resupplyTimer = 4.0;
      }
      this.onSimEvent?.({
        type: 'weather_shift',
        detail: `${wSnap.label} with wind ${wSnap.windFromDeg} deg at ${wSnap.windSpeedKts} knots`,
      });
    }

    const preDistToRunway = Math.hypot(
      this.state.position.x - RUNWAY_CENTER.x,
      this.state.position.z - RUNWAY_CENTER.z
    );
    const preGroundY = Math.max(0, groundHeightAt(this.state.position.x, this.state.position.z));
    const preRadarAlt = this.state.position.y - preGroundY;
    if (!this.onRunwayGround) {
      if (preDistToRunway < 2400 && preRadarAlt < 210 && this.state.iasKts < 255) {
        if (this.manualGearOverride === null) this.gearDown = true;
      } else if (preRadarAlt > 340 || preDistToRunway > 3200) {
        if (this.manualGearOverride === null) this.gearDown = false;
        else if (preRadarAlt > 420 && this.manualGearOverride === false) this.manualGearOverride = null;
      }
    }

    this.weather.sampleWindAt(this.state.position, this.elapsed, this.cloudImmersion, _windVec, _turbSample);

    // Control input smoothing / fly-by-wire stick shaping + quaternion 6-DOF physics
    const rawInput = this.buildControlInputs();
    smoothControlInputs(this.smoothedControls, rawInput, this.state.mach, dt);

    stepAircraftPhysics(
      this.state,
      this.smoothedControls,
      dt,
      this.aircraftSpec,
      this.hull,
      _windVec,
      _turbSample,
      this.gearDown,
      this.onRunwayGround
    );

    if (this.state.gLocActive && !this.prevGlocActive) {
      this.glocCount++;
    }
    this.prevGlocActive = this.state.gLocActive;

    if (this.state.crossedMachUp) {
      this.audio.playSonicBoom();
      this.cameraShake = Math.max(this.cameraShake, 0.35);
    }

    if (Math.hypot(this.state.position.x, this.state.position.z) > 13500) {
      this.state.position.x = THREE.MathUtils.clamp(this.state.position.x, -13500, 13500);
      this.state.position.z = THREE.MathUtils.clamp(this.state.position.z, -13500, 13500);
    }
    if (this.state.position.y > 9500) {
      this.state.position.y = 9500;
      this.state.velocity.y = Math.min(0, this.state.velocity.y);
    }

    // Runway Touchdown, Ground Rollout & Terrain Collision Check
    const overRunway =
      Math.abs(this.state.position.x - RUNWAY_CENTER.x) <= RUNWAY_WIDTH * 0.56 &&
      Math.abs(this.state.position.z - RUNWAY_CENTER.z) <= RUNWAY_LENGTH * 0.52;
    const groundY = overRunway
      ? RUNWAY_CENTER.y
      : Math.max(0, groundHeightAt(this.state.position.x, this.state.position.z));
    const radarAlt = this.state.position.y - groundY;

    if (this.onRunwayGround) {
      if (!overRunway) {
        if (this.state.velocity.y > 1.8 && this.state.tasMps > 55) {
          this.onRunwayGround = false;
          this.runwayTouchdownScored = false;
        } else if (radarAlt <= 2.1) {
          this.hull = 0;
          this.weapons.spawnExplosion(this.state.position, 1.8);
          this.audio.playExplosion(1.2);
          this.phase = 'gameover';
          this.audio.updateContinuous(false, 0, false, 0, 0, 0, false, false, false, false, false);
          this.emitTelemetry();
          return;
        }
      } else {
        if (this.state.velocity.y > 2.4 && this.state.tasMps > 64 && this.smoothedControls.pitch > 0.1) {
          this.onRunwayGround = false;
          this.runwayTouchdownScored = false;
          this.manualGearOverride = null;
          this.resupplyNotice = 'ROTATE · POSITIVE RATE CLIMB';
          this.resupplyTimer = 2.4;
        } else {
          this.state.position.y = RUNWAY_CENTER.y + 2.35;
          if (this.state.velocity.y < 0) this.state.velocity.y = 0;
        }
      }
    } else if (overRunway && radarAlt <= 2.45) {
      const sinkMps = -this.state.velocity.y;
      _euler.setFromQuaternion(this.state.quaternion, 'YXZ');
      const rollDegAbs = Math.abs(THREE.MathUtils.radToDeg(_euler.z));
      const pitchDegNow = THREE.MathUtils.radToDeg(_euler.x);

      if (
        this.gearDown &&
        sinkMps <= 11.5 &&
        rollDegAbs <= 22 &&
        pitchDegNow >= -7 &&
        pitchDegNow <= 22 &&
        this.state.iasKts <= 250
      ) {
        this.onRunwayGround = true;
        this.state.position.y = RUNWAY_CENTER.y + 2.35;
        this.state.velocity.y = 0;

        const smoothness = THREE.MathUtils.clamp(1 - sinkMps / 11.0, 0.1, 1.0);
        this.audio.playTouchdown(smoothness);
        this.cameraShake = Math.max(this.cameraShake, 0.25 * (1.2 - smoothness * 0.6));

        if (!this.runwayTouchdownScored && this.resupplyCooldown <= 0) {
          this.runwayTouchdownScored = true;
          const xwindKtsAbs = Math.round(Math.abs(wSnap.windVecX) * 1.943844);
          const landPts = Math.round(320 + smoothness * 260 + xwindKtsAbs * 14);
          this.score += landPts;
          this.hull = 100;
          this.hullLowEventSent = false;
          this.gunAmmo = this.maxGunAmmo;
          this.missilesIr = this.aircraftSpec.missilesIr;
          this.missilesRadar = this.aircraftSpec.missilesRadar;
          this.flares = this.aircraftSpec.flares;
          this.resupplyCooldown = 14;
          const quality = smoothness > 0.72 ? 'GREASED LANDING' : 'RUNWAY TOUCHDOWN';
          this.resupplyNotice = `${quality} · ${xwindKtsAbs}KT X-WND · +${landPts} PTS · REARMED`;
          this.resupplyTimer = 4.4;
        }
      } else if (!this.gearDown || sinkMps > 16.5 || rollDegAbs > 36) {
        const impactDmg = !this.gearDown ? 38 : Math.min(80, sinkMps * 4.4);
        this.hull = Math.max(0, this.hull - impactDmg);
        this.weapons.spawnHitSparks(this.state.position);
        this.cameraShake = Math.max(this.cameraShake, 0.85);
        if (this.hull <= 0) {
          this.weapons.spawnExplosion(this.state.position, 1.8);
          this.audio.playExplosion(1.2);
          this.phase = 'gameover';
          this.audio.updateContinuous(false, 0, false, 0, 0, 0, false, false, false, false, false);
          this.emitTelemetry();
          return;
        }
        this.audio.playExplosion(0.55);
        this.state.position.y = RUNWAY_CENTER.y + 3.4;
        this.state.velocity.y = Math.max(9, sinkMps * 0.45);
        this.resupplyNotice = !this.gearDown ? 'GEAR UP IMPACT · PRESS [G]' : 'HARD BOUNCE · GO AROUND';
        this.resupplyTimer = 2.8;
      } else {
        this.audio.playTouchdown(0.25);
        this.state.position.y = RUNWAY_CENTER.y + 2.8;
        this.state.velocity.y = Math.max(4, sinkMps * 0.35);
      }
    } else if (radarAlt <= 3.5) {
      this.hull = 0;
      this.weapons.spawnExplosion(this.state.position, 1.8);
      this.audio.playExplosion(1.2);
      this.phase = 'gameover';
      this.audio.updateContinuous(false, 0, false, 0, 0, 0, false, false, false, false, false);
      this.emitTelemetry();
      return;
    }

    // Airbase Runway Low-Pass Rearm & Repair
    const distToRunway = Math.hypot(
      this.state.position.x - RUNWAY_CENTER.x,
      this.state.position.z - RUNWAY_CENTER.z
    );
    if (!this.onRunwayGround && distToRunway < 1100 && radarAlt < 130 && this.resupplyCooldown <= 0) {
      const needed =
        this.hull < 100 ||
        this.gunAmmo < this.maxGunAmmo ||
        this.missilesIr < this.aircraftSpec.missilesIr ||
        this.missilesRadar < this.aircraftSpec.missilesRadar ||
        this.flares < this.aircraftSpec.flares;
      if (needed) {
        this.hull = 100;
        this.hullLowEventSent = false;
        this.gunAmmo = this.maxGunAmmo;
        this.missilesIr = this.aircraftSpec.missilesIr;
        this.missilesRadar = this.aircraftSpec.missilesRadar;
        this.flares = this.aircraftSpec.flares;
        this.resupplyCooldown = 18;
        this.resupplyNotice = 'AIRBASE REARM & REPAIR COMPLETE';
        this.resupplyTimer = 3.2;
      }
    }

    // M61 Vulcan Rotary Cannon firing
    const wantGun =
      !this.state.gLocActive &&
      (this.heldKeys.has(this.controlBindings.fireGun) || this.mouseLeftDown);
    let firingGun = false;
    if (wantGun && this.gunAmmo > 0) {
      firingGun = true;
      if (this.gunCooldown <= 0) {
        this.gunCooldown = 0.048;
        this.gunAmmo--;
        this.shotsFired++;
        _fwd.set(0, 0, -1).applyQuaternion(this.state.quaternion).normalize();
        _v1.set(1.22, 0.28, -3.5).applyQuaternion(this.state.quaternion).add(this.state.position);
        this.weapons.spawnBullet(_v1, _fwd, this.state.velocity, true);
        this.audio.playCannonShot();
        this.cameraShake = Math.max(this.cameraShake, 0.07);
      }
    }

    // High-G Wingtip Vapor Contrails
    if (Math.abs(this.state.gForce) > 3.8 && this.state.tasMps > 120) {
      this.contrailAccum += dt;
      if (this.contrailAccum > 0.028) {
        this.contrailAccum = 0;
        for (const side of [-6.3, 6.3]) {
          _v1.set(side, 0.05, 3.0).applyQuaternion(this.state.quaternion).add(this.state.position);
          this.weapons.spawnParticle(_v1, _v2.set(0, 0, 0), 0.7, 0.45, 1.5, 0xf8fafc);
        }
      }
    }

    // Hull < 50% Visual Damage: Smoke trails, engine flame-out embers & localized debris
    if (this.hull < 50) {
      const severity = THREE.MathUtils.clamp((50 - this.hull) / 50, 0.15, 1.0);
      const smokeInterval = THREE.MathUtils.lerp(0.055, 0.022, severity);
      this.damageSmokeAccum += dt;
      if (this.damageSmokeAccum >= smokeInterval) {
        this.damageSmokeAccum = 0;
        const dmgNozX = this.aircraftSpec.twinEngine
          ? this.selectedAircraftId === 'f14'
            ? -0.96
            : this.selectedAircraftId === 'typhoon'
            ? -0.52
            : -0.68
          : 0;
        _v1.set(dmgNozX, 0.06, 6.1).applyQuaternion(this.state.quaternion).add(this.state.position);
        _v2.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
        const smokeCol = Math.random() < 0.35 ? 0x1e293b : 0x475569;
        this.weapons.spawnParticle(_v1, _v2, 1.35 + severity * 0.7, 0.95 + severity * 0.65, 5.8 + severity * 4.5, smokeCol);

        if (Math.random() < 0.32 + severity * 0.4) {
          this.weapons.spawnParticle(
            _v1,
            _v2.multiplyScalar(0.5),
            0.28 + severity * 0.18,
            0.75,
            2.4,
            Math.random() > 0.4 ? 0xf97316 : 0xfacc15
          );
        }

        if (this.hull < 28) {
          _v1.set(1.9, 0.08, 2.8).applyQuaternion(this.state.quaternion).add(this.state.position);
          this.weapons.spawnParticle(_v1, _v2, 1.1, 0.7, 4.2, 0x334155);
        }
      }

      const debrisInterval = THREE.MathUtils.lerp(0.18, 0.065, severity);
      this.damageDebrisAccum += dt;
      if (this.damageDebrisAccum >= debrisInterval) {
        this.damageDebrisAccum = 0;
        const sideX = Math.random() > 0.3 ? -0.95 : 1.45;
        _v1.set(sideX, 0.15, 2.5 + Math.random() * 2.5).applyQuaternion(this.state.quaternion).add(this.state.position);
        _v2
          .copy(this.state.velocity)
          .multiplyScalar(0.55)
          .add(_v3.set((Math.random() - 0.5) * 42, (Math.random() - 0.5) * 34 - 8, (Math.random() - 0.5) * 42));
        const isSpark = Math.random() < 0.6;
        this.weapons.spawnParticle(
          _v1,
          _v2,
          isSpark ? 0.45 : 0.95,
          isSpark ? 0.35 : 0.45,
          isSpark ? 0.1 : 0.3,
          isSpark ? 0xfbbf24 : 0x94a3b8
        );
      }
    }

    // Sync player 3D model & cockpit instrumentation
    _euler.setFromQuaternion(this.state.quaternion, 'YXZ');
    const incomingMissileNow = this.weapons.missiles.some((m) => m.active && !m.fromPlayer && !m.spoofedByFlare);
    if (incomingMissileNow && this.elapsed - this.lastMissileWarnEventTime > 12) {
      this.lastMissileWarnEventTime = this.elapsed;
      this.onSimEvent?.({
        type: 'missile_inbound',
        detail: `Fox-2 inbound at ${Math.round(this.state.position.y * 3.28084)}ft, Mach ${this.state.mach.toFixed(2)}.`,
      });
    }

    this.playerRig.root.position.copy(this.state.position);
    this.playerRig.root.quaternion.copy(this.state.quaternion);
    this.playerRig.updateVisuals({
      pitchInput: this.state.gLocActive ? 0 : this.smoothedControls.pitch,
      rollInput: this.state.gLocActive ? 0 : this.smoothedControls.roll,
      yawInput: this.state.gLocActive ? 0 : this.smoothedControls.yaw,
      throttle01: this.state.throttle,
      afterburner: this.state.afterburner,
      airbrake: this.state.airbrake,
      mach: this.state.mach,
      iasKts: Math.round(this.state.iasKts),
      altitudeFt: Math.round(this.state.position.y * 3.28084),
      pitchDeg: THREE.MathUtils.radToDeg(_euler.x),
      rollDeg: THREE.MathUtils.radToDeg(_euler.z),
      aoaDeg: this.state.aoaDeg,
      gForce: this.state.gForce,
      firingGun,
      gunAmmo: this.gunAmmo,
      irMissilesLeft: this.missilesIr,
      radarMissilesLeft: this.missilesRadar,
      flares: this.flares,
      stallWarning: this.state.stallWarning,
      missileWarning: incomingMissileNow,
      isCockpitCam: this.cameraMode === 'cockpit',
      hullPct: this.hull,
      gearDown: this.gearDown,
      windFromDeg: wSnap.windFromDeg,
      windSpeedKts: wSnap.windSpeedKts,
      weatherRegime: wSnap.regime,
      elapsed: this.elapsed,
      dt,
    });

    // Update Escort / Recon objectives
    const missionWon = this.updateMissionObjectives(dt);
    if (missionWon) {
      this.audio.updateContinuous(false, 0, false, 0, 0, 0, false, false, false, false, false);
      this.emitTelemetry();
      return;
    }

    // Update Enemy AI (4-state FSM: patrol -> engage -> evade -> retreat)
    let anyLockingPlayer = false;
    const activeEscortPos = this.escortRig ? this.escortPos : null;
    const activeEscortVel = this.escortRig ? this.escortVel : null;

    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const act = updateEnemyAi(
        enemy,
        this.state.position,
        this.state.velocity,
        this.wave,
        dt,
        this.elapsed,
        this.difficultyProfile,
        activeEscortPos,
        activeEscortVel
      );
      if (enemy.isLockingPlayer) anyLockingPlayer = true;

      if (act.enteredRetreat) {
        this.onSimEvent?.({
          type: 'enemy_retreat',
          detail: `${enemy.callsign} badly damaged (${Math.round(enemy.health)} HP), breaking off engagement.`,
        });
      }
      if (act.fireGun) {
        _fwd.set(0, 0, -1).applyQuaternion(enemy.quaternion).normalize();
        _v1.set(0, 0, -8).applyQuaternion(enemy.quaternion).add(enemy.position);
        this.weapons.spawnBullet(_v1, _fwd, enemy.velocity, false);
      }
      if (act.fireMissile) {
        _v1.set(0, -0.8, -2).applyQuaternion(enemy.quaternion).add(enemy.position);
        this.weapons.spawnMissile(
          _v1,
          enemy.quaternion,
          enemy.speed,
          false,
          'ir',
          null,
          act.targetEscort
        );
      }
    }

    this.updateTargetLock(dt);

    // Update Pooled Weapons & Collisions
    this.weapons.update(
      dt,
      this.state.position,
      this.enemies,
      {
        onEnemyHit: (enemy, damage, isMissile) => {
          if (!enemy.alive) return;
          enemy.health -= damage;
          enemy.hitFlashTimer = 0.14;
          this.hitMarkerTimer = 0.18;
          if (!isMissile) this.shotsHit++;
          this.audio.playHitImpact();

          if (enemy.health <= 0) {
            enemy.alive = false;
            this.scene.remove(enemy.model.root);
            this.weapons.spawnExplosion(enemy.position, 1.85);
            this.audio.playExplosion(1.1);
            this.kills++;
            this.score += isMissile ? 350 : 500;
            this.killBanner = `${enemy.callsign} SPLASHED`;
            this.killBannerTimer = 2.6;
            this.hitstopTimer = 0.042;
            this.cameraShake = Math.max(this.cameraShake, 0.55);

            this.onSimEvent?.({
              type: 'splash',
              detail: `${enemy.callsign} destroyed by ${isMissile ? 'missile' : '20mm cannon'}`,
            });

            if (this.lockedEnemyId === enemy.id) {
              this.lockedEnemyId = null;
              this.lockProgress = 0;
            }
          }
        },
        onPlayerHit: (damage, isMissile) => {
          const prevHull = this.hull;
          this.hull = Math.max(0, this.hull - damage);
          this.cameraShake = Math.max(this.cameraShake, isMissile ? 0.75 : 0.3);
          this.weapons.spawnHitSparks(this.state.position);
          if (this.hull < 50 || (prevHull >= 50 && this.hull < 50)) {
            if (!this.hullLowEventSent) {
              this.hullLowEventSent = true;
              this.onSimEvent?.({
                type: 'hull_low',
                detail: `Player airframe at ${Math.round(this.hull)}% hull, engine fire/smoke trailing.`,
              });
            }
            for (let i = 0; i < 6; i++) {
              _v1.set((Math.random() - 0.5) * 65, (Math.random() - 0.5) * 55, (Math.random() - 0.5) * 65);
              this.weapons.spawnParticle(
                this.state.position,
                _v1,
                0.85,
                0.55,
                0.25,
                i % 2 === 0 ? 0xf97316 : 0x64748b
              );
            }
          }
          if (this.hull <= 0) {
            this.weapons.spawnExplosion(this.state.position, 1.8);
            this.audio.playExplosion(1.2);
            this.phase = 'gameover';
          }
        },
        onEscortHit: (damage) => {
          if (!this.escortRig) return;
          this.escortHull = Math.max(0, this.escortHull - damage);
          if (this.elapsed - this.lastEscortWarnEventTime > 10) {
            this.lastEscortWarnEventTime = this.elapsed;
            this.onSimEvent?.({
              type: 'escort_under_fire',
              detail: `GUARDIAN-1 taking enemy fire, integrity at ${Math.round(this.escortHull)}%`,
            });
          }
          if (this.escortHull <= 0) {
            this.weapons.spawnExplosion(this.escortPos, 2.4);
            this.audio.playExplosion(1.2);
            this.resupplyNotice = 'GUARDIAN-1 LOST · MISSION FAILED';
            this.phase = 'gameover';
          }
        },
        onExplosion: () => {
          this.audio.playExplosion(0.7);
        },
      },
      activeEscortPos
    );

    // Wave Clear Progression / Destroy Victory
    const remaining = this.enemies.filter((e) => e.alive).length;
    if (remaining === 0 && this.phase === 'playing') {
      if (!this.endlessMode && this.activeMission.objectiveType === 'destroy' && this.wave >= 2) {
        this.score += 1100;
        this.phase = 'victory';
        this.onSimEvent?.({
          type: 'mission_victory',
          detail: `Airspace secured over ${this.activeMission.sectorLabel} (${this.kills} hostiles splashed).`,
        });
        this.audio.updateContinuous(false, 0, false, 0, 0, 0, false, false, false, false, false);
        this.emitTelemetry();
        return;
      }

      this.wave++;
      this.score += 750;
      this.missilesIr = Math.min(this.aircraftSpec.missilesIr, this.missilesIr + 1);
      this.missilesRadar = Math.min(this.aircraftSpec.missilesRadar, this.missilesRadar + 2);
      this.flares = Math.min(this.aircraftSpec.flares, this.flares + 6);
      this.gunAmmo = Math.min(this.maxGunAmmo, this.gunAmmo + 250);
      this.killBanner = `WAVE ${this.wave} SCRAMBLED`;
      this.killBannerTimer = 3.0;
      this.clearEnemies();

      const nextCount = Math.max(
        2,
        this.activeMission.enemyCount + (this.wave - 1) + this.difficultyProfile.waveSizeDelta
      );
      this.enemies = spawnEnemyWave(
        this.wave,
        this.state.position,
        this.mats,
        this.scene,
        nextCount,
        this.activeMission.difficultyMultiplier
      );
    }

    this.updateCamera(dt);

    const incomingMissile = this.weapons.missiles.some((m) => m.active && !m.fromPlayer && !m.spoofedByFlare);
    const sinkRate = -this.state.velocity.y;
    const approachFlareSafe = overRunway && this.gearDown && sinkRate < 11.5;
    const terrainWarning = !this.onRunwayGround && !approachFlareSafe && radarAlt < 185 && (sinkRate > 25 || radarAlt < 75);
    const windAudTurb = wSnap.turbulenceLevel * (0.65 + this.cloudImmersion * 0.55);

    this.audio.updateContinuous(
      this.phase === 'playing',
      this.state.throttle,
      this.state.afterburner,
      this.state.mach,
      this.state.aoaDeg,
      this.lockProgress,
      this.lockProgress >= 0.85,
      anyLockingPlayer,
      incomingMissile,
      terrainWarning,
      this.cameraMode === 'cockpit',
      this.state.gLocIntensity,
      windAudTurb
    );

    this.emitTelemetry(terrainWarning, anyLockingPlayer, incomingMissile, radarAlt);
  }

  private updateTargetLock(dt: number): void {
    const alive = this.enemies.filter((e) => e.alive);
    if (alive.length === 0) {
      this.lockedEnemyId = null;
      this.lockProgress = 0;
      return;
    }

    _fwd.set(0, 0, -1).applyQuaternion(this.state.quaternion).normalize();
    const maxRange = this.selectedWeapon === 'missile_radar' ? 9500 : 4800;
    const maxCone = this.selectedWeapon === 'missile_radar' ? 0.36 : 0.44;

    let locked = alive.find((e) => e.id === this.lockedEnemyId);
    if (!locked) {
      let bestScore = Infinity;
      for (const e of alive) {
        const dist = _v1.subVectors(e.position, this.state.position).length();
        const angle = _fwd.angleTo(_v1.normalize());
        if (angle < 0.7 && dist < maxRange) {
          const s = angle * 2000 + dist * 0.25;
          if (s < bestScore) {
            bestScore = s;
            locked = e;
          }
        }
      }
      if (!locked) locked = alive[0];
      this.lockedEnemyId = locked.id;
      this.lockProgress = 0;
    }

    const dist = _v1.subVectors(locked.position, this.state.position).length();
    const angle = _fwd.angleTo(_v1.normalize());
    if (angle < maxCone && dist < maxRange) {
      const lockRate = this.selectedWeapon === 'missile_ir' ? 0.85 : 0.58;
      this.lockProgress = Math.min(1.0, this.lockProgress + dt * lockRate);
    } else {
      this.lockProgress = Math.max(0, this.lockProgress - dt * 0.9);
    }
  }

  private updateCamera(dt: number): void {
    if (this.cameraMode === 'cockpit') {
      const headDrop = THREE.MathUtils.clamp((this.state.gForce - 1) * 0.0065, -0.02, 0.05);
      const headSway = THREE.MathUtils.clamp(-this.state.angularVelocity.z * 0.022, -0.032, 0.032);
      const buffetAmp =
        (this.state.stallWarning ? 0.008 : 0) +
        (this.state.afterburner ? 0.0018 : 0) +
        (this.hull < 50 ? 0.004 : 0);
      const buffetY = Math.sin(this.elapsed * 47) * buffetAmp;
      const buffetX = Math.cos(this.elapsed * 39) * buffetAmp * 0.7;

      _v1
        .set(headSway + buffetX, 1.14 - headDrop + buffetY, -3.72)
        .applyQuaternion(this.state.quaternion)
        .add(this.state.position);

      const lookTurn = THREE.MathUtils.clamp(-this.state.angularVelocity.z * 0.035, -0.06, 0.06);
      const lookClimb = THREE.MathUtils.clamp((this.state.gForce - 1) * 0.008, -0.02, 0.055);
      _fwd.set(lookTurn, lookClimb, -1).normalize().applyQuaternion(this.state.quaternion);
      _up.set(0, 1, 0).applyQuaternion(this.state.quaternion).normalize();

      this.camera.position.copy(_v1);
      _camLookAt.copy(_v1).addScaledVector(_fwd, 200);
      this.camera.up.copy(_up);
      this.camera.lookAt(_camLookAt);

      const targetFov = 72 + Math.max(0, this.state.mach - 0.6) * 7;
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 6, dt);
      this.camera.updateProjectionMatrix();
    } else if (this.cameraMode === 'cinematic') {
      const ang = this.elapsed * 0.45;
      _v1.set(Math.sin(ang) * 28, 6.5, Math.cos(ang) * 28);
      _camTargetPos.copy(this.state.position).add(_v1);
      this.camera.position.lerp(_camTargetPos, Math.min(1, dt * 5));
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.state.position);
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, 58, 6, dt);
      this.camera.updateProjectionMatrix();
    } else {
      _fwd.set(0, 0, -1).applyQuaternion(this.state.quaternion).normalize();
      _up.set(0, 1, 0).applyQuaternion(this.state.quaternion).normalize();

      const abPullback = this.state.afterburner ? 2.6 : 0;
      _camTargetPos
        .copy(this.state.position)
        .addScaledVector(_fwd, -(20.5 + abPullback))
        .addScaledVector(_up, 4.7);

      const followAlpha = 1 - Math.exp(-15 * dt);
      this.camera.position.lerp(_camTargetPos, followAlpha);

      _camLookAt.copy(this.state.position).addScaledVector(_fwd, 26).addScaledVector(_up, 1.4);
      _camUp.copy(this.camera.up).lerp(_up, 1 - Math.exp(-7 * dt)).normalize();
      this.camera.up.copy(_camUp);
      this.camera.lookAt(_camLookAt);

      const speedFov = 60 + THREE.MathUtils.clamp((this.state.mach - 0.5) * 14, 0, 16) + (this.state.afterburner ? 3.5 : 0);
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, speedFov, 6, dt);
      this.camera.updateProjectionMatrix();
    }

    if (this.cameraShake > 0.005) {
      this.camera.position.x += (Math.random() - 0.5) * this.cameraShake * 0.8;
      this.camera.position.y += (Math.random() - 0.5) * this.cameraShake * 0.8;
    }
  }

  private projectToScreen(worldPos: THREE.Vector3, w: number, h: number): { x: number; y: number; inFront: boolean } {
    _proj.copy(worldPos);
    _v3.subVectors(worldPos, this.camera.position);
    _fwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const inFront = _v3.dot(_fwd) > 0;
    _proj.project(this.camera);
    return {
      x: ((_proj.x + 1) * 0.5) * w,
      y: ((-_proj.y + 1) * 0.5) * h,
      inFront,
    };
  }

  private emitTelemetry(
    terrainWarning = false,
    rwrLockWarning = false,
    missileWarning = false,
    radarAltM = 900
  ): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;

    _euler.setFromQuaternion(this.state.quaternion, 'YXZ');
    const headingDeg = (((-THREE.MathUtils.radToDeg(_euler.y)) % 360) + 360) % 360;
    const pitchDeg = THREE.MathUtils.radToDeg(_euler.x);
    const rollDeg = THREE.MathUtils.radToDeg(_euler.z);

    _fwd.set(0, 0, -1).applyQuaternion(this.state.quaternion).normalize();
    _v1.copy(this.state.position).addScaledVector(_fwd, 600);
    const bore = this.projectToScreen(_v1, w, h);

    _v2.copy(this.state.velocity);
    if (_v2.lengthSq() < 1) _v2.copy(_fwd);
    else _v2.normalize();
    _v1.copy(this.state.position).addScaledVector(_v2, 600);
    const fpv = this.projectToScreen(_v1, w, h);

    const targets: ProjectedTarget[] = [];
    const projectedWaypoints: ProjectedWaypoint[] = [];
    const radarBlips: RadarBlip[] = [];
    const radarRange = 9000;
    const cosH = Math.cos(_euler.y);
    const sinH = Math.sin(_euler.y);

    _right.set(1, 0, 0).applyQuaternion(this.state.quaternion).normalize();

    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dist = e.position.distanceTo(this.state.position);
      const scr = this.projectToScreen(e.position, w, h);

      _v1.subVectors(e.position, this.state.position).divideScalar(Math.max(1, dist));
      _v2.subVectors(this.state.velocity, e.velocity);
      const closureRateMps = _v2.dot(_v1);

      const isLocked = e.id === this.lockedEnemyId;
      const leadValid = computeGunLeadPoint(
        this.state.position,
        this.state.velocity,
        e.position,
        e.velocity,
        1050,
        _leadWorld
      );
      const leadScr = leadValid
        ? this.projectToScreen(_leadWorld, w, h)
        : { x: scr.x, y: scr.y, inFront: false };

      const relX = e.position.x - this.state.position.x;
      const relZ = e.position.z - this.state.position.z;
      const relBearingRad = Math.atan2(relX, -relZ) - (-_euler.y);

      targets.push({
        id: e.id,
        callsign: e.callsign,
        x: scr.x,
        y: scr.y,
        inFront: scr.inFront,
        distanceMeters: dist,
        closureRateMps,
        isLocked,
        lockProgress: isLocked ? this.lockProgress : 0,
        healthRatio: Math.max(0, e.health / e.maxHealth),
        leadX: leadScr.x,
        leadY: leadScr.y,
        leadValid: leadValid && leadScr.inFront && dist < 2100,
        isLockingPlayer: e.isLockingPlayer,
        relBearingRad,
        aiMode: e.mode,
      });

      const rx = relX * cosH - relZ * sinH;
      const rz = relX * sinH + relZ * cosH;
      radarBlips.push({
        id: e.id,
        dx: THREE.MathUtils.clamp(rx / radarRange, -0.95, 0.95),
        dz: THREE.MathUtils.clamp(rz / radarRange, -0.95, 0.95),
        isLocked,
        isMissile: false,
      });
    }

    // Mission Waypoints & Allied Escort HUD + Radar Markers
    if (this.escortRig && this.activeMission.objectiveType === 'escort') {
      const scr = this.projectToScreen(this.escortPos, w, h);
      projectedWaypoints.push({
        id: 'escort_guardian',
        label: `GUARDIAN-1 (${Math.round(this.escortHull)}%)`,
        x: scr.x,
        y: scr.y,
        inFront: scr.inFront,
        distanceMeters: this.escortPos.distanceTo(this.state.position),
        kind: 'escort',
        completed: false,
      });
      const relX = this.escortPos.x - this.state.position.x;
      const relZ = this.escortPos.z - this.state.position.z;
      radarBlips.push({
        id: 'escort_guardian',
        dx: THREE.MathUtils.clamp((relX * cosH - relZ * sinH) / radarRange, -0.95, 0.95),
        dz: THREE.MathUtils.clamp((relX * sinH + relZ * cosH) / radarRange, -0.95, 0.95),
        isLocked: false,
        isMissile: false,
        isAlly: true,
      });
    } else if (this.activeMission.objectiveType === 'recon') {
      for (const wp of this.activeMission.waypoints) {
        if (wp.completed) continue;
        _v1.set(wp.x, wp.y, wp.z);
        const scr = this.projectToScreen(_v1, w, h);
        projectedWaypoints.push({
          id: wp.id,
          label: wp.label,
          x: scr.x,
          y: scr.y,
          inFront: scr.inFront,
          distanceMeters: _v1.distanceTo(this.state.position),
          kind: 'recon',
          completed: wp.completed,
        });
        const relX = wp.x - this.state.position.x;
        const relZ = wp.z - this.state.position.z;
        radarBlips.push({
          id: wp.id,
          dx: THREE.MathUtils.clamp((relX * cosH - relZ * sinH) / radarRange, -0.95, 0.95),
          dz: THREE.MathUtils.clamp((relX * sinH + relZ * cosH) / radarRange, -0.95, 0.95),
          isLocked: false,
          isMissile: false,
          isObjective: true,
        });
      }
    }

    for (const m of this.weapons.missiles) {
      if (!m.active || m.fromPlayer) continue;
      const relX = m.position.x - this.state.position.x;
      const relZ = m.position.z - this.state.position.z;
      radarBlips.push({
        id: m.id,
        dx: THREE.MathUtils.clamp((relX * cosH - relZ * sinH) / radarRange, -0.95, 0.95),
        dz: THREE.MathUtils.clamp((relX * sinH + relZ * cosH) / radarRange, -0.95, 0.95),
        isLocked: false,
        isMissile: true,
      });
    }

    {
      const relX = RUNWAY_CENTER.x - this.state.position.x;
      const relZ = RUNWAY_CENTER.z - this.state.position.z;
      radarBlips.push({
        id: 'airbase',
        dx: THREE.MathUtils.clamp((relX * cosH - relZ * sinH) / radarRange, -0.95, 0.95),
        dz: THREE.MathUtils.clamp((relX * sinH + relZ * cosH) / radarRange, -0.95, 0.95),
        isLocked: false,
        isMissile: false,
        isFriendlyRunway: true,
      });
    }

    const lockedTarget = targets.find((t) => t.isLocked);
    const lockStatus: 'NONE' | 'TRACK' | 'LOCK' =
      this.lockProgress >= 0.85 ? 'LOCK' : this.lockProgress > 0.1 ? 'TRACK' : 'NONE';

    const wSnap = this.weather.getSnapshot();
    const windRelDeg = (((wSnap.windFromDeg - headingDeg) % 360) + 360) % 360;
    const dxRwy = RUNWAY_CENTER.x - this.state.position.x;
    const dzRwy = RUNWAY_CENTER.z - this.state.position.z;
    const rwyDistM = Math.hypot(dxRwy, dzRwy);
    const rwyBearingDeg = (((THREE.MathUtils.radToDeg(Math.atan2(dxRwy, -dzRwy))) % 360) + 360) % 360;

    const landingNorth = this.state.position.z >= RUNWAY_CENTER.z;
    const thrZ = landingNorth
      ? RUNWAY_CENTER.z + RUNWAY_LENGTH * 0.5 - 160
      : RUNWAY_CENTER.z - RUNWAY_LENGTH * 0.5 + 160;
    const distAlong = landingNorth ? Math.max(20, this.state.position.z - thrZ) : Math.max(20, thrZ - this.state.position.z);
    const localizerOffset = THREE.MathUtils.clamp(
      (landingNorth ? this.state.position.x - RUNWAY_CENTER.x : RUNWAY_CENTER.x - this.state.position.x) / 140,
      -1,
      1
    );
    const idealAltM = RUNWAY_CENTER.y + distAlong * Math.tan(THREE.MathUtils.degToRad(3.0));
    const glideslopeOffset = THREE.MathUtils.clamp((this.state.position.y - idealAltM) / 90, -1, 1);

    const windEastKts = wSnap.windVecX * 1.943844;
    const windSouthKts = wSnap.windVecZ * 1.943844;
    const crosswindKts = Math.round(landingNorth ? -windEastKts : windEastKts);
    const headwindKts = Math.round(landingNorth ? windSouthKts : -windSouthKts);

    const runwayApproachActive =
      this.gearDown || this.onRunwayGround || (rwyDistM < 4800 && radarAltM < 800);
    const verticalSpeedFpm = Math.round(this.state.velocity.y * 196.85);

    // Mission objective progress summary
    let missionObjectiveText = `Wave ${this.wave} · Splash ${targets.length} Bandits`;
    let missionProgressPct = 0;
    if (this.endlessMode) {
      missionObjectiveText = `Endless CAP Wave ${this.wave} · ${targets.length} Hostiles`;
      missionProgressPct = 50;
    } else if (this.activeMission.objectiveType === 'escort') {
      const doneCount = this.activeMission.waypoints.filter((wp) => wp.completed).length;
      const totalWps = Math.max(1, this.activeMission.waypoints.length);
      missionObjectiveText = `Escort GUARDIAN-1 (${Math.round(this.escortHull)}%) · WP ${Math.min(doneCount + 1, totalWps)}/${totalWps}`;
      missionProgressPct = Math.round((doneCount / totalWps) * 100);
    } else if (this.activeMission.objectiveType === 'recon') {
      const doneCount = this.activeMission.waypoints.filter((wp) => wp.completed).length;
      const totalWps = Math.max(1, this.activeMission.waypoints.length);
      missionObjectiveText = `Recon Gates ${doneCount}/${totalWps} · Evade/Engage CAP`;
      missionProgressPct = Math.round((doneCount / totalWps) * 100);
    } else {
      missionObjectiveText = `Destroy Hostiles (Wave ${this.wave}/2) · ${targets.length} Remaining`;
      missionProgressPct = Math.min(100, Math.round(((this.wave - 1) * 50) + (targets.length === 0 ? 50 : 15)));
    }

    this.onTelemetry({
      phase: this.phase,
      aircraftId: this.selectedAircraftId,
      aircraftLabel: `${this.aircraftSpec.code} ${this.aircraftSpec.name}`,
      airspeedKts: Math.round(this.state.iasKts),
      trueAirspeedMps: Math.round(this.state.tasMps),
      mach: this.state.mach,
      altitudeFt: Math.round(this.state.position.y * 3.28084),
      radarAltitudeFt: Math.max(0, Math.round(radarAltM * 3.28084)),
      headingDeg: Math.round(headingDeg),
      pitchDeg,
      rollDeg,
      aoaDeg: this.state.aoaDeg,
      gForce: this.state.gForce,
      throttlePct: Math.round(this.state.throttle * 100),
      afterburner: this.state.afterburner,
      airbrake: this.state.airbrake,
      stallWarning: this.state.stallWarning,
      terrainWarning,
      missileWarning,
      rwrLockWarning,
      hullPct: Math.round(this.hull),
      gunAmmo: this.gunAmmo,
      maxGunAmmo: this.maxGunAmmo,
      missilesIr: this.missilesIr,
      missilesRadar: this.missilesRadar,
      selectedWeapon: this.selectedWeapon,
      flares: this.flares,
      flareCooldown: this.flareCooldown,
      score: this.score,
      kills: this.kills,
      wave: this.wave,
      enemiesRemaining: targets.length,
      lockStatus,
      lockProgress: this.lockProgress,
      lockedTargetCallsign: lockedTarget ? lockedTarget.callsign : null,
      lockedTargetRangeKm: lockedTarget ? lockedTarget.distanceMeters / 1000 : null,
      fpvX: fpv.x,
      fpvY: fpv.y,
      fpvVisible: fpv.inFront,
      boreX: bore.x,
      boreY: bore.y,
      mouseAimX: ((this.mouseNormX + 1) * 0.5) * w,
      mouseAimY: ((-this.mouseNormY + 1) * 0.5) * h,
      targets,
      projectedWaypoints,
      radarBlips,
      cameraMode: this.cameraMode,
      controlMode: this.controlMode,
      isMuted: this.audio.isMuted(),
      gLocActive: this.state.gLocActive,
      gLocIntensity: this.state.gLocIntensity,
      gTolerancePct: Math.round(this.state.gTolerance * 100),
      redoutIntensity: this.state.redoutIntensity,
      hitMarkerTimer: this.hitMarkerTimer,
      killBanner: this.killBanner,
      resupplyNotice: this.resupplyNotice,
      flightTimeSec: this.flightTimeSec,
      shotsFired: this.shotsFired,
      shotsHit: this.shotsHit,
      glocCount: this.glocCount,
      weatherRegime: wSnap.regime,
      weatherLabel: wSnap.label,
      windFromDeg: wSnap.windFromDeg,
      windSpeedKts: wSnap.windSpeedKts,
      gustSpeedKts: wSnap.gustSpeedKts,
      windRelativeDeg: Math.round(windRelDeg),
      weatherShifting: wSnap.isShifting,
      weatherNextShiftSec: wSnap.nextShiftSec,
      stormFactor: wSnap.stormFactor,
      gearDown: this.gearDown,
      onRunwayGround: this.onRunwayGround,
      runwayDistanceKm: Number((rwyDistM / 1000).toFixed(1)),
      runwayBearingDeg: Math.round(rwyBearingDeg),
      runwayApproachActive,
      localizerOffset,
      glideslopeOffset,
      crosswindKts,
      headwindKts,
      verticalSpeedFpm,
      fps: this.currentFps,
      renderScaleActual: this.graphicsSettings.renderScale,
      webGpuSupported: this.webGpuSupported,
      webGpuFlagActive: this.graphicsSettings.experimentalWebGpu && this.webGpuAdapterVerified,
      timeOfDay: this.timeOfDay,
      missionTitle: this.activeMission.title,
      missionType: this.activeMission.objectiveType,
      missionObjectiveText,
      missionProgressPct,
      escortHullPct: this.escortRig ? Math.round(this.escortHull) : null,
      skillTier: this.difficultyProfile.skillTier,
    });
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    window.removeEventListener('resize', this.handleResizeBound);
    window.removeEventListener('keydown', this.handleKeyDownBound);
    window.removeEventListener('keyup', this.handleKeyUpBound);
    window.removeEventListener('blur', this.handleBlurBound);
    this.renderer.domElement.removeEventListener('mousemove', this.handleMouseMoveBound);
    this.renderer.domElement.removeEventListener('mousedown', this.handleMouseDownBound);
    window.removeEventListener('mouseup', this.handleMouseUpBound);
    this.renderer.domElement.removeEventListener('wheel', this.handleWheelBound);
    this.renderer.domElement.removeEventListener('contextmenu', this.handleContextMenuBound);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLostBound);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.handleContextRestoredBound);

    this.clearEnemies();
    this.clearMissionProps();
    this.reconGateGeo.dispose();
    this.reconGateMat.dispose();
    this.weapons.dispose();
    this.playerRig.dispose();
    this.world.dispose();
    this.mats.dispose();
    this.audio.dispose();
    this.postfx?.dispose();

    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
