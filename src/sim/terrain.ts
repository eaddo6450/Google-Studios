import * as THREE from 'three';
import { createVolumetricCloudSystem, type VolumetricCloudSystem } from './clouds';
import type { SimMaterialLibrary } from './materials';
import type { TimeOfDay } from './types';

export const WORLD_RADIUS = 16000;
export const RUNWAY_CENTER = new THREE.Vector3(0, 18.2, -400);
export const RUNWAY_LENGTH = 2400;
export const RUNWAY_WIDTH = 72;

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

export function groundHeightAt(x: number, z: number): number {
  const n1 = fbm(x * 0.00022 + 12.4, z * 0.00022 - 7.1);
  const ridge = Math.abs(fbm(x * 0.00055 - 3.2, z * 0.00055 + 9.8) - 0.5) * 2.0;

  const channelCut = Math.exp(-Math.pow((x - Math.sin(z * 0.00035) * 1400) / 2100, 2));
  let h = (n1 * 880 + (1 - ridge) * 420 - 260) * (1 - channelCut * 0.88);

  const distFromCenter = Math.hypot(x, z);
  if (distFromCenter > 9500) {
    const rim = Math.min(1, (distFromCenter - 9500) / 5500);
    h += rim * 700 * (0.6 + n1 * 0.6);
  }

  const dxBase = Math.abs(x - RUNWAY_CENTER.x);
  const dzBase = Math.abs(z - RUNWAY_CENTER.z);
  const baseMaskX = Math.max(0, 1 - Math.max(0, dxBase - 260) / 480);
  const baseMaskZ = Math.max(0, 1 - Math.max(0, dzBase - 1400) / 600);
  const baseBlend = Math.min(1, baseMaskX * baseMaskZ);
  const smoothBase = baseBlend * baseBlend * (3 - 2 * baseBlend);

  h = h * (1 - smoothBase) + 18.0 * smoothBase;
  return h;
}

export interface TimeOfDayAtmosphere {
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  hemiIntensity: number;
  topColor: THREE.Color;
  midColor: THREE.Color;
  horColor: THREE.Color;
  starIntensity: number;
  twilightTint: THREE.Color;
}

const TOD_PRESETS: Record<TimeOfDay, TimeOfDayAtmosphere> = {
  dawn: {
    sunDir: new THREE.Vector3(0.84, 0.15, -0.52).normalize(),
    sunColor: new THREE.Color(0xffb478),
    sunIntensity: 1.85,
    hemiIntensity: 0.72,
    topColor: new THREE.Color(0x0f2042),
    midColor: new THREE.Color(0x4b5d8a),
    horColor: new THREE.Color(0xe89b72),
    starIntensity: 0.25,
    twilightTint: new THREE.Color(0xf97316),
  },
  day: {
    sunDir: new THREE.Vector3(0.55, 0.42, -0.72).normalize(),
    sunColor: new THREE.Color(0xfff1d6),
    sunIntensity: 2.3,
    hemiIntensity: 0.85,
    topColor: new THREE.Color(0x0b2349),
    midColor: new THREE.Color(0x3a76b8),
    horColor: new THREE.Color(0xc8deee),
    starIntensity: 0.0,
    twilightTint: new THREE.Color(0xffe4b8),
  },
  dusk: {
    sunDir: new THREE.Vector3(-0.82, 0.12, -0.56).normalize(),
    sunColor: new THREE.Color(0xff7e47),
    sunIntensity: 1.6,
    hemiIntensity: 0.58,
    topColor: new THREE.Color(0x091229),
    midColor: new THREE.Color(0x3b3869),
    horColor: new THREE.Color(0xd96b52),
    starIntensity: 0.48,
    twilightTint: new THREE.Color(0xf43f5e),
  },
  night: {
    sunDir: new THREE.Vector3(-0.35, 0.52, -0.78).normalize(),
    sunColor: new THREE.Color(0x8bb8ff),
    sunIntensity: 0.78,
    hemiIntensity: 0.42,
    topColor: new THREE.Color(0x02050d),
    midColor: new THREE.Color(0x091529),
    horColor: new THREE.Color(0x162944),
    starIntensity: 1.0,
    twilightTint: new THREE.Color(0x38bdf8),
  },
};

