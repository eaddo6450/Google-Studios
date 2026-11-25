import * as THREE from 'three';
import { createEnemyFighterModel } from './aircraftModel';
import type { SimMaterialLibrary } from './materials';
import { groundHeightAt } from './terrain';
import type { AdaptiveDifficultyProfile } from './types';

export type AiMode = 'patrol' | 'engage' | 'evade' | 'retreat';

export interface EnemyAircraft {
  id: string;
  callsign: string;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  quaternion: THREE.Quaternion;
  patrolAnchor: THREE.Vector3;
  speed: number;
  health: number;
  maxHealth: number;
  alive: boolean;
  mode: AiMode;
  modeTimer: number;
  evadeSign: number;
  gunCooldown: number;
  missileCooldown: number;
  lockTimer: number;
  isLockingPlayer: boolean;
  hitFlashTimer: number;
  hasTriggeredRetreat: boolean;
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
const _targetQuat = new THREE.Quaternion();
const _lookMat = new THREE.Matrix4();
const _bankQuat = new THREE.Quaternion();
const _zAxis = new THREE.Vector3(0, 0, 1);
const _worldUp = new THREE.Vector3(0, 1, 0);
const _origin = new THREE.Vector3(0, 0, 0);

export function spawnEnemyWave(
  wave: number,
  playerPos: THREE.Vector3,
  mats: SimMaterialLibrary,
  scene: THREE.Scene,
  requestedCount?: number,
  difficultyScale = 1.0,
  startPatrolling = false
): EnemyAircraft[] {
  const count = requestedCount
    ? Math.max(1, Math.min(7, requestedCount))
    : Math.min(6, 2 + wave);
  const enemies: EnemyAircraft[] = [];

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 1.4 - Math.PI * 0.7 + (Math.random() - 0.5) * 0.35;
    const dist = 2900 + wave * 420 + Math.random() * 1400;
    const x = THREE.MathUtils.clamp(playerPos.x + Math.sin(angle) * dist, -10500, 10500);
    const z = THREE.MathUtils.clamp(playerPos.z - Math.cos(angle) * dist, -10500, 10500);
    const floor = Math.max(0, groundHeightAt(x, z));
    const y = Math.max(floor + 650, 950 + Math.random() * 1100);

    const model = createEnemyFighterModel(mats);
    model.root.position.set(x, y, z);
    scene.add(model.root);

    const pos = new THREE.Vector3(x, y, z);
    const dirToPlayer = new THREE.Vector3().subVectors(playerPos, pos).normalize();
    const quat = new THREE.Quaternion();
    _lookMat.lookAt(_origin, dirToPlayer, _worldUp);
    quat.setFromRotationMatrix(_lookMat);

    const baseHealth = Math.round((100 + (wave - 1) * 18) * difficultyScale);
    const baseSpeed = 195 + Math.min(85, wave * 12);

    enemies.push({
      id: `enemy_${wave}_${i}_${Math.floor(Math.random() * 9999)}`,
      callsign: CALLSIGNS[i % CALLSIGNS.length],
      position: pos,
      velocity: dirToPlayer.multiplyScalar(baseSpeed),
      quaternion: quat,
      patrolAnchor: new THREE.Vector3(x * 0.85, y, z * 0.85),
      speed: baseSpeed,
      health: baseHealth,
      maxHealth: baseHealth,
      alive: true,
      mode: startPatrolling && i % 2 === 1 ? 'patrol' : 'engage',
      modeTimer: 4 + Math.random() * 3.5,
      evadeSign: Math.random() > 0.5 ? 1 : -1,
      gunCooldown: 1 + Math.random() * 1.5,
      missileCooldown: 7 + Math.random() * 6,
      lockTimer: 0,
      isLockingPlayer: false,
      hitFlashTimer: 0,
      hasTriggeredRetreat: false,
      model,
    });
  }

  return enemies;
}

export interface AiActionResult {
  fireGun: boolean;
  fireMissile: boolean;
  targetEscort: boolean;
  enteredRetreat: boolean;
}

