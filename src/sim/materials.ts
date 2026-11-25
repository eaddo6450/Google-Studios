import * as THREE from 'three';

export interface SimMaterialLibrary {
  playerFuselage: THREE.MeshPhysicalMaterial;
  playerRamTrim: THREE.MeshStandardMaterial;
  titaniumNozzle: THREE.MeshPhysicalMaterial;
  burnerLiner: THREE.MeshStandardMaterial;
  intakeDark: THREE.MeshStandardMaterial;
  canopyGlass: THREE.MeshPhysicalMaterial;
  cockpitMatte: THREE.MeshStandardMaterial;
  navRed: THREE.MeshBasicMaterial;
  navGreen: THREE.MeshBasicMaterial;
  navWhite: THREE.MeshBasicMaterial;
  enemyFuselage: THREE.MeshStandardMaterial;
  enemyAccent: THREE.MeshStandardMaterial;
  missileBody: THREE.MeshStandardMaterial;
  missileBand: THREE.MeshStandardMaterial;
  afterburnerCore: THREE.MeshBasicMaterial;
  afterburnerHalo: THREE.MeshBasicMaterial;
  runwayAsphalt: THREE.MeshStandardMaterial;
  concreteApron: THREE.MeshStandardMaterial;
  oceanWater: THREE.MeshPhysicalMaterial;
  createExhaustShaderMaterial: (variant?: 'jet' | 'missile') => THREE.ShaderMaterial;
  dispose: () => void;
}

