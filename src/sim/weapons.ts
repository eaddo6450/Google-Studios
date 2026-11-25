import * as THREE from 'three';
import type { EnemyAircraft } from './ai';
import type { SimMaterialLibrary } from './materials';
import { groundHeightAt } from './terrain';

export interface GunBullet {
  active: boolean;
  fromPlayer: boolean;
  position: THREE.Vector3;
  prevPosition: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
}

export interface GuidedMissile {
  id: string;
  active: boolean;
  fromPlayer: boolean;
  kind: 'ir' | 'radar';
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  quaternion: THREE.Quaternion;
  targetEnemyId: string | null;
  speed: number;
  maxSpeed: number;
  turnRateRad: number; // max G-turn angular rate
  life: number;
  smokeAccum: number;
  spoofedByFlare: boolean;
  spoofTarget: THREE.Vector3;
  mesh: THREE.Group;
}

export interface FlarePod {
  active: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  smokeAccum: number;
}

interface Particle {
  active: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  age: number;
  maxAge: number;
  startScale: number;
  endScale: number;
  color: THREE.Color;
}

const MAX_BULLETS = 220;
const MAX_PARTICLES = 650;
const MAX_FLARES = 48;

const _dummy = new THREE.Object3D();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _look = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Computes exact ballistic lead intercept point for M61 20mm Vulcan cannon.
 */
export function computeGunLeadPoint(
  shooterPos: THREE.Vector3,
  shooterVel: THREE.Vector3,
  targetPos: THREE.Vector3,
  targetVel: THREE.Vector3,
  muzzleSpeed: number,
  out: THREE.Vector3
): boolean {
  const dist = shooterPos.distanceTo(targetPos);
  if (dist > 2600 || dist < 15) return false;

  // Two-pass iterative time-of-flight solver with gravity drop compensation
  let tof = dist / (muzzleSpeed + shooterVel.length() * 0.5);
  for (let i = 0; i < 2; i++) {
    out.copy(targetPos).addScaledVector(targetVel, tof);
    // Subtract shooter's inherited velocity displacement & gravity drop
    out.addScaledVector(shooterVel, -tof * 0.85);
    out.y += 0.5 * 9.81 * tof * tof;
    const predDist = shooterPos.distanceTo(out);
    tof = predDist / muzzleSpeed;
  }

  // Final visual aim point in world space (where target will be minus gravity drop)
  out.copy(targetPos).addScaledVector(targetVel, tof);
  out.addScaledVector(shooterVel, -tof * 0.85);
  out.y += 0.5 * 9.81 * tof * tof;
  return true;
}

export class WeaponsSystem {
  public bullets: GunBullet[] = [];
  public missiles: GuidedMissile[] = [];
  public flares: FlarePod[] = [];
  private particles: Particle[] = [];

  private bulletMesh: THREE.InstancedMesh;
  private particleMesh: THREE.InstancedMesh;
  private flareMesh: THREE.InstancedMesh;
  private scene: THREE.Scene;
  private mats: SimMaterialLibrary;