export function getTimeOfDayPreset(tod: TimeOfDay): TimeOfDayAtmosphere {
  return TOD_PRESETS[tod] ?? TOD_PRESETS.day;
}

export interface WorldEnvironment {
  group: THREE.Group;
  skyMesh: THREE.Mesh;
  waterMesh: THREE.Mesh;
  clouds: VolumetricCloudSystem;
  getHorizonFogColor: (out: THREE.Color) => THREE.Color;
  getSunDirection: (out: THREE.Vector3) => THREE.Vector3;
  update: (
    elapsed: number,
    dt: number,
    cameraPos: THREE.Vector3,
    aircraftPos: THREE.Vector3,
    windVecX: number,
    windVecZ: number,
    windSpeedKts: number,
    stormFactor: number,
    rainIntensity: number,
    timeOfDay?: TimeOfDay
  ) => number;
  dispose: () => void;
}

function buildTerrainGeometry(size: number, segments: number): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);

  const posAttr = geo.attributes.position as THREE.BufferAttribute;
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

    const v = 0.93 + hash2(Math.floor(x * 0.02), Math.floor(z * 0.02)) * 0.14;
    colors[i * 3] = tmpColor.r * v;
    colors[i * 3 + 1] = tmpColor.g * v;
    colors[i * 3 + 2] = tmpColor.b * v;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