export function updateEnemyAi(
  enemy: EnemyAircraft,
  playerPos: THREE.Vector3,
  playerVel: THREE.Vector3,
  wave: number,
  dt: number,
  elapsed: number,
  difficulty: AdaptiveDifficultyProfile,
  escortPos: THREE.Vector3 | null = null,
  escortVel: THREE.Vector3 | null = null
): AiActionResult {
  const result: AiActionResult = {
    fireGun: false,
    fireMissile: false,
    targetEscort: false,
    enteredRetreat: false,
  };
  if (!enemy.alive) return result;

  enemy.gunCooldown = Math.max(0, enemy.gunCooldown - dt);
  enemy.missileCooldown = Math.max(0, enemy.missileCooldown - dt);
  enemy.hitFlashTimer = Math.max(0, enemy.hitFlashTimer - dt);
  enemy.modeTimer -= dt;

  // Choose primary engagement target (player vs allied escort transport)
  const distToPlayer = enemy.position.distanceTo(playerPos);
  const distToEscort = escortPos ? enemy.position.distanceTo(escortPos) : Infinity;
  const engageEscort = Boolean(escortPos && (distToEscort < distToPlayer * 0.85 || distToPlayer > 4200));
  const targetPos = engageEscort && escortPos ? escortPos : playerPos;
  const targetVel = engageEscort && escortVel ? escortVel : playerVel;

  _toTarget.subVectors(targetPos, enemy.position);
  const dist = _toTarget.length();
  const dirToTarget = _toTarget.clone().divideScalar(Math.max(1, dist));

  _fwd.set(0, 0, -1).applyQuaternion(enemy.quaternion).normalize();
  const angleToTarget = _fwd.angleTo(dirToTarget);
  const healthRatio = enemy.health / Math.max(1, enemy.maxHealth);

  // Explicit 4-State Tactical FSM: patrol -> engage -> evade -> retreat
  if (healthRatio < 0.28 && enemy.mode !== 'retreat') {
    enemy.mode = 'retreat';
    enemy.modeTimer = 10.0;
    enemy.isLockingPlayer = false;
    enemy.lockTimer = 0;
    if (!enemy.hasTriggeredRetreat) {
      enemy.hasTriggeredRetreat = true;
      result.enteredRetreat = true;
    }
  } else if (enemy.mode === 'patrol') {
    if (dist < 6200 || enemy.hitFlashTimer > 0) {
      enemy.mode = 'engage';
      enemy.modeTimer = 5.0;
    }
  } else if (enemy.mode === 'retreat') {
    // Stay in tactical retreat while hull is critical; re-engage only if forced close
    if (dist < 520 && enemy.modeTimer <= 0) {
      enemy.mode = 'evade';
      enemy.modeTimer = 3.0;
    }
  } else if (enemy.modeTimer <= 0) {
    if (dist < 620 || (enemy.hitFlashTimer > 0 && dist < 1400)) {
      enemy.mode = 'evade';
      enemy.modeTimer = 3.0 + Math.random() * 2.0;
      enemy.evadeSign = Math.random() > 0.5 ? 1 : -1;
    } else if (dist > 8200 && !engageEscort) {
      enemy.mode = 'patrol';
      enemy.modeTimer = 4.0;
    } else {
      enemy.mode = 'engage';
      enemy.modeTimer = 4.5 + Math.random() * 3.5;
    }
  }

  // Desired flight vector per state
  if (enemy.mode === 'patrol') {
    const orbitAngle = elapsed * 0.22 + enemy.position.x * 0.001;
    const patrolX = enemy.patrolAnchor.x + Math.cos(orbitAngle) * 1400;
    const patrolZ = enemy.patrolAnchor.z + Math.sin(orbitAngle) * 1400;
    _desiredDir
      .set(patrolX - enemy.position.x, enemy.patrolAnchor.y - enemy.position.y, patrolZ - enemy.position.z)
      .normalize();
  } else if (enemy.mode === 'evade') {
    _right.set(1, 0, 0).applyQuaternion(enemy.quaternion);
    _desiredDir
      .copy(dirToTarget)
      .multiplyScalar(-0.45)
      .addScaledVector(_right, enemy.evadeSign * 0.92)
      .addScaledVector(_worldUp, 0.36)
      .normalize();
  } else if (enemy.mode === 'retreat') {
    // Break away from player toward perimeter & climb
    _desiredDir
      .subVectors(enemy.position, playerPos)
      .setY(0.28 * Math.max(400, dist))
      .normalize();
  } else {
    // Engage: proportional lead pursuit
    const leadTime = Math.min(2.0, dist / 350);
    _desiredDir
      .copy(targetPos)
      .addScaledVector(targetVel, leadTime * 0.68)
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

  // Operational theater perimeter containment
  const distFromCenter = Math.hypot(enemy.position.x, enemy.position.z);
  if (distFromCenter > 11500) {
    _desiredDir.set(-enemy.position.x, 260, -enemy.position.z).normalize();
  }

  // Bank-to-turn quaternion orientation (gimbal-lock free)
  const turnRate = (0.72 + Math.min(0.45, wave * 0.08)) * difficulty.aiTurnScale;
  _lookMat.lookAt(_origin, _desiredDir, _worldUp);
  _targetQuat.setFromRotationMatrix(_lookMat);

  const lateralDot = _desiredDir.dot(_right.set(1, 0, 0).applyQuaternion(enemy.quaternion));
  const bankAngle = THREE.MathUtils.clamp(-lateralDot * 1.65, -1.18, 1.18);
  _bankQuat.setFromAxisAngle(_zAxis, bankAngle);
  _targetQuat.multiply(_bankQuat);

  enemy.quaternion.slerp(_targetQuat, Math.min(1, dt * turnRate * 2.2));

  // Speed regime per AI state
  const targetSpeed =
    enemy.mode === 'retreat'
      ? 315 + wave * 10
      : enemy.mode === 'evade'
      ? 268 + wave * 12
      : enemy.mode === 'patrol'
      ? 178
      : 215 + wave * 10;
  enemy.speed = THREE.MathUtils.damp(enemy.speed, targetSpeed, 1.8, dt);

  _fwd.set(0, 0, -1).applyQuaternion(enemy.quaternion).normalize();
  enemy.velocity.copy(_fwd).multiplyScalar(enemy.speed);
  enemy.position.addScaledVector(enemy.velocity, dt);

  // Sync visual LOD & custom afterburner shader uniforms
  enemy.model.root.position.copy(enemy.position);
  enemy.model.root.quaternion.copy(enemy.quaternion);
  const abScale =
    (0.75 + Math.sin(elapsed * 44 + enemy.position.x) * 0.14) *
    (enemy.mode === 'retreat' ? 1.35 : enemy.mode === 'evade' ? 1.2 : enemy.mode === 'patrol' ? 0.55 : 0.92);
  enemy.model.abLeft.scale.set(0.9, 0.9, abScale);
  enemy.model.abRight.scale.set(0.9, 0.9, abScale);
  enemy.model.abShader.uniforms.uTime.value = elapsed;
  enemy.model.abShader.uniforms.uMach.value = enemy.speed / 340;
  enemy.model.abShader.uniforms.uPower.value = enemy.mode === 'patrol' ? 0.48 : 1.05;

  // Weapons engagement only in 'engage' mode
  if (enemy.mode === 'engage') {
    if (dist < 950 && angleToTarget < 0.2 * difficulty.aiAggression && enemy.gunCooldown <= 0) {
      enemy.gunCooldown = 0.13 / difficulty.aiAggression;
      result.fireGun = true;
      result.targetEscort = engageEscort;
    }

    const canLock =
      dist > 550 &&
      dist < 4400 &&
      angleToTarget < 0.42 &&
      enemy.missileCooldown <= 0;

    if (canLock) {
      enemy.isLockingPlayer = !engageEscort;
      enemy.lockTimer += dt * difficulty.aiAggression;
      if (enemy.lockTimer >= 2.6) {
        enemy.lockTimer = 0;
        enemy.isLockingPlayer = false;
        enemy.missileCooldown = Math.max(6.5, (13 - wave * 1.0) * difficulty.aiMissileCooldownScale);
        result.fireMissile = true;
        result.targetEscort = engageEscort;
      }
    } else {
      enemy.isLockingPlayer = false;
      enemy.lockTimer = Math.max(0, enemy.lockTimer - dt * 1.5);
    }
  } else {
    enemy.isLockingPlayer = false;
    enemy.lockTimer = 0;
  }

  return result;
}
