import * as THREE from 'three';

function hash2(ix: number, iz: number): number {
  const n = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

/**
 * Returns normalized atmospheric cloud density [0..1] for a given altitude (meters).
 * - Sea level (0–450m): Clear coastal visibility (0.12)
 * - Low Stratus Band (650–1150m): Rising broken mist (0.55)
 * - Mid Cumulus Deck (1350–2650m): Peak volumetric cloud layer (1.0)
 * - Upper Transition (2700–3900m): Thinning haze (0.15)
 * - Stratospheric Cirrus (4200–6500m): Sparse ice-crystal veil (0.28)
 */
export function cloudDensityAtAltitude(altMeters: number): number {
  if (altMeters < 450) {
    return 0.1 + 0.08 * (altMeters / 450);
  }
  if (altMeters < 1350) {
    const t = (altMeters - 450) / 900;
    return 0.18 + t * t * (3 - 2 * t) * 0.82;
  }
  if (altMeters <= 2650) {
    return 1.0;
  }
  if (altMeters < 4000) {
    const t = (altMeters - 2650) / 1350;
    return 1.0 - t * t * (3 - 2 * t) * 0.85;
  }
  if (altMeters <= 6400) {
    const mid = Math.sin(((altMeters - 4000) / 2400) * Math.PI);
    return 0.15 + mid * 0.22;
  }
  return Math.max(0.04, 0.15 - (altMeters - 6400) * 0.00004);
}

interface CloudLobe {
  baseX: number;
  baseY: number;
  baseZ: number;
  sx: number;
  sy: number;
  sz: number;
  rotY: number;
  stratum: 'stratus' | 'cumulus' | 'cirrus';
  windFactor: number;
}

interface SpeedWisp {
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  baseScale: number;
  layerAltMin: number;
  layerAltMax: number;
  rotZ: number;
}

export interface VolumetricCloudSystem {
  group: THREE.Group;
  update: (
    elapsed: number,
    dt: number,
    cameraPos: THREE.Vector3,
    aircraftPos: THREE.Vector3,
    windVecX: number,
    windVecZ: number,
    stormFactor: number,
    rainIntensity: number,
    sunDir?: THREE.Vector3,
    skyFogColor?: THREE.Color
  ) => number;
  dispose: () => void;
}

const _dummy = new THREE.Object3D();
const _cColor = new THREE.Color();

function createSoftWispTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, size, size);
  // Multi-lobed soft cloud puff alpha silhouette
  const blobs = [
    { x: 64, y: 64, r: 54, a: 0.48 },
    { x: 46, y: 68, r: 36, a: 0.34 },
    { x: 84, y: 66, r: 34, a: 0.34 },
    { x: 62, y: 46, r: 34, a: 0.36 },
  ];
  for (const b of blobs) {
    const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
    grad.addColorStop(0, `rgba(255, 255, 255, ${b.a})`);
    grad.addColorStop(0.55, `rgba(241, 246, 252, ${b.a * 0.45})`);
    grad.addColorStop(1, 'rgba(241, 246, 252, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createVolumetricCloudSystem(isSoftwareGl: boolean): VolumetricCloudSystem {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];

  // 1. Macro 3D Volumetric Cloud Strata (Stratus, Cumulus Towers, High Cirrus)
  const macroCount = isSoftwareGl ? 220 : 340;
  const puffGeo = new THREE.IcosahedronGeometry(1, 2);
  disposables.push(puffGeo);

  const volumetricMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0.55, 0.36, -0.75).normalize() },
      uFogColor: { value: new THREE.Color(0xc4dbed) },
      uFogDensity: { value: 0.000058 },
      uAltDensity: { value: 0.5 },
      uStorminess: { value: 0.0 },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vColor;
      varying float vViewDist;

      void main() {
        #ifdef USE_INSTANCING_COLOR
          vColor = instanceColor;
        #else
          vColor = vec3(1.0);
        #endif

        vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);

        vec4 mvPos = viewMatrix * worldPos;
        vViewDist = -mvPos.z;
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vColor;
      varying float vViewDist;

      uniform vec3 uSunDir;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform float uAltDensity;
      uniform float uStorminess;

      void main() {
        vec3 N = normalize(vWorldNormal);
        vec3 V = normalize(cameraPosition - vWorldPos);

        // Soft volumetric silhouette (fades gently at grazing angles so spheres read as vapor)
        float ndv = abs(dot(N, V));
        float softEdge = pow(ndv, 1.35);

        // Smooth near-camera dissipation so flying through clouds feels misty rather than clipping polygons
        float nearFade = smoothstep(28.0, 145.0, vViewDist);

        // Sunlit top vs storm-darkened anvil cloud base + forward silver-lining scattering
        float sunWrap = dot(N, uSunDir) * 0.5 + 0.5;
        float topLight = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
        float forwardScatter = pow(max(dot(-V, uSunDir), 0.0), 5.0) * (0.38 - uStorminess * 0.24);

        vec3 shadowCol = mix(vec3(0.58, 0.67, 0.78), vec3(0.24, 0.30, 0.39), uStorminess);
        vec3 litCol = mix(vec3(1.0, 0.98, 0.94), vec3(0.68, 0.75, 0.84), uStorminess * 0.75);
        vec3 baseCol = mix(shadowCol, litCol, clamp(sunWrap * 0.65 + topLight * 0.35, 0.0, 1.0));
        baseCol = baseCol * vColor + vec3(1.0, 0.95, 0.85) * forwardScatter;

        // Atmospheric perspective fog blend
        float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vViewDist * vViewDist);
        vec3 finalCol = mix(baseCol, uFogColor, clamp(fogFactor, 0.0, 1.0));

        float alpha = softEdge * nearFade * (0.42 + uAltDensity * 0.26 + uStorminess * 0.14);
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(finalCol, clamp(alpha, 0.0, 0.84));
      }
    `,
  });
  disposables.push(volumetricMat);

  const macroInstanced = new THREE.InstancedMesh(puffGeo, volumetricMat, macroCount);
  macroInstanced.frustumCulled = false;

  const lobes: CloudLobe[] = [];
  for (let i = 0; i < macroCount; i++) {
    const clusterIdx = Math.floor(i / 5);
    const angle = hash2(clusterIdx, 11) * Math.PI * 2;
    const rad = 1100 + hash2(clusterIdx, 29) * 12500;

    let stratum: CloudLobe['stratum'] = 'cumulus';
    let baseY = 1400;
    let sx = 240;
    let sy = 80;
    let sz = 210;

    const rType = hash2(clusterIdx, 47);
    if (rType < 0.24) {
      // Low coastal stratus layer (700m - 1150m)
      stratum = 'stratus';
      baseY = 720 + hash2(clusterIdx, 41) * 420 + (hash2(i, 13) - 0.5) * 65;
      sx = 340 + hash2(i, 53) * 420;
      sy = 34 + hash2(i, 61) * 42;
      sz = 280 + hash2(i, 71) * 360;
    } else if (rType < 0.84) {
      // Main volumetric cumulus deck (1380m - 2620m)
      stratum = 'cumulus';
      baseY = 1420 + hash2(clusterIdx, 41) * 1180 + (hash2(i, 13) - 0.5) * 160;
      sx = 220 + hash2(i, 53) * 360;
      sy = 85 + hash2(i, 61) * 145;
      sz = 200 + hash2(i, 71) * 320;
    } else {
      // High-altitude cirrus streaks (4300m - 6100m)
      stratum = 'cirrus';
      baseY = 4300 + hash2(clusterIdx, 41) * 1800 + (hash2(i, 13) - 0.5) * 120;
      sx = 520 + hash2(i, 53) * 650;
      sy = 24 + hash2(i, 61) * 26;
      sz = 190 + hash2(i, 71) * 240;
    }

    const baseX = Math.cos(angle) * rad + (hash2(i, 3) - 0.5) * 460;
    const baseZ = Math.sin(angle) * rad + (hash2(i, 7) - 0.5) * 460;
    const rotY = hash2(i, 23) * Math.PI * 2;

    lobes.push({
      baseX,
      baseY,
      baseZ,
      sx,
      sy,
      sz,
      rotY,
      stratum,
      windFactor: stratum === 'cirrus' ? 1.55 : stratum === 'cumulus' ? 1.0 : 0.72,
    });

    const shade = 0.9 + hash2(i, 89) * 0.1;
    _cColor.setRGB(shade, shade, shade * 0.99);
    macroInstanced.setColorAt(i, _cColor);
  }
  if (macroInstanced.instanceColor) macroInstanced.instanceColor.needsUpdate = true;
  group.add(macroInstanced);

  // 2. Local Fly-Through Speed Wisps (wrapped dynamically around aircraft XZ for intense Mach speed sensation)
  const wispCount = isSoftwareGl ? 90 : 150;
  const wispTex = createSoftWispTexture();
  const wispGeo = new THREE.PlaneGeometry(1, 1);
  const wispMat = new THREE.MeshBasicMaterial({
    map: wispTex,
    color: 0xf4f8fc,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  disposables.push(wispTex, wispGeo, wispMat);

  const wispInstanced = new THREE.InstancedMesh(wispGeo, wispMat, wispCount);
  wispInstanced.frustumCulled = false;

  const wisps: SpeedWisp[] = [];
  const WRAP_SPAN = 2600;
  const HALF_SPAN = WRAP_SPAN * 0.5;

  for (let i = 0; i < wispCount; i++) {
    const band = hash2(i, 101);
    const layerAltMin = band < 0.28 ? 620 : band < 0.88 ? 1320 : 4100;
    const layerAltMax = band < 0.28 ? 1180 : band < 0.88 ? 2750 : 6200;

    wisps.push({
      offsetX: (hash2(i, 103) - 0.5) * WRAP_SPAN,
      offsetY: layerAltMin + hash2(i, 107) * (layerAltMax - layerAltMin),
      offsetZ: (hash2(i, 109) - 0.5) * WRAP_SPAN,
      baseScale: 48 + hash2(i, 113) * 95,
      layerAltMin,
      layerAltMax,
      rotZ: hash2(i, 127) * Math.PI * 2,
    });
  }
  group.add(wispInstanced);

  // 3. Wind-Slanted Squall Rain / Mist Streaks (below cloud deck when squall/storm hits)
  const rainCount = isSoftwareGl ? 110 : 220;
  const rainGeo = new THREE.PlaneGeometry(0.11, 5.2);
  const rainMat = new THREE.MeshBasicMaterial({
    color: 0xd8e8f8,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const rainInstanced = new THREE.InstancedMesh(rainGeo, rainMat, rainCount);
  rainInstanced.frustumCulled = false;
  rainInstanced.visible = false;
  group.add(rainInstanced);
  disposables.push(rainGeo, rainMat);

  const rainOffsets: Array<{ x: number; y: number; z: number; fallOffset: number }> = [];
  const RAIN_SPAN = 140;
  const RAIN_HEIGHT = 75;
  for (let i = 0; i < rainCount; i++) {
    rainOffsets.push({
      x: (hash2(i, 211) - 0.5) * RAIN_SPAN,
      y: (hash2(i, 223) - 0.5) * RAIN_HEIGHT,
      z: (hash2(i, 227) - 0.5) * RAIN_SPAN,
      fallOffset: hash2(i, 233) * RAIN_HEIGHT,
    });
  }

  let driftAccumX = 0;
  let driftAccumZ = 0;

  const wrapAround = (val: number, span: number): number => {
    const half = span * 0.5;
    return ((((val % span) + span + half) % span) - half);
  };

  return {
    group,
    update: (
      elapsed: number,
      dt: number,
      cameraPos: THREE.Vector3,
      aircraftPos: THREE.Vector3,
      windVecX: number,
      windVecZ: number,
      stormFactor: number,
      rainIntensity: number,
      sunDir?: THREE.Vector3,
      skyFogColor?: THREE.Color
    ): number => {
      const altDensity = cloudDensityAtAltitude(aircraftPos.y);
      volumetricMat.uniforms.uAltDensity.value = altDensity;
      volumetricMat.uniforms.uStorminess.value = stormFactor;
      if (sunDir) {
        (volumetricMat.uniforms.uSunDir.value as THREE.Vector3).copy(sunDir);
      }
      if (skyFogColor) {
        (volumetricMat.uniforms.uFogColor.value as THREE.Color).copy(skyFogColor);
      } else {
        volumetricMat.uniforms.uFogColor.value.setRGB(
          THREE.MathUtils.lerp(0.77, 0.48, stormFactor),
          THREE.MathUtils.lerp(0.86, 0.56, stormFactor),
          THREE.MathUtils.lerp(0.93, 0.65, stormFactor)
        );
      }

      // Integrate continuous wind drift smoothly so wind shifts never snap cloud positions
      driftAccumX += windVecX * dt * 1.1;
      driftAccumZ += windVecZ * dt * 1.1;

      let insideCloudProximity = 0;

      // Update macro cloud clusters with true wind advection & immersion check
      for (let i = 0; i < lobes.length; i++) {
        const l = lobes[i];
        const wx = wrapAround(l.baseX + driftAccumX * l.windFactor, 28000);
        const wz = wrapAround(l.baseZ + driftAccumZ * l.windFactor, 28000);
        const altPulse = 1.0 + Math.sin(elapsed * 0.15 + i) * 0.03;

        _dummy.position.set(wx, l.baseY, wz);
        _dummy.rotation.set(0, l.rotY, 0);
        _dummy.scale.set(l.sx * altPulse, l.sy * altPulse, l.sz * altPulse);
        _dummy.updateMatrix();
        macroInstanced.setMatrixAt(i, _dummy.matrix);

        // Check if aircraft is passing inside this volumetric lobe
        const dx = (aircraftPos.x - wx) / l.sx;
        const dy = (aircraftPos.y - l.baseY) / l.sy;
        const dz = (aircraftPos.z - wz) / l.sz;
        const normDistSq = dx * dx + dy * dy + dz * dz;
        if (normDistSq < 1.35) {
          const strength = 1.0 - normDistSq / 1.35;
          if (strength > insideCloudProximity) insideCloudProximity = strength;
        }
      }
      macroInstanced.instanceMatrix.needsUpdate = true;

      // Wrap local speed wisps around aircraft XZ neighborhood & advect along wind vector
      wispMat.opacity = 0.06 + altDensity * 0.24 + insideCloudProximity * 0.14 + stormFactor * 0.08;
      if (skyFogColor) {
        wispMat.color.copy(skyFogColor).lerp(_cColor.setRGB(0.96, 0.98, 1.0), 0.52 - stormFactor * 0.25);
      } else {
        wispMat.color.setRGB(
          THREE.MathUtils.lerp(0.96, 0.72, stormFactor),
          THREE.MathUtils.lerp(0.97, 0.78, stormFactor),
          THREE.MathUtils.lerp(0.99, 0.85, stormFactor)
        );
      }

      for (let i = 0; i < wisps.length; i++) {
        const w = wisps[i];
        const wx =
          aircraftPos.x +
          ((((w.offsetX - aircraftPos.x + driftAccumX * 1.4) % WRAP_SPAN) + WRAP_SPAN + HALF_SPAN) %
            WRAP_SPAN) -
          HALF_SPAN;
        const wz =
          aircraftPos.z +
          ((((w.offsetZ - aircraftPos.z + driftAccumZ * 1.4) % WRAP_SPAN) + WRAP_SPAN + HALF_SPAN) %
            WRAP_SPAN) -
          HALF_SPAN;

        // Vertical fade when aircraft is far from this wisp's altitude stratum
        const distY = Math.abs(aircraftPos.y - w.offsetY);
        const yFade = Math.max(0, 1 - distY / 1100);
        const scale = w.baseScale * (0.35 + yFade * 0.85) * (0.55 + altDensity * 0.65);

        _dummy.position.set(wx, w.offsetY, wz);
        _dummy.lookAt(cameraPos);
        _dummy.rotateZ(w.rotZ);
        _dummy.scale.set(scale * 1.45, scale * 0.82, 1);
        _dummy.updateMatrix();
        wispInstanced.setMatrixAt(i, _dummy.matrix);
      }
      wispInstanced.instanceMatrix.needsUpdate = true;

      // Rain streaks active below cloud tops (2400m) when rainIntensity > 0.05
      const belowClouds = THREE.MathUtils.clamp(1 - (cameraPos.y - 1800) / 700, 0, 1);
      const effectiveRain = rainIntensity * belowClouds;
      if (effectiveRain > 0.05) {
        rainInstanced.visible = true;
        rainMat.opacity = effectiveRain * 0.38;

        for (let i = 0; i < rainOffsets.length; i++) {
          const r = rainOffsets[i];
          const rx = cameraPos.x + wrapAround(r.x + driftAccumX * 1.8 - cameraPos.x, RAIN_SPAN);
          const rz = cameraPos.z + wrapAround(r.z + driftAccumZ * 1.8 - cameraPos.z, RAIN_SPAN);
          const ry =
            cameraPos.y +
            wrapAround(r.y - elapsed * (28 + rainIntensity * 14) + r.fallOffset - cameraPos.y, RAIN_HEIGHT);

          _dummy.position.set(rx, ry, rz);
          _dummy.lookAt(cameraPos.x, ry, cameraPos.z);
          // Lean raindrop along true wind component perpendicular to camera view direction
          const dx = cameraPos.x - rx;
          const dz = cameraPos.z - rz;
          const invLen = 1 / Math.max(0.01, Math.hypot(dx, dz));
          const lateralWind = (windVecX * -dz + windVecZ * dx) * invLen;
          _dummy.rotateZ(THREE.MathUtils.clamp(Math.atan2(lateralWind, 24), -0.65, 0.65));
          _dummy.scale.set(1, 0.75 + effectiveRain * 0.65, 1);
          _dummy.updateMatrix();
          rainInstanced.setMatrixAt(i, _dummy.matrix);
        }
        rainInstanced.instanceMatrix.needsUpdate = true;
      } else {
        rainInstanced.visible = false;
      }

      return insideCloudProximity;
    },
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}
