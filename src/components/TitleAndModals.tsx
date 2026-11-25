import React from 'react';
import { Volume2, VolumeX, Sparkles, Sliders, Compass, Shield, Crosshair } from 'lucide-react';
import { AIRCRAFT_CATALOG, getAircraftSpec } from '../sim/aircraftCatalog';
import type {
  AdaptiveDifficultyProfile,
  AircraftId,
  ControlMode,
  HudTelemetry,
  MissionSpec,
  MissionType,
  TimeOfDay,
} from '../sim/types';

interface TitleScreenProps {
  selectedAircraft: AircraftId;
  controlMode: ControlMode;
  isMuted: boolean;
  mission: MissionSpec;
  timeOfDay: TimeOfDay;
  aiGeneratingMission: boolean;
  aiError: string | null;
  onSelectAircraft: (id: AircraftId) => void;
  onSelectControlMode: (mode: ControlMode) => void;
  onSelectMissionType: (type: MissionType) => void;
  onSelectTimeOfDay: (tod: TimeOfDay) => void;
  onGenerateAiMission: () => void;
  onOpenSettings: () => void;
  onToggleMute: () => void;
  onStart: () => void;
}

const MISSION_TYPES: Array<{ id: MissionType; label: string; icon: React.ReactNode }> = [
  { id: 'destroy', label: 'Destroy', icon: <Crosshair className="w-3.5 h-3.5" /> },
  { id: 'escort', label: 'Escort', icon: <Shield className="w-3.5 h-3.5" /> },
  { id: 'recon', label: 'Recon', icon: <Compass className="w-3.5 h-3.5" /> },
];

const TIME_OPTIONS: Array<{ id: TimeOfDay; label: string }> = [
  { id: 'dawn', label: 'Dawn' },
  { id: 'day', label: 'Day' },
  { id: 'dusk', label: 'Dusk' },
  { id: 'night', label: 'Night' },
];

