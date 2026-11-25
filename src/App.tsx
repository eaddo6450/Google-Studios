/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { HudOverlay } from './components/HudOverlay';
import { PauseOrGameOverModal, TitleScreen } from './components/TitleAndModals';
import { JetSimulatorEngine } from './sim/engine';
import type { AircraftId, CameraMode, ControlMode, HudTelemetry, WeaponType } from './sim/types';

const INITIAL_TELEMETRY: HudTelemetry = {
  phase: 'title',
  aircraftId: 'f22',
  aircraftLabel: 'F-22A Raptor',
  airspeedKts: 430,
  trueAirspeedMps: 235,
  mach: 0.7,
  altitudeFt: 3018,
  radarAltitudeFt: 2950,
  headingDeg: 0,
  pitchDeg: 0,
  rollDeg: 0,
  aoaDeg: 2.1,
  gForce: 1.0,
  throttlePct: 72,
  afterburner: false,
  airbrake: false,
  stallWarning: false,
  terrainWarning: false,
  missileWarning: false,
  rwrLockWarning: false,
  hullPct: 100,
  gunAmmo: 480,
  maxGunAmmo: 480,
  missilesIr: 2,
  missilesRadar: 6,
  selectedWeapon: 'missile_ir',
  flares: 16,
  flareCooldown: 0,
  score: 0,
  kills: 0,
  wave: 1,
  enemiesRemaining: 0,
  lockStatus: 'NONE',
  lockProgress: 0,
  lockedTargetCallsign: null,
  lockedTargetRangeKm: null,
  fpvX: 720,
  fpvY: 450,
  fpvVisible: true,
  boreX: 720,
  boreY: 450,
  mouseAimX: 720,
  mouseAimY: 450,
  targets: [],
  radarBlips: [],
  cameraMode: 'chase',
  controlMode: 'mouse',
  isMuted: false,
  gLocActive: false,
  gLocIntensity: 0,
  gTolerancePct: 100,
  redoutIntensity: 0,
  hitMarkerTimer: 0,
  killBanner: null,
  resupplyNotice: null,
  flightTimeSec: 0,
  shotsFired: 0,
  shotsHit: 0,
  weatherRegime: 'BREEZY',
  weatherLabel: 'COASTAL X-WIND',
  windFromDeg: 278,
  windSpeedKts: 21,
  gustSpeedKts: 28,
  windRelativeDeg: 278,
  weatherShifting: false,
  weatherNextShiftSec: 38,
  stormFactor: 0.25,
  gearDown: false,
  onRunwayGround: false,
  runwayDistanceKm: 3.0,
  runwayBearingDeg: 0,
  runwayApproachActive: false,
  localizerOffset: 0,
  glideslopeOffset: 0,
  crosswindKts: 21,
  headwindKts: 0,
  verticalSpeedFpm: 0,
};

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<JetSimulatorEngine | null>(null);
  const [telemetry, setTelemetry] = useState<HudTelemetry>(INITIAL_TELEMETRY);
  const [webglError, setWebglError] = useState(false);

  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    try {
      const probe = document.createElement('canvas');
      if (!probe.getContext('webgl2') && !probe.getContext('webgl')) {
        setWebglError(true);
        return;
      }

      const engine = new JetSimulatorEngine(container, (nextTelemetry) => {
        setTelemetry(nextTelemetry);
      });
      engineRef.current = engine;

      return () => {
        engine.dispose();
        engineRef.current = null;
      };
    } catch {
      setWebglError(true);
    }
  }, []);

  const handleSelectAircraft = (id: AircraftId) => engineRef.current?.setAircraft(id);
  const handleStart = () => engineRef.current?.startSortie();
  const handleTogglePause = () => engineRef.current?.togglePause();
  const handleReturnToTitle = () => engineRef.current?.setPhase('title');
  const handleSetCamera = (mode: CameraMode) => engineRef.current?.setCameraMode(mode);
  const handleSetControlMode = (mode: ControlMode) => engineRef.current?.setControlMode(mode);
  const handleSetWeapon = (w: WeaponType) => engineRef.current?.setWeapon(w);
  const handleToggleGear = () => engineRef.current?.toggleGear();
  const handleToggleMute = () => {
    engineRef.current?.toggleMute();
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#070b12]">
      {/* Isolated WebGL Mount Container */}
      <div ref={canvasMountRef} className="absolute inset-0 w-full h-full" />

      {webglError && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#070b12] p-8 text-center">
          <div className="max-w-md bg-[#0b121c] border border-slate-700 rounded-xl p-6">
            <h1 className="text-xl font-display font-bold text-white mb-2">WebGL Context Unavailable</h1>
            <p className="text-sm text-slate-300">
              Hardware or software WebGL2 acceleration is required to render the 3D flight environment.
            </p>
          </div>
        </div>
      )}

      {!webglError && telemetry.phase === 'title' && (
        <TitleScreen
          selectedAircraft={telemetry.aircraftId}
          controlMode={telemetry.controlMode}
          isMuted={telemetry.isMuted}
          onSelectAircraft={handleSelectAircraft}
          onSelectControlMode={handleSetControlMode}
          onToggleMute={handleToggleMute}
          onStart={handleStart}
        />
      )}

      {!webglError && telemetry.phase === 'playing' && (
        <HudOverlay
          telemetry={telemetry}
          onSetCamera={handleSetCamera}
          onSetControlMode={handleSetControlMode}
          onSetWeapon={handleSetWeapon}
          onToggleGear={handleToggleGear}
          onToggleMute={handleToggleMute}
          onPause={handleTogglePause}
        />
      )}

      {!webglError && (telemetry.phase === 'paused' || telemetry.phase === 'gameover') && (
        <PauseOrGameOverModal
          telemetry={telemetry}
          onResume={handleTogglePause}
          onRestart={handleStart}
          onReturnToTitle={handleReturnToTitle}
        />
      )}
    </div>
  );
}
