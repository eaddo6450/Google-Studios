import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { getAircraftSpec, type AircraftSpec } from './aircraftCatalog';
import { createPlayerFighterModel, type FighterVisualRig } from './aircraftModel';
import { spawnEnemyWave, updateEnemyAi, type EnemyAircraft } from './ai';
import { AviationAudio } from './audio';
import { cloudDensityAtAltitude } from './clouds';
import { createMaterialLibrary, type SimMaterialLibrary } from './materials';
import {
  createInitialAircraftState,
  stepAircraftPhysics,
  type AircraftPhysicsState,
  type ControlInputs,
} from './physics';
import { createPostProcessingPipeline, type PostProcessingPipeline } from './postprocessing';
import {
  createWorldEnvironment,
  groundHeightAt,
  RUNWAY_CENTER,
  RUNWAY_LENGTH,
  RUNWAY_WIDTH,
  type WorldEnvironment,
} from './terrain';
import type {
  AircraftId,
  CameraMode,
  ControlMode,
  GamePhase,
  HudTelemetry,
  ProjectedTarget,
  RadarBlip,
  WeaponType,
} from './types';
import { computeGunLeadPoint, WeaponsSystem } from './weapons';
import { createWeatherSystem, type TurbulenceSample, type WeatherSystem } from './weather';

// Pre-allocated math helpers for zero GC in loop
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
const _turbSample: TurbulenceSample = { pitch: 0, roll: 0, yaw: 0 };
const _euler = new THREE.Euler();
const _clearFogColor = new THREE.Color(0xc4dbed);
const _stormFogColor = new THREE.Color(0x6d7f93);
const _cloudFogColor = new THREE.Color(0xe6eff6);
const _stratFogColor = new THREE.Color(0x9bc0e3);