export const TitleScreen: React.FC<TitleScreenProps> = ({
  selectedAircraft,
  controlMode,
  isMuted,
  mission,
  timeOfDay,
  aiGeneratingMission,
  aiError,
  onSelectAircraft,
  onSelectControlMode,
  onSelectMissionType,
  onSelectTimeOfDay,
  onGenerateAiMission,
  onOpenSettings,
  onToggleMute,
  onStart,
}) => {
  const activeSpec = getAircraftSpec(selectedAircraft);
  const thrustRatio = (activeSpec.maxAbThrustN / (activeSpec.massKg * 9.81)).toFixed(2);

  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-between p-5 md:p-8 pointer-events-none overflow-y-auto">
      <div className="flex items-start justify-between gap-4">
        <div className="pointer-events-auto max-w-xl bg-[#070d16]/82 border border-slate-700/60 rounded-xl px-6 py-5 shadow-2xl">
          {/* Bespoke inline SVG aviation lockup */}
          <svg viewBox="0 0 360 66" className="w-56 md:w-64 h-auto mb-2" aria-label="Vanguard">
            <g fill="none" stroke="#f59e0b" strokeWidth="2.2">
              <polygon points="18,48 34,16 50,48 34,39" fill="#f59e0b" fillOpacity="0.18" />
              <line x1="8" y1="53" x2="60" y2="53" stroke="#94a3b8" strokeWidth="1.4" />
            </g>
            <text
              x="74"
              y="43"
              fill="#f8fafc"
              fontFamily="Chakra Petch, sans-serif"
              fontWeight="700"
              fontSize="36"
              letterSpacing="4"
            >
              VANGUARD
            </text>
          </svg>

          {/* 4-Aircraft Hangar Selector */}
          <div className="mb-3.5">
            <div className="text-xs font-medium text-slate-400 mb-1.5">Select Aircraft</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {AIRCRAFT_CATALOG.map((jet) => {
                const active = jet.id === selectedAircraft;
                return (
                  <button
                    key={jet.id}
                    type="button"
                    onClick={() => onSelectAircraft(jet.id)}
                    className={`px-3 py-2 rounded-lg text-left border transition-colors cursor-pointer whitespace-nowrap ${
                      active
                        ? 'bg-emerald-500/18 border-emerald-400/70 text-white'
                        : 'bg-slate-900/80 border-slate-700/60 text-slate-300 hover:border-slate-500 hover:text-white'
                    }`}
                  >
                    <div className="text-xs font-display font-bold tracking-wide">{jet.code}</div>
                    <div className="text-[11px] text-slate-400 truncate">{jet.name}</div>
                  </button>
                );
              })}
            </div>

            <div className="mt-2.5 pt-2.5 border-t border-slate-800/90 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <span className="font-semibold text-slate-100">
                  {activeSpec.code} {activeSpec.name} · {activeSpec.role}
                </span>
                <span className="font-mono-hud text-[11px] text-emerald-300 tabular-nums">
                  M{activeSpec.maxMach.toFixed(2)} · T/W {thrustRatio} · {activeSpec.missilesIr} IR / {activeSpec.missilesRadar} BVR
                </span>
              </div>
              <p className="text-slate-300 leading-snug text-[12px]">{activeSpec.summary}</p>
            </div>
          </div>

          {/* Mission Type, Time-of-Day & AI Mission Generator */}
          <div className="mb-4 pt-3 border-t border-slate-800/90">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <span className="text-xs font-medium text-slate-400">Sortie Mission & Time of Day</span>
              <button
                type="button"
                onClick={onGenerateAiMission}
                disabled={aiGeneratingMission}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/50 text-sky-200 text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5 text-sky-300" />
                <span>{aiGeneratingMission ? 'Generating...' : 'Generate AI Mission'}</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 mb-2.5">
              <div className="flex items-center gap-1 p-0.5 bg-slate-900/90 border border-slate-700/70 rounded-lg">
                {MISSION_TYPES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onSelectMissionType(m.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                      mission.objectiveType === m.id
                        ? 'bg-emerald-500/22 text-emerald-300 border border-emerald-500/40'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {m.icon}
                    <span>{m.label}</span>
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1 p-0.5 bg-slate-900/90 border border-slate-700/70 rounded-lg">
                {TIME_OPTIONS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onSelectTimeOfDay(t.id)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                      timeOfDay === t.id
                        ? 'bg-amber-500/22 text-amber-300 border border-amber-500/40'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-slate-900/75 border border-slate-800 rounded-lg px-3.5 py-2.5 text-xs">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-display font-bold tracking-wide text-slate-100">
                  {mission.title}
                </span>
                <span className="font-mono-hud text-[11px] text-amber-300">
                  {mission.sectorLabel} · {mission.weatherRegime}
                </span>
              </div>
              <p className="text-slate-300 text-[12px] leading-snug">{mission.briefing}</p>
            </div>

            {aiError && (
              <div className="mt-2 px-3 py-1.5 rounded bg-red-950/75 border border-red-500/40 text-[11px] font-mono-hud text-red-200">
                {aiError}
              </div>
            )}
          </div>

          {/* Control Mode, Settings & Primary Launch CTA */}
          <div className="flex flex-wrap items-center gap-3 mb-2.5">
            <div className="flex items-center gap-1 p-1 bg-slate-900/90 border border-slate-700/70 rounded-lg">
              <button
                type="button"
                onClick={() => onSelectControlMode('mouse')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                  controlMode === 'mouse'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Mouse Aim
              </button>
              <button
                type="button"
                onClick={() => onSelectControlMode('keyboard')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                  controlMode === 'keyboard'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Keyboard Stick
              </button>
            </div>

            <button
              type="button"
              onClick={onStart}
              className="px-6 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display font-bold text-sm tracking-wider uppercase whitespace-nowrap transition-colors cursor-pointer"
            >
              Launch Sortie
            </button>
          </div>

          <p className="text-[11px] font-mono-hud text-slate-400">
            Enter / Space to launch · Land or low-pass on Runway 09R/27L in shifting crosswinds to rearm & repair
          </p>
        </div>

        {/* Top-Right Controls: Settings + Audio */}
        <div className="pointer-events-auto flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#070d16]/80 border border-slate-700/70 text-xs font-medium text-slate-200 hover:text-white transition-colors cursor-pointer"
          >
            <Sliders className="w-4 h-4 text-sky-400" />
            <span>Settings & Keys</span>
          </button>
          <button
            type="button"
            onClick={onToggleMute}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#070d16]/80 border border-slate-700/70 text-xs font-medium text-slate-200 hover:text-white transition-colors cursor-pointer"
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
            <span>{isMuted ? 'Muted' : 'Audio On'}</span>
          </button>
        </div>
      </div>

      <div className="self-center px-5 py-2 rounded-lg bg-[#070d16]/78 border border-slate-700/50 text-xs font-mono-hud text-slate-300 text-center">
        Mouse / WASD Flight · LMB / Space Cannon · RMB / E Missile · 1 / 2 Select · Shift AB · B Airbrake · G Gear · F Flares · C Camera · H Co-Pilot
      </div>
    </div>
  );
};

interface ModalProps {
  telemetry: HudTelemetry;
  difficulty: AdaptiveDifficultyProfile;
  onResume: () => void;
  onRestart: () => void;
  onContinueEndless: () => void;
  onOpenSettings: () => void;
  onReturnToTitle: () => void;
}

export const PauseOrGameOverModal: React.FC<ModalProps> = ({
  telemetry,
  difficulty,
  onResume,
  onRestart,
  onContinueEndless,
  onOpenSettings,
  onReturnToTitle,
}) => {
  const isGameOver = telemetry.phase === 'gameover';
  const isVictory = telemetry.phase === 'victory';
  const accuracy =
    telemetry.shotsFired > 0
      ? Math.round((telemetry.shotsHit / telemetry.shotsFired) * 100)
      : 0;
  const mins = Math.floor(telemetry.flightTimeSec / 60);
  const secs = Math.floor(telemetry.flightTimeSec % 60);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#04070d]/72 p-6">
      <div className="w-full max-w-md bg-[#0b121c] border border-slate-700/80 rounded-xl p-7 shadow-2xl">
        <div className="mb-5">
          <p
            className={`text-xs font-mono-hud mb-1 ${
              isVictory ? 'text-emerald-400' : isGameOver ? 'text-red-400' : 'text-amber-400'
            }`}
          >
            {isVictory ? 'MISSION ACCOMPLISHED' : isGameOver ? 'SORTIE FAILED' : 'SIMULATION PAUSED'}
          </p>
          <h2 className="text-2xl font-display font-bold text-white tracking-wide">
            {isVictory || isGameOver ? 'Sortie Debrief' : 'Flight Controls & Status'}
          </h2>
          <p className="text-xs font-mono-hud text-slate-400 mt-1">{telemetry.missionTitle}</p>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4 text-xs font-mono-hud">
          <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3">
            <div className="text-slate-400 mb-0.5">SCORE</div>
            <div className="text-lg font-bold text-amber-300">{telemetry.score.toLocaleString()}</div>
          </div>
          <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3">
            <div className="text-slate-400 mb-0.5">AIRCRAFT SPLASHED</div>
            <div className="text-lg font-bold text-emerald-300">{telemetry.kills}</div>
          </div>
          <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3">
            <div className="text-slate-400 mb-0.5">WAVE / GUN ACC</div>
            <div className="text-sm font-semibold text-slate-100">
              Wave {telemetry.wave} · {accuracy}%
            </div>
          </div>
          <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3">
            <div className="text-slate-400 mb-0.5">FLIGHT TIME</div>
            <div className="text-sm font-semibold text-slate-100">
              {mins}:{String(secs).padStart(2, '0')}
            </div>
          </div>
        </div>

        <div className="bg-slate-900/75 border border-slate-800 rounded-lg p-3 mb-5 text-xs">
          <div className="flex items-center justify-between font-mono-hud text-[11px] text-sky-300 mb-1">
            <span>ADAPTIVE AI TIER</span>
            <span className="font-semibold">{difficulty.skillTier}</span>
          </div>
          <p className="text-slate-300 leading-snug">{difficulty.coachingNote}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {!isGameOver && !isVictory && (
            <button
              type="button"
              onClick={onResume}
              className="flex-1 px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display font-bold text-sm tracking-wider uppercase transition-colors cursor-pointer"
            >
              Resume
            </button>
          )}
          {isVictory && (
            <button
              type="button"
              onClick={onContinueEndless}
              className="flex-1 px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display font-bold text-sm tracking-wider uppercase transition-colors cursor-pointer"
            >
              Next Wave
            </button>
          )}
          <button
            type="button"
            onClick={onRestart}
            className="flex-1 px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-sm tracking-wider uppercase transition-colors cursor-pointer"
          >
            {isGameOver || isVictory ? 'Replay Mission' : 'Restart'}
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="px-3.5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs transition-colors cursor-pointer"
          >
            Settings
          </button>
          <button
            type="button"
            onClick={onReturnToTitle}
            className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-sm transition-colors cursor-pointer"
          >
            Title
          </button>
        </div>
      </div>
    </div>
  );
};
