/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { HudOverlay } from './components/HudOverlay';
import { SettingsModal } from './components/SettingsModal';
import { PauseOrGameOverModal, TitleScreen } from './components/TitleAndModals';
import {
  DEFAULT_CONTROL_BINDINGS,
  DEFAULT_DIFFICULTY_PROFILE,
  DEFAULT_GRAPHICS_SETTINGS,
  PRESET_MISSIONS,
  formatKeyCode,
} from './sim/defaults';
import { JetSimulatorEngine } from './sim/engine';
import type {
  AdaptiveDifficultyProfile,
  AircraftId,
  CameraMode,
  ControlBindings,
  ControlMode,
  GraphicsSettings,
  HudTelemetry,
  MissionSpec,
  MissionType,
  RadioMessage,
  SimEventPayload,
  TimeOfDay,
  WeaponType,
} from './sim/types';

const LS_GRAPHICS_KEY = 'vanguard_graphics_v1';
const LS_BINDINGS_KEY = 'vanguard_bindings_v1';
const LS_DIFFICULTY_KEY = 'vanguard_difficulty_v1';

function loadStoredJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    return fallback;
  }
}

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
  projectedWaypoints: [],
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
  glocCount: 0,
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
  fps: 60,
  renderScaleActual: 1.0,
  webGpuSupported: false,
  webGpuFlagActive: false,
  timeOfDay: 'day',
  missionTitle: PRESET_MISSIONS.destroy.title,
  missionType: 'destroy',
  missionObjectiveText: 'Destroy Hostiles',
  missionProgressPct: 0,
  escortHullPct: null,
  skillTier: 'VETERAN',
};

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<JetSimulatorEngine | null>(null);
  const telemetryRef = useRef<HudTelemetry>(INITIAL_TELEMETRY);

  const [telemetry, setTelemetry] = useState<HudTelemetry>(INITIAL_TELEMETRY);
  const [webglError, setWebglError] = useState(false);

  const [graphics, setGraphics] = useState<GraphicsSettings>(() =>
    loadStoredJson(LS_GRAPHICS_KEY, DEFAULT_GRAPHICS_SETTINGS)
  );
  const [bindings, setBindings] = useState<ControlBindings>(() =>
    loadStoredJson(LS_BINDINGS_KEY, DEFAULT_CONTROL_BINDINGS)
  );
  const [difficulty, setDifficulty] = useState<AdaptiveDifficultyProfile>(() =>
    loadStoredJson(LS_DIFFICULTY_KEY, DEFAULT_DIFFICULTY_PROFILE)
  );
  const [mission, setMission] = useState<MissionSpec>(() => structuredClone(PRESET_MISSIONS.destroy));
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>('day');

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiGeneratingMission, setAiGeneratingMission] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [radioFeed, setRadioFeed] = useState<RadioMessage[]>([]);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotBusy, setCopilotBusy] = useState(false);
  const [copilotMessages, setCopilotMessages] = useState<
    Array<{ id: string; role: 'pilot' | 'copilot' | 'error'; text: string }>
  >([]);

  const lastCommsCallRef = useRef(0);
  const prevPhaseRef = useRef<HudTelemetry['phase']>('title');

  const triggerRadioComms = useCallback(async (ev: SimEventPayload) => {
    const now = Date.now();
    // Rate-limit frequent radio chatter cleanly while allowing mission_start/victory
    if (ev.type !== 'mission_start' && ev.type !== 'mission_victory' && now - lastCommsCallRef.current < 4500) {
      return;
    }
    lastCommsCallRef.current = now;

    try {
      const res = await fetch('/api/ai/comms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: ev.type,
          detail: ev.detail,
          aircraftLabel: telemetryRef.current.aircraftLabel,
          weatherLabel: telemetryRef.current.weatherLabel,
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        speaker: string;
        channel: RadioMessage['channel'];
        tone: RadioMessage['tone'];
        text: string;
      };
      if (data.text) {
        setRadioFeed((prev) => [
          ...prev.slice(-3),
          {
            id: `rad_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            speaker: data.speaker,
            channel: data.channel,
            tone: data.tone,
            text: data.text,
            timestampSec: telemetryRef.current.flightTimeSec,
          },
        ]);
      }
    } catch {
      // Non-critical combat chatter request failures never disrupt 60fps flight
    }
  }, []);

  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    try {
      const probe = document.createElement('canvas');
      if (!probe.getContext('webgl2') && !probe.getContext('webgl')) {
        setWebglError(true);
        return;
      }

      const engine = new JetSimulatorEngine(
        container,
        (nextTelemetry) => {
          telemetryRef.current = nextTelemetry;
          setTelemetry(nextTelemetry);
        },
        (ev) => {
          void triggerRadioComms(ev);
        }
      );

      engine.setGraphicsSettings(graphics);
      engine.setControlBindings(bindings);
      engine.setDifficultyProfile(difficulty);
      engine.setMission(mission);
      engineRef.current = engine;

      return () => {
        engine.dispose();
        engineRef.current = null;
      };
    } catch {
      setWebglError(true);
    }
    // Mount WebGL engine once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Adaptive difficulty evaluation on sortie end (gameover or victory)
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = telemetry.phase;

    if (prev === 'playing' && (telemetry.phase === 'gameover' || telemetry.phase === 'victory')) {
      const acc = telemetry.shotsFired > 0 ? Math.round((telemetry.shotsHit / telemetry.shotsFired) * 100) : 0;
      void (async () => {
        try {
          const res = await fetch('/api/ai/difficulty', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              accuracyPct: acc,
              kills: telemetry.kills,
              hullPct: telemetry.hullPct,
              flightTimeSec: telemetry.flightTimeSec,
              wave: telemetry.wave,
            }),
          });
          if (!res.ok) return;
          const nextProfile = (await res.json()) as AdaptiveDifficultyProfile;
          setDifficulty(nextProfile);
          localStorage.setItem(LS_DIFFICULTY_KEY, JSON.stringify(nextProfile));
          engineRef.current?.setDifficultyProfile(nextProfile);
        } catch {
          // Keep previous adaptive difficulty profile cleanly
        }
      })();
    }
  }, [telemetry.phase, telemetry.shotsFired, telemetry.shotsHit, telemetry.kills, telemetry.hullPct, telemetry.flightTimeSec, telemetry.wave]);

  const handleChangeGraphics = (next: GraphicsSettings) => {
    setGraphics(next);
    localStorage.setItem(LS_GRAPHICS_KEY, JSON.stringify(next));
    engineRef.current?.setGraphicsSettings(next);
  };

  const handleChangeBindings = (next: ControlBindings) => {
    setBindings(next);
    localStorage.setItem(LS_BINDINGS_KEY, JSON.stringify(next));
    engineRef.current?.setControlBindings(next);
  };

  const handleSelectMissionType = (type: MissionType) => {
    const preset = structuredClone(PRESET_MISSIONS[type]);
    preset.timeOfDay = timeOfDay;
    setMission(preset);
    setAiError(null);
    engineRef.current?.setMission(preset);
  };

  const handleSelectTimeOfDay = (tod: TimeOfDay) => {
    setTimeOfDay(tod);
    setMission((prev) => ({ ...prev, timeOfDay: tod }));
    engineRef.current?.setTimeOfDay(tod);
  };

  const handleGenerateAiMission = async () => {
    setAiGeneratingMission(true);
    setAiError(null);
    try {
      const res = await fetch('/api/ai/mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objectiveType: mission.objectiveType,
          timeOfDay,
          difficulty: difficulty.skillTier,
          aircraftLabel: telemetry.aircraftLabel,
        }),
      });
      const payload = (await res.json()) as MissionSpec & { error?: string };
      if (!res.ok) {
        setAiError(payload.error || 'Failed to generate AI mission.');
        return;
      }
      setMission(payload);
      setTimeOfDay(payload.timeOfDay);
      engineRef.current?.setMission(payload);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Network error reaching AI mission service.');
    } finally {
      setAiGeneratingMission(false);
    }
  };

  const handleAskCopilot = async (question: string) => {
    setCopilotMessages((prev) => [
      ...prev.slice(-6),
      { id: `u_${Date.now()}`, role: 'pilot', text: question },
    ]);
    setCopilotBusy(true);

    const t = telemetryRef.current;
    const telemetrySummary = `${t.aircraftLabel}, IAS ${t.airspeedKts}KTS, Mach ${t.mach.toFixed(2)}, ALT ${t.altitudeFt}FT, Hull ${t.hullPct}%, Weather ${t.weatherLabel} (${t.windSpeedKts}KT), Missiles ${t.missilesIr} IR / ${t.missilesRadar} BVR, Gear ${t.gearDown ? 'DOWN' : 'UP'}, Runway ${t.runwayDistanceKm}km`;
    const controlsSummary = `Pitch ${formatKeyCode(bindings.pitchUp)}/${formatKeyCode(bindings.pitchDown)}, Roll ${formatKeyCode(bindings.rollLeft)}/${formatKeyCode(bindings.rollRight)}, Gun ${formatKeyCode(bindings.fireGun)}, Missile ${formatKeyCode(bindings.fireMissile)}, Flare ${formatKeyCode(bindings.flare)}, Gear ${formatKeyCode(bindings.gear)}`;

    try {
      const res = await fetch('/api/ai/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          telemetrySummary,
          controlsSummary,
          missionSummary: `${mission.title} (${mission.objectiveType}): ${t.missionObjectiveText}`,
        }),
      });
      const data = (await res.json()) as { reply?: string; error?: string };
      if (!res.ok) {
        setCopilotMessages((prev) => [
          ...prev.slice(-6),
          { id: `e_${Date.now()}`, role: 'error', text: data.error || 'Co-Pilot unavailable.' },
        ]);
        return;
      }
      setCopilotMessages((prev) => [
        ...prev.slice(-6),
        { id: `a_${Date.now()}`, role: 'copilot', text: data.reply || 'Standing by.' },
      ]);
    } catch (err) {
      setCopilotMessages((prev) => [
        ...prev.slice(-6),
        {
          id: `e_${Date.now()}`,
          role: 'error',
          text: err instanceof Error ? err.message : 'Unable to reach Co-Pilot service.',
        },
      ]);
    } finally {
      setCopilotBusy(false);
    }
  };

  const handleSelectAircraft = (id: AircraftId) => engineRef.current?.setAircraft(id);
  const handleStart = () => {
    setRadioFeed([]);
    setCopilotOpen(false);
    engineRef.current?.startSortie(false);
  };
  const handleContinueEndless = () => engineRef.current?.startSortie(true);
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
          mission={mission}
          timeOfDay={timeOfDay}
          aiGeneratingMission={aiGeneratingMission}
          aiError={aiError}
          onSelectAircraft={handleSelectAircraft}
          onSelectControlMode={handleSetControlMode}
          onSelectMissionType={handleSelectMissionType}
          onSelectTimeOfDay={handleSelectTimeOfDay}
          onGenerateAiMission={handleGenerateAiMission}
          onOpenSettings={() => setSettingsOpen(true)}
          onToggleMute={handleToggleMute}
          onStart={handleStart}
        />
      )}

      {!webglError && telemetry.phase === 'playing' && (
        <HudOverlay
          telemetry={telemetry}
          radioFeed={radioFeed}
          copilotOpen={copilotOpen}
          copilotMessages={copilotMessages}
          copilotBusy={copilotBusy}
          onToggleCopilot={() => setCopilotOpen((o) => !o)}
          onAskCopilot={handleAskCopilot}
          onOpenSettings={() => setSettingsOpen(true)}
          onSetCamera={handleSetCamera}
          onSetControlMode={handleSetControlMode}
          onSetWeapon={handleSetWeapon}
          onToggleGear={handleToggleGear}
          onToggleMute={handleToggleMute}
          onPause={handleTogglePause}
        />
      )}

      {!webglError &&
        (telemetry.phase === 'paused' || telemetry.phase === 'gameover' || telemetry.phase === 'victory') && (
          <PauseOrGameOverModal
            telemetry={telemetry}
            difficulty={difficulty}
            onResume={handleTogglePause}
            onRestart={handleStart}
            onContinueEndless={handleContinueEndless}
            onOpenSettings={() => setSettingsOpen(true)}
            onReturnToTitle={handleReturnToTitle}
          />
        )}

      {settingsOpen && (
        <SettingsModal
          graphics={graphics}
          bindings={bindings}
          webGpuSupported={telemetry.webGpuSupported}
          webGpuFlagActive={telemetry.webGpuFlagActive}
          onChangeGraphics={handleChangeGraphics}
          onChangeBindings={handleChangeBindings}
          onSetCaptureSuppressed={(s) => engineRef.current?.setInputCaptureSuppressed(s)}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
