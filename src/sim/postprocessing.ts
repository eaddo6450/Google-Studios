import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export interface PostProcessUpdateParams {
  dt: number;
  mach: number;
  afterburner: boolean;
  angPitchRate: number;
  angYawRate: number;
  angRollRate: number;
  cameraShake: number;
  isCockpit: boolean;
  isTitle: boolean;
  isPaused: boolean;
  centerX?: number;
  centerY?: number;
}

export interface PostProcessingPipeline {
  update: (params: PostProcessUpdateParams) => void;
  render: () => void;
  resize: (width: number, height: number) => void;
  dispose: () => void;
}

const HighSpeedMotionBlurShader = {
  name: 'HighSpeedMotionBlurShader',
  uniforms: {
    tDiffuse: { value: null },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uRadialStrength: { value: 0.0 },
    uCenterDeadzone: { value: 0.24 },
    uAngularOffset: { value: new THREE.Vector2(0.0, 0.0) },
    uChromaAmount: { value: 0.0 },
    uAspect: { value: 1.7778 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uCenter;
    uniform float uRadialStrength;
    uniform float uCenterDeadzone;
    uniform vec2 uAngularOffset;
    uniform float uChromaAmount;
    uniform float uAspect;
    varying vec2 vUv;

    void main() {
      vec2 toEdge = vUv - uCenter;
      vec2 aspectCorrected = vec2(toEdge.x * uAspect, toEdge.y);
      float dist = length(aspectCorrected);

      // Keep central gun boresight, HUD, and cockpit gauges razor-sharp
      float edgeMask = smoothstep(uCenterDeadzone, 0.98, dist);
      vec2 radialDir = dist > 0.0001 ? (toEdge / dist) : vec2(0.0);

      vec2 blurVec = radialDir * (uRadialStrength * edgeMask) + uAngularOffset * (0.35 + 0.65 * edgeMask);
      float blurLen = length(blurVec);

      // Clamp max UV excursion to avoid edge smearing artifacts
      if (blurLen > 0.026) {
        blurVec *= (0.026 / blurLen);
        blurLen = 0.026;
      }

      if (blurLen < 0.00035 && uChromaAmount < 0.0002) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }

      // 9-tap centered directional/radial kernel with triangular weights
      vec4 accum = vec4(0.0);
      float weightSum = 0.0;
      const int TAPS = 9;
      for (int i = 0; i < TAPS; i++) {
        float t = (float(i) / float(TAPS - 1)) - 0.5; // -0.5 .. +0.5
        float w = 1.0 - abs(t) * 1.15;
        vec2 sampleUv = clamp(vUv - blurVec * t * 1.6, vec2(0.001), vec2(0.999));
        accum += texture2D(tDiffuse, sampleUv) * w;
        weightSum += w;
      }
      vec4 blurred = accum / weightSum;

      // Subtle peripheral supersonic chromatic fringe
      if (uChromaAmount > 0.0002 && edgeMask > 0.01) {
        vec2 chromaShift = radialDir * (uChromaAmount * edgeMask);
        float r = texture2D(tDiffuse, clamp(vUv + chromaShift, vec2(0.001), vec2(0.999))).r;
        float b = texture2D(tDiffuse, clamp(vUv - chromaShift, vec2(0.001), vec2(0.999))).b;
        blurred.r = mix(blurred.r, r, 0.35);
        blurred.b = mix(blurred.b, b, 0.35);
      }

      gl_FragColor = blurred;
    }
  `,
};

export function createPostProcessingPipeline(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera
): PostProcessingPipeline {
  const size = new THREE.Vector2();
  renderer.getSize(size);
  const w = Math.max(1, size.x);
  const h = Math.max(1, size.y);

  const maxSamples = typeof renderer.capabilities.maxSamples === 'number' ? renderer.capabilities.maxSamples : 0;
  const renderTarget = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    samples: Math.min(4, maxSamples),
  });

  const composer = new EffectComposer(renderer, renderTarget);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // High threshold preserves crisp daylight sky/clouds while glowing afterburners, explosions & flares
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.3, 0.44, 0.94);
  composer.addPass(bloomPass);

  const motionBlurPass = new ShaderPass(HighSpeedMotionBlurShader);
  motionBlurPass.uniforms.uAspect.value = w / h;
  composer.addPass(motionBlurPass);

  // Applies ACESFilmicToneMapping + SRGBColorSpace at the end of the pipeline
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  let dampedRadial = 0;
  let dampedAngX = 0;
  let dampedAngY = 0;
  let dampedBloom = 0.28;
  let dampedChroma = 0;
  let dampedCenterX = 0.5;
  let dampedCenterY = 0.5;

  const update = (p: PostProcessUpdateParams) => {
    const dt = Math.max(0.001, Math.min(p.dt, 0.05));

    // Mach speed factor ramps up cleanly from subsonic cruise into supersonic dash
    const speedFactor = THREE.MathUtils.clamp((p.mach - 0.58) / 1.15, 0, 1);
    const abFactor = p.afterburner ? 1 : 0;
    const shakeBoost = THREE.MathUtils.clamp(p.cameraShake * 0.45, 0, 1);

    let targetRadial = (speedFactor * 0.015 + abFactor * 0.0045 + shakeBoost * 0.006);
    if (p.isCockpit) {
      targetRadial *= 0.65; // keep canopy instruments & HUD comfortable
    }
    if (p.isTitle) {
      targetRadial = 0.0025; // subtle cinematic flyby polish
    }
    if (p.isPaused) {
      targetRadial = 0;
    }

    const targetAngX = p.isPaused || p.isTitle
      ? 0
      : THREE.MathUtils.clamp(-p.angYawRate * 0.0048 - p.angRollRate * 0.0012, -0.012, 0.012);
    const targetAngY = p.isPaused || p.isTitle
      ? 0
      : THREE.MathUtils.clamp(p.angPitchRate * 0.0048, -0.012, 0.012);

    const targetBloom = p.isPaused
      ? 0.24
      : 0.28 + abFactor * 0.14 + speedFactor * 0.08 + shakeBoost * 0.16;

    const targetChroma = p.isPaused || p.isTitle
      ? 0
      : THREE.MathUtils.clamp((p.mach - 0.92) * 0.0024 + abFactor * 0.0008 + shakeBoost * 0.0012, 0, 0.0032);

    const targetCx = typeof p.centerX === 'number' ? THREE.MathUtils.clamp(p.centerX, 0.25, 0.75) : 0.5;
    const targetCy = typeof p.centerY === 'number' ? THREE.MathUtils.clamp(p.centerY, 0.25, 0.75) : 0.5;

    dampedRadial = THREE.MathUtils.damp(dampedRadial, targetRadial, 8, dt);
    dampedAngX = THREE.MathUtils.damp(dampedAngX, targetAngX, 11, dt);
    dampedAngY = THREE.MathUtils.damp(dampedAngY, targetAngY, 11, dt);
    dampedBloom = THREE.MathUtils.damp(dampedBloom, targetBloom, 9, dt);
    dampedChroma = THREE.MathUtils.damp(dampedChroma, targetChroma, 8, dt);
    dampedCenterX = THREE.MathUtils.damp(dampedCenterX, targetCx, 8, dt);
    dampedCenterY = THREE.MathUtils.damp(dampedCenterY, targetCy, 8, dt);

    bloomPass.strength = dampedBloom;

    const u = motionBlurPass.uniforms;
    u.uRadialStrength.value = dampedRadial;
    u.uCenterDeadzone.value = p.isCockpit ? 0.36 : 0.22;
    (u.uAngularOffset.value as THREE.Vector2).set(dampedAngX, dampedAngY);
    (u.uCenter.value as THREE.Vector2).set(dampedCenterX, dampedCenterY);
    u.uChromaAmount.value = dampedChroma;
  };

  const render = () => {
    composer.render();
  };

  const resize = (width: number, height: number) => {
    const rw = Math.max(1, width);
    const rh = Math.max(1, height);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(rw, rh);
    bloomPass.resolution.set(rw, rh);
    motionBlurPass.uniforms.uAspect.value = rw / rh;
  };

  const dispose = () => {
    renderPass.dispose();
    bloomPass.dispose();
    motionBlurPass.dispose();
    outputPass.dispose();
    composer.dispose();
    renderTarget.dispose();
  };

  return {
    update,
    render,
    resize,
    dispose,
  };
}
