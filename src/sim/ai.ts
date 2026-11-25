import * as THREE from 'three';
import { createEnemyFighterModel } from './aircraftModel';
import type { SimMaterialLibrary } from './materials';
import { groundHeightAt } from './terrain';

export type AiMode = 'intercept' | 'dogfight' | 'evade';

export interface EnemyAircraft {
  id: string;
  callsign: string;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  quaternion: THREE.Quaternion;
  speed: number;
  health: number;
  maxHealth: number;
  alive: boolean;
  mode: AiMode;
  modeTimer: number;
  evadeSign: number;
  gunCooldown: number;
  missileCooldown: number;
  lockTimer: number; // builds up to 2.6s before launching missile at player
  isLockingPlayer: boolean;
  hitFlashTimer: number;
  model: ReturnType<typeof createEnemyFighterModel>;
}

const CALLSIGNS = [
  'KESTREL-1',
  'VIPER-2',
  'REAPER-3',
  'COBRA-4',
  'TALON-5',
  'SPECTER-6',
  'JACKAL-7',
  'PHANTOM-8',
];

const _toTarget = new THREE.Vector3();
const _desiredDir = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _targetQuat = new THREE.Quaternion();
const _lookMat = new THREE.Matrix4();
const _bankQuat = new THREE.Quaternion();
const _zAxis = new THREE.Vector3(0, 0, 1);
const _worldUp = new THREE.Vector3(0, 1, 0);

export function spawnEnemyWave(
  wave: number,
  playerPos: THREE.Vector3,
  mats: SimMaterialLibrary,
  scene: THREE.Scene
): EnemyAircraft[] {
  const count = Math.min(6, 2 + wave);
  const enemies: EnemyAircraft[] = [];

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 1.4 - Math.PI * 0.7 + (Math.random() - 0.5) * 0.35;
    const dist = 2600 + wave * 450 + Math.random() * 1400;
    const x = THREE.MathUtils.clamp(playerPos.x + Math.sin(angle) * dist, -11000, 11000);
    const z = THREE.MathUtils.clamp(playerPos.z - Math.cos(angle) * dist, -11000, 11000);
    const floor = Math.max(0, groundHeightAt(x, z));
    const y = Math.max(floor + 650, 950 + Math.random() * 1100);

    const model = createEnemyFighterModel(mats);
    model.root.position.set(x, y, z);
    scene.add(model.root);

    const pos = new THREE.Vector3(x, y, z);
    const dirToPlayer = new THREE.Vector3().subVectors(playerPos, pos).normalize();
    const quat = new THREE.Quaternion();
    _lookMat.lookAt(new THREE.Vector3(), dirToPlayer, _worldUp);
    quat.setFromRotationMatrix(_lookMat);

    const baseHealth = 100 + (wave - 1) * 20;
    const baseSpeed = 195 + Math.min(85, wave * 14);

    enemies.push({
      id: `enemy_${wave}_${i}_${Math.floor(Math.random() * 9999)}`,
      callsign: CALLSIGNS[i % CALLSIGNS.length],
      position: pos,
      velocity: dirToPlayer.multiplyScalar(baseSpeed),
      quaternion: quat,
      speed: baseSpeed,
      health: baseHealth,
      maxHealth: baseHealth,
      alive: true,
      mode: 'intercept',
      modeTimer: 4 + Math.random() * 4,
      evadeSign: Math.random() > 0.5 ? 1 : -1,
      gunCooldown: 1 + Math.random() * 1.5,
      missileCooldown: 7 + Math.random() * 6,
      lockTimer: 0,
      isLockingPlayer: false,
      hitFlashTimer: 0,
      model,
    });
  }

  return enemies;
}

export interface AiActionResult {
  fireGun: boolean;
  fireMissile: boolean;
}

