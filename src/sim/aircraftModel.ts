import * as THREE from 'three';
import { getAircraftSpec, type AircraftSpec } from './aircraftCatalog';
import { createFighterCockpit, type FighterCockpitRig } from './cockpit';
import type { SimMaterialLibrary } from './materials';
import type { AircraftId } from './types';

export interface FighterVisualRig {
  root: THREE.Group;
  spec: AircraftSpec;
  cockpit: FighterCockpitRig;
  updateVisuals: (params: {
    pitchInput: number;
    rollInput: number;
    yawInput: number;
    throttle01: number;
    afterburner: boolean;
    airbrake: boolean;
    mach: number;
    iasKts: number;
    altitudeFt: number;
    pitchDeg: number;
    rollDeg: number;
    aoaDeg: number;
    gForce: number;
    firingGun: boolean;
    gunAmmo: number;
    irMissilesLeft: number;
    radarMissilesLeft: number;
    flares: number;
    stallWarning: boolean;
    missileWarning: boolean;
    isCockpitCam: boolean;
    hullPct: number;
    gearDown: boolean;
    windFromDeg: number;
    windSpeedKts: number;
    weatherRegime: string;
    elapsed: number;
    dt: number;
  }) => void;
  dispose: () => void;
}

function createSweptWingGeometry(
  rootChord: number,
  tipChord: number,
  span: number,
  sweepZ: number,
  thickness: number,
  side: 1 | -1
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, -rootChord * 0.5);
  shape.lineTo(side * span, -tipChord * 0.5 + sweepZ);
  shape.lineTo(side * span, tipChord * 0.5 + sweepZ);
  shape.lineTo(0, rootChord * 0.5);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: thickness * 0.45,
    bevelSize: 0.12,
    bevelSegments: 2,
  });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, thickness * 0.5, 0);
  return geo;
}

function createFinGeometry(
  rootChord: number,
  tipChord: number,
  height: number,
  sweepBack: number,
  thickness: number
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-rootChord * 0.5, 0);
  shape.lineTo(rootChord * 0.5, 0);
  shape.lineTo(tipChord * 0.5 + sweepBack, height);
  shape.lineTo(-tipChord * 0.5 + sweepBack, height);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: thickness * 0.4,
    bevelSize: 0.07,
    bevelSegments: 2,
  });
  geo.rotateY(-Math.PI / 2);
  geo.translate(thickness * 0.5, 0, 0);
  return geo;
}

function createNozzleGroup(
  mats: SimMaterialLibrary,
  radius: number,
  disposables: Array<{ dispose: () => void }>
): { group: THREE.Group; petalRing: THREE.Group } {
  const track = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };

  const group = new THREE.Group();

  // Fixed titanium shroud base
  const shroudPts = [
    new THREE.Vector2(radius * 1.02, 0),
    new THREE.Vector2(radius * 1.05, 0.25),
    new THREE.Vector2(radius * 0.94, 0.72),
    new THREE.Vector2(radius * 0.82, 1.05),
  ];
  const shroudGeo = track(new THREE.LatheGeometry(shroudPts, 18));
  shroudGeo.rotateX(Math.PI / 2);
  group.add(new THREE.Mesh(shroudGeo, mats.titaniumNozzle));

  // Inner ceramic flameholder cavity
  const linerGeo = track(new THREE.CylinderGeometry(radius * 0.74, radius * 0.62, 0.85, 16, 1, true));
  linerGeo.rotateX(Math.PI / 2);
  const liner = new THREE.Mesh(linerGeo, mats.burnerLiner);
  liner.position.z = 0.75;
  group.add(liner);

  // Articulated turkey-feather convergent/divergent petals (scale open on AB)
  const petalRing = new THREE.Group();
  petalRing.position.z = 0.85;
  const petalGeo = track(new THREE.BoxGeometry(radius * 0.34, radius * 0.14, 0.56));
  const petalCount = 12;
  for (let i = 0; i < petalCount; i++) {
    const angle = (i / petalCount) * Math.PI * 2;
    const pHolder = new THREE.Group();
    pHolder.rotation.z = angle;
    const p = new THREE.Mesh(petalGeo, mats.titaniumNozzle);
    p.position.set(0, radius * 0.81, 0.22);
    p.rotation.x = 0.14;
    pHolder.add(p);
    petalRing.add(pHolder);
  }
  group.add(petalRing);

  return { group, petalRing };
}

function createMissileMesh(
  mats: SimMaterialLibrary,
  isAmraam: boolean,
  disposables: Array<{ dispose: () => void }>
): THREE.Group {
  const track = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };
  const g = new THREE.Group();
  const len = isAmraam ? 3.2 : 2.6;
  const rad = isAmraam ? 0.11 : 0.09;

  const body = new THREE.Mesh(
    track(new THREE.CylinderGeometry(rad, rad, len, 10).rotateX(Math.PI / 2)),
    mats.missileBody
  );
  g.add(body);

  const nose = new THREE.Mesh(
    track(new THREE.ConeGeometry(rad, 0.45, 10).rotateX(-Math.PI / 2)),
    mats.playerRamTrim
  );
  nose.position.z = -len * 0.5 - 0.22;
  g.add(nose);

  const band = new THREE.Mesh(
    track(new THREE.CylinderGeometry(rad * 1.03, rad * 1.03, 0.14, 10).rotateX(Math.PI / 2)),
    mats.missileBand
  );
  band.position.z = -len * 0.25;
  g.add(band);

  const finGeo = track(new THREE.BoxGeometry(rad * 4.2, 0.02, 0.38));
  const finH = new THREE.Mesh(finGeo, mats.playerRamTrim);
  finH.position.z = len * 0.42;
  const finV = new THREE.Mesh(finGeo, mats.playerRamTrim);
  finV.rotation.z = Math.PI / 2;
  finV.position.z = len * 0.42;
  g.add(finH, finV);

  return g;
}

