import * as THREE from 'three';
import { createVolumetricCloudSystem, type VolumetricCloudSystem } from './clouds';
import type { SimMaterialLibrary } from './materials';

export const WORLD_RADIUS = 16000;
export const RUNWAY_CENTER = new THREE.Vector3(0, 18.2, -400);
export const RUNWAY_LENGTH = 2400;
export const RUNWAY_WIDTH = 72;

// Deterministic 2D hash & smooth value noise
function hash2(ix: number, iz: number): number {
  const n = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);

  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);

  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

function fbm(x: number, z: number): number {
  let v = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < 4; i++) {
    v += amp * valueNoise(x * freq, z * freq);
    freq *= 2.04;
    amp *= 0.48;
  }
  return v;
}

/**
 * Deterministic terrain elevation in meters.
 * Ocean surface sits at y = 0.
 * Coastal airbase plateau sits around (0, -400) at y = 18m.
 */
export function groundHeightAt(x: number, z: number): number {
  // Coastal channel runs diagonally/horizontally around x in [-1600, 1600] except the airbase peninsula
  const n1 = fbm(x * 0.00022 + 12.4, z * 0.00022 - 7.1);
  const ridge = Math.abs(fbm(x * 0.00055 - 3.2, z * 0.00055 + 9.8) - 0.5) * 2.0;

  // Mountain elevation sculpted around coastal fjords
  const channelCut = Math.exp(-Math.pow((x - Math.sin(z * 0.00035) * 1400) / 2100, 2));
  let h = (n1 * 880 + (1 - ridge) * 420 - 260) * (1 - channelCut * 0.88);

  // Outer dramatic mountain wall ring for natural perimeter
  const distFromCenter = Math.hypot(x, z);
  if (distFromCenter > 9500) {
    const rim = Math.min(1, (distFromCenter - 9500) / 5500);
    h += rim * 700 * (0.6 + n1 * 0.6);
  }

  // Smooth plateau for the Airbase Runway peninsula around (0, -400)
  const dxBase = Math.abs(x - RUNWAY_CENTER.x);
  const dzBase = Math.abs(z - RUNWAY_CENTER.z);
  const baseMaskX = Math.max(0, 1 - Math.max(0, dxBase - 260) / 480);
  const baseMaskZ = Math.max(0, 1 - Math.max(0, dzBase - 1400) / 600);
  const baseBlend = Math.min(1, baseMaskX * baseMaskZ);
  const smoothBase = baseBlend * baseBlend * (3 - 2 * baseBlend);

  h = h * (1 - smoothBase) + 18.0 * smoothBase;

  return h;
}

export interface WorldEnvironment {
  group: THREE.Group;
  skyMesh: THREE.Mesh;
  waterMesh: THREE.Mesh;
  clouds: VolumetricCloudSystem;
  update: (
    elapsed: number,
    dt: number,
    cameraPos: THREE.Vector3,
    aircraftPos: THREE.Vector3,
    windVecX: number,
    windVecZ: number,
    windSpeedKts: number,
    stormFactor: number,
    rainIntensity: number
  ) => number;
  dispose: () => void;
}