  private bulletGeo: THREE.BufferGeometry;
  private bulletMat: THREE.MeshBasicMaterial;
  private particleGeo: THREE.BufferGeometry;
  private particleMat: THREE.MeshBasicMaterial;
  private flareGeo: THREE.BufferGeometry;
  private flareMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, mats: SimMaterialLibrary) {
    this.scene = scene;
    this.mats = mats;

    for (let i = 0; i < MAX_BULLETS; i++) {
      this.bullets.push({
        active: false,
        fromPlayer: true,
        position: new THREE.Vector3(),
        prevPosition: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        life: 0,
      });
    }

    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        active: false,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        age: 0,
        maxAge: 1,
        startScale: 1,
        endScale: 3,
        color: new THREE.Color(1, 1, 1),
      });
    }

    for (let i = 0; i < MAX_FLARES; i++) {
      this.flares.push({
        active: false,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        life: 0,
        smokeAccum: 0,
      });
    }

    // Pooled tracer bolts
    this.bulletGeo = new THREE.CylinderGeometry(0.16, 0.16, 11, 5).rotateX(Math.PI / 2);
    this.bulletMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    this.bulletMesh = new THREE.InstancedMesh(this.bulletGeo, this.bulletMat, MAX_BULLETS);
    this.bulletMesh.frustumCulled = false;
    this.bulletMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.bulletMesh);

    // Pooled particles (smoke, fireballs, contrails, sparks)
    this.particleGeo = new THREE.DodecahedronGeometry(1, 0);
    this.particleMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    });
    this.particleMesh = new THREE.InstancedMesh(this.particleGeo, this.particleMat, MAX_PARTICLES);
    this.particleMesh.frustumCulled = false;
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particleMesh.setColorAt(i, new THREE.Color(1, 1, 1));
    }
    scene.add(this.particleMesh);

    // Pooled magnesium decoy flares
    this.flareGeo = new THREE.SphereGeometry(0.75, 8, 6);
    this.flareMat = new THREE.MeshBasicMaterial({ color: 0xfffbeb });
    this.flareMesh = new THREE.InstancedMesh(this.flareGeo, this.flareMat, MAX_FLARES);
    this.flareMesh.frustumCulled = false;
    this.flareMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.flareMesh);
  }

  public spawnBullet(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    carrierVel: THREE.Vector3,
    fromPlayer: boolean
  ): void {
    const slot = this.bullets.find((b) => !b.active);
    if (!slot) return;

    slot.active = true;
    slot.fromPlayer = fromPlayer;
    slot.position.copy(origin);
    slot.prevPosition.copy(origin);

    // Muzzle speed 1050 m/s + tiny 0.009 rad dispersion
    const muzzleSpeed = fromPlayer ? 1050 : 880;
    _v1.copy(dir);
    _v1.x += (Math.random() - 0.5) * 0.011;
    _v1.y += (Math.random() - 0.5) * 0.011;
    _v1.z += (Math.random() - 0.5) * 0.011;
    _v1.normalize();

    slot.velocity.copy(carrierVel).addScaledVector(_v1, muzzleSpeed);
    slot.life = 2.4;
  }

  public spawnMissile(
    origin: THREE.Vector3,
    quaternion: THREE.Quaternion,
    carrierSpeed: number,
    fromPlayer: boolean,
    kind: 'ir' | 'radar',
    targetEnemyId: string | null
  ): void {
    const mesh = new THREE.Group();
    const len = kind === 'radar' ? 3.5 : 2.9;
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, len, 8).rotateX(Math.PI / 2),
      this.mats.missileBody
    );
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.24, 1.9, 8).rotateX(Math.PI / 2),
      this.mats.afterburnerCore
    );
    flame.position.z = len * 0.5 + 0.95;
    mesh.add(body, flame);
    mesh.position.copy(origin);
    mesh.quaternion.copy(quaternion);
    this.scene.add(mesh);

    _v1.set(0, 0, -1).applyQuaternion(quaternion).normalize();
    const initSpeed = Math.max(carrierSpeed + 60, 260);

    this.missiles.push({
      id: `msl_${Math.random().toString(36).slice(2, 8)}`,
      active: true,
      fromPlayer,
      kind,
      position: origin.clone(),
      velocity: _v1.clone().multiplyScalar(initSpeed),
      quaternion: quaternion.clone(),
      targetEnemyId,
      speed: initSpeed,
      maxSpeed: kind === 'radar' ? 860 : 680,
      turnRateRad: kind === 'ir' ? 2.15 : 1.75,
      life: kind === 'radar' ? 14.0 : 9.5,
      smokeAccum: 0,
      spoofedByFlare: false,
      spoofTarget: new THREE.Vector3(),
      mesh,
    });
  }

  public deployFlareSalvo(origin: THREE.Vector3, carrierVel: THREE.Vector3, carrierQuat: THREE.Quaternion): void {
    const right = _v1.set(1, 0, 0).applyQuaternion(carrierQuat);
    const up = _v2.set(0, 1, 0).applyQuaternion(carrierQuat);

    for (let side = -1; side <= 1; side += 2) {
      const pod = this.flares.find((f) => !f.active);
      if (!pod) continue;
      pod.active = true;
      pod.position.copy(origin);
      pod.velocity
        .copy(carrierVel)
        .multiplyScalar(0.68)
        .addScaledVector(right, side * (26 + Math.random() * 14))
        .addScaledVector(up, -12 - Math.random() * 8);
      pod.life = 3.2;
      pod.smokeAccum = 0;
    }

    // Seduce incoming enemy IR/radar missiles if flares deployed within 1200m
    for (const m of this.missiles) {
      if (m.active && !m.fromPlayer && !m.spoofedByFlare) {
        const dist = m.position.distanceTo(origin);
        if (dist < 1400 && Math.random() < 0.72) {
          m.spoofedByFlare = true;
          m.spoofTarget.copy(origin).addScaledVector(right, (Math.random() - 0.5) * 260);
        }
      }
    }
  }

  public spawnParticle(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    maxAge: number,
    startScale: number,
    endScale: number,
    hexColor: number
  ): void {
    const p = this.particles.find((item) => !item.active);
    if (!p) return;
    p.active = true;
    p.position.copy(pos);
    p.velocity.copy(vel);
    p.age = 0;
    p.maxAge = maxAge;
    p.startScale = startScale;
    p.endScale = endScale;
    p.color.setHex(hexColor);
  }

  public spawnExplosion(pos: THREE.Vector3, scale = 1.0): void {
    // Bright fireball core
    for (let i = 0; i < 18; i++) {
      _v1.set(
        (Math.random() - 0.5) * 95 * scale,
        (Math.random() - 0.3) * 95 * scale,
        (Math.random() - 0.5) * 95 * scale
      );
      this.spawnParticle(
        pos,
        _v1,
        0.55 + Math.random() * 0.45,
        4.5 * scale,
        24 * scale,
        i % 2 === 0 ? 0xf97316 : 0xfef08a
      );
    }
    // Dark smoke plume
    for (let i = 0; i < 16; i++) {
      _v1.set(
        (Math.random() - 0.5) * 48 * scale,
        15 + Math.random() * 52 * scale,
        (Math.random() - 0.5) * 48 * scale
      );
      this.spawnParticle(
        pos,
        _v1,
        1.6 + Math.random() * 1.4,
        6 * scale,
        36 * scale,
        0x334155
      );
    }
  }

  public spawnHitSparks(pos: THREE.Vector3): void {
    for (let i = 0; i < 7; i++) {
      _v1.set((Math.random() - 0.5) * 70, (Math.random() - 0.5) * 70, (Math.random() - 0.5) * 70);
      this.spawnParticle(pos, _v1, 0.3 + Math.random() * 0.25, 1.4, 4.5, 0xfacc15);
    }
  }

  public update(
    dt: number,
    playerPos: THREE.Vector3,
    enemies: EnemyAircraft[],
    callbacks: {
      onEnemyHit: (enemy: EnemyAircraft, damage: number, isMissile: boolean) => void;
      onPlayerHit: (damage: number, isMissile: boolean) => void;
      onExplosion: (pos: THREE.Vector3, intensity: number) => void;
    }
  ): void {
    // 1. Update bullets & swept sphere collision
    let bulletCount = 0;
    for (const b of this.bullets) {
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) {
        b.active = false;
        continue;
      }

      b.prevPosition.copy(b.position);
      b.velocity.y -= 9.81 * dt;
      b.velocity.multiplyScalar(1 - 0.08 * dt);
      b.position.addScaledVector(b.velocity, dt);

      // Terrain hit
      const floor = Math.max(0, groundHeightAt(b.position.x, b.position.z));
      if (b.position.y <= floor) {
        b.active = false;
        this.spawnParticle(b.position, _v1.set(0, 18, 0), 0.45, 2.5, 8, 0x94a3b8);
        continue;
      }

      // Hit checks
      let hit = false;
      if (b.fromPlayer) {
        for (const e of enemies) {
          if (!e.alive) continue;
          if (segmentSphereDistSq(b.prevPosition, b.position, e.position) < 16 * 16) {
            b.active = false;
            hit = true;
            this.spawnHitSparks(b.position);
            callbacks.onEnemyHit(e, 14, false);
            break;
          }
        }
      } else {
        if (segmentSphereDistSq(b.prevPosition, b.position, playerPos) < 12 * 12) {
          b.active = false;
          hit = true;
          this.spawnHitSparks(b.position);
          callbacks.onPlayerHit(7, false);
        }
      }
      if (hit) continue;

      _dummy.position.copy(b.position);
      _v1.copy(b.position).add(b.velocity);
      _dummy.lookAt(_v1);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      this.bulletMesh.setMatrixAt(bulletCount++, _dummy.matrix);
    }
    this.bulletMesh.count = bulletCount;
    this.bulletMesh.instanceMatrix.needsUpdate = true;

    // 2. Update guided missiles (Proportional Navigation)
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      if (!m.active) continue;

      m.life -= dt;
      if (m.life <= 0) {
        this.retireMissile(i);
        continue;
      }

      // Accelerate under rocket motor
      m.speed = Math.min(m.maxSpeed, m.speed + 280 * dt);

      // Find target position
      let targetPos: THREE.Vector3 | null = null;
      let targetEnemy: EnemyAircraft | undefined;

      if (m.fromPlayer && m.targetEnemyId) {
        targetEnemy = enemies.find((e) => e.id === m.targetEnemyId && e.alive);
        if (targetEnemy) targetPos = targetEnemy.position;
      } else if (!m.fromPlayer) {
        targetPos = m.spoofedByFlare ? m.spoofTarget : playerPos;
      }

      if (targetPos) {
        // Predictive lead (Proportional Navigation approximation)
        const dist = m.position.distanceTo(targetPos);
        const leadTime = Math.min(1.5, dist / Math.max(200, m.speed));
        _v2.copy(targetPos);
        if (targetEnemy) {
          _v2.addScaledVector(targetEnemy.velocity, leadTime * 0.72);
        }

        _v1.subVectors(_v2, m.position).normalize();
        _look.lookAt(_v3.set(0, 0, 0), _v1, _up);
        _q1.setFromRotationMatrix(_look);
        m.quaternion.rotateTowards(_q1, m.turnRateRad * dt);
      }

      _v1.set(0, 0, -1).applyQuaternion(m.quaternion).normalize();
      m.velocity.copy(_v1).multiplyScalar(m.speed);
      m.position.addScaledVector(m.velocity, dt);
      m.mesh.position.copy(m.position);
      m.mesh.quaternion.copy(m.quaternion);

      // Rocket smoke trail
      m.smokeAccum += dt;
      if (m.smokeAccum > 0.025) {
        m.smokeAccum = 0;
        this.spawnParticle(
          m.position,
          _v3.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6),
          1.35,
          1.5,
          6.8,
          0xe2e8f0
        );
      }

      // Terrain impact
      const floor = Math.max(0, groundHeightAt(m.position.x, m.position.z));
      if (m.position.y <= floor) {
        this.spawnExplosion(m.position, 0.75);
        callbacks.onExplosion(m.position, 0.55);
        this.retireMissile(i);
        continue;
      }

      // Proximity fuze detonation (32m)
      if (m.fromPlayer) {
        let detonated = false;
        for (const e of enemies) {
          if (!e.alive) continue;
          if (m.position.distanceTo(e.position) < 34) {
            this.spawnExplosion(m.position, 1.15);
            callbacks.onExplosion(m.position, 0.9);
            callbacks.onEnemyHit(e, 75, true);
            detonated = true;
            break;
          }
        }
        if (detonated) {
          this.retireMissile(i);
          continue;
        }
      } else {
        if (!m.spoofedByFlare && m.position.distanceTo(playerPos) < 28) {
          this.spawnExplosion(m.position, 1.0);
          callbacks.onExplosion(m.position, 0.85);
          callbacks.onPlayerHit(32, true);
          this.retireMissile(i);
          continue;
        }
      }
    }

    // 3. Update flares
    let flareCount = 0;
    for (const f of this.flares) {
      if (!f.active) continue;
      f.life -= dt;
      if (f.life <= 0) {
        f.active = false;
        continue;
      }
      f.velocity.y -= 9.81 * dt;
      f.velocity.multiplyScalar(1 - 0.75 * dt);
      f.position.addScaledVector(f.velocity, dt);

      f.smokeAccum += dt;
      if (f.smokeAccum > 0.045) {
        f.smokeAccum = 0;
        this.spawnParticle(f.position, _v3.set(0, 4, 0), 0.75, 1.2, 4.2, 0xfef9c3);
      }

      _dummy.position.copy(f.position);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.setScalar(1.1 + Math.random() * 0.45);
      _dummy.updateMatrix();
      this.flareMesh.setMatrixAt(flareCount++, _dummy.matrix);
    }
    this.flareMesh.count = flareCount;
    this.flareMesh.instanceMatrix.needsUpdate = true;

    // 4. Update pooled particles
    let partCount = 0;
    for (const p of this.particles) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.maxAge) {
        p.active = false;
        continue;
      }
      p.position.addScaledVector(p.velocity, dt);
      p.velocity.multiplyScalar(1 - 0.65 * dt);

      const t = p.age / p.maxAge;
      const scale = THREE.MathUtils.lerp(p.startScale, p.endScale, t) * (1 - t * 0.35);
      _dummy.position.copy(p.position);
      _dummy.rotation.set(p.age * 1.4, p.age * 0.9, 0);
      _dummy.scale.setScalar(Math.max(0.05, scale));
      _dummy.updateMatrix();

      this.particleMesh.setMatrixAt(partCount, _dummy.matrix);
      this.particleMesh.setColorAt(partCount, p.color);
      partCount++;
    }
    this.particleMesh.count = partCount;
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
  }

  private retireMissile(index: number): void {
    const m = this.missiles[index];
    m.active = false;
    this.scene.remove(m.mesh);
    m.mesh.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        (child as THREE.Mesh).geometry.dispose();
      }
    });
    this.missiles.splice(index, 1);
  }

  public clearAll(): void {
    for (const b of this.bullets) b.active = false;
    for (const f of this.flares) f.active = false;
    for (const p of this.particles) p.active = false;
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      this.retireMissile(i);
    }
    this.bulletMesh.count = 0;
    this.flareMesh.count = 0;
    this.particleMesh.count = 0;
  }

  public dispose(): void {
    this.clearAll();
    this.bulletGeo.dispose();
    this.bulletMat.dispose();
    this.particleGeo.dispose();
    this.particleMat.dispose();
    this.flareGeo.dispose();
    this.flareMat.dispose();
  }
}

function segmentSphereDistSq(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const lenSq = abx * abx + aby * aby + abz * abz;
  if (lenSq < 1e-6) return a.distanceToSquared(p);
  const t = THREE.MathUtils.clamp(
    ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / lenSq,
    0,
    1
  );
  const cx = a.x + abx * t - p.x;
  const cy = a.y + aby * t - p.y;
  const cz = a.z + abz * t - p.z;
  return cx * cx + cy * cy + cz * cz;
}
