import * as THREE from 'three';
import type { SimMaterialLibrary } from './materials';

export interface CockpitUpdateParams {
  aircraftCode: string;
  twinEngine: boolean;
  pitchInput: number;
  rollInput: number;
  yawInput: number;
  throttle01: number;
  afterburner: boolean;
  mach: number;
  iasKts: number;
  altitudeFt: number;
  pitchDeg: number;
  rollDeg: number;
  aoaDeg: number;
  gForce: number;
  hullPct: number;
  gunAmmo: number;
  irMissilesLeft: number;
  radarMissilesLeft: number;
  flares: number;
  stallWarning: boolean;
  missileWarning: boolean;
  isCockpitCam: boolean;
  gearDown: boolean;
  windFromDeg: number;
  windSpeedKts: number;
  weatherRegime: string;
  dt: number;
}

export interface FighterCockpitRig {
  group: THREE.Group;
  canopyMesh: THREE.Mesh;
  update: (params: CockpitUpdateParams) => void;
  dispose: () => void;
}

function createConsoleTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#12171f';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#2d3748';
  ctx.lineWidth = 3;
  for (let y = 36; y < h; y += 84) {
    ctx.strokeRect(10, y, w - 20, 74);
  }

  for (let row = 0; row < 5; row++) {
    const baseY = 50 + row * 84;
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(22, baseY, 48, 5);
    ctx.fillRect(22, baseY + 10, 72, 4);

    for (let k = 0; k < 3; k++) {
      const kx = 148 + k * 36;
      const ky = baseY + 26;
      ctx.fillStyle = '#262f3d';
      ctx.beginPath();
      ctx.arc(kx, ky, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(kx, ky);
      ctx.lineTo(kx + (k - 1) * 6, ky - 8);
      ctx.stroke();
    }

    for (let s = 0; s < 4; s++) {
      ctx.fillStyle = s === 2 && row === 1 ? '#f59e0b' : '#475569';
      ctx.fillRect(24 + s * 22, baseY + 34, 10, 18);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createUfcTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#141a22';
  ctx.fillRect(0, 0, w, h);

  // Numeric keypad 1..9, 0
  ctx.fillStyle = '#1f2937';
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 1.5;
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'center';
  const labels = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLR', '0', 'ENT'];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 3; c++) {
      const bx = 18 + c * 36;
      const by = 14 + r * 26;
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(bx, by, 30, 20);
      ctx.strokeRect(bx, by, 30, 20);
      ctx.fillStyle = '#34d399';
      ctx.fillText(labels[r * 3 + c], bx + 15, by + 15);
    }
  }

  // Right scratchpad LCD strips
  ctx.fillStyle = '#05140d';
  ctx.fillRect(136, 14, 104, 98);
  ctx.strokeStyle = '#166534';
  ctx.strokeRect(136, 14, 104, 98);
  ctx.fillStyle = '#4ade80';
  ctx.textAlign = 'left';
  ctx.font = 'bold 13px monospace';
  ctx.fillText('COM1 251.0', 144, 34);
  ctx.fillText('COM2 127.4', 144, 56);
  ctx.fillText('TAC  048X', 144, 78);
  ctx.fillText('IFF  M4 ON', 144, 100);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createEjectionStripeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#facc15';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#111827';
  for (let i = -64; i < 128; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 8, 0);
    ctx.lineTo(i + 40, 64);
    ctx.lineTo(i + 32, 64);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createFighterCockpit(
  mats: SimMaterialLibrary,
  customCanopyMat?: THREE.Material
): FighterCockpitRig {
  const group = new THREE.Group();
  // Cockpit origin sits inside recessed forward fuselage spine
  group.position.set(0, 0.72, -3.95);

  const disposables: Array<{ dispose: () => void }> = [];
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    disposables.push(m);
    return m;
  };

  // Materials calibrated for cockpit interior
  const darkPanelMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x1a212b,
      roughness: 0.76,
      metalness: 0.28,
    })
  );
  const bezelMetalMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x2d3644,
      roughness: 0.4,
      metalness: 0.75,
    })
  );
  const consoleTex = createConsoleTexture();
  disposables.push(consoleTex);
  const consoleMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: consoleTex,
      roughness: 0.65,
      metalness: 0.2,
      emissive: 0x0b2919,
      emissiveMap: consoleTex,
      emissiveIntensity: 0.68,
    })
  );

  const ufcTex = createUfcTexture();
  disposables.push(ufcTex);
  const ufcScreenMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: ufcTex,
      roughness: 0.5,
      metalness: 0.15,
      emissive: 0x10b981,
      emissiveMap: ufcTex,
      emissiveIntensity: 0.42,
    })
  );

  // 1. Cockpit Tub Floor, Bulkheads, Pedals & Side Consoles
  const floor = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.9, 0.08, 2.35)), darkPanelMat);
  floor.position.set(0, -0.32, 0.12);
  group.add(floor);

  const wallL = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.08, 0.58, 2.35)), mats.playerRamTrim);
  wallL.position.set(-0.48, -0.03, 0.12);
  wallL.rotation.z = -0.14;
  const wallR = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.08, 0.58, 2.35)), mats.playerRamTrim);
  wallR.position.set(0.48, -0.03, 0.12);
  wallR.rotation.z = 0.14;
  group.add(wallL, wallR);

  // Rear Cockpit Firewall Bulkhead
  const rearBulkhead = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.96, 0.62, 0.1)), darkPanelMat);
  rearBulkhead.position.set(0, 0.04, 0.88);
  group.add(rearBulkhead);

  // Rudder Pedals (articulated with yaw input)
  const pedalGeo = trackGeo(new THREE.BoxGeometry(0.11, 0.12, 0.03));
  const pedalL = new THREE.Mesh(pedalGeo, bezelMetalMat);
  pedalL.position.set(-0.14, -0.22, -0.66);
  pedalL.rotation.x = -0.35;
  const pedalR = new THREE.Mesh(pedalGeo, bezelMetalMat);
  pedalR.position.set(0.14, -0.22, -0.66);
  pedalR.rotation.x = -0.35;
  group.add(pedalL, pedalR);

  // Left & Right Avionics Side Consoles
  const consoleGeo = trackGeo(new THREE.BoxGeometry(0.24, 0.19, 1.55));
  const consoleL = new THREE.Mesh(consoleGeo, consoleMat);
  consoleL.position.set(-0.35, -0.13, 0.08);
  consoleL.rotation.z = -0.24;
  const consoleR = new THREE.Mesh(consoleGeo, consoleMat);
  consoleR.position.set(0.35, -0.13, 0.08);
  consoleR.rotation.z = 0.24;
  group.add(consoleL, consoleR);

  // 2. Main Instrument Panel (angled UPWARD toward pilot eyes via negative rotation.x), Glare Shield & UFC
  const mainPanel = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.86, 0.44, 0.14)), darkPanelMat);
  mainPanel.position.set(0, 0.01, -0.78);
  mainPanel.rotation.x = -0.18;
  group.add(mainPanel);

  // Sculpted wrap-around anti-glare coaming
  const glareShroud = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.88, 0.09, 0.56)), mats.cockpitMatte);
  glareShroud.position.set(0, 0.23, -0.82);
  glareShroud.rotation.x = 0.06;
  group.add(glareShroud);

  // HUD Collimator Projector Lens Barrel on top of glare shroud
  const hudLensBase = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.11, 0.13, 0.04, 18)), bezelMetalMat);
  hudLensBase.position.set(0, 0.275, -0.78);
  group.add(hudLensBase);

  const hudLensGlassMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.72,
    })
  );
  const hudLensGlass = new THREE.Mesh(trackGeo(new THREE.CircleGeometry(0.09, 18)), hudLensGlassMat);
  hudLensGlass.rotation.x = -Math.PI / 2;
  hudLensGlass.position.set(0, 0.296, -0.78);
  group.add(hudLensGlass);

  // Up-Front Controller (UFC) angled up toward pilot right under HUD lens
  const ufcBody = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.28, 0.12, 0.09)), bezelMetalMat);
  ufcBody.position.set(0, 0.18, -0.66);
  ufcBody.rotation.x = -0.24;
  group.add(ufcBody);

  const ufcFace = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(0.25, 0.1)), ufcScreenMat);
  ufcFace.position.set(0, 0.18, -0.612);
  ufcFace.rotation.x = -0.24;
  group.add(ufcFace);

  // 3. Live Dynamic 3-MFD Canvas Screens (Left Stores/Radar, Center ADI, Right Engine/Caution)
  const mfdCanvas = document.createElement('canvas');
  mfdCanvas.width = 512;
  mfdCanvas.height = 192;
  const mfdCtx = mfdCanvas.getContext('2d')!;
  const mfdTexture = new THREE.CanvasTexture(mfdCanvas);
  mfdTexture.colorSpace = THREE.SRGBColorSpace;
  disposables.push(mfdTexture);

  const mfdMat = trackMat(
    new THREE.MeshBasicMaterial({
      map: mfdTexture,
    })
  );

  const createMfdMesh = (uMin: number, uMax: number, w: number, h: number): THREE.Mesh => {
    const geo = trackGeo(new THREE.PlaneGeometry(w, h));
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      uv.setX(i, uMin + u * (uMax - uMin));
    }
    return new THREE.Mesh(geo, mfdMat);
  };

  // Angled toward pilot's seat (-0.18 on X, slightly canted inward on Y for side MFDs)
  const mfdSpecs: Array<{
    x: number;
    y: number;
    z: number;
    rotY: number;
    u0: number;
    u1: number;
    w: number;
    h: number;
  }> = [
    { x: -0.255, y: 0.02, z: -0.695, rotY: 0.14, u0: 0.0, u1: 0.33, w: 0.21, h: 0.2 },
    { x: 0.0, y: -0.015, z: -0.71, rotY: 0.0, u0: 0.335, u1: 0.665, w: 0.21, h: 0.2 },
    { x: 0.255, y: 0.02, z: -0.695, rotY: -0.14, u0: 0.67, u1: 1.0, w: 0.21, h: 0.2 },
  ];

  mfdSpecs.forEach((p) => {
    const mfdHolder = new THREE.Group();
    mfdHolder.position.set(p.x, p.y, p.z);
    mfdHolder.rotation.order = 'YXZ';
    mfdHolder.rotation.y = p.rotY;
    mfdHolder.rotation.x = -0.18;

    const bezel = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(p.w + 0.032, p.h + 0.032, 0.026)), bezelMetalMat);
    bezel.position.z = -0.013;
    const screen = createMfdMesh(p.u0, p.u1, p.w, p.h);
    screen.position.z = 0.002;

    // Tactile OSB MFD bezel pushbuttons around frame
    const btnGeo = trackGeo(new THREE.BoxGeometry(0.014, 0.01, 0.012));
    for (let b = -2; b <= 2; b++) {
      const topBtn = new THREE.Mesh(btnGeo, darkPanelMat);
      topBtn.position.set(b * 0.038, p.h * 0.5 + 0.009, 0.004);
      const botBtn = new THREE.Mesh(btnGeo, darkPanelMat);
      botBtn.position.set(b * 0.038, -p.h * 0.5 - 0.009, 0.004);
      mfdHolder.add(topBtn, botBtn);
    }

    mfdHolder.add(bezel, screen);
    group.add(mfdHolder);
  });

  // 4. Machined Dual-Pane HUD Combiner Frame & AOA Indexer Pod (aligned with boresight y=0.42)
  const hudFrameGroup = new THREE.Group();
  hudFrameGroup.position.set(0, 0.42, -0.78);
  group.add(hudFrameGroup);

  const hudPostGeo = trackGeo(new THREE.BoxGeometry(0.022, 0.34, 0.038));
  const hudPostL = new THREE.Mesh(hudPostGeo, bezelMetalMat);
  hudPostL.position.set(-0.2, 0.01, 0);
  hudPostL.rotation.x = -0.3;
  const hudPostR = new THREE.Mesh(hudPostGeo, bezelMetalMat);
  hudPostR.position.set(0.2, 0.01, 0);
  hudPostR.rotation.x = -0.3;
  hudFrameGroup.add(hudPostL, hudPostR);

  const hudCrossbar = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.42, 0.018, 0.026)), bezelMetalMat);
  hudCrossbar.position.set(0, 0.17, -0.052);
  hudFrameGroup.add(hudCrossbar);

  const hudGlassMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0x34d399,
      emissive: 0x10b981,
      emissiveIntensity: 0.24,
      roughness: 0.04,
      metalness: 0.12,
      transparent: true,
      opacity: 0.19,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  const hudGlassLower = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(0.38, 0.31)), hudGlassMat);
  hudGlassLower.position.set(0, 0.01, -0.012);
  hudGlassLower.rotation.x = -0.44;
  hudFrameGroup.add(hudGlassLower);

  const hudGlassUpper = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(0.37, 0.14)), hudGlassMat);
  hudGlassUpper.position.set(0, 0.11, -0.065);
  hudGlassUpper.rotation.x = -0.26;
  hudFrameGroup.add(hudGlassUpper);

  // Left-strut AOA Indexer Pod (Slow Red / On-Speed Green / Fast Amber)
  const aoaPod = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.032, 0.088, 0.032)), darkPanelMat);
  aoaPod.position.set(-0.23, 0.02, 0.01);
  hudFrameGroup.add(aoaPod);

  const aoaSlowMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xef4444 }));
  const aoaOnMat = trackMat(new THREE.MeshBasicMaterial({ color: 0x22c55e }));
  const aoaFastMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xf59e0b }));
  const aoaLampGeo = trackGeo(new THREE.PlaneGeometry(0.016, 0.016));

  const aoaSlowLamp = new THREE.Mesh(aoaLampGeo, aoaSlowMat);
  aoaSlowLamp.position.set(-0.23, 0.044, 0.027);
  const aoaOnLamp = new THREE.Mesh(aoaLampGeo, aoaOnMat);
  aoaOnLamp.position.set(-0.23, 0.02, 0.027);
  const aoaFastLamp = new THREE.Mesh(aoaLampGeo, aoaFastMat);
  aoaFastLamp.position.set(-0.23, -0.004, 0.027);
  hudFrameGroup.add(aoaSlowLamp, aoaOnLamp, aoaFastLamp);

  // 5. Articulated HOTAS Flight Stick (Right Side-Stick) & Left Split Throttle Quadrant
  const stickPivot = new THREE.Group();
  stickPivot.position.set(0.28, -0.09, -0.32);
  group.add(stickPivot);

  const stickBoot = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.038, 0.055, 0.06, 10)), darkPanelMat);
  stickBoot.position.set(0, 0.03, 0);
  stickPivot.add(stickBoot);

  const stickShaft = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.017, 0.021, 0.15, 10)), bezelMetalMat);
  stickShaft.position.set(0, 0.11, 0);
  stickPivot.add(stickShaft);

  const stickGrip = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.044, 0.095, 0.056)), mats.cockpitMatte);
  stickGrip.position.set(0, 0.19, 0.008);
  stickGrip.rotation.x = 0.18;
  stickPivot.add(stickGrip);

  const stickHat = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.012, 0.012, 0.014, 8)), bezelMetalMat);
  stickHat.position.set(0, 0.24, 0.015);
  stickPivot.add(stickHat);

  // Trigger guard on front of stick grip
  const stickTrigger = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.012, 0.028, 0.02)), aoaSlowMat);
  stickTrigger.position.set(0, 0.2, -0.025);
  stickPivot.add(stickTrigger);

  // Left Throttle Rail & Sliding Lever
  const throttleRail = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.11, 0.04, 0.34)), bezelMetalMat);
  throttleRail.position.set(-0.31, -0.04, -0.28);
  group.add(throttleRail);

  const throttleLeverGroup = new THREE.Group();
  throttleLeverGroup.position.set(-0.31, -0.01, -0.28);
  group.add(throttleLeverGroup);

  const throttleArm = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.04, 0.09, 0.03)), bezelMetalMat);
  throttleArm.position.set(0, 0.04, 0);
  const throttleGrip = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.098, 0.042, 0.068)), mats.cockpitMatte);
  throttleGrip.position.set(0.015, 0.095, 0);
  throttleLeverGroup.add(throttleArm, throttleGrip);

  // 6. Reclined ACES-II Ejection Seat, Headrest & Striped Pull Loop
  const seatBack = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.46, 0.58, 0.12)), darkPanelMat);
  seatBack.position.set(0, 0.04, 0.62);
  seatBack.rotation.x = 0.22; // Reclined backward cleanly
  group.add(seatBack);

  const headrest = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.32, 0.3, 0.16)), mats.cockpitMatte);
  headrest.position.set(0, 0.41, 0.72);
  headrest.rotation.x = 0.16;
  group.add(headrest);

  const ejectTex = createEjectionStripeTexture();
  disposables.push(ejectTex);
  const ejectMat = trackMat(new THREE.MeshStandardMaterial({ map: ejectTex, roughness: 0.45 }));
  const ejectHandle = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.042, 0.011, 8, 16)), ejectMat);
  ejectHandle.position.set(0, -0.22, -0.1);
  ejectHandle.rotation.x = 0.55;
  group.add(ejectHandle);

  // 7. Canopy Frame Arch, Side Sills & Twin Mirrors
  const sillL = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.06, 0.055, 2.28)), mats.playerRamTrim);
  sillL.position.set(-0.46, 0.22, 0.12);
  const sillR = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.06, 0.055, 2.28)), mats.playerRamTrim);
  sillR.position.set(0.46, 0.22, 0.12);
  group.add(sillL, sillR);

  // Forward Canopy Arch Bow framing upper canopy edge
  const bowGeo = trackGeo(new THREE.TorusGeometry(0.47, 0.034, 8, 24, Math.PI));
  const frontBow = new THREE.Mesh(bowGeo, mats.playerRamTrim);
  frontBow.position.set(0, 0.23, -0.56);
  frontBow.rotation.x = 0.24;
  group.add(frontBow);

  // Rear Canopy Bow
  const rearBow = new THREE.Mesh(
    trackGeo(new THREE.TorusGeometry(0.49, 0.042, 8, 20, Math.PI)),
    mats.playerRamTrim
  );
  rearBow.position.set(0, 0.22, 0.72);
  rearBow.rotation.x = -0.2;
  group.add(rearBow);

  // Twin Cockpit Rearview Mirrors tucked into upper arch corners
  const mirrorHousingGeo = trackGeo(new THREE.BoxGeometry(0.095, 0.038, 0.028));
  const mirrorGlassMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xbae6fd,
      metalness: 0.96,
      roughness: 0.05,
    })
  );
  const mirrorGlassGeo = trackGeo(new THREE.PlaneGeometry(0.08, 0.028));

  for (const side of [-1, 1]) {
    const mGroup = new THREE.Group();
    mGroup.position.set(side * 0.27, 0.61, -0.51);
    mGroup.rotation.y = side * -0.24;
    mGroup.rotation.z = side * -0.22;
    const housing = new THREE.Mesh(mirrorHousingGeo, mats.playerRamTrim);
    const glass = new THREE.Mesh(mirrorGlassGeo, mirrorGlassMat);
    glass.position.z = 0.015;
    mGroup.add(housing, glass);
    group.add(mGroup);
  }

  // 8. Bubble Canopy Glass
  const canopyGeo = trackGeo(new THREE.SphereGeometry(0.62, 22, 14));
  canopyGeo.scale(0.84, 0.72, 2.65);
  const canopyMesh = new THREE.Mesh(canopyGeo, customCanopyMat ?? mats.canopyGlass);
  canopyMesh.position.set(0, 0.22, 0.14);
  canopyMesh.renderOrder = 4;
  group.add(canopyMesh);

  // 9. Cockpit Avionics Backlight
  const cockpitLight = new THREE.PointLight(0x34d399, 0, 2.6, 2);
  cockpitLight.position.set(0, 0.34, -0.28);
  group.add(cockpitLight);

  let mfdTimer = 0.1;

  const drawMfds = (p: CockpitUpdateParams) => {
    const ctx = mfdCtx;
    ctx.fillStyle = '#05090f';
    ctx.fillRect(0, 0, 512, 192);

    // --- LEFT MFD (WPN / STORES) [x: 0..168] ---
    ctx.strokeStyle = '#14532d';
    ctx.lineWidth = 2;
    ctx.strokeRect(4, 4, 160, 184);

    ctx.fillStyle = '#4ade80';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(`SMS ${p.aircraftCode}`, 14, 24);

    ctx.font = '13px monospace';
    ctx.fillStyle = '#a7f3d0';
    ctx.fillText(`20MM   ${String(p.gunAmmo).padStart(3, '0')}`, 14, 54);
    ctx.fillText(`AIM-9X   ${p.irMissilesLeft}`, 14, 80);
    ctx.fillText(`AIM-120  ${p.radarMissilesLeft}`, 14, 106);
    ctx.fillText(`FLARES  ${String(p.flares).padStart(2, '0')}`, 14, 132);

    ctx.strokeStyle = '#22c55e';
    ctx.beginPath();
    ctx.moveTo(84, 146);
    ctx.lineTo(138, 174);
    ctx.lineTo(30, 174);
    ctx.closePath();
    ctx.stroke();

    // --- CENTER MFD (ELECTRONIC ADI / HORIZON) [x: 172..340] ---
    ctx.save();
    ctx.beginPath();
    ctx.rect(172, 4, 168, 184);
    ctx.clip();

    const cx = 256;
    const cy = 96;
    ctx.translate(cx, cy);
    ctx.rotate((-p.rollDeg * Math.PI) / 180);
    const pitchPx = Math.max(-55, Math.min(55, p.pitchDeg * 1.6));

    ctx.fillStyle = '#0c4a6e';
    ctx.fillRect(-140, -140 + pitchPx, 280, 140);
    ctx.fillStyle = '#713f12';
    ctx.fillRect(-140, pitchPx, 280, 140);
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-120, pitchPx);
    ctx.lineTo(120, pitchPx);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(248,250,252,0.65)';
    ctx.lineWidth = 1.5;
    for (const deg of [-20, -10, 10, 20]) {
      const py = pitchPx - deg * 1.6;
      ctx.beginPath();
      ctx.moveTo(-26, py);
      ctx.lineTo(26, py);
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(234, 96);
    ctx.lineTo(248, 96);
    ctx.lineTo(256, 104);
    ctx.lineTo(264, 96);
    ctx.lineTo(278, 96);
    ctx.stroke();

    ctx.strokeStyle = '#14532d';
    ctx.lineWidth = 2;
    ctx.strokeRect(172, 4, 168, 184);

    ctx.fillStyle = '#4ade80';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(`IAS ${p.iasKts}`, 180, 22);
    ctx.fillText(`ALT ${p.altitudeFt}`, 266, 22);
    ctx.fillText(`M ${p.mach.toFixed(2)}`, 180, 180);
    ctx.fillText(`${p.gForce.toFixed(1)}G`, 290, 180);

    // --- RIGHT MFD (ENG / EICAS & CAUTION) [x: 344..508] ---
    ctx.strokeStyle = '#14532d';
    ctx.lineWidth = 2;
    ctx.strokeRect(344, 4, 164, 184);

    ctx.fillStyle = '#4ade80';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('ENG / SYS', 354, 24);

    const thrPct = Math.round(p.throttle01 * 100);
    const eng1Fault = p.hullPct < 50;
    const eng1Rpm = p.hullPct < 25 ? 12 : eng1Fault ? Math.round(thrPct * 0.62) : thrPct;

    ctx.font = '12px monospace';
    if (p.twinEngine) {
      ctx.fillStyle = eng1Fault ? '#f87171' : '#a7f3d0';
      ctx.fillText(`L-ENG ${eng1Rpm}%`, 354, 48);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(354, 54, 140, 10);
      ctx.fillStyle = eng1Fault ? '#ef4444' : p.afterburner ? '#f59e0b' : '#22c55e';
      ctx.fillRect(354, 54, Math.round(1.4 * eng1Rpm), 10);

      ctx.fillStyle = '#a7f3d0';
      ctx.fillText(`R-ENG ${thrPct}%${p.afterburner ? ' AB' : ''}`, 354, 84);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(354, 90, 140, 10);
      ctx.fillStyle = p.afterburner ? '#f59e0b' : '#22c55e';
      ctx.fillRect(354, 90, Math.round(1.4 * thrPct), 10);
    } else {
      ctx.fillStyle = eng1Fault ? '#f87171' : '#a7f3d0';
      ctx.fillText(`F110-ENG ${eng1Rpm}%${p.afterburner ? ' AB' : ''}`, 354, 56);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(354, 66, 140, 14);
      ctx.fillStyle = eng1Fault ? '#ef4444' : p.afterburner ? '#f59e0b' : '#22c55e';
      ctx.fillRect(354, 66, Math.round(1.4 * eng1Rpm), 14);
    }

    ctx.fillStyle = p.hullPct < 50 ? '#f87171' : '#a7f3d0';
    ctx.fillText(`HULL  ${Math.round(p.hullPct)}%`, 354, 122);

    if (p.missileWarning) {
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(354, 136, 140, 22);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px monospace';
      ctx.fillText('MISSILE ALERT', 372, 151);
    } else if (eng1Fault || p.stallWarning) {
      ctx.fillStyle = '#d97706';
      ctx.fillRect(354, 136, 140, 22);
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(eng1Fault ? 'ENG 1 FIRE' : 'STALL WARN', 382, 151);
    } else {
      ctx.fillStyle = '#064e3b';
      ctx.fillRect(354, 136, 140, 22);
      ctx.fillStyle = '#4ade80';
      ctx.font = '12px monospace';
      ctx.fillText('SYSTEMS NOMINAL', 366, 151);
    }

    // Live Wind & Landing Gear status strip at bottom of Right MFD
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = p.windSpeedKts >= 28 ? '#fbbf24' : '#7dd3fc';
    ctx.fillText(`WND ${String(p.windFromDeg).padStart(3, '0')}/${p.windSpeedKts}KT`, 354, 178);
    ctx.fillStyle = p.gearDown ? '#4ade80' : '#64748b';
    ctx.fillText(p.gearDown ? 'GEAR DN' : 'GEAR UP', 446, 178);

    mfdTexture.needsUpdate = true;
  };

  return {
    group,
    canopyMesh,
    update: (p: CockpitUpdateParams) => {
      // Physical HOTAS stick deflection
      stickPivot.rotation.x = THREE.MathUtils.damp(stickPivot.rotation.x, -p.pitchInput * 0.28, 14, p.dt);
      stickPivot.rotation.z = THREE.MathUtils.damp(stickPivot.rotation.z, -p.rollInput * 0.28, 14, p.dt);

      // Physical left throttle quadrant sliding fore/aft (-Z is forward)
      const targetThrottleZ = -0.18 - p.throttle01 * 0.18;
      throttleLeverGroup.position.z = THREE.MathUtils.damp(throttleLeverGroup.position.z, targetThrottleZ, 12, p.dt);

      // Rudder pedals travel opposite
      pedalL.position.z = -0.66 - p.yawInput * 0.04;
      pedalR.position.z = -0.66 + p.yawInput * 0.04;

      // AOA Indexer lights (On-speed 6..11 deg)
      aoaSlowLamp.visible = p.aoaDeg > 11;
      aoaOnLamp.visible = p.aoaDeg >= 5 && p.aoaDeg <= 13;
      aoaFastLamp.visible = p.aoaDeg < 5;

      // Hide bubble canopy glass in cockpit view while keeping frame arch, sills & mirrors visible
      canopyMesh.visible = !p.isCockpitCam;
      cockpitLight.intensity = p.isCockpitCam ? 0.65 : 0.12;

      // Redraw live MFD screens
      mfdTimer += p.dt;
      const refreshPeriod = p.isCockpitCam ? 0.066 : 0.35;
      if (mfdTimer >= refreshPeriod) {
        mfdTimer = 0;
        drawMfds(p);
      }
    },
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}