export function createWorldEnvironment(
  mats: SimMaterialLibrary,
  isSoftwareGl: boolean
): WorldEnvironment {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];

  // 1. Atmospheric Sky Dome Shader (vertical Rayleigh-inspired gradient + sun disk glow)
  const skyGeo = new THREE.SphereGeometry(28000, 32, 20);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0.55, 0.36, -0.75).normalize() },
      uTopColor: { value: new THREE.Color(0x0b2349) },
      uMidColor: { value: new THREE.Color(0x3a76b8) },
      uHorizonColor: { value: new THREE.Color(0xc8deee) },
    },
    vertexShader: `
      varying vec3 vWorldDir;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(position);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      varying vec3 vWorldDir;
      uniform vec3 uSunDir;
      uniform vec3 uTopColor;
      uniform vec3 uMidColor;
      uniform vec3 uHorizonColor;
      void main() {
        vec3 dir = normalize(vWorldDir);
        float h = clamp(dir.y, 0.0, 1.0);
        vec3 col = mix(uHorizonColor, uMidColor, pow(h, 0.45));
        col = mix(col, uTopColor, smoothstep(0.18, 0.85, h));

        // Sun halo & disk
        float sunDot = max(dot(dir, uSunDir), 0.0);
        col += vec3(1.0, 0.88, 0.68) * pow(sunDot, 14.0) * 0.32;
        col += vec3(1.0, 0.96, 0.86) * smoothstep(0.9988, 0.9997, sunDot) * 1.4;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const skyMesh = new THREE.Mesh(skyGeo, skyMat);
  skyMesh.frustumCulled = false;
  group.add(skyMesh);
  disposables.push(skyGeo, skyMat);

  // 2. Sculpted Terrain Mesh with Vertex Colors (sand/shore -> scrub/pine -> granite rock -> alpine snow)
  const segments = isSoftwareGl ? 150 : 210;
  const terrainSize = WORLD_RADIUS * 2;
  const terrainGeo = new THREE.PlaneGeometry(terrainSize, terrainSize, segments, segments);
  terrainGeo.rotateX(-Math.PI / 2);

  const posAttr = terrainGeo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(posAttr.count * 3);
  const cShore = new THREE.Color(0x8e8368);
  const cForest = new THREE.Color(0x2f4938);
  const cRock = new THREE.Color(0x5b6169);
  const cSnow = new THREE.Color(0xeef3f8);
  const tmpColor = new THREE.Color();

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    const y = groundHeightAt(x, z);
    posAttr.setY(i, y);

    if (y < 4) {
      tmpColor.copy(cShore);
    } else if (y < 190) {
      const t = (y - 4) / 186;
      tmpColor.copy(cShore).lerp(cForest, Math.min(1, t * 2.2));
    } else if (y < 520) {
      const t = (y - 190) / 330;
      tmpColor.copy(cForest).lerp(cRock, t);
    } else {
      const t = Math.min(1, (y - 520) / 220);
      tmpColor.copy(cRock).lerp(cSnow, t);
    }

    // Subtle micro variation
    const v = 0.93 + hash2(Math.floor(x * 0.02), Math.floor(z * 0.02)) * 0.14;
    colors[i * 3] = tmpColor.r * v;
    colors[i * 3 + 1] = tmpColor.g * v;
    colors[i * 3 + 2] = tmpColor.b * v;
  }

  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();

  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.04,
  });
  const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
  terrainMesh.receiveShadow = true;
  group.add(terrainMesh);
  disposables.push(terrainGeo, terrainMat);

  // 3. Ocean Water Plane at y = 0
  const waterGeo = new THREE.PlaneGeometry(terrainSize * 1.4, terrainSize * 1.4, 1, 1);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMesh = new THREE.Mesh(waterGeo, mats.oceanWater);
  waterMesh.position.y = 0;
  waterMesh.receiveShadow = true;
  group.add(waterMesh);
  disposables.push(waterGeo);

  // 4. Coastal Airbase Runway (09R / 27L), Apron, Hangars & Control Tower
  const runwayGeo = new THREE.PlaneGeometry(RUNWAY_WIDTH, RUNWAY_LENGTH);
  runwayGeo.rotateX(-Math.PI / 2);
  const runwayMesh = new THREE.Mesh(runwayGeo, mats.runwayAsphalt);
  runwayMesh.position.set(RUNWAY_CENTER.x, 18.18, RUNWAY_CENTER.z);
  runwayMesh.receiveShadow = true;
  group.add(runwayMesh);
  disposables.push(runwayGeo);

  // Apron & Hangars alongside runway
  const apronGeo = new THREE.BoxGeometry(110, 0.4, 620);
  const apronMesh = new THREE.Mesh(apronGeo, mats.concreteApron);
  apronMesh.position.set(RUNWAY_CENTER.x + 125, 18.02, RUNWAY_CENTER.z);
  apronMesh.receiveShadow = true;
  group.add(apronMesh);
  disposables.push(apronGeo);

  const hangarGeo = new THREE.BoxGeometry(44, 15, 64);
  const hangarMat = new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.65, metalness: 0.3 });
  disposables.push(hangarGeo, hangarMat);
  for (let i = -1; i <= 1; i++) {
    const hangar = new THREE.Mesh(hangarGeo, hangarMat);
    hangar.position.set(RUNWAY_CENTER.x + 155, 18 + 7.5, RUNWAY_CENTER.z + i * 160);
    hangar.castShadow = true;
    hangar.receiveShadow = true;
    group.add(hangar);
  }

  // Control tower
  const towerShaftGeo = new THREE.CylinderGeometry(4.5, 6, 42, 8);
  const towerCabGeo = new THREE.CylinderGeometry(9.5, 6.5, 9, 8);
  const towerCabMat = new THREE.MeshStandardMaterial({
    color: 0x0ea5e9,
    roughness: 0.15,
    metalness: 0.75,
    emissive: 0x0369a1,
    emissiveIntensity: 0.35,
  });
  const towerShaft = new THREE.Mesh(towerShaftGeo, hangarMat);
  towerShaft.position.set(RUNWAY_CENTER.x + 145, 18 + 21, RUNWAY_CENTER.z - 280);
  towerShaft.castShadow = true;
  const towerCab = new THREE.Mesh(towerCabGeo, towerCabMat);
  towerCab.position.set(RUNWAY_CENTER.x + 145, 18 + 45, RUNWAY_CENTER.z - 280);
  group.add(towerShaft, towerCab);
  disposables.push(towerShaftGeo, towerCabGeo, towerCabMat);

  // 5. Dynamic 3D Runway Windsocks (swivel downwind & billow with wind speed)
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.45, metalness: 0.7 });
  const sockOrangeMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.65, metalness: 0.05 });
  const sockWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.65, metalness: 0.05 });
  const mastGeo = new THREE.CylinderGeometry(0.18, 0.24, 10.5, 8);
  const segGeos = [0, 1, 2, 3, 4].map((idx) => {
    const r0 = 0.68 - idx * 0.085;
    const r1 = 0.60 - idx * 0.085;
    const g = new THREE.CylinderGeometry(r1, r0, 1.05, 10, 1, true);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, 0.525);
    return g;
  });
  disposables.push(poleMat, sockOrangeMat, sockWhiteMat, mastGeo, ...segGeos);

  interface WindsockRig {
    swivel: THREE.Group;
    segments: THREE.Mesh[];
  }
  const windsocks: WindsockRig[] = [];
  for (const sockZ of [RUNWAY_CENTER.z - 920, RUNWAY_CENTER.z + 520]) {
    const base = new THREE.Group();
    base.position.set(RUNWAY_CENTER.x - 56, 18.0, sockZ);
    const mast = new THREE.Mesh(mastGeo, poleMat);
    mast.position.y = 5.25;
    mast.castShadow = true;
    base.add(mast);

    const swivel = new THREE.Group();
    swivel.position.y = 10.3;
    const segments: THREE.Mesh[] = [];
    let parentObj: THREE.Object3D = swivel;
    for (let idx = 0; idx < 5; idx++) {
      const seg = new THREE.Mesh(segGeos[idx], idx % 2 === 0 ? sockOrangeMat : sockWhiteMat);
      seg.position.z = idx === 0 ? 0.35 : 0.98;
      parentObj.add(seg);
      segments.push(seg);
      parentObj = seg;
    }
    base.add(swivel);
    group.add(base);
    windsocks.push({ swivel, segments });
  }

  // 6. Runway Threshold & 4-Box PAPI Precision Glideslope Lights (both ends)
  const papiThresholds = [
    { z: RUNWAY_CENTER.z + RUNWAY_LENGTH * 0.5 - 160, approachDirZ: 1 }, // South threshold (landing North 000°)
    { z: RUNWAY_CENTER.z - RUNWAY_LENGTH * 0.5 + 160, approachDirZ: -1 }, // North threshold (landing South 180°)
  ];
  const papiMatWhite = new THREE.MeshBasicMaterial({ color: 0xfefce8 });
  const papiMatRed = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  const papiBoxGeo = new THREE.BoxGeometry(1.8, 1.1, 1.4);
  const thrLightGeo = new THREE.BoxGeometry(1.4, 0.7, 1.4);
  const thrGreenMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });
  disposables.push(papiMatWhite, papiMatRed, papiBoxGeo, thrLightGeo, thrGreenMat);

  interface PapiBank {
    thrZ: number;
    approachDirZ: number;
    boxes: THREE.Mesh[];
  }
  const papiBanks: PapiBank[] = [];
  for (const thr of papiThresholds) {
    // Threshold green edge lights
    for (let k = -3; k <= 3; k++) {
      const l = new THREE.Mesh(thrLightGeo, thrGreenMat);
      l.position.set(RUNWAY_CENTER.x + k * 9.5, 18.6, thr.z + thr.approachDirZ * 140);
      group.add(l);
    }
    // 4-Box PAPI array to port side of runway
    const boxes: THREE.Mesh[] = [];
    for (let b = 0; b < 4; b++) {
      const box = new THREE.Mesh(papiBoxGeo, b < 2 ? papiMatWhite : papiMatRed);
      box.position.set(RUNWAY_CENTER.x - (RUNWAY_WIDTH * 0.5 + 12 + b * 6.5), 18.8, thr.z);
      group.add(box);
      boxes.push(box);
    }
    papiBanks.push({ thrZ: thr.z, approachDirZ: thr.approachDirZ, boxes });
  }

  // 7. Dynamic Multi-Altitude Volumetric Cloud Layers, Rain Streaks & Fly-Through Wisps
  const clouds = createVolumetricCloudSystem(isSoftwareGl);
  group.add(clouds.group);

  const _cClearTop = new THREE.Color(0x0b2349);
  const _cClearMid = new THREE.Color(0x3a76b8);
  const _cClearHor = new THREE.Color(0xc8deee);
  const _cStormTop = new THREE.Color(0x1b2638);
  const _cStormMid = new THREE.Color(0x41536a);
  const _cStormHor = new THREE.Color(0x7e90a4);

  return {
    group,
    skyMesh,
    waterMesh,
    clouds,
    update: (
      elapsed: number,
      dt: number,
      cameraPos: THREE.Vector3,
      aircraftPos: THREE.Vector3,
      windVecX: number,
      windVecZ: number,
      windSpeedKts: number,
      stormFactor: number,
      rainIntensity: number
    ): number => {
      skyMesh.position.copy(cameraPos);
      skyMat.uniforms.uTopColor.value.copy(_cClearTop).lerp(_cStormTop, stormFactor);
      skyMat.uniforms.uMidColor.value.copy(_cClearMid).lerp(_cStormMid, stormFactor);
      skyMat.uniforms.uHorizonColor.value.copy(_cClearHor).lerp(_cStormHor, stormFactor);

      if (mats.oceanWater.normalMap) {
        const waveScale = 0.01 + windSpeedKts * 0.0005;
        mats.oceanWater.normalMap.offset.x = (elapsed * waveScale) % 1;
        mats.oceanWater.normalMap.offset.y = (elapsed * waveScale * 0.75) % 1;
      }

      // Animate 3D runway windsocks pointing downwind & fluttering with gusts
      const windDownAngle = Math.atan2(windVecX, windVecZ);
      const extension = THREE.MathUtils.clamp(windSpeedKts / 26, 0.15, 1.0);
      const droopPitch = (1 - extension) * 0.36; // positive X rotation droops +Z tip down
      for (let w = 0; w < windsocks.length; w++) {
        const rig = windsocks[w];
        rig.swivel.rotation.y = windDownAngle + Math.sin(elapsed * 2.1 + w) * (0.04 + extension * 0.07);
        for (let s = 0; s < rig.segments.length; s++) {
          const flutter = Math.sin(elapsed * (7.5 + windSpeedKts * 0.25) - s * 0.9) * (0.035 + extension * 0.07);
          rig.segments[s].rotation.x = droopPitch * (0.45 + s * 0.14) + flutter * 0.4;
          rig.segments[s].rotation.y = flutter;
        }
      }

      // Update 4-Box PAPI glideslope beacons relative to aircraft position
      // Threshold cuts: 3.5 deg, 3.17 deg, 2.83 deg, 2.5 deg (innermost = steepest white threshold)
      const cutoffs = [2.5, 2.83, 3.17, 3.5];
      for (const bank of papiBanks) {
        const distAlong = (aircraftPos.z - bank.thrZ) * bank.approachDirZ;
        const altAboveThr = Math.max(0.5, aircraftPos.y - 18.2);
        const glideDeg = distAlong > 30 ? THREE.MathUtils.radToDeg(Math.atan2(altAboveThr, distAlong)) : 3.0;
        for (let b = 0; b < 4; b++) {
          bank.boxes[b].material = glideDeg > cutoffs[b] ? papiMatWhite : papiMatRed;
        }
      }

      return clouds.update(
        elapsed,
        dt,
        cameraPos,
        aircraftPos,
        windVecX,
        windVecZ,
        stormFactor,
        rainIntensity
      );
    },
    dispose: () => {
      clouds.dispose();
      disposables.forEach((d) => d.dispose());
    },
  };
}
