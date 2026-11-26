/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { HudOverlay } from './components/HudOverlay';
import { SettingsModal } from './components/SettingsModal';
import { PauseOrGameOverModal, TitleScreen, type TitleViewMode } from './components/TitleAndModals';
import {
  CAREER_STORAGE_KEY,
  loadCareerRecord,
  resetCareerRecord,
  saveCareerRecord,
  type CareerRecord,
  type SortieLogEntry,
} from './sim/careerStorage';
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

interface SortieTracker {
  active: boolean;
  sortieId: string;
  recordedFlightSec: number;
  recordedKills: number;
  recordedShotsFired: number;
  recordedShotsHit: number;
  missionOutcomeRecorded: boolean;
}

function createFreshSortieTracker(active: boolean): SortieTracker {
  return {
    active,
    sortieId: `sortie_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    recordedFlightSec: 0,
    recordedKills: 0,
    recordedShotsFired: 0,
    recordedShotsHit: 0,
    missionOutcomeRecorded: false,
  };
}

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

  const [titleView, setTitleView] = useState<TitleViewMode>('setup');
  const [careerRecord, setCareerRecord] = useState<CareerRecord>(() => loadCareerRecord());

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
  const sortieTrackerRef = useRef<SortieTracker>(createFreshSortieTracker(false));

  const flushCareerProgress = useCallback(
    (t: HudTelemetry, finalizeOutcome?: SortieLogEntry['outcome']) => {
      const tr = sortieTrackerRef.current;
      if (!tr.active) return;

      const deltaTime = Math.max(0, t.flightTimeSec - tr.recordedFlightSec);
      const deltaKills = Math.max(0, t.kills - tr.recordedKills);
      const deltaFired = Math.max(0, t.shotsFired - tr.recordedShotsFired);
      const deltaHit = Math.max(0, t.shotsHit - tr.recordedShotsHit);

      if (!finalizeOutcome && deltaTime < 0.1 && deltaKills === 0 && deltaFired === 0 && deltaHit === 0) {
        return;
      }

      tr.recordedFlightSec = Math.max(tr.recordedFlightSec, t.flightTimeSec);
      tr.recordedKills = Math.max(tr.recordedKills, t.kills);
      tr.recordedShotsFired = Math.max(tr.recordedShotsFired, t.shotsFired);
      tr.recordedShotsHit = Math.max(tr.recordedShotsHit, t.shotsHit);

      const base = loadCareerRecord();
      const nextKillsByAircraft = { ...base.killsByAircraft };
      if (deltaKills > 0) {
        nextKillsByAircraft[t.aircraftId] = (nextKillsByAircraft[t.aircraftId] ?? 0) + deltaKills;
      }

      let nextMissionsAttempted = base.missionsAttempted;
      let nextMissionsCompleted = base.missionsCompleted;
      let nextTotalSorties = base.totalSorties;
      let nextTotalScore = base.totalScore;
      let nextRecentSorties = [...base.recentSorties];

      if (finalizeOutcome && !tr.missionOutcomeRecorded) {
        tr.missionOutcomeRecorded = true;
        nextTotalSorties += 1;
        nextTotalScore += Math.max(0, t.score);
        if (finalizeOutcome === 'success') {
          nextMissionsAttempted += 1;
          nextMissionsCompleted += 1;
        } else if (finalizeOutcome === 'failed') {
          nextMissionsAttempted += 1;
        }
        const entry: SortieLogEntry = {
          id: tr.sortieId,
          timestampIso: new Date().toISOString(),
          aircraftId: t.aircraftId,
          aircraftLabel: t.aircraftLabel,
          missionTitle: t.missionTitle,
          missionType: t.missionType,
          kills: t.kills,
          score: t.score,
          flightTimeSec: t.flightTimeSec,
          shotsFired: t.shotsFired,
          shotsHit: t.shotsHit,
          outcome: finalizeOutcome,
        };
        nextRecentSorties = [entry, ...nextRecentSorties].slice(0, 8);
      } else if (tr.missionOutcomeRecorded) {
        nextRecentSorties = nextRecentSorties.map((entry) =>
          entry.id === tr.sortieId
            ? {
                ...entry,
                kills: t.kills,
                score: Math.max(entry.score, t.score),
                flightTimeSec: Math.max(entry.flightTimeSec, t.flightTimeSec),
                shotsFired: t.shotsFired,
                shotsHit: t.shotsHit,
              }
            : entry
        );
      }

      const saved = saveCareerRecord({
        ...base,
        totalKills: base.totalKills + deltaKills,
        totalFlightSeconds: base.totalFlightSeconds + deltaTime,
        missionsAttempted: nextMissionsAttempted,
        missionsCompleted: nextMissionsCompleted,
        totalSorties: nextTotalSorties,
        totalScore: nextTotalScore,
        bestScore: Math.max(base.bestScore, t.score),
        totalShotsFired: base.totalShotsFired + deltaFired,
        totalShotsHit: base.totalShotsHit + deltaHit,
        killsByAircraft: nextKillsByAircraft,
        recentSorties: nextRecentSorties,
      });

      setCareerRecord(saved);
    },
    []
  );

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

  // Keep engine keyboard capture suppressed while Settings modal or Career Record view is open
  useEffect(() => {
    const suppress = settingsOpen || (telemetry.phase === 'title' && titleView === 'career');
    engineRef.current?.setInputCaptureSuppressed(suppress);
  }, [settingsOpen, telemetry.phase, titleView]);

  // Sync Career Record if localStorage is updated from another tab
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === CAREER_STORAGE_KEY || e.key === null) {
        setCareerRecord(loadCareerRecord());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Periodically persist in-flight hours/kills and flush on pagehide
  useEffect(() => {
    const onPageHide = () => {
      if (sortieTrackerRef.current.active) {
        flushCareerProgress(telemetryRef.current);
      }
    };
    window.addEventListener('pagehide', onPageHide);
    const interval = window.setInterval(() => {
      if (telemetryRef.current.phase === 'playing' && sortieTrackerRef.current.active) {
        flushCareerProgress(telemetryRef.current);
      }
    }, 10000);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.clearInterval(interval);
    };
  }, [flushCareerProgress]);

  // Sortie lifecycle tracking: Career Record persistence + Adaptive difficulty evaluation
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = telemetry.phase;

    if (prev === 'title' && telemetry.phase === 'playing') {
      // Covers keyboard Enter/Space launch directly from Title Screen
      if (!sortieTrackerRef.current.active) {
        sortieTrackerRef.current = createFreshSortieTracker(true);
      }
      setTitleView('setup');
    }

    if (prev === 'playing' && (telemetry.phase === 'gameover' || telemetry.phase === 'victory')) {
      flushCareerProgress(telemetry, telemetry.phase === 'victory' ? 'success' : 'failed');

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
  }, [
    telemetry,
    telemetry.phase,
    telemetry.shotsFired,
    telemetry.shotsHit,
    telemetry.kills,
    telemetry.hullPct,
    telemetry.flightTimeSec,
    telemetry.wave,
    flushCareerProgress,
  ]);

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
    if (sortieTrackerRef.current.active) {
      if (!sortieTrackerRef.current.missionOutcomeRecorded && telemetryRef.current.flightTimeSec >= 3) {
        flushCareerProgress(telemetryRef.current, 'aborted');
      } else {
        flushCareerProgress(telemetryRef.current);
      }
    }
    sortieTrackerRef.current = createFreshSortieTracker(true);
    setTitleView('setup');
    setRadioFeed([]);
    setCopilotOpen(false);
    engineRef.current?.startSortie(false);
  };

  const handleContinueEndless = () => engineRef.current?.startSortie(true);
  const handleTogglePause = () => engineRef.current?.togglePause();

  const handleReturnToTitle = () => {
    if (sortieTrackerRef.current.active) {
      if (!sortieTrackerRef.current.missionOutcomeRecorded && telemetryRef.current.flightTimeSec >= 3) {
        flushCareerProgress(telemetryRef.current, 'aborted');
      } else {
        flushCareerProgress(telemetryRef.current);
      }
      sortieTrackerRef.current.active = false;
    }
    setCareerRecord(loadCareerRecord());
    engineRef.current?.setPhase('title');
  };

  const handleChangeTitleView = (view: TitleViewMode) => {
    if (view === 'career') {
      setCareerRecord(loadCareerRecord());
    }
    setTitleView(view);
  };

  const handleResetCareerRecord = () => {
    setCareerRecord(resetCareerRecord());
  };

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
          titleView={titleView}
          careerRecord={careerRecord}
          onSelectAircraft={handleSelectAircraft}
          onSelectControlMode={handleSetControlMode}
          onSelectMissionType={handleSelectMissionType}
          onSelectTimeOfDay={handleSelectTimeOfDay}
          onGenerateAiMission={handleGenerateAiMission}
          onChangeTitleView={handleChangeTitleView}
          onResetCareerRecord={handleResetCareerRecord}
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