export function createWorldEnvironment(
  mats: SimMaterialLibrary,
  isSoftwareGl: boolean
): WorldEnvironment {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];

  // 1. Dynamic Sky Dome Shader (Dawn/Day/Dusk/Night Rayleigh + Starfield + Sun/Moon Halo)
  const skyGeo = new THREE.SphereGeometry(28000, 32, 20);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uSunDir: { value: TOD_PRESETS.day.sunDir.clone() },
      uTopColor: { value: TOD_PRESETS.day.topColor.clone() },
      uMidColor: { value: TOD_PRESETS.day.midColor.clone() },
      uHorizonColor: { value: TOD_PRESETS.day.horColor.clone() },
      uTwilightColor: { value: TOD_PRESETS.day.twilightTint.clone() },
      uStarIntensity: { value: 0.0 },
      uTime: { value: 0.0 },
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
      uniform vec3 uTwilightColor;
      uniform float uStarIntensity;
      uniform float uTime;

      float starHash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      void main() {
        vec3 dir = normalize(vWorldDir);
        float h = clamp(dir.y, 0.0, 1.0);
        vec3 col = mix(uHorizonColor, uMidColor, pow(h, 0.45));
        col = mix(col, uTopColor, smoothstep(0.18, 0.85, h));

        // Sun/Moon halo & disk
        float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
        col += uTwilightColor * pow(sunDot, 10.0) * 0.34;
        col += mix(vec3(1.0, 0.96, 0.86), uTwilightColor, 0.25) * smoothstep(0.9988, 0.9997, sunDot) * 1.35;

        // Crisp upper-hemisphere starfield during Dusk & Night
        if (uStarIntensity > 0.02 && dir.y > 0.03) {
          vec3 grid = floor(dir * 260.0);
          float rnd = starHash(grid);
          if (rnd > 0.993) {
            float twinkle = 0.65 + 0.35 * sin(uTime * 2.5 + rnd * 120.0);
            float mask = smoothstep(0.03, 0.35, dir.y) * uStarIntensity;
            col += vec3(0.85, 0.92, 1.0) * twinkle * mask * 0.95;
          }
        }

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const skyMesh = new THREE.Mesh(skyGeo, skyMat);
  skyMesh.frustumCulled = false;
  group.add(skyMesh);
  disposables.push(skyGeo, skyMat);

  // 2. THREE.LOD Terrain Mesh (High-res close theater + Low-poly far fallback)
  const terrainSize = WORLD_RADIUS * 2;
  const hiSegs = isSoftwareGl ? 130 : 190;
  const loSegs = 64;
  const terrainGeoHi = buildTerrainGeometry(terrainSize, hiSegs);
  const terrainGeoLo = buildTerrainGeometry(terrainSize, loSegs);
  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.04,
  });

  const terrainLod = new THREE.LOD();
  const terrainHiMesh = new THREE.Mesh(terrainGeoHi, terrainMat);
  terrainHiMesh.receiveShadow = true;
  const terrainLoMesh = new THREE.Mesh(terrainGeoLo, terrainMat);
  terrainLoMesh.receiveShadow = true;
  terrainLod.addLevel(terrainHiMesh, 0);
  terrainLod.addLevel(terrainLoMesh, 9500);
  group.add(terrainLod);
  disposables.push(terrainGeoHi, terrainGeoLo, terrainMat);

  // 3. Ocean Water Plane at y = 0
  const waterGeo = new THREE.PlaneGeometry(terrainSize * 1.4, terrainSize * 1.4, 1, 1);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMesh = new THREE.Mesh(waterGeo, mats.oceanWater);
  waterMesh.position.y = 0;
  waterMesh.receiveShadow = true;
  group.add(waterMesh);
  disposables.push(waterGeo);

  // 4. GPU InstancedMesh Coastal Alpine Pines & Foliage (single draw call!)
  const treeCount = isSoftwareGl ? 180 : 420;
  const treeGeo = new THREE.ConeGeometry(4.2, 19, 6);
  treeGeo.translate(0, 9.5, 0);
  const treeMat = new THREE.MeshStandardMaterial({
    color: 0x264430,
    roughness: 0.88,
    metalness: 0.02,
  });
  const treeInstanced = new THREE.InstancedMesh(treeGeo, treeMat, treeCount);
  treeInstanced.receiveShadow = true;
  const dummy = new THREE.Object3D();
  let placedTrees = 0;
  for (let i = 0; i < treeCount * 4 && placedTrees < treeCount; i++) {
    const px = (hash2(i, 17) - 0.5) * 16000;
    const pz = (hash2(i, 31) - 0.5) * 16000;
    // Keep well clear of runway plateau
    if (Math.abs(px - RUNWAY_CENTER.x) < 620 && Math.abs(pz - RUNWAY_CENTER.z) < 1850) continue;
    const py = groundHeightAt(px, pz);
    if (py < 8 || py > 290) continue;

    const s = 0.75 + hash2(i, 53) * 0.95;
    dummy.position.set(px, py - 0.4, pz);
    dummy.rotation.set(0, hash2(i, 71) * Math.PI * 2, 0);
    dummy.scale.set(s, s * (0.9 + hash2(i, 83) * 0.45), s);
    dummy.updateMatrix();
    treeInstanced.setMatrixAt(placedTrees++, dummy.matrix);
  }
  treeInstanced.count = placedTrees;
  treeInstanced.instanceMatrix.needsUpdate = true;
  group.add(treeInstanced);
  disposables.push(treeGeo, treeMat);

  // 5. Coastal Airbase Runway (09R / 27L), Apron, LOD Hangars & Control Tower
  const runwayGeo = new THREE.PlaneGeometry(RUNWAY_WIDTH, RUNWAY_LENGTH);
  runwayGeo.rotateX(-Math.PI / 2);
  const runwayMesh = new THREE.Mesh(runwayGeo, mats.runwayAsphalt);
  runwayMesh.position.set(RUNWAY_CENTER.x, 18.18, RUNWAY_CENTER.z);
  runwayMesh.receiveShadow = true;
  group.add(runwayMesh);
  disposables.push(runwayGeo);

  const apronGeo = new THREE.BoxGeometry(110, 0.4, 620);
  const apronMesh = new THREE.Mesh(apronGeo, mats.concreteApron);
  apronMesh.position.set(RUNWAY_CENTER.x + 125, 18.02, RUNWAY_CENTER.z);
  apronMesh.receiveShadow = true;
  group.add(apronMesh);
  disposables.push(apronGeo);

  const hangarHiGeo = new THREE.BoxGeometry(44, 15, 64);
  const hangarRoofGeo = new THREE.CylinderGeometry(22, 22, 64, 10, 1, false, 0, Math.PI);
  hangarRoofGeo.rotateZ(Math.PI / 2);
  hangarRoofGeo.rotateY(Math.PI / 2);
  const hangarMat = new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.65, metalness: 0.3 });
  const hangarLoGeo = new THREE.BoxGeometry(44, 18, 64);
  disposables.push(hangarHiGeo, hangarRoofGeo, hangarLoGeo, hangarMat);

  for (let i = -1; i <= 1; i++) {
    const lod = new THREE.LOD();
    const hiG = new THREE.Group();
    const base = new THREE.Mesh(hangarHiGeo, hangarMat);
    base.castShadow = true;
    base.receiveShadow = true;
    const roof = new THREE.Mesh(hangarRoofGeo, hangarMat);
    roof.position.y = 7.5;
    hiG.add(base, roof);

    const loMesh = new THREE.Mesh(hangarLoGeo, hangarMat);
    lod.addLevel(hiG, 0);
    lod.addLevel(loMesh, 2200);
    lod.position.set(RUNWAY_CENTER.x + 155, 18 + 7.5, RUNWAY_CENTER.z + i * 160);
    group.add(lod);
  }

  // Control tower
  const towerShaftGeo = new THREE.CylinderGeometry(4.5, 6, 42, 8);
  const towerCabGeo = new THREE.CylinderGeometry(9.5, 6.5, 9, 8);
  const towerCabMat = new THREE.MeshStandardMaterial({
    color: 0x0ea5e9,
    roughness: 0.15,
    metalness: 0.75,
    emissive: 0x0369a1,
    emissiveIntensity: 0.45,
  });
  const towerShaft = new THREE.Mesh(towerShaftGeo, hangarMat);
  towerShaft.position.set(RUNWAY_CENTER.x + 145, 18 + 21, RUNWAY_CENTER.z - 280);
  towerShaft.castShadow = true;
  const towerCab = new THREE.Mesh(towerCabGeo, towerCabMat);
  towerCab.position.set(RUNWAY_CENTER.x + 145, 18 + 45, RUNWAY_CENTER.z - 280);
  group.add(towerShaft, towerCab);
  disposables.push(towerShaftGeo, towerCabGeo, towerCabMat);

  // Instanced Runway Edge Beacons (amber/white lights visible strongly at dusk/night)
  const edgeLightCount = 32;
  const edgeLightGeo = new THREE.BoxGeometry(0.9, 0.55, 0.9);
  const edgeLightMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
  const edgeLights = new THREE.InstancedMesh(edgeLightGeo, edgeLightMat, edgeLightCount);
  let elIdx = 0;
  for (let side of [-1, 1]) {
    for (let k = 0; k < 16; k++) {
      const lz = RUNWAY_CENTER.z - RUNWAY_LENGTH * 0.46 + (k / 15) * (RUNWAY_LENGTH * 0.92);
      dummy.position.set(RUNWAY_CENTER.x + side * (RUNWAY_WIDTH * 0.5 + 1.5), 18.4, lz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      edgeLights.setMatrixAt(elIdx++, dummy.matrix);
    }
  }
  edgeLights.instanceMatrix.needsUpdate = true;
  group.add(edgeLights);
  disposables.push(edgeLightGeo, edgeLightMat);

  // 6. Dynamic 3D Runway Windsocks
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

  // 7. Runway Threshold & 4-Box PAPI Precision Glideslope Lights
  const papiThresholds = [
    { z: RUNWAY_CENTER.z + RUNWAY_LENGTH * 0.5 - 160, approachDirZ: 1 },
    { z: RUNWAY_CENTER.z - RUNWAY_LENGTH * 0.5 + 160, approachDirZ: -1 },
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
    for (let k = -3; k <= 3; k++) {
      const l = new THREE.Mesh(thrLightGeo, thrGreenMat);
      l.position.set(RUNWAY_CENTER.x + k * 9.5, 18.6, thr.z + thr.approachDirZ * 140);
      group.add(l);
    }
    const boxes: THREE.Mesh[] = [];
    for (let b = 0; b < 4; b++) {
      const box = new THREE.Mesh(papiBoxGeo, b < 2 ? papiMatWhite : papiMatRed);
      box.position.set(RUNWAY_CENTER.x - (RUNWAY_WIDTH * 0.5 + 12 + b * 6.5), 18.8, thr.z);
      group.add(box);
      boxes.push(box);
    }
    papiBanks.push({ thrZ: thr.z, approachDirZ: thr.approachDirZ, boxes });
  }

  // 8. Dynamic Multi-Altitude Volumetric Cloud Layers & Rain
  const clouds = createVolumetricCloudSystem(isSoftwareGl);
  group.add(clouds.group);

  const _cStormTop = new THREE.Color(0x1b2638);
  const _cStormMid = new THREE.Color(0x41536a);
  const _cStormHor = new THREE.Color(0x7e90a4);
  const _curTop = TOD_PRESETS.day.topColor.clone();
  const _curMid = TOD_PRESETS.day.midColor.clone();
  const _curHor = TOD_PRESETS.day.horColor.clone();
  const _curTwilight = TOD_PRESETS.day.twilightTint.clone();
  const _curSunDir = TOD_PRESETS.day.sunDir.clone();

  return {
    group,
    skyMesh,
    waterMesh,
    clouds,
    getHorizonFogColor: (out: THREE.Color) => out.copy(skyMat.uniforms.uHorizonColor.value as THREE.Color),
    getSunDirection: (out: THREE.Vector3) => out.copy(_curSunDir),
    update: (
      elapsed: number,
      dt: number,
      cameraPos: THREE.Vector3,
      aircraftPos: THREE.Vector3,
      windVecX: number,
      windVecZ: number,
      windSpeedKts: number,
      stormFactor: number,
      rainIntensity: number,
      timeOfDay: TimeOfDay = 'day'
    ): number => {
      const tod = TOD_PRESETS[timeOfDay] ?? TOD_PRESETS.day;
      const lerpAlpha = Math.min(1, dt * 1.4);

      _curSunDir.lerp(tod.sunDir, lerpAlpha).normalize();
      _curTop.lerp(tod.topColor, lerpAlpha);
      _curMid.lerp(tod.midColor, lerpAlpha);
      _curHor.lerp(tod.horColor, lerpAlpha);
      _curTwilight.lerp(tod.twilightTint, lerpAlpha);

      skyMesh.position.copy(cameraPos);
      (skyMat.uniforms.uSunDir.value as THREE.Vector3).copy(_curSunDir);
      skyMat.uniforms.uTopColor.value.copy(_curTop).lerp(_cStormTop, stormFactor * 0.72);
      skyMat.uniforms.uMidColor.value.copy(_curMid).lerp(_cStormMid, stormFactor * 0.72);
      skyMat.uniforms.uHorizonColor.value.copy(_curHor).lerp(_cStormHor, stormFactor * 0.72);
      skyMat.uniforms.uTwilightColor.value.copy(_curTwilight);
      skyMat.uniforms.uStarIntensity.value = THREE.MathUtils.lerp(
        skyMat.uniforms.uStarIntensity.value,
        tod.starIntensity * (1 - stormFactor * 0.8),
        lerpAlpha
      );
      skyMat.uniforms.uTime.value = elapsed;

      if (mats.oceanWater.normalMap) {
        const waveScale = 0.01 + windSpeedKts * 0.0005;
        mats.oceanWater.normalMap.offset.x = (elapsed * waveScale) % 1;
        mats.oceanWater.normalMap.offset.y = (elapsed * waveScale * 0.75) % 1;
      }

      const windDownAngle = Math.atan2(windVecX, windVecZ);
      const extension = THREE.MathUtils.clamp(windSpeedKts / 26, 0.15, 1.0);
      const droopPitch = (1 - extension) * 0.36;
      for (let w = 0; w < windsocks.length; w++) {
        const rig = windsocks[w];
        rig.swivel.rotation.y = windDownAngle + Math.sin(elapsed * 2.1 + w) * (0.04 + extension * 0.07);
        for (let s = 0; s < rig.segments.length; s++) {
          const flutter = Math.sin(elapsed * (7.5 + windSpeedKts * 0.25) - s * 0.9) * (0.035 + extension * 0.07);
          rig.segments[s].rotation.x = droopPitch * (0.45 + s * 0.14) + flutter * 0.4;
          rig.segments[s].rotation.y = flutter;
        }
      }

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
        rainIntensity,
        _curSunDir,
        skyMat.uniforms.uHorizonColor.value as THREE.Color
      );
    },
    dispose: () => {
      clouds.dispose();
      disposables.forEach((d) => d.dispose());
    },
  };
}
