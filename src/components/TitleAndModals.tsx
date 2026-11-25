import React from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { AIRCRAFT_CATALOG, getAircraftSpec } from '../sim/aircraftCatalog';
import type { AircraftId, ControlMode, HudTelemetry } from '../sim/types';

interface TitleScreenProps {
  selectedAircraft: AircraftId;
  controlMode: ControlMode;
  isMuted: boolean;
  onSelectAircraft: (id: AircraftId) => void;
  onSelectControlMode: (mode: ControlMode) => void;
  onToggleMute: () => void;
  onStart: () => void;
}

export const TitleScreen: React.FC<TitleScreenProps> = ({
  selectedAircraft,
  controlMode,
  isMuted,
  onSelectAircraft,
  onSelectControlMode,
  onToggleMute,
  onStart,
}) => {
  const activeSpec = getAircraftSpec(selectedAircraft);
  const thrustRatio = (activeSpec.maxAbThrustN / (activeSpec.massKg * 9.81)).toFixed(2);

  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-between p-6 md:p-10 pointer-events-none">
      {/* Top Bar: Clean bespoke SVG lockup & Hangar selector on left + single mute button on right */}
      <div className="flex items-start justify-between gap-6">
        <div className="pointer-events-auto max-w-xl bg-[#070d16]/78 border border-slate-700/55 rounded-xl px-6 py-5">
          {/* Bespoke inline SVG aviation insignia & title lockup */}
          <svg
            viewBox="0 0 360 66"
            className="w-64 md:w-72 h-auto mb-2.5"
            aria-label="Vanguard"
          >
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

          <p className="text-sm text-slate-300 leading-relaxed max-w-lg mb-4">
            Supersonic air-superiority simulator with 6-DOF aerodynamics, live cockpit instrumentation, and four selectable tactical airframes.
          </p>

          {/* 4-Aircraft Hangar Selector (Live 3D Preview Switching) */}
          <div className="mb-4">
            <div className="text-xs font-medium text-slate-400 mb-2">Select Aircraft</div>
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

            {/* Active Aircraft Brief & Tabular Metrics */}
            <div className="mt-3 pt-3 border-t border-slate-800/90 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                <span className="font-semibold text-slate-100">
                  {activeSpec.code} {activeSpec.name} · {activeSpec.role}
                </span>
                <span className="font-mono-hud text-slate-400 tabular-nums">{activeSpec.camoLabel}</span>
              </div>
              <p className="text-slate-300 leading-snug mb-2.5">{activeSpec.summary}</p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono-hud text-[11px] text-emerald-300 tabular-nums">
                <span>MAX M {activeSpec.maxMach.toFixed(2)}</span>
                <span className="text-slate-600">/</span>
                <span>T/W {thrustRatio}</span>
                <span className="text-slate-600">/</span>
                <span>20MM {activeSpec.gunAmmo}</span>
                <span className="text-slate-600">/</span>
                <span>
                  MSL {activeSpec.missilesIr} IR + {activeSpec.missilesRadar} BVR
                </span>
              </div>
            </div>
          </div>

          {/* Control Mode Selection & Primary Launch CTA */}
          <div className="flex flex-wrap items-center gap-4 mb-3">
            <div className="flex items-center gap-1 p-1 bg-slate-900/90 border border-slate-700/70 rounded-lg">
              <button
                type="button"
                onClick={() => onSelectControlMode('mouse')}
                className={`px-3.5 py-2 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
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
                className={`px-3.5 py-2 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
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
              className="px-7 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display font-bold text-sm tracking-wider uppercase whitespace-nowrap transition-colors cursor-pointer"
            >
              Launch Sortie
            </button>
          </div>

          <p className="text-xs font-mono-hud text-slate-400">
            Press Enter or Space to launch · Land or low-pass on Runway 09R/27L in shifting crosswinds to rearm & repair
          </p>
        </div>

        <button
          type="button"
          onClick={onToggleMute}
          className="pointer-events-auto flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#070d16]/80 border border-slate-700/70 text-xs font-medium text-slate-200 hover:text-white transition-colors shrink-0"
        >
          {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
          <span>{isMuted ? 'Muted' : 'Audio On'}</span>
        </button>
      </div>

      {/* Single Flat Control-Hint Line */}
      <div className="self-center px-5 py-2 rounded-lg bg-[#070d16]/78 border border-slate-700/50 text-xs font-mono-hud text-slate-300 text-center">
        Mouse / WASD Flight · LMB / Space Cannon · RMB / E Missile · 1 / 2 Select · Shift AB · B Airbrake · G Gear · F Flares · C Camera · Esc Pause
      </div>
    </div>
  );
};

interface ModalProps {
  telemetry: HudTelemetry;
  onResume: () => void;
  onRestart: () => void;
  onReturnToTitle: () => void;
}

export const PauseOrGameOverModal: React.FC<ModalProps> = ({
  telemetry,
  onResume,
  onRestart,
  onReturnToTitle,
}) => {
  const isGameOver = telemetry.phase === 'gameover';
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
          <p className="text-xs font-mono-hud text-amber-400 mb-1">
            {isGameOver ? 'AIRFRAME LOST' : 'SIMULATION PAUSED'}
          </p>
          <h2 className="text-2xl font-display font-bold text-white tracking-wide">
            {isGameOver ? 'Sortie Debrief' : 'Flight Controls & Status'}
          </h2>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-6 text-xs font-mono-hud">
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

        {!isGameOver && (
          <div className="text-xs text-slate-300 bg-slate-900/60 border border-slate-800 rounded-lg p-3.5 mb-6 space-y-1 font-mono-hud">
            <div>Pitch / Roll: Mouse Aim or W/S/A/D · Rudder: Q / Z</div>
            <div>Throttle: Shift (AB) / B (Airbrake) / G (Gear) / Wheel</div>
            <div>Weapons: Space / LMB (20mm) · E / RMB (Missile) · F (Flares)</div>
            <div>View & Radar: C (Camera) · Tab (Cycle Target) · 1/2 (Missile)</div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {!isGameOver && (
            <button
              type="button"
              onClick={onResume}
              className="flex-1 px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display font-bold text-sm tracking-wider uppercase transition-colors cursor-pointer"
            >
              Resume
            </button>
          )}
          <button
            type="button"
            onClick={onRestart}
            className="flex-1 px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-sm tracking-wider uppercase transition-colors cursor-pointer"
          >
            {isGameOver ? 'Fly Again' : 'Restart'}
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