export function updateEnemyAi(
  enemy: EnemyAircraft,
  playerPos: THREE.Vector3,
  playerVel: THREE.Vector3,
  wave: number,
  dt: number,
  elapsed: number
): AiActionResult {
  const result: AiActionResult = { fireGun: false, fireMissile: false };
  if (!enemy.alive) return result;

  enemy.gunCooldown = Math.max(0, enemy.gunCooldown - dt);
  enemy.missileCooldown = Math.max(0, enemy.missileCooldown - dt);
  enemy.hitFlashTimer = Math.max(0, enemy.hitFlashTimer - dt);
  enemy.modeTimer -= dt;

  _toTarget.subVectors(playerPos, enemy.position);
  const dist = _toTarget.length();
  const dirToPlayer = _toTarget.clone().divideScalar(Math.max(1, dist));

  _fwd.set(0, 0, -1).applyQuaternion(enemy.quaternion).normalize();
  const angleToPlayer = _fwd.angleTo(dirToPlayer);

  // Switch modes dynamically for realistic dogfight maneuvering
  if (enemy.modeTimer <= 0) {
    if (dist < 620) {
      enemy.mode = 'evade';
      enemy.modeTimer = 3.2 + Math.random() * 2.2;
      enemy.evadeSign = Math.random() > 0.5 ? 1 : -1;
    } else if (dist < 2400) {
      enemy.mode = 'dogfight';
      enemy.modeTimer = 5.0 + Math.random() * 4.0;
    } else {
      enemy.mode = 'intercept';
      enemy.modeTimer = 4.0;
    }
  }

  // Desired pursuit/evasion vector
  if (enemy.mode === 'evade') {
    // Break turn & climb away to avoid overshoot collision
    _right.set(1, 0, 0).applyQuaternion(enemy.quaternion);
    _desiredDir
      .copy(dirToPlayer)
      .multiplyScalar(-0.45)
      .addScaledVector(_right, enemy.evadeSign * 0.9)
      .addScaledVector(_worldUp, 0.35)
      .normalize();
  } else {
    // Lead pursuit toward player predicted position
    const leadTime = Math.min(2.0, dist / 350);
    _desiredDir
      .copy(playerPos)
      .addScaledVector(playerVel, leadTime * 0.65)
      .sub(enemy.position)
      .normalize();
  }

  // Terrain avoidance (look ahead 450m)
  const lookAheadX = enemy.position.x + _fwd.x * 450;
  const lookAheadZ = enemy.position.z + _fwd.z * 450;
  const terrainFloor = Math.max(0, groundHeightAt(lookAheadX, lookAheadZ)) + 260;
  const curFloor = Math.max(0, groundHeightAt(enemy.position.x, enemy.position.z)) + 180;
  const minSafeAlt = Math.max(terrainFloor, curFloor);

  if (enemy.position.y < minSafeAlt) {
    const pullUpUrgency = THREE.MathUtils.clamp((minSafeAlt - enemy.position.y) / 220, 0.2, 1.0);
    _desiredDir.y = Math.max(_desiredDir.y, pullUpUrgency * 0.95);
    _desiredDir.normalize();
  }

  // Keep inside operational theater radius
  const distFromCenter = Math.hypot(enemy.position.x, enemy.position.z);
  if (distFromCenter > 11500) {
    _desiredDir.set(-enemy.position.x, 250, -enemy.position.z).normalize();
  }

  // Compute bank-to-turn quaternion
  const turnRate = 0.72 + Math.min(0.45, wave * 0.08);
  _lookMat.lookAt(new THREE.Vector3(), _desiredDir, _worldUp);
  _targetQuat.setFromRotationMatrix(_lookMat);

  // Add realistic roll bank toward turn direction
  const lateralDot = _desiredDir.dot(_right.set(1, 0, 0).applyQuaternion(enemy.quaternion));
  const bankAngle = THREE.MathUtils.clamp(-lateralDot * 1.65, -1.18, 1.18);
  _bankQuat.setFromAxisAngle(_zAxis, bankAngle);
  _targetQuat.multiply(_bankQuat);

  enemy.quaternion.slerp(_targetQuat, Math.min(1, dt * turnRate * 2.2));

  // Speed & energy control
  const targetSpeed = enemy.mode === 'evade' ? 265 + wave * 12 : 210 + wave * 10;
  enemy.speed = THREE.MathUtils.damp(enemy.speed, targetSpeed, 1.8, dt);

  _fwd.set(0, 0, -1).applyQuaternion(enemy.quaternion).normalize();
  enemy.velocity.copy(_fwd).multiplyScalar(enemy.speed);
  enemy.position.addScaledVector(enemy.velocity, dt);

  // Sync visual mesh + afterburner flicker
  enemy.model.root.position.copy(enemy.position);
  enemy.model.root.quaternion.copy(enemy.quaternion);
  const abScale = (0.75 + Math.sin(elapsed * 44 + enemy.position.x) * 0.14) * (enemy.mode === 'evade' ? 1.25 : 0.85);
  enemy.model.abLeft.scale.set(0.9, 0.9, abScale);
  enemy.model.abRight.scale.set(0.9, 0.9, abScale);

  // Attack logic: Guns inside 950m & narrow cone; Missiles with 2.6s RWR lock telegraph
  if (dist < 950 && angleToPlayer < 0.19 && enemy.gunCooldown <= 0) {
    enemy.gunCooldown = 0.13;
    result.fireGun = true;
  }

  const canLock = dist > 550 && dist < 4400 && angleToPlayer < 0.42 && enemy.missileCooldown <= 0;
  if (canLock) {
    enemy.isLockingPlayer = true;
    enemy.lockTimer += dt;
    if (enemy.lockTimer >= 2.6) {
      enemy.lockTimer = 0;
      enemy.isLockingPlayer = false;
      enemy.missileCooldown = Math.max(7.5, 13 - wave * 1.1);
      result.fireMissile = true;
    }
  } else {
    enemy.isLockingPlayer = false;
    enemy.lockTimer = Math.max(0, enemy.lockTimer - dt * 1.5);
  }

  // Unused _up reference guard
  void _up;
  return result;
}