export function createPlayerFighterModel(
  mats: SimMaterialLibrary,
  aircraftId: AircraftId = 'f22'
): FighterVisualRig {
  const spec = getAircraftSpec(aircraftId);
  const root = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];

  const track = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    disposables.push(m);
    return m;
  };

  // Per-aircraft tinted PBR fuselage, RAM trim, and canopy glass
  const fuselageMat = trackMat(mats.playerFuselage.clone());
  fuselageMat.color.setHex(spec.fuselageColor);
  const trimMat = trackMat(mats.playerRamTrim.clone());
  trimMat.color.setHex(spec.trimColor);
  const canopyMat = trackMat(mats.canopyGlass.clone());
  canopyMat.color.setHex(spec.canopyTint);

  // 1. Fuselage Aft Spine, Recessed Belly Keel & Flanking Cockpit Cheeks
  const hullWidthScale = aircraftId === 'f16' ? 0.72 : aircraftId === 'f14' ? 1.24 : 1.0;
  const fuselageShape = new THREE.Shape();
  fuselageShape.moveTo(0, -0.52);
  fuselageShape.lineTo(1.18 * hullWidthScale, -0.25);
  fuselageShape.lineTo(1.38 * hullWidthScale, 0.12);
  fuselageShape.lineTo(0.88 * hullWidthScale, 0.58);
  fuselageShape.lineTo(0, 0.72);
  fuselageShape.lineTo(-0.88 * hullWidthScale, 0.58);
  fuselageShape.lineTo(-1.38 * hullWidthScale, 0.12);
  fuselageShape.lineTo(-1.18 * hullWidthScale, -0.25);
  fuselageShape.closePath();

  const mainHullGeo = track(
    new THREE.ExtrudeGeometry(fuselageShape, {
      depth: 7.55,
      bevelEnabled: true,
      bevelThickness: 0.32,
      bevelSize: 0.18,
      bevelSegments: 2,
    })
  );
  mainHullGeo.translate(0, 0, -2.75);
  const mainHull = new THREE.Mesh(mainHullGeo, fuselageMat);
  mainHull.castShadow = true;
  mainHull.receiveShadow = true;
  root.add(mainHull);

  // Forward belly keel cleanly beneath cockpit tub (y <= 0.34)
  const bellyShape = new THREE.Shape();
  bellyShape.moveTo(0, -0.52);
  bellyShape.lineTo(1.05 * hullWidthScale, -0.24);
  bellyShape.lineTo(1.12 * hullWidthScale, 0.18);
  bellyShape.lineTo(0.55, 0.34);
  bellyShape.lineTo(-0.55, 0.34);
  bellyShape.lineTo(-1.12 * hullWidthScale, 0.18);
  bellyShape.lineTo(-1.05 * hullWidthScale, -0.24);
  bellyShape.closePath();

  const bellyGeo = track(
    new THREE.ExtrudeGeometry(bellyShape, {
      depth: 2.35,
      bevelEnabled: true,
      bevelThickness: 0.12,
      bevelSize: 0.06,
      bevelSegments: 2,
    })
  );
  bellyGeo.translate(0, 0, -5.0);
  const forwardBelly = new THREE.Mesh(bellyGeo, fuselageMat);
  forwardBelly.castShadow = true;
  root.add(forwardBelly);

  // Outer cockpit sill cheeks flanking tub
  const cheekGeo = track(new THREE.BoxGeometry(0.46, 0.42, 2.35));
  const cheekL = new THREE.Mesh(cheekGeo, fuselageMat);
  cheekL.position.set(-0.78, 0.56, -3.82);
  cheekL.rotation.z = -0.35;
  const cheekR = new THREE.Mesh(cheekGeo, fuselageMat);
  cheekR.position.set(0.78, 0.56, -3.82);
  cheekR.rotation.z = 0.35;
  root.add(cheekL, cheekR);

  // Sculpted forward radome nose + pitot probe (-Z forward, stops ahead of glare at z=-4.85)
  const nosePts = [
    new THREE.Vector2(0.01, -4.2),
    new THREE.Vector2(0.24, -3.2),
    new THREE.Vector2(0.54, -1.8),
    new THREE.Vector2(0.82, 0.0),
    new THREE.Vector2(0.92, 0.45),
  ];
  const noseGeo = track(new THREE.LatheGeometry(nosePts, 22));
  noseGeo.rotateX(Math.PI / 2);
  noseGeo.scale(aircraftId === 'f16' ? 0.9 : 1.08, 0.72, 1);
  const noseMesh = new THREE.Mesh(noseGeo, fuselageMat);
  noseMesh.position.set(0, 0.04, -5.2);
  noseMesh.castShadow = true;
  root.add(noseMesh);

  const radomeTip = new THREE.Mesh(
    track(new THREE.ConeGeometry(0.23, 1.05, 16).rotateX(-Math.PI / 2)),
    trimMat
  );
  radomeTip.position.set(0, 0.02, -9.3);
  root.add(radomeTip);

  // Stainless steel Pitot Probe & upper nose IFF blade antennas
  const pitot = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.014, 0.026, 0.85, 8).rotateX(Math.PI / 2)),
    mats.titaniumNozzle
  );
  pitot.position.set(0, 0.02, -10.15);
  root.add(pitot);

  const iffBladeGeo = track(new THREE.BoxGeometry(0.04, 0.14, 0.28));
  const iffBlade = new THREE.Mesh(iffBladeGeo, trimMat);
  iffBlade.position.set(0, 0.56, -5.55);
  const dorsalAntenna = new THREE.Mesh(iffBladeGeo, trimMat);
  dorsalAntenna.position.set(0, 0.86, 0.2);
  root.add(iffBlade, dorsalAntenna);

  // Leading-Edge Root Extensions (LERX strakes)
  const lerxSpan = aircraftId === 'f14' ? 1.15 : aircraftId === 'typhoon' ? 0.55 : 0.95;
  const lerxL = new THREE.Mesh(
    track(createSweptWingGeometry(4.4, 0.8, lerxSpan, 2.2, 0.14, -1)),
    fuselageMat
  );
  lerxL.position.set(-0.92 * hullWidthScale, 0.06, -3.4);
  const lerxR = new THREE.Mesh(
    track(createSweptWingGeometry(4.4, 0.8, lerxSpan, 2.2, 0.14, 1)),
    fuselageMat
  );
  lerxR.position.set(0.92 * hullWidthScale, 0.06, -3.4);
  root.add(lerxL, lerxR);

  // 2. Variant-Authentic Recessed Engine Intakes with Dark Compressor Cavities
  if (aircraftId === 'f16') {
    // Ventral chin F-16 intake scoop with dark tunnel cavity
    const chinIntake = new THREE.Mesh(track(new THREE.BoxGeometry(1.18, 0.56, 3.8)), trimMat);
    chinIntake.position.set(0, -0.58, -2.5);
    const chinCavity = new THREE.Mesh(track(new THREE.BoxGeometry(0.96, 0.4, 0.4)), mats.intakeDark);
    chinCavity.position.set(0, -0.58, -4.32);
    const chinSpinner = new THREE.Mesh(
      track(new THREE.ConeGeometry(0.18, 0.3, 10).rotateX(-Math.PI / 2)),
      mats.titaniumNozzle
    );
    chinSpinner.position.set(0, -0.58, -4.2);
    root.add(chinIntake, chinCavity, chinSpinner);
  } else if (aircraftId === 'typhoon') {
    // Twin side-by-side ventral Eurofighter rectangular intakes
    for (const side of [-1, 1]) {
      const iBox = new THREE.Mesh(track(new THREE.BoxGeometry(0.62, 0.52, 4.4)), trimMat);
      iBox.position.set(side * 0.42, -0.56, -2.1);
      const cav = new THREE.Mesh(track(new THREE.BoxGeometry(0.48, 0.36, 0.35)), mats.intakeDark);
      cav.position.set(side * 0.42, -0.56, -4.22);
      root.add(iBox, cav);
    }
  } else {
    // Twin lateral intakes (F-22 canted stealth / F-14 wide box nacelles)
    const intakeX = aircraftId === 'f14' ? 1.26 : 1.02;
    const intakeRoll = aircraftId === 'f14' ? 0.0 : 0.14;
    const intakeGeo = track(new THREE.BoxGeometry(0.86, 0.72, 4.8));
    const cavGeo = track(new THREE.BoxGeometry(0.66, 0.52, 0.45));
    const spinGeo = track(new THREE.ConeGeometry(0.18, 0.32, 10).rotateX(-Math.PI / 2));

    for (const side of [-1, 1]) {
      const intake = new THREE.Mesh(intakeGeo, trimMat);
      intake.position.set(side * intakeX, -0.18, -1.8);
      intake.rotation.z = -side * intakeRoll;

      const cav = new THREE.Mesh(cavGeo, mats.intakeDark);
      cav.position.set(side * intakeX, -0.18, -4.05);
      cav.rotation.z = -side * intakeRoll;

      const spin = new THREE.Mesh(spinGeo, mats.titaniumNozzle);
      spin.position.set(side * intakeX, -0.18, -3.9);
      root.add(intake, cav, spin);
    }
  }

  // 3. Detailed 3D Fighter Cockpit (Live MFDs, HOTAS Stick/Throttle, HUD Frame, Mirrors, Canopy)
  const cockpit = createFighterCockpit(mats, canopyMat);
  root.add(cockpit.group);

  // 4. Variant-Specific Wings, Canards (Typhoon), Swing-Wing Pivots (F-14) & Navigation Lights
  let wingPivotL: THREE.Group | null = null;
  let wingPivotR: THREE.Group | null = null;
  let canardL: THREE.Mesh | null = null;
  let canardR: THREE.Mesh | null = null;

  const wingGeoL = track(
    createSweptWingGeometry(
      aircraftId === 'typhoon' ? 5.2 : aircraftId === 'f16' ? 3.7 : aircraftId === 'f14' ? 3.2 : 4.3,
      aircraftId === 'typhoon' ? 0.95 : aircraftId === 'f14' ? 1.05 : 1.35,
      aircraftId === 'f16' ? 4.3 : aircraftId === 'f14' ? 6.0 : 5.2,
      aircraftId === 'typhoon' ? 3.1 : aircraftId === 'f14' ? 1.05 : 2.55,
      0.18,
      -1
    )
  );
  const wingGeoR = track(
    createSweptWingGeometry(
      aircraftId === 'typhoon' ? 5.2 : aircraftId === 'f16' ? 3.7 : aircraftId === 'f14' ? 3.2 : 4.3,
      aircraftId === 'typhoon' ? 0.95 : aircraftId === 'f14' ? 1.05 : 1.35,
      aircraftId === 'f16' ? 4.3 : aircraftId === 'f14' ? 6.0 : 5.2,
      aircraftId === 'typhoon' ? 3.1 : aircraftId === 'f14' ? 1.05 : 2.55,
      0.18,
      1
    )
  );

  if (spec.hasSwingWings) {
    // Fixed wing glove shoulder
    const gloveGeoL = track(createSweptWingGeometry(3.8, 2.2, 1.3, 1.3, 0.22, -1));
    const gloveGeoR = track(createSweptWingGeometry(3.8, 2.2, 1.3, 1.3, 0.22, 1));
    const gloveL = new THREE.Mesh(gloveGeoL, fuselageMat);
    gloveL.position.set(-1.35, 0.06, -0.3);
    const gloveR = new THREE.Mesh(gloveGeoR, fuselageMat);
    gloveR.position.set(1.35, 0.06, -0.3);
    root.add(gloveL, gloveR);

    wingPivotL = new THREE.Group();
    wingPivotL.position.set(-2.3, 0.05, 0.6);
    const swingL = new THREE.Mesh(wingGeoL, fuselageMat);
    swingL.castShadow = true;
    wingPivotL.add(swingL);

    wingPivotR = new THREE.Group();
    wingPivotR.position.set(2.3, 0.05, 0.6);
    const swingR = new THREE.Mesh(wingGeoR, fuselageMat);
    swingR.castShadow = true;
    wingPivotR.add(swingR);

    root.add(wingPivotL, wingPivotR);
  } else {
    const wingRootX = aircraftId === 'f16' ? 0.85 : 1.15;
    const wingL = new THREE.Mesh(wingGeoL, fuselageMat);
    wingL.position.set(-wingRootX, 0.04, 0.65);
    wingL.castShadow = true;
    wingL.receiveShadow = true;
    const wingR = new THREE.Mesh(wingGeoR, fuselageMat);
    wingR.position.set(wingRootX, 0.04, 0.65);
    wingR.castShadow = true;
    wingR.receiveShadow = true;
    root.add(wingL, wingR);
  }

  // Close-coupled Foreplane Canards for EF-2000 Typhoon
  if (spec.hasCanards) {
    const canardGeoL = track(createSweptWingGeometry(1.35, 0.45, 1.45, 0.55, 0.09, -1));
    const canardGeoR = track(createSweptWingGeometry(1.35, 0.45, 1.45, 0.55, 0.09, 1));
    canardL = new THREE.Mesh(canardGeoL, fuselageMat);
    canardL.position.set(-0.92, 0.22, -4.35);
    canardR = new THREE.Mesh(canardGeoR, fuselageMat);
    canardR.position.set(0.92, 0.22, -4.35);
    root.add(canardL, canardR);
  }

  // Articulated Ailerons
  const aileronX = aircraftId === 'f16' ? 3.55 : aircraftId === 'f14' ? 4.4 : 4.35;
  const aileronGeo = track(new THREE.BoxGeometry(2.0, 0.08, 0.54));
  const leftAileron = new THREE.Mesh(aileronGeo, trimMat);
  leftAileron.position.set(-aileronX, 0.12, 3.0);
  leftAileron.rotation.y = 0.22;
  const rightAileron = new THREE.Mesh(aileronGeo, trimMat);
  rightAileron.position.set(aileronX, 0.12, 3.0);
  rightAileron.rotation.y = -0.22;
  root.add(leftAileron, rightAileron);
  if (spec.hasSwingWings && wingPivotL && wingPivotR) {
    // Re-parent ailerons onto F-14 swing wings so they move with wing sweep
    leftAileron.position.set(-3.4, 0.04, 1.65);
    rightAileron.position.set(3.4, 0.04, 1.65);
    wingPivotL.add(leftAileron);
    wingPivotR.add(rightAileron);
  }

  // Wingtip Position Navigation Lights (Port Red / Starboard Green)
  const navGeo = track(new THREE.SphereGeometry(0.11, 8, 6));
  const navPort = new THREE.Mesh(navGeo, mats.navRed);
  const navStbd = new THREE.Mesh(navGeo, mats.navGreen);
  if (spec.hasSwingWings && wingPivotL && wingPivotR) {
    navPort.position.set(-6.05, 0.08, 1.05);
    navStbd.position.set(6.05, 0.08, 1.05);
    wingPivotL.add(navPort);
    wingPivotR.add(navStbd);
  } else {
    const tipX = aircraftId === 'f16' ? 5.15 : 6.35;
    const tipZ = aircraftId === 'typhoon' ? 3.7 : aircraftId === 'f16' ? 3.1 : 3.2;
    navPort.position.set(-tipX, 0.08, tipZ);
    navStbd.position.set(tipX, 0.08, tipZ);
    root.add(navPort, navStbd);
  }

  // 5. All-Moving Horizontal Stabilators (F-22, F-16, F-14)
  const stabGeoL = track(createSweptWingGeometry(2.1, 0.72, 2.25, 1.15, 0.12, -1));
  const stabGeoR = track(createSweptWingGeometry(2.1, 0.72, 2.25, 1.15, 0.12, 1));
  const leftStab = new THREE.Mesh(stabGeoL, fuselageMat);
  leftStab.position.set(-1.15 * hullWidthScale, 0.04, 4.95);
  const rightStab = new THREE.Mesh(stabGeoR, fuselageMat);
  rightStab.position.set(1.15 * hullWidthScale, 0.04, 4.95);
  if (aircraftId === 'typhoon') {
    // Pure delta Typhoon has trailing elevons instead of separate horizontal stabs
    leftStab.visible = false;
    rightStab.visible = false;
  }
  root.add(leftStab, rightStab);

  // 6. Vertical Stabilizers (Twin Canted for F-22, Twin Straight for F-14, Single Tall Fin for F-16/Typhoon)
  const rudderGeo = track(new THREE.BoxGeometry(0.08, 1.45, 0.56));
  const rudders: THREE.Mesh[] = [];
  if (aircraftId === 'f16' || aircraftId === 'typhoon') {
    const singleFinGeo = track(createFinGeometry(2.6, 0.9, 2.55, 1.35, 0.12));
    const centerFin = new THREE.Mesh(singleFinGeo, fuselageMat);
    centerFin.position.set(0, 0.65, 4.15);
    centerFin.castShadow = true;
    const centerRudder = new THREE.Mesh(rudderGeo, trimMat);
    centerRudder.position.set(0, 1.58, 5.38);
    root.add(centerFin, centerRudder);
    rudders.push(centerRudder);

    // Tail anti-collision white strobe at fin apex
    const strobe = new THREE.Mesh(navGeo, mats.navWhite);
    strobe.position.set(0, 3.22, 5.85);
    root.add(strobe);

    if (aircraftId === 'f16') {
      // Iconic twin ventral stabilizing fins under F-16 tail
      const vStrakeGeo = track(new THREE.BoxGeometry(0.06, 0.42, 1.35));
      const vsL = new THREE.Mesh(vStrakeGeo, trimMat);
      vsL.position.set(-0.56, -0.54, 4.15);
      vsL.rotation.z = -0.32;
      const vsR = new THREE.Mesh(vStrakeGeo, trimMat);
      vsR.position.set(0.56, -0.54, 4.15);
      vsR.rotation.z = 0.32;
      root.add(vsL, vsR);
    }
  } else {
    const finCant = aircraftId === 'f14' ? 0.06 : 0.34;
    const finX = aircraftId === 'f14' ? 1.35 : 1.05;
    const finGeo = track(createFinGeometry(2.3, 0.85, 2.28, 1.25, 0.11));
    const finL = new THREE.Mesh(finGeo, fuselageMat);
    finL.position.set(-finX, 0.45, 4.35);
    finL.rotation.z = finCant;
    finL.castShadow = true;
    const finR = new THREE.Mesh(finGeo, fuselageMat);
    finR.position.set(finX, 0.45, 4.35);
    finR.rotation.z = -finCant;
    finR.castShadow = true;

    const rL = new THREE.Mesh(rudderGeo, trimMat);
    rL.position.set(-finX - Math.sin(finCant) * 1.1, 1.35, 5.42);
    rL.rotation.z = finCant;
    const rR = new THREE.Mesh(rudderGeo, trimMat);
    rR.position.set(finX + Math.sin(finCant) * 1.1, 1.35, 5.42);
    rR.rotation.z = -finCant;
    root.add(finL, finR, rL, rR);
    rudders.push(rL, rR);

    const strobe = new THREE.Mesh(navGeo, mats.navWhite);
    strobe.position.set(finX + Math.sin(finCant) * 1.9, 2.65, 5.95);
    root.add(strobe);
  }

  // 7. Dorsal Spine Airbrake Panel + Belly Arresting Tailhook
  const airbrakeGeo = track(new THREE.BoxGeometry(1.05, 0.08, 1.85));
  airbrakeGeo.translate(0, 0, 0.92);
  const airbrakeFlap = new THREE.Mesh(airbrakeGeo, trimMat);
  airbrakeFlap.position.set(0, 0.78, 0.6);
  root.add(airbrakeFlap);

  const tailhook = new THREE.Mesh(track(new THREE.CylinderGeometry(0.04, 0.04, 1.9, 8).rotateX(Math.PI / 2)), trimMat);
  tailhook.position.set(0, -0.48, 4.4);
  root.add(tailhook);

  // 8. Petaled Variable-Geometry Engine Nozzles + Afterburner Plumes
  const nozzleXOffset = aircraftId === 'f14' ? 0.96 : aircraftId === 'typhoon' ? 0.52 : 0.68;
  const nozzleRadius = spec.twinEngine ? 0.54 : 0.72;
  const nozControls: Array<{ petalRing: THREE.Group; abGroup: THREE.Group }> = [];

  const buildEngineRig = (xPos: number) => {
    const noz = createNozzleGroup(mats, nozzleRadius, disposables);
    noz.group.position.set(xPos, 0.0, 4.85);
    root.add(noz.group);

    const abG = new THREE.Group();
    abG.position.set(xPos, 0.0, 6.05);
    const plumeRad = spec.twinEngine ? 0.36 : 0.48;
    const coreGeo = track(new THREE.ConeGeometry(plumeRad, 4.2, 14).rotateX(Math.PI / 2));
    coreGeo.translate(0, 0, 2.1);
    const core = new THREE.Mesh(coreGeo, mats.afterburnerCore);

    const haloGeo = track(new THREE.ConeGeometry(plumeRad * 1.55, 6.4, 16, 1, true).rotateX(Math.PI / 2));
    haloGeo.translate(0, 0, 3.2);
    const halo = new THREE.Mesh(haloGeo, mats.afterburnerHalo);

    const diamondGeo = track(new THREE.OctahedronGeometry(plumeRad * 0.68, 0));
    for (let i = 0; i < 4; i++) {
      const d = new THREE.Mesh(diamondGeo, mats.afterburnerCore);
      d.position.z = 0.8 + i * 1.15;
      d.scale.set(1 - i * 0.16, 1 - i * 0.16, 1.5);
      abG.add(d);
    }

    abG.add(core, halo);
    root.add(abG);
    nozControls.push({ petalRing: noz.petalRing, abGroup: abG });
  };

  if (spec.twinEngine) {
    buildEngineRig(-nozzleXOffset);
    buildEngineRig(nozzleXOffset);
  } else {
    buildEngineRig(0);
  }

  const abLight = new THREE.PointLight(0xff8c32, 0, 32, 2);
  abLight.position.set(0, 0, 7.6);
  root.add(abLight);

  // Localized engine-bay damage fire glow
  const dmgFireMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0xf97316,
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  const dmgFireMesh = new THREE.Mesh(
    track(new THREE.ConeGeometry(0.46, 2.2, 10).rotateX(Math.PI / 2)),
    dmgFireMat
  );
  dmgFireMesh.position.set(spec.twinEngine ? -nozzleXOffset : 0, 0.08, 5.7);
  dmgFireMesh.visible = false;
  root.add(dmgFireMesh);

  // 9. M61 Vulcan Cannon Muzzle Port + Flash
  const gunPort = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.11, 0.13, 0.9, 8).rotateX(Math.PI / 2)),
    mats.titaniumNozzle
  );
  gunPort.position.set(1.18, 0.28, -2.85);
  root.add(gunPort);

  const muzzleMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  const muzzleFlash = new THREE.Mesh(
    track(new THREE.ConeGeometry(0.26, 1.4, 8).rotateX(-Math.PI / 2)),
    muzzleMat
  );
  muzzleFlash.position.set(1.18, 0.28, -3.7);
  muzzleFlash.visible = false;
  root.add(muzzleFlash);

  const muzzleLight = new THREE.PointLight(0xfacc15, 0, 18, 2);
  muzzleLight.position.set(1.18, 0.35, -3.8);
  root.add(muzzleLight);

  // 10. Underwing Pylons & Ordnance Hardpoints (matched to aircraft IR/Radar counts)
  const irHardpoints: THREE.Group[] = [];
  const radarHardpoints: THREE.Group[] = [];
  const pylonGeo = track(new THREE.BoxGeometry(0.1, 0.24, 1.35));

  const irCoords: Array<[number, number, number]> =
    aircraftId === 'f16'
      ? [
          [-5.15, 0.02, 3.1],
          [5.15, 0.02, 3.1],
          [-3.85, -0.25, 2.1],
          [3.85, -0.25, 2.1],
        ]
      : aircraftId === 'f14'
      ? [
          [-2.05, -0.28, 0.6],
          [2.05, -0.28, 0.6],
        ]
      : [
          [-(aircraftId === 'typhoon' ? 6.2 : 6.35), 0.02, 2.8],
          [aircraftId === 'typhoon' ? 6.2 : 6.35, 0.02, 2.8],
        ];

  const radarCoords: Array<[number, number, number]> =
    aircraftId === 'f16'
      ? [
          [-2.3, -0.32, 1.2],
          [2.3, -0.32, 1.2],
        ]
      : aircraftId === 'f14'
      ? [
          [-0.65, -0.64, -0.3],
          [0.65, -0.64, -0.3],
          [-0.65, -0.64, 2.6],
          [0.65, -0.64, 2.6],
          [-1.7, -0.34, 1.1],
          [1.7, -0.34, 1.1],
        ]
      : [
          [-3.8, -0.28, 1.55],
          [3.8, -0.28, 1.55],
          [-2.45, -0.32, 0.95],
          [2.45, -0.32, 0.95],
          [-0.55, -0.58, 0.6],
          [0.55, -0.58, 0.6],
        ];

  const attachHardpoint = (pos: [number, number, number], isAmraam: boolean, targetArr: THREE.Group[]) => {
    const pylon = new THREE.Mesh(pylonGeo, trimMat);
    pylon.position.set(pos[0], pos[1] + 0.14, pos[2]);
    root.add(pylon);
    const m = createMissileMesh(mats, isAmraam, disposables);
    m.position.set(pos[0], pos[1], pos[2]);
    root.add(m);
    targetArr.push(m);
  };

  for (let i = 0; i < Math.min(spec.missilesIr, irCoords.length); i++) {
    attachHardpoint(irCoords[i], false, irHardpoints);
  }
  for (let i = 0; i < Math.min(spec.missilesRadar, radarCoords.length); i++) {
    attachHardpoint(radarCoords[i], true, radarHardpoints);
  }

  // 11. Transonic Prandtl-Glauert Vapor Cone (Mach ~0.96 - 1.06)
  const vaporGeo = track(new THREE.ConeGeometry(3.8, 4.6, 24, 1, true).rotateX(Math.PI / 2));
  const vaporMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0xf1f5f9,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  const vaporCone = new THREE.Mesh(vaporGeo, vaporMat);
  vaporCone.position.set(0, 0.05, 0.4);
  vaporCone.visible = false;
  root.add(vaporCone);

  // 12. Retractable Tricycle Landing Gear (nose oleo + twin main struts/tires + taxi lamp)
  const tireMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x16191f, roughness: 0.9, metalness: 0.05 }));
  const landingLampMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xfef9c3 }));
  const strutGeo = track(new THREE.CylinderGeometry(0.055, 0.065, 1.05, 10));
  const noseTireGeo = track(new THREE.CylinderGeometry(0.24, 0.24, 0.14, 14).rotateZ(Math.PI / 2));
  const mainTireGeo = track(new THREE.CylinderGeometry(0.36, 0.36, 0.22, 14).rotateZ(Math.PI / 2));
  const lampGeo = track(new THREE.SphereGeometry(0.09, 8, 8));

  const gearGroup = new THREE.Group();
  const noseGearPivot = new THREE.Group();
  noseGearPivot.position.set(0, -0.32, -4.45);
  const noseStrut = new THREE.Mesh(strutGeo, mats.titaniumNozzle);
  noseStrut.position.y = -0.52;
  const noseTire = new THREE.Mesh(noseTireGeo, tireMat);
  noseTire.position.set(0, -1.04, 0);
  const taxiLamp = new THREE.Mesh(lampGeo, landingLampMat);
  taxiLamp.position.set(0, -0.68, -0.09);
  noseGearPivot.add(noseStrut, noseTire, taxiLamp);
  gearGroup.add(noseGearPivot);

  const mainGearLPivot = new THREE.Group();
  mainGearLPivot.position.set(-1.32, -0.26, 1.55);
  const mainStrutL = new THREE.Mesh(strutGeo, mats.titaniumNozzle);
  mainStrutL.position.y = -0.54;
  mainStrutL.rotation.z = -0.14;
  const mainTireL = new THREE.Mesh(mainTireGeo, tireMat);
  mainTireL.position.set(-0.14, -1.06, 0);
  mainGearLPivot.add(mainStrutL, mainTireL);
  gearGroup.add(mainGearLPivot);

  const mainGearRPivot = new THREE.Group();
  mainGearRPivot.position.set(1.32, -0.26, 1.55);
  const mainStrutR = new THREE.Mesh(strutGeo, mats.titaniumNozzle);
  mainStrutR.position.y = -0.54;
  mainStrutR.rotation.z = 0.14;
  const mainTireR = new THREE.Mesh(mainTireGeo, tireMat);
  mainTireR.position.set(0.14, -1.06, 0);
  mainGearRPivot.add(mainStrutR, mainTireR);
  gearGroup.add(mainGearRPivot);

  gearGroup.visible = false;
  root.add(gearGroup);

  let gearProgress = 0;

  return {
    root,
    spec,
    cockpit,
    updateVisuals: ({
      pitchInput,
      rollInput,
      yawInput,
      throttle01,
      afterburner,
      airbrake,
      mach,
      iasKts,
      altitudeFt,
      pitchDeg,
      rollDeg,
      aoaDeg,
      gForce,
      firingGun,
      gunAmmo,
      irMissilesLeft,
      radarMissilesLeft,
      flares,
      stallWarning,
      missileWarning,
      isCockpitCam,
      hullPct,
      gearDown,
      windFromDeg,
      windSpeedKts,
      weatherRegime,
      elapsed,
      dt,
    }) => {
      // Control surface deflections
      leftAileron.rotation.x = -rollInput * 0.42;
      rightAileron.rotation.x = rollInput * 0.42;
      leftStab.rotation.x = pitchInput * 0.36 - rollInput * 0.12;
      rightStab.rotation.x = pitchInput * 0.36 + rollInput * 0.12;
      for (const r of rudders) {
        r.rotation.y = yawInput * 0.34;
      }

      // Close-coupled Foreplane Canards (Typhoon)
      if (canardL && canardR) {
        const targetCanard = -pitchInput * 0.34 - THREE.MathUtils.clamp(aoaDeg * 0.015, -0.2, 0.3);
        canardL.rotation.x = THREE.MathUtils.damp(canardL.rotation.x, targetCanard - rollInput * 0.1, 14, dt);
        canardR.rotation.x = THREE.MathUtils.damp(canardR.rotation.x, targetCanard + rollInput * 0.1, 14, dt);
      }

      // Automated Mach-coupled Variable-Sweep Swing Wings (F-14D Tomcat: 20 deg low speed -> 68 deg supersonic)
      if (wingPivotL && wingPivotR) {
        const sweepRatio = THREE.MathUtils.clamp((mach - 0.55) / 0.55, 0, 1);
        const targetSweep = sweepRatio * 0.72; // swings aft around +Y on L and -Y on R
        wingPivotL.rotation.y = THREE.MathUtils.damp(wingPivotL.rotation.y, targetSweep, 3.2, dt);
        wingPivotR.rotation.y = THREE.MathUtils.damp(wingPivotR.rotation.y, -targetSweep, 3.2, dt);
      }

      // Airbrake deployment
      const targetBrake = airbrake ? -0.68 : 0;
      airbrakeFlap.rotation.x += (targetBrake - airbrakeFlap.rotation.x) * 0.18;

      // Engine nozzles & afterburner plumes (variable turkey feathers open wider under AB)
      const flicker = 0.92 + Math.sin(elapsed * 58) * 0.08;
      const abPower = afterburner ? 1.0 + (throttle01 - 0.8) * 1.4 : Math.max(0.08, throttle01 * 0.35);
      const lenScale = (afterburner ? 1.15 : 0.28) * abPower * flicker;
      const radScale = afterburner ? 1.0 : 0.58;
      const petalSpread = afterburner ? 1.12 : 0.84 + throttle01 * 0.18;

      const engineActive = throttle01 > 0.08;
      const isDamaged = hullPct < 50;
      const isCritical = hullPct < 25;
      const sputterWave = Math.sin(elapsed * 21.0) * Math.sin(elapsed * 8.7);
      const portFlameout = isCritical || (isDamaged && sputterWave > -0.15);
      const stbdSputter = isCritical && Math.sin(elapsed * 17.3) > 0.55;

      nozControls.forEach((nc, idx) => {
        nc.petalRing.scale.x = THREE.MathUtils.damp(nc.petalRing.scale.x, petalSpread, 10, dt);
        nc.petalRing.scale.y = THREE.MathUtils.damp(nc.petalRing.scale.y, petalSpread, 10, dt);

        const isPort = idx === 0;
        const flamedOut = isPort ? portFlameout : stbdSputter;
        const dmgScale = isPort && isDamaged ? 0.55 : !isPort && stbdSputter ? 0.45 : 1;
        nc.abGroup.scale.set(radScale, radScale, lenScale * dmgScale);
        nc.abGroup.visible = engineActive && !flamedOut;
      });

      if (isDamaged) {
        const fireFlicker = 0.65 + Math.sin(elapsed * 37) * 0.35;
        dmgFireMesh.visible = !isCockpitCam && (isCritical || sputterWave > -0.45);
        dmgFireMesh.scale.set(
          0.7 + fireFlicker * 0.45,
          0.7 + fireFlicker * 0.45,
          (isCritical ? 1.25 : 0.75) * fireFlicker
        );
        abLight.intensity = (afterburner && !stbdSputter ? 3.2 : 1.6) * fireFlicker;
      } else {
        dmgFireMesh.visible = false;
        abLight.intensity = afterburner ? 4.5 * flicker : throttle01 * 0.6;
      }

      // Muzzle flash
      if (firingGun) {
        muzzleFlash.visible = Math.random() > 0.25;
        muzzleFlash.rotation.z = Math.random() * Math.PI * 2;
        muzzleFlash.scale.setScalar(0.85 + Math.random() * 0.5);
        muzzleLight.intensity = 6;
      } else {
        muzzleFlash.visible = false;
        muzzleLight.intensity = 0;
      }

      // Dynamic ordnance visibility on hardpoints
      const totalIr = irHardpoints.length;
      for (let i = 0; i < totalIr; i++) {
        irHardpoints[i].visible = irMissilesLeft >= totalIr - i;
      }
      const totalRad = radarHardpoints.length;
      for (let i = 0; i < totalRad; i++) {
        radarHardpoints[i].visible = radarMissilesLeft >= totalRad - i;
      }

      // Transonic vapor cone near Mach 0.96..1.06
      const transonic = Math.max(0, 1 - Math.abs(mach - 1.0) / 0.055);
      if (transonic > 0.05) {
        vaporCone.visible = true;
        vaporMat.opacity = transonic * 0.34;
        vaporCone.scale.setScalar(0.9 + (1 - transonic) * 0.35);
      } else {
        vaporCone.visible = false;
      }

      // Landing gear deployment & retraction animation
      gearProgress = THREE.MathUtils.damp(gearProgress, gearDown ? 1 : 0, 5.5, dt);
      gearGroup.visible = gearProgress > 0.03;
      if (gearGroup.visible) {
        noseGearPivot.rotation.x = -(1 - gearProgress) * 1.48;
        mainGearLPivot.rotation.x = (1 - gearProgress) * 1.45;
        mainGearRPivot.rotation.x = (1 - gearProgress) * 1.45;
      }

      // Live 3D Cockpit Update
      cockpit.update({
        aircraftCode: spec.code,
        twinEngine: spec.twinEngine,
        pitchInput,
        rollInput,
        yawInput,
        throttle01,
        afterburner,
        mach,
        iasKts,
        altitudeFt,
        pitchDeg,
        rollDeg,
        aoaDeg,
        gForce,
        hullPct,
        gunAmmo,
        irMissilesLeft,
        radarMissilesLeft,
        flares,
        stallWarning,
        missileWarning,
        isCockpitCam,
        gearDown,
        windFromDeg,
        windSpeedKts,
        weatherRegime,
        dt,
      });
    },
    dispose: () => {
      cockpit.dispose();
      disposables.forEach((d) => d.dispose());
    },
  };
}