export class JetSimulatorEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private sunLight: THREE.DirectionalLight;
  private isSoftwareGl: boolean;

  private mats: SimMaterialLibrary;
  private world: WorldEnvironment;
  private playerRig: FighterVisualRig;
  private weapons: WeaponsSystem;
  private weather: WeatherSystem;
  private postfx: PostProcessingPipeline | null = null;
  public audio: AviationAudio;

  private state: AircraftPhysicsState;
  private enemies: EnemyAircraft[] = [];

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

  // Dynamic weather & landing sequence state
  private cloudImmersion = 0;
  private gearDown = false;
  private manualGearOverride: boolean | null = null;
  private onRunwayGround = false;
  private runwayTouchdownScored = false;
  private lastWeatherRegime = 'BREEZY';

  // Input state
  private heldKeys = new Set<string>();
  private mouseNormX = 0; // -1..1
  private mouseNormY = 0; // -1..1
  private mouseLeftDown = false;

  // Timing & lifecycle
  private clock = new THREE.Clock();
  private elapsed = 0;
  private frameId = 0;
  private disposed = false;
  private onTelemetry: (t: HudTelemetry) => void;
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

  constructor(container: HTMLElement, onTelemetry: (t: HudTelemetry) => void) {
    this.container = container;
    this.onTelemetry = onTelemetry;

    // 1. Software WebGL Detection (renderer string only)
    this.isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    // 2. Renderer Configuration (4K-capable high-DPI up to 2x on GPU)
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
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

    const rim = new THREE.DirectionalLight(0x93c5fd, 0.55);
    rim.position.set(-1400, 600, 1600);
    this.scene.add(rim);

    // 5. Materials, World, Player Jet, Weapons, Audio
    this.mats = createMaterialLibrary(this.renderer, this.isSoftwareGl);
    this.world = createWorldEnvironment(this.mats, this.isSoftwareGl);
    this.scene.add(this.world.group);

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

  public startSortie(): void {
    this.audio.init();
    this.clearEnemies();
    this.weapons.clearAll();

    this.state = createInitialAircraftState();
    this.hull = 100;
    this.maxGunAmmo = this.aircraftSpec.gunAmmo;
    this.gunAmmo = this.aircraftSpec.gunAmmo;
    this.missilesIr = this.aircraftSpec.missilesIr;
    this.missilesRadar = this.aircraftSpec.missilesRadar;
    this.flares = this.aircraftSpec.flares;
    this.flareCooldown = 0;
    this.gunCooldown = 0;
    this.missileFireCooldown = 0;
    this.score = 0;
    this.kills = 0;
    this.wave = 1;
    this.flightTimeSec = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.lockedEnemyId = null;
    this.lockProgress = 0;
    this.killBanner = null;
    this.resupplyNotice = null;
    this.damageSmokeAccum = 0;
    this.damageDebrisAccum = 0;
    this.gearDown = false;
    this.manualGearOverride = null;
    this.onRunwayGround = false;
    this.runwayTouchdownScored = false;
    this.weather.reset();
    this.lastWeatherRegime = this.weather.getSnapshot().regime;
    this.mouseNormX = 0;
    this.mouseNormY = 0;

    this.enemies = spawnEnemyWave(1, this.state.position, this.mats, this.scene);
    this.phase = 'playing';
    this.cameraMode = 'chase';
    this.emitTelemetry();
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
    if (this.onRunwayGround) return; // keep gear locked down while rolling on runway
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
      targetId
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
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.postfx?.resize(w, h);
  }

  private onBlur(): void {
    this.heldKeys.clear();
    this.mouseLeftDown = false;
  }

  private onKeyDown(e: KeyboardEvent): void {
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
      this.startSortie();
      return;
    }

    if (this.phase !== 'playing') return;

    const firstPress = !this.heldKeys.has(code);
    this.heldKeys.add(code);

    if (!firstPress) return;

    if (code === 'KeyE' || code === 'KeyR' || code === 'Enter') {
      this.fireMissile();
    } else if (code === 'KeyF' || code === 'KeyX') {
      this.triggerFlare();
    } else if (code === 'Tab' || code === 'KeyT') {
      this.cycleTarget();
    } else if (code === 'KeyC') {
      this.cycleCamera();
    } else if (code === 'KeyM') {
      this.toggleMute();
    } else if (code === 'KeyG') {
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
    if (this.phase !== 'playing') return;
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

    // Keyboard flight stick inputs
    if (this.heldKeys.has('KeyW') || this.heldKeys.has('ArrowUp')) pitch -= 1;
    if (this.heldKeys.has('KeyS') || this.heldKeys.has('ArrowDown')) pitch += 1;
    if (this.heldKeys.has('KeyA') || this.heldKeys.has('ArrowLeft')) roll -= 1;
    if (this.heldKeys.has('KeyD') || this.heldKeys.has('ArrowRight')) roll += 1;
    if (this.heldKeys.has('KeyQ')) yaw += 1;
    if (this.heldKeys.has('KeyE') && this.controlMode === 'keyboard') {
      // E fires missile; use Z/Q or Q/V for rudder if needed
    }
    if (this.heldKeys.has('KeyZ')) yaw -= 1;

    // Mouse-Aim Flight Director (when keyboard pitch/roll isn't actively held)
    if (this.controlMode === 'mouse') {
      const dead = 0.03;
      const mx = Math.abs(this.mouseNormX) < dead ? 0 : this.mouseNormX;
      const my = Math.abs(this.mouseNormY) < dead ? 0 : this.mouseNormY;

      if (Math.abs(pitch) < 0.01 && Math.abs(roll) < 0.01 && (mx !== 0 || my !== 0)) {
        // Project desired world aim vector from camera through mouse reticle
        _v1.set(mx * 0.65, my * 0.65, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
        _fwd.set(0, 0, -1).applyQuaternion(this.state.quaternion).normalize();
        _up.set(0, 1, 0).applyQuaternion(this.state.quaternion).normalize();
        _right.set(1, 0, 0).applyQuaternion(this.state.quaternion).normalize();

        const localX = _v1.dot(_right);
        const localY = _v1.dot(_up);

        // Bank into the turn, pull pitch toward target elevation
        const targetBankRoll = THREE.MathUtils.clamp(localX * 3.4, -1, 1);
        const levelRollAssist = _right.y * 0.45;
        roll = THREE.MathUtils.clamp(targetBankRoll + (Math.abs(localX) < 0.08 ? levelRollAssist : 0), -1, 1);
        pitch = THREE.MathUtils.clamp(localY * 3.8 + Math.abs(localX) * 0.35, -1, 1);
        yaw = THREE.MathUtils.clamp(-localX * 0.45, -0.5, 0.5);
      } else if (Math.abs(roll) < 0.01) {
        // Gentle wings-level tendency when centered
        _right.set(1, 0, 0).applyQuaternion(this.state.quaternion);
        roll = THREE.MathUtils.clamp(_right.y * 0.35, -0.35, 0.35);
      }
    }

    let throttleDelta = 0;
    if (this.heldKeys.has('Equal') || this.heldKeys.has('BracketRight')) throttleDelta += 1;
    if (this.heldKeys.has('Minus') || this.heldKeys.has('BracketLeft')) throttleDelta -= 1;

    const afterburnerBoost = this.heldKeys.has('ShiftLeft') || this.heldKeys.has('ShiftRight');
    const airbrake = this.heldKeys.has('KeyB');

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
        wSnap.rainIntensity
      );
      const altDensity = cloudDensityAtAltitude(this.state.position.y);
      if (this.scene.fog instanceof THREE.FogExp2) {
        const highAltClear = THREE.MathUtils.clamp((this.state.position.y - 2800) / 3500, 0, 1);
        const targetDensity =
          (0.000048 + wSnap.stormFactor * 0.000038) * (1 - highAltClear * 0.45) +
          altDensity * 0.000018 +
          this.cloudImmersion * 0.00042;
        this.scene.fog.density = THREE.MathUtils.damp(this.scene.fog.density, targetDensity, 4.5, dt);

        _clearFogColor
          .setHex(0xc4dbed)
          .lerp(_stormFogColor, wSnap.stormFactor)
          .lerp(_stratFogColor, highAltClear);
        this.scene.fog.color.lerpColors(_clearFogColor, _cloudFogColor, Math.min(1, this.cloudImmersion * 1.15));
      }

      this.sunLight.intensity = THREE.MathUtils.damp(
        this.sunLight.intensity,
        THREE.MathUtils.lerp(2.3, 1.25, wSnap.stormFactor),
        2.0,
        dt
      );

      this.sunLight.position.set(
        this.state.position.x + 1600,
        this.state.position.y + 1200,
        this.state.position.z - 2200
      );
      this.sunLight.target.position.copy(this.state.position);
      this.sunLight.target.updateMatrixWorld();

      if (!this.isSoftwareGl && this.postfx) {
        let centerX = 0.5;
        let centerY = 0.5;
        if (this.phase === 'playing' && this.cameraMode !== 'cinematic') {
          _v1.copy(this.state.velocity);
          if (_v1.lengthSq() > 1) {
            _v1.normalize();
          } else {
            _v1.set(0, 0, -1).applyQuaternion(this.state.quaternion).normalize();
          }
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
          isPaused: this.phase === 'paused' || this.phase === 'gameover',
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
    // Smooth cinematic figure-eight patrol over the coastal fjord & runway
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
    // Bank into turn
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

    // Orbiting hero showcase camera
    const camAngle = this.elapsed * 0.22;
    _v2.set(Math.sin(camAngle) * 24, 5.5 + Math.sin(this.elapsed * 0.4) * 2.5, Math.cos(camAngle) * 24);
    _camTargetPos.copy(this.state.position).add(_v2);
    this.camera.position.lerp(_camTargetPos, Math.min(1, dt * 4));
    this.camera.lookAt(this.state.position);
    this.camera.up.set(0, 1, 0);

    this.audio.updateContinuous(false, 0, false, 0, 0, 0, false, false, false, false, false);
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
    }

    // Auto-extend / retract landing gear smoothly around final approach unless manually overridden
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

    // Sample local wind shear, gusts, and atmospheric turbulence
    this.weather.sampleWindAt(this.state.position, this.elapsed, this.cloudImmersion, _windVec, _turbSample);

    const input = this.buildControlInputs();
    stepAircraftPhysics(
      this.state,
      input,
      dt,
      this.aircraftSpec,
      this.hull,
      _windVec,
      _turbSample,
      this.gearDown,
      this.onRunwayGround
    );

    if (this.state.crossedMachUp) {
      this.audio.playSonicBoom();
      this.cameraShake = Math.max(this.cameraShake, 0.35);
    }

    // Clamp operational perimeter smoothly (turn back warning / soft boundary)
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
        // Rolled off runway shoulder: bump back slightly or transition airborne if rotating
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
        // Check for takeoff rotation lift-off
        if (this.state.velocity.y > 2.4 && this.state.tasMps > 64 && input.pitch > 0.1) {
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
        // Successful precision runway touchdown
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
        // Hard gear-up or heavy sink slam onto runway
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
        // Mild bounce on fast/firm approach
        this.audio.playTouchdown(0.25);
        this.state.position.y = RUNWAY_CENTER.y + 2.8;
        this.state.velocity.y = Math.max(4, sinkMps * 0.35);
      }
    } else if (radarAlt <= 3.5) {
      // Fatal terrain / ocean impact
      this.hull = 0;
      this.weapons.spawnExplosion(this.state.position, 1.8);
      this.audio.playExplosion(1.2);
      this.phase = 'gameover';
      this.audio.updateContinuous(false, 0, false, 0, 0, 0, false, false, false, false, false);
      this.emitTelemetry();
      return;
    }

    // Friendly Airbase Runway Low-Pass Rearm & Repair
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
        this.gunAmmo = this.maxGunAmmo;
        this.missilesIr = this.aircraftSpec.missilesIr;
        this.missilesRadar = this.aircraftSpec.missilesRadar;
        this.flares = this.aircraftSpec.flares;
        this.resupplyCooldown = 18;
        this.resupplyNotice = 'AIRBASE REARM & REPAIR COMPLETE';
        this.resupplyTimer = 3.2;
      }
    }

    // M61 Vulcan Rotary Cannon firing (disabled while incapacitated in G-LOC)
    const wantGun = !this.state.gLocActive && (this.heldKeys.has('Space') || this.mouseLeftDown);
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
        // Engine smoke plume
        _v1.set(dmgNozX, 0.06, 6.1).applyQuaternion(this.state.quaternion).add(this.state.position);
        _v2.set(
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 14
        );
        const smokeCol = Math.random() < 0.35 ? 0x1e293b : 0x475569;
        this.weapons.spawnParticle(
          _v1,
          _v2,
          1.35 + severity * 0.7,
          0.95 + severity * 0.65,
          5.8 + severity * 4.5,
          smokeCol
        );

        // Intermittent combustion flare / burning fuel puff from damaged engine
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

        // Secondary starboard wing-root smoke when hull is critical (< 28%)
        if (this.hull < 28) {
          _v1.set(1.9, 0.08, 2.8).applyQuaternion(this.state.quaternion).add(this.state.position);
          this.weapons.spawnParticle(_v1, _v2, 1.1, 0.7, 4.2, 0x334155);
        }
      }

      // Localized metallic debris & hot sparks peeling off damaged airframe
      const debrisInterval = THREE.MathUtils.lerp(0.18, 0.065, severity);
      this.damageDebrisAccum += dt;
      if (this.damageDebrisAccum >= debrisInterval) {
        this.damageDebrisAccum = 0;
        const sideX = Math.random() > 0.3 ? -0.95 : 1.45;
        _v1.set(sideX, 0.15, 2.5 + Math.random() * 2.5)
          .applyQuaternion(this.state.quaternion)
          .add(this.state.position);
        _v2
          .copy(this.state.velocity)
          .multiplyScalar(0.55)
          .add(
            _v3.set(
              (Math.random() - 0.5) * 42,
              (Math.random() - 0.5) * 34 - 8,
              (Math.random() - 0.5) * 42
            )
          );
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
    this.playerRig.root.position.copy(this.state.position);
    this.playerRig.root.quaternion.copy(this.state.quaternion);
    this.playerRig.updateVisuals({
      pitchInput: this.state.gLocActive ? 0 : input.pitch,
      rollInput: this.state.gLocActive ? 0 : input.roll,
      yawInput: this.state.gLocActive ? 0 : input.yaw,
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

    // Update Enemy AI
    let anyLockingPlayer = false;
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const act = updateEnemyAi(enemy, this.state.position, this.state.velocity, this.wave, dt, this.elapsed);
      if (enemy.isLockingPlayer) anyLockingPlayer = true;

      if (act.fireGun) {
        _fwd.set(0, 0, -1).applyQuaternion(enemy.quaternion).normalize();
        _v1.set(0, 0, -8).applyQuaternion(enemy.quaternion).add(enemy.position);
        this.weapons.spawnBullet(_v1, _fwd, enemy.velocity, false);
      }
      if (act.fireMissile) {
        _v1.set(0, -0.8, -2).applyQuaternion(enemy.quaternion).add(enemy.position);
        this.weapons.spawnMissile(_v1, enemy.quaternion, enemy.speed, false, 'ir', null);
      }
    }

    // Update Target Lock Acquisition (automatic best target in boresight or manually cycled)
    this.updateTargetLock(dt);

    // Update Weapons & Collisions
    this.weapons.update(dt, this.state.position, this.enemies, {
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
          this.score += isMissile ? 350 : 500; // Bonus for gun kill
          this.killBanner = `${enemy.callsign} SPLASHED`;
          this.killBannerTimer = 2.6;
          this.hitstopTimer = 0.042; // Crisp 42ms impact hitstop
          this.cameraShake = Math.max(this.cameraShake, 0.55);

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
        // Immediate localized debris chunk burst when hit below 50% or crossing 50% threshold
        if (this.hull < 50 || (prevHull >= 50 && this.hull < 50)) {
          for (let i = 0; i < 6; i++) {
            _v1.set(
              (Math.random() - 0.5) * 65,
              (Math.random() - 0.5) * 55,
              (Math.random() - 0.5) * 65
            );
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
      onExplosion: () => {
        this.audio.playExplosion(0.7);
      },
    });

    // Advance Wave if all enemies splashed
    const remaining = this.enemies.filter((e) => e.alive).length;
    if (remaining === 0 && this.phase === 'playing') {
      this.wave++;
      this.score += 750;
      this.missilesIr = Math.min(this.aircraftSpec.missilesIr, this.missilesIr + 1);
      this.missilesRadar = Math.min(this.aircraftSpec.missilesRadar, this.missilesRadar + 2);
      this.flares = Math.min(this.aircraftSpec.flares, this.flares + 6);
      this.gunAmmo = Math.min(this.maxGunAmmo, this.gunAmmo + 250);
      this.killBanner = `WAVE ${this.wave} SCRAMBLED`;
      this.killBannerTimer = 3.0;
      this.clearEnemies();
      this.enemies = spawnEnemyWave(this.wave, this.state.position, this.mats, this.scene);
    }

    // Update Camera
    this.updateCamera(dt);

    // Update Continuous Procedural Audio
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

    // Auto-select nearest target inside seeker cone if none selected
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
      // Dynamic pilot eye inside 3D canopy with G-load seat compression, buffet & look-into-turn
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
      // Chase Cam with speed FOV widening + smooth bank-following lag
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

    // Apply decaying camera shake
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

    // Heading, Pitch, Roll in degrees
    _euler.setFromQuaternion(this.state.quaternion, 'YXZ');
    const headingDeg = (((-THREE.MathUtils.radToDeg(_euler.y)) % 360) + 360) % 360;
    const pitchDeg = THREE.MathUtils.radToDeg(_euler.x);
    const rollDeg = THREE.MathUtils.radToDeg(_euler.z);

    // Boresight & Flight Path Vector (Velocity Vector) projection
    _fwd.set(0, 0, -1).applyQuaternion(this.state.quaternion).normalize();
    _v1.copy(this.state.position).addScaledVector(_fwd, 600);
    const bore = this.projectToScreen(_v1, w, h);

    _v2.copy(this.state.velocity);
    if (_v2.lengthSq() < 1) _v2.copy(_fwd);
    else _v2.normalize();
    _v1.copy(this.state.position).addScaledVector(_v2, 600);
    const fpv = this.projectToScreen(_v1, w, h);

    // Project targets & gun lead pipper
    const targets: ProjectedTarget[] = [];
    const radarBlips: RadarBlip[] = [];
    const radarRange = 9000;

    _right.set(1, 0, 0).applyQuaternion(this.state.quaternion).normalize();

    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dist = e.position.distanceTo(this.state.position);
      const scr = this.projectToScreen(e.position, w, h);

      // Closure rate along line of sight
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
      });

      // Radar horizontal projection rotated into player heading
      const cosH = Math.cos(_euler.y);
      const sinH = Math.sin(_euler.y);
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

    // Incoming enemy missiles on radar
    for (const m of this.weapons.missiles) {
      if (!m.active || m.fromPlayer) continue;
      const relX = m.position.x - this.state.position.x;
      const relZ = m.position.z - this.state.position.z;
      const cosH = Math.cos(_euler.y);
      const sinH = Math.sin(_euler.y);
      radarBlips.push({
        id: m.id,
        dx: THREE.MathUtils.clamp((relX * cosH - relZ * sinH) / radarRange, -0.95, 0.95),
        dz: THREE.MathUtils.clamp((relX * sinH + relZ * cosH) / radarRange, -0.95, 0.95),
        isLocked: false,
        isMissile: true,
      });
    }

    // Friendly airbase blip on radar
    {
      const relX = RUNWAY_CENTER.x - this.state.position.x;
      const relZ = RUNWAY_CENTER.z - this.state.position.z;
      const cosH = Math.cos(_euler.y);
      const sinH = Math.sin(_euler.y);
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

    // Weather & ILS Runway Approach Geometry
    const wSnap = this.weather.getSnapshot();
    const windRelDeg = (((wSnap.windFromDeg - headingDeg) % 360) + 360) % 360;
    const dxRwy = RUNWAY_CENTER.x - this.state.position.x;
    const dzRwy = RUNWAY_CENTER.z - this.state.position.z;
    const rwyDistM = Math.hypot(dxRwy, dzRwy);
    const rwyBearingDeg = (((THREE.MathUtils.radToDeg(Math.atan2(dxRwy, -dzRwy))) % 360) + 360) % 360;

    // Select nearest runway approach end (South approach landing North 000°, or North approach landing South 180°)
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

    // Crosswind (+ = from pilot right pushing left) & Headwind (+ = headwind) relative to runway heading
    const windEastKts = wSnap.windVecX * 1.943844;
    const windSouthKts = wSnap.windVecZ * 1.943844;
    const crosswindKts = Math.round(landingNorth ? -windEastKts : windEastKts);
    const headwindKts = Math.round(landingNorth ? windSouthKts : -windSouthKts);

    const runwayApproachActive =
      this.gearDown || this.onRunwayGround || (rwyDistM < 4800 && radarAltM < 800);
    const verticalSpeedFpm = Math.round(this.state.velocity.y * 196.85);

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