function createJetPanelTexture(baseHex: string, lineHex: string, rivetHex: string, insigniaColor: string): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, size, size);

  // Subtle composite weave / brushed grain
  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const alpha = Math.random() * 0.05;
    ctx.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
    ctx.fillRect(x, y, 6 + Math.random() * 14, 1);
  }

  // Aircraft skin panel seams
  ctx.strokeStyle = lineHex;
  ctx.lineWidth = 1.5;
  const grid = [0, 64, 148, 256, 340, 448, 512];
  for (const g of grid) {
    ctx.beginPath();
    ctx.moveTo(g, 0);
    ctx.lineTo(g, size);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, g);
    ctx.lineTo(size, g);
    ctx.stroke();
  }

  // Diagonal stealth sawtooth RAM edges
  ctx.strokeStyle = rivetHex;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x <= size; x += 32) {
    ctx.lineTo(x, (x % 64 === 0 ? 18 : 30));
  }
  ctx.stroke();

  // Tactical warning stripe & squadron stencil
  ctx.fillStyle = insigniaColor;
  ctx.fillRect(28, 212, 42, 10);
  ctx.fillRect(420, 380, 56, 12);

  // Rivets along primary seams
  ctx.fillStyle = rivetHex;
  for (let x = 16; x < size; x += 24) {
    for (const y of [68, 152, 260, 344]) {
      ctx.fillRect(x, y, 2, 2);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createAircraftBumpTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);

  // Recessed panel seams & inspection hatches
  ctx.strokeStyle = '#383838';
  ctx.lineWidth = 2;
  const grid = [0, 64, 148, 256, 340, 448, 512];
  for (const g of grid) {
    ctx.beginPath();
    ctx.moveTo(g, 0);
    ctx.lineTo(g, size);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, g);
    ctx.lineTo(size, g);
    ctx.stroke();
  }

  // Avionics bay hatch boxes
  ctx.strokeRect(86, 174, 52, 64);
  ctx.strokeRect(278, 86, 52, 48);

  // Raised rivet heads along seams
  ctx.fillStyle = '#c8c8c8';
  for (let x = 16; x < size; x += 20) {
    for (const y of [69, 153, 261, 345]) {
      ctx.fillRect(x, y, 2, 2);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  // Data map stays in linear NoColorSpace
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createRunwayTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 2048;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // Dark weathered asphalt
  ctx.fillStyle = '#1f252d';
  ctx.fillRect(0, 0, w, h);

  // Asphalt aggregate noise
  for (let i = 0; i < 14000; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const v = 24 + Math.floor(Math.random() * 26);
    ctx.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Edge lines
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(22, 0, 10, h);
  ctx.fillRect(w - 32, 0, 10, h);

  // Threshold piano keys (both ends)
  for (let i = 0; i < 8; i++) {
    const x = 52 + i * 52;
    ctx.fillRect(x, 40, 26, 110);
    ctx.fillRect(x, h - 150, 26, 110);
  }

  // Runway numbers 09 / 27
  ctx.save();
  ctx.fillStyle = '#f1f5f9';
  ctx.font = 'bold 88px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('09R', w / 2, 260);
  ctx.translate(w / 2, h - 220);
  ctx.rotate(Math.PI);
  ctx.fillText('27L', 0, 0);
  ctx.restore();

  // Dashed centerline
  ctx.fillStyle = '#f8fafc';
  for (let y = 320; y < h - 320; y += 110) {
    ctx.fillRect(w / 2 - 7, y, 14, 62);
  }

  // Tire skid rubber marks near touchdown zones
  ctx.fillStyle = 'rgba(10,12,16,0.45)';
  ctx.fillRect(140, 340, 48, 240);
  ctx.fillRect(w - 188, 340, 48, 240);
  ctx.fillRect(140, h - 580, 48, 240);
  ctx.fillRect(w - 188, h - 580, 48, 240);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createWaterNormalTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const d = img.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;
      const nx = Math.sin(u * 3 + Math.cos(v * 2)) * 0.25 + Math.cos(u * 7 - v * 5) * 0.12;
      const ny = Math.cos(v * 4 + Math.sin(u * 3)) * 0.25 + Math.sin(v * 6 + u * 4) * 0.12;
      d[idx] = Math.floor((nx * 0.5 + 0.5) * 255);
      d[idx + 1] = Math.floor((ny * 0.5 + 0.5) * 255);
      d[idx + 2] = 240;
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  // Normal map stays in linear (NoColorSpace)
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(90, 90);
  return tex;
}

export function createMaterialLibrary(
  renderer: THREE.WebGLRenderer,
  isSoftwareGl: boolean
): SimMaterialLibrary {
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const playerTex = createJetPanelTexture('#5b6775', '#343c47', '#7b8794', '#d97706');
  playerTex.anisotropy = maxAniso;

  const panelBumpTex = createAircraftBumpTexture();
  panelBumpTex.anisotropy = maxAniso;

  const enemyTex = createJetPanelTexture('#3d434d', '#20242b', '#555d69', '#dc2626');
  enemyTex.anisotropy = maxAniso;

  const runwayTex = createRunwayTexture();
  runwayTex.anisotropy = maxAniso;

  const waterNormal = createWaterNormalTexture();
  waterNormal.anisotropy = maxAniso;

  const playerFuselage = new THREE.MeshPhysicalMaterial({
    map: playerTex,
    bumpMap: panelBumpTex,
    bumpScale: 0.025,
    color: 0xdbe3ec,
    roughness: 0.4,
    metalness: 0.46,
    clearcoat: 0.24,
    clearcoatRoughness: 0.34,
  });

  const playerRamTrim = new THREE.MeshStandardMaterial({
    color: 0x262d36,
    roughness: 0.72,
    metalness: 0.25,
  });

  const titaniumNozzle = new THREE.MeshPhysicalMaterial({
    color: 0x707987,
    roughness: 0.2,
    metalness: 0.94,
    anisotropy: 0.85,
    anisotropyRotation: Math.PI * 0.5,
  });

  const burnerLiner = new THREE.MeshStandardMaterial({
    color: 0x3b2c25,
    emissive: 0x7c2d12,
    emissiveIntensity: 0.25,
    roughness: 0.55,
    metalness: 0.65,
    side: THREE.DoubleSide,
  });

  const intakeDark = new THREE.MeshStandardMaterial({
    color: 0x090d14,
    roughness: 0.88,
    metalness: 0.15,
  });

  const navRed = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
  const navGreen = new THREE.MeshBasicMaterial({ color: 0x22c55e });
  const navWhite = new THREE.MeshBasicMaterial({ color: 0xf8fafc });

  const canopyGlass = new THREE.MeshPhysicalMaterial({
    color: 0xffd584,
    metalness: 0.08,
    roughness: 0.06,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    ior: 1.52,
    thickness: 0.4,
    transmission: isSoftwareGl ? 0 : 0.72,
    transparent: true,
    opacity: isSoftwareGl ? 0.48 : 0.92,
    depthWrite: false,
  });

  const cockpitMatte = new THREE.MeshStandardMaterial({
    color: 0x161a20,
    roughness: 0.85,
    metalness: 0.15,
  });

  const enemyFuselage = new THREE.MeshStandardMaterial({
    map: enemyTex,
    color: 0xd1d5db,
    roughness: 0.46,
    metalness: 0.42,
  });

  const enemyAccent = new THREE.MeshStandardMaterial({
    color: 0x991b1b,
    roughness: 0.55,
    metalness: 0.25,
  });

  const missileBody = new THREE.MeshStandardMaterial({
    color: 0xe5e7eb,
    roughness: 0.32,
    metalness: 0.35,
  });

  const missileBand = new THREE.MeshStandardMaterial({
    color: 0xeab308,
    roughness: 0.4,
    metalness: 0.2,
  });

  const afterburnerCore = new THREE.MeshBasicMaterial({
    color: 0xffedd5,
    transparent: true,
    opacity: 0.92,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const afterburnerHalo = new THREE.MeshBasicMaterial({
    color: 0xf97316,
    transparent: true,
    opacity: 0.58,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const runwayAsphalt = new THREE.MeshStandardMaterial({
    map: runwayTex,
    roughness: 0.86,
    metalness: 0.05,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const concreteApron = new THREE.MeshStandardMaterial({
    color: 0x646e78,
    roughness: 0.9,
    metalness: 0.05,
  });

  const oceanWater = new THREE.MeshPhysicalMaterial({
    color: 0x0b3b5c,
    roughness: 0.16,
    metalness: 0.12,
    clearcoat: 0.85,
    clearcoatRoughness: 0.14,
    normalMap: waterNormal,
    normalScale: new THREE.Vector2(0.45, 0.45),
  });

  const allTextures = [playerTex, panelBumpTex, enemyTex, runwayTex, waterNormal];
  const allMaterials = [
    playerFuselage,
    playerRamTrim,
    titaniumNozzle,
    burnerLiner,
    intakeDark,
    canopyGlass,
    cockpitMatte,
    navRed,
    navGreen,
    navWhite,
    enemyFuselage,
    enemyAccent,
    missileBody,
    missileBand,
    afterburnerCore,
    afterburnerHalo,
    runwayAsphalt,
    concreteApron,
    oceanWater,
  ];

  const createExhaustShaderMaterial = (variant: 'jet' | 'missile' = 'jet'): THREE.ShaderMaterial => {
    const isMissile = variant === 'missile';
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uPower: { value: isMissile ? 1.0 : 0.85 },
        uMach: { value: isMissile ? 1.8 : 0.9 },
        uCoreColor: { value: new THREE.Color(isMissile ? 0xfffbeb : 0xe0f2fe) },
        uMidColor: { value: new THREE.Color(isMissile ? 0xfbbf24 : 0x7c8cff) },
        uOuterColor: { value: new THREE.Color(isMissile ? 0xea580c : 0xf97316) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vViewDir;

        void main() {
          vUv = uv;
          vec4 mvPos;
          #ifdef USE_INSTANCING
            mvPos = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
            vNormalView = normalize(normalMatrix * mat3(instanceMatrix) * normal);
          #else
            mvPos = modelViewMatrix * vec4(position, 1.0);
            vNormalView = normalize(normalMatrix * normal);
          #endif
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uPower;
        uniform float uMach;
        uniform vec3 uCoreColor;
        uniform vec3 uMidColor;
        uniform vec3 uOuterColor;

        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vViewDir;

        void main() {
          // Axial coordinate: 0 at nozzle exit -> 1 at plume tail (Cone rotated +Z)
          float axial = clamp(1.0 - vUv.y, 0.0, 1.0);

          // Fresnel / cylindrical center density so edges dissolve softly
          float ndv = abs(dot(normalize(vNormalView), normalize(vViewDir)));
          float coreMask = pow(ndv, 1.35);

          // High-frequency turbulent combustion flutter along plume
          float turb = 0.88 + 0.12 * sin(axial * 28.0 - uTime * 54.0 + vUv.x * 12.56);

          // Standing supersonic Mach shock-diamond wavelets concentrated along core
          float shockFreq = mix(18.0, 30.0, clamp(uMach * 0.6, 0.0, 1.0));
          float shockWave = pow(max(0.0, sin(axial * shockFreq - uTime * 6.0)), 4.0);
          float shockDecay = smoothstep(0.02, 0.16, axial) * (1.0 - smoothstep(0.45, 0.96, axial));
          float diamonds = shockWave * shockDecay * pow(ndv, 1.8) * (0.45 + 0.75 * clamp(uPower, 0.0, 1.2));

          // Color gradient: hot nozzle core -> ionized shock diamonds -> amber/orange tail
          vec3 col = mix(uCoreColor, uMidColor, smoothstep(0.05, 0.42, axial));
          col = mix(col, uOuterColor, smoothstep(0.32, 0.88, axial));
          col += uCoreColor * diamonds * 1.45;

          float axialFade = smoothstep(0.0, 0.06, axial) * pow(1.0 - axial, 1.15);
          float alpha = clamp((coreMask * axialFade * 0.82 + diamonds * 0.55) * turb * uPower, 0.0, 1.0);

          if (alpha < 0.01) discard;
          gl_FragColor = vec4(col * (1.1 + diamonds * 0.8), alpha);
        }
      `,
    });
    return mat;
  };

  return {
    playerFuselage,
    playerRamTrim,
    titaniumNozzle,
    burnerLiner,
    intakeDark,
    canopyGlass,
    cockpitMatte,
    navRed,
    navGreen,
    navWhite,
    enemyFuselage,
    enemyAccent,
    missileBody,
    missileBand,
    afterburnerCore,
    afterburnerHalo,
    runwayAsphalt,
    concreteApron,
    oceanWater,
    createExhaustShaderMaterial,
    dispose: () => {
      allTextures.forEach((t) => t.dispose());
      allMaterials.forEach((m) => m.dispose());
    },
  };
}