export function createEnemyFighterModel(mats: SimMaterialLibrary): {
  root: THREE.Group;
  abLeft: THREE.Mesh;
  abRight: THREE.Mesh;
  dispose: () => void;
} {
  const root = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };

  // Su-27 / MiG-29 Aggressor silhouette with recessed intakes, pitot nose, nav lights & red accents
  const hull = new THREE.Mesh(
    track(new THREE.BoxGeometry(1.7, 0.72, 9.6)),
    mats.enemyFuselage
  );
  hull.castShadow = true;
  root.add(hull);

  const nose = new THREE.Mesh(
    track(new THREE.ConeGeometry(0.68, 4.4, 14).rotateX(-Math.PI / 2)),
    mats.enemyFuselage
  );
  nose.scale.set(1.1, 0.72, 1);
  nose.position.set(0, 0.02, -6.9);
  root.add(nose);

  const radome = new THREE.Mesh(
    track(new THREE.ConeGeometry(0.24, 1.1, 12).rotateX(-Math.PI / 2)),
    mats.enemyAccent
  );
  radome.position.set(0, 0.0, -9.2);
  root.add(radome);

  const pitot = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.015, 0.026, 0.85, 8).rotateX(Math.PI / 2)),
    mats.titaniumNozzle
  );
  pitot.position.set(0, 0.0, -10.1);
  root.add(pitot);

  // Recessed twin intakes
  const intakeGeo = track(new THREE.BoxGeometry(0.62, 0.45, 3.8));
  const cavGeo = track(new THREE.BoxGeometry(0.48, 0.34, 0.35));
  for (const side of [-1, 1]) {
    const iBox = new THREE.Mesh(intakeGeo, mats.enemyAccent);
    iBox.position.set(side * 0.88, -0.28, -2.0);
    const cav = new THREE.Mesh(cavGeo, mats.intakeDark);
    cav.position.set(side * 0.88, -0.28, -3.85);
    root.add(iBox, cav);
  }

  // Canopy
  const canopy = new THREE.Mesh(
    track(new THREE.SphereGeometry(0.55, 14, 10)).scale(0.78, 0.68, 2.3),
    mats.canopyGlass
  );
  canopy.position.set(0, 0.56, -3.5);
  root.add(canopy);

  // Swept wings
  const wingL = new THREE.Mesh(
    track(createSweptWingGeometry(4.0, 1.1, 5.4, 2.7, 0.16, -1)),
    mats.enemyFuselage
  );
  wingL.position.set(-0.85, 0.0, 0.4);
  wingL.castShadow = true;
  const wingR = new THREE.Mesh(
    track(createSweptWingGeometry(4.0, 1.1, 5.4, 2.7, 0.16, 1)),
    mats.enemyFuselage
  );
  wingR.position.set(0.85, 0.0, 0.4);
  wingR.castShadow = true;
  root.add(wingL, wingR);

  // Aggressor red wingtips & nav lights
  const tipGeo = track(new THREE.BoxGeometry(0.75, 0.12, 1.1));
  const tipL = new THREE.Mesh(tipGeo, mats.enemyAccent);
  tipL.position.set(-6.0, 0.08, 3.0);
  const tipR = new THREE.Mesh(tipGeo, mats.enemyAccent);
  tipR.position.set(6.0, 0.08, 3.0);
  root.add(tipL, tipR);

  // Twin vertical fins + horizontal stabs
  const finGeo = track(createFinGeometry(2.1, 0.75, 2.35, 1.1, 0.1));
  const finL = new THREE.Mesh(finGeo, mats.enemyAccent);
  finL.position.set(-1.05, 0.35, 4.1);
  const finR = new THREE.Mesh(finGeo, mats.enemyAccent);
  finR.position.set(1.05, 0.35, 4.1);
  root.add(finL, finR);

  const stabL = new THREE.Mesh(
    track(createSweptWingGeometry(1.9, 0.65, 2.4, 1.1, 0.11, -1)),
    mats.enemyFuselage
  );
  stabL.position.set(-0.85, 0.0, 4.6);
  const stabR = new THREE.Mesh(
    track(createSweptWingGeometry(1.9, 0.65, 2.4, 1.1, 0.11, 1)),
    mats.enemyFuselage
  );
  stabR.position.set(0.85, 0.0, 4.6);
  root.add(stabL, stabR);

  // Twin engine nozzles + plumes
  const nozL = createNozzleGroup(mats, 0.52, disposables);
  nozL.group.position.set(-0.66, 0, 4.6);
  const nozR = createNozzleGroup(mats, 0.52, disposables);
  nozR.group.position.set(0.66, 0, 4.6);
  root.add(nozL.group, nozR.group);

  const abGeo = track(new THREE.ConeGeometry(0.36, 4.4, 12).rotateX(Math.PI / 2));
  abGeo.translate(0, 0, 2.2);
  const abLeft = new THREE.Mesh(abGeo, mats.afterburnerHalo);
  abLeft.position.set(-0.66, 0, 5.9);
  const abRight = new THREE.Mesh(abGeo, mats.afterburnerHalo);
  abRight.position.set(0.66, 0, 5.9);
  root.add(abLeft, abRight);

  return {
    root,
    abLeft,
    abRight,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}
