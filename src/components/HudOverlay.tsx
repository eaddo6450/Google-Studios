import React, { useEffect, useState } from 'react';
import {
  Volume2,
  VolumeX,
  Camera,
  Crosshair,
  Pause,
  ChevronDown,
  ChevronUp,
  Wind,
  PlaneLanding,
  Sliders,
  Radio,
  Bot,
  Send,
  X,
} from 'lucide-react';
import type {
  CameraMode,
  ControlMode,
  HudTelemetry,
  RadioMessage,
  WeaponType,
} from '../sim/types';

interface CopilotMessage {
  id: string;
  role: 'pilot' | 'copilot' | 'error';
  text: string;
}

interface HudOverlayProps {
  telemetry: HudTelemetry;
  radioFeed: RadioMessage[];
  copilotOpen: boolean;
  copilotMessages: CopilotMessage[];
  copilotBusy: boolean;
  onToggleCopilot: () => void;
  onAskCopilot: (question: string) => void;
  onOpenSettings: () => void;
  onSetCamera: (mode: CameraMode) => void;
  onSetControlMode: (mode: ControlMode) => void;
  onSetWeapon: (w: WeaponType) => void;
  onToggleGear: () => void;
  onToggleMute: () => void;
  onPause: () => void;
}

const PITCH_RUNGS = [-30, -20, -10, 0, 10, 20, 30];

export const HudOverlay: React.FC<HudOverlayProps> = ({
  telemetry,
  radioFeed,
  copilotOpen,
  copilotMessages,
  copilotBusy,
  onToggleCopilot,
  onAskCopilot,
  onOpenSettings,
  onSetCamera,
  onSetControlMode,
  onSetWeapon,
  onToggleGear,
  onToggleMute,
  onPause,
}) => {
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [questionInput, setQuestionInput] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'KeyH') {
        onToggleCopilot();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onToggleCopilot]);

  const hudColor = telemetry.missileWarning || telemetry.terrainWarning ? '#fbbf24' : '#4ade80';
  const pxPerDeg = 5.2;
  const hudVisibility = Math.max(0.14, 1 - telemetry.gLocIntensity * 0.86);

  const handleSubmitCopilot = (e: React.FormEvent) => {
    e.preventDefault();
    const q = questionInput.trim();
    if (!q || copilotBusy) return;
    setQuestionInput('');
    onAskCopilot(q);
  };

  return (
    <div className="fixed inset-0 z-10 pointer-events-none overflow-hidden select-none">
      {/* Collimated HUD & Perimeter Clusters */}
      <div className="absolute inset-0" style={{ opacity: hudVisibility }}>
        <svg className="absolute inset-0 w-full h-full">
          {/* Center Pitch Ladder & Horizon Line */}
          <g
            transform={`translate(${telemetry.boreX}, ${telemetry.boreY}) rotate(${-telemetry.rollDeg})`}
            opacity={0.78}
          >
            {PITCH_RUNGS.map((deg) => {
              const yOffset = (telemetry.pitchDeg - deg) * pxPerDeg;
              if (Math.abs(yOffset) > 195) return null;
              const isHorizon = deg === 0;
              const halfGap = isHorizon ? 58 : 26;
              const arm = isHorizon ? 120 : 56;
              return (
                <g key={deg} transform={`translate(0, ${yOffset})`}>
                  <line
                    x1={-arm}
                    y1={0}
                    x2={-halfGap}
                    y2={0}
                    stroke={hudColor}
                    strokeWidth={isHorizon ? 1.5 : 1.2}
                    strokeDasharray={deg < 0 ? '6 4' : undefined}
                  />
                  <line
                    x1={halfGap}
                    y1={0}
                    x2={arm}
                    y2={0}
                    stroke={hudColor}
                    strokeWidth={isHorizon ? 1.5 : 1.2}
                    strokeDasharray={deg < 0 ? '6 4' : undefined}
                  />
                  {!isHorizon && (
                    <>
                      <line x1={-arm} y1={0} x2={-arm} y2={deg > 0 ? 7 : -7} stroke={hudColor} strokeWidth={1.2} />
                      <line x1={arm} y1={0} x2={arm} y2={deg > 0 ? 7 : -7} stroke={hudColor} strokeWidth={1.2} />
                      <text x={arm + 6} y={4} fill={hudColor} fontSize="10" fontFamily="JetBrains Mono, monospace">
                        {deg}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </g>

          {/* Boresight Watermark Cross */}
          <g transform={`translate(${telemetry.boreX}, ${telemetry.boreY})`} opacity={0.85}>
            <line x1={-10} y1={0} x2={-4} y2={0} stroke={hudColor} strokeWidth={1.4} />
            <line x1={4} y1={0} x2={10} y2={0} stroke={hudColor} strokeWidth={1.4} />
            <line x1={0} y1={-10} x2={0} y2={-4} stroke={hudColor} strokeWidth={1.4} />
            <line x1={0} y1={4} x2={0} y2={10} stroke={hudColor} strokeWidth={1.4} />
          </g>

          {/* Flight Path Vector */}
          {telemetry.fpvVisible && (
            <g transform={`translate(${telemetry.fpvX}, ${telemetry.fpvY})`} opacity={0.9}>
              <circle cx={0} cy={0} r={7} fill="none" stroke={hudColor} strokeWidth={1.5} />
              <line x1={-16} y1={0} x2={-7} y2={0} stroke={hudColor} strokeWidth={1.5} />
              <line x1={7} y1={0} x2={16} y2={0} stroke={hudColor} strokeWidth={1.5} />
              <line x1={0} y1={-13} x2={0} y2={-7} stroke={hudColor} strokeWidth={1.5} />
            </g>
          )}

          {/* ILS Glideslope & Localizer Needles */}
          {telemetry.runwayApproachActive && !telemetry.onRunwayGround && (
            <g transform={`translate(${telemetry.boreX}, ${telemetry.boreY})`} opacity={0.82}>
              <line x1={-76} y1={72} x2={76} y2={72} stroke="#38bdf8" strokeWidth={1} strokeOpacity={0.45} />
              <line x1={0} y1={66} x2={0} y2={78} stroke="#38bdf8" strokeWidth={1.2} strokeOpacity={0.6} />
              <line
                x1={-telemetry.localizerOffset * 68}
                y1={56}
                x2={-telemetry.localizerOffset * 68}
                y2={88}
                stroke="#38bdf8"
                strokeWidth={2.2}
              />
              <line x1={92} y1={-68} x2={92} y2={68} stroke="#38bdf8" strokeWidth={1} strokeOpacity={0.45} />
              <line x1={86} y1={0} x2={98} y2={0} stroke="#38bdf8" strokeWidth={1.2} strokeOpacity={0.6} />
              <line
                x1={78}
                y1={telemetry.glideslopeOffset * 60}
                x2={106}
                y2={telemetry.glideslopeOffset * 60}
                stroke="#38bdf8"
                strokeWidth={2.2}
              />
            </g>
          )}

          {/* Mouse-Aim Flight Director Reticle */}
          {telemetry.controlMode === 'mouse' && (
            <g transform={`translate(${telemetry.mouseAimX}, ${telemetry.mouseAimY})`} opacity={0.7}>
              <circle cx={0} cy={0} r={15} fill="none" stroke="#e2e8f0" strokeWidth={1.2} strokeDasharray="4 4" />
              <circle cx={0} cy={0} r={2} fill="#e2e8f0" />
            </g>
          )}

          {/* Hit Marker Flash */}
          {telemetry.hitMarkerTimer > 0 && (
            <g transform={`translate(${telemetry.boreX}, ${telemetry.boreY})`} opacity={0.95}>
              <line x1={-14} y1={-14} x2={-6} y2={-6} stroke="#facc15" strokeWidth={2} />
              <line x1={14} y1={-14} x2={6} y2={-6} stroke="#facc15" strokeWidth={2} />
              <line x1={-14} y1={14} x2={-6} y2={6} stroke="#facc15" strokeWidth={2} />
              <line x1={14} y1={14} x2={6} y2={6} stroke="#facc15" strokeWidth={2} />
            </g>
          )}

          {/* Mission Waypoints & Escort Markers */}
          {telemetry.projectedWaypoints.map((wp) => {
            const w = typeof window !== 'undefined' ? window.innerWidth : 1440;
            const h = typeof window !== 'undefined' ? window.innerHeight : 900;
            const onScreen = wp.inFront && wp.x > 24 && wp.x < w - 24 && wp.y > 24 && wp.y < h - 24;
            const color = wp.kind === 'escort' ? '#38bdf8' : '#22d3ee';

            if (!onScreen) {
              const cx = w / 2;
              const cy = h / 2;
              const angle = Math.atan2(wp.inFront ? wp.y - cy : -(wp.y - cy), wp.inFront ? wp.x - cx : -(wp.x - cx));
              const r = Math.min(cx, cy) - 68;
              return (
                <g
                  key={wp.id}
                  transform={`translate(${cx + Math.cos(angle) * r}, ${cy + Math.sin(angle) * r}) rotate(${(angle * 180) / Math.PI})`}
                  opacity={0.85}
                >
                  <polygon points="8,0 -5,-5 -2,0 -5,5" fill={color} />
                </g>
              );
            }

            return (
              <g key={wp.id} transform={`translate(${wp.x}, ${wp.y})`}>
                <polygon points="0,-14 14,0 0,14 -14,0" fill="none" stroke={color} strokeWidth={1.6} />
                <text x={18} y={-2} fill={color} fontSize="10" fontFamily="JetBrains Mono, monospace">
                  {wp.label}
                </text>
                <text x={18} y={10} fill={color} fontSize="10" fontFamily="JetBrains Mono, monospace">
                  {(wp.distanceMeters / 1000).toFixed(1)}km
                </text>
              </g>
            );
          })}

          {/* Enemy Target Designator Boxes, Lock Diamond & Gun Lead Pipper */}
          {telemetry.targets.map((t) => {
            const w = typeof window !== 'undefined' ? window.innerWidth : 1440;
            const h = typeof window !== 'undefined' ? window.innerHeight : 900;
            const onScreen = t.inFront && t.x > 24 && t.x < w - 24 && t.y > 24 && t.y < h - 24;

            if (!onScreen) {
              const cx = w / 2;
              const cy = h / 2;
              const angle = Math.atan2(
                t.inFront ? t.y - cy : -(t.y - cy),
                t.inFront ? t.x - cx : -(t.x - cx)
              );
              const r = Math.min(cx, cy) - 52;
              const ex = cx + Math.cos(angle) * r;
              const ey = cy + Math.sin(angle) * r;
              return (
                <g
                  key={t.id}
                  transform={`translate(${ex}, ${ey}) rotate(${(angle * 180) / Math.PI})`}
                  opacity={t.isLocked ? 0.95 : 0.65}
                >
                  <polygon
                    points="8,0 -6,-5 -3,0 -6,5"
                    fill={t.isLockingPlayer ? '#ef4444' : t.isLocked ? '#f59e0b' : '#4ade80'}
                  />
                </g>
              );
            }

            const boxColor =
              t.isLocked && telemetry.lockStatus === 'LOCK'
                ? '#ef4444'
                : t.isLocked
                ? '#f59e0b'
                : '#4ade80';

            return (
              <g key={t.id}>
                <g transform={`translate(${t.x}, ${t.y})`}>
                  <rect x={-16} y={-16} width={32} height={32} fill="none" stroke={boxColor} strokeWidth={t.isLocked ? 1.8 : 1.2} />
                  {t.isLocked && (
                    <polygon
                      points="0,-24 24,0 0,24 -24,0"
                      fill="none"
                      stroke={boxColor}
                      strokeWidth={1.3}
                      strokeDasharray={telemetry.lockStatus === 'LOCK' ? undefined : '4 4'}
                    />
                  )}
                  <text x={22} y={-6} fill={boxColor} fontSize="10" fontFamily="JetBrains Mono, monospace">
                    {t.callsign} {t.aiMode === 'retreat' ? '[RTR]' : ''}
                  </text>
                  <text x={22} y={7} fill={boxColor} fontSize="10" fontFamily="JetBrains Mono, monospace">
                    {(t.distanceMeters / 1000).toFixed(1)}km
                  </text>
                  <rect x={-16} y={20} width={32} height={2.5} fill="rgba(15,23,42,0.75)" />
                  <rect x={-16} y={20} width={32 * t.healthRatio} height={2.5} fill={boxColor} />
                </g>

                {t.isLocked && t.leadValid && (
                  <g>
                    <line
                      x1={t.x}
                      y1={t.y}
                      x2={t.leadX}
                      y2={t.leadY}
                      stroke="#4ade80"
                      strokeWidth={1}
                      strokeDasharray="3 3"
                      opacity={0.65}
                    />
                    <circle cx={t.leadX} cy={t.leadY} r={10} fill="none" stroke="#4ade80" strokeWidth={1.6} />
                    <circle cx={t.leadX} cy={t.leadY} r={1.8} fill="#4ade80" />
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        {/* Top-Left: Airframe, Mission Objective & Score + Dynamic Radio Feed */}
        <div className="absolute top-4 left-5 flex flex-col gap-2 max-w-md">
          <div className="flex flex-wrap items-center gap-2.5 text-xs font-mono-hud text-emerald-300 bg-[#080d14]/78 px-3.5 py-2 rounded border border-emerald-500/25 tabular-nums">
            <span className="text-slate-100 font-semibold">{telemetry.aircraftLabel}</span>
            <span className="text-slate-500">/</span>
            <span className="text-sky-300 uppercase">{telemetry.missionType}</span>
            <span className="text-slate-500">/</span>
            <span>SPLASHED {telemetry.kills}</span>
            <span className="text-slate-500">/</span>
            <span className="text-amber-300 font-semibold">{telemetry.score.toLocaleString()} PTS</span>
          </div>

          <div className="bg-[#080d14]/75 border border-slate-700/70 rounded px-3 py-1.5 text-[11px] font-mono-hud text-slate-200 flex items-center justify-between gap-3">
            <span className="truncate">{telemetry.missionObjectiveText}</span>
            <span className="text-sky-300 font-semibold shrink-0">{telemetry.missionProgressPct}%</span>
          </div>

          {radioFeed.length > 0 && (
            <div className="flex flex-col gap-1">
              {radioFeed.slice(-2).map((msg) => (
                <div
                  key={msg.id}
                  className={`flex items-start gap-2 px-3 py-1.5 rounded border text-[11px] font-mono-hud bg-[#070d16]/82 ${
                    msg.tone === 'hostile'
                      ? 'border-red-500/40 text-red-200'
                      : msg.tone === 'alert'
                      ? 'border-amber-500/45 text-amber-200'
                      : 'border-sky-500/35 text-sky-100'
                  }`}
                >
                  <Radio className="w-3.5 h-3.5 mt-0.5 shrink-0 opacity-80" />
                  <div>
                    <span className="font-semibold mr-1.5">[{msg.speaker}]</span>
                    <span className="text-slate-200">{msg.text}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top-Center: Heading, Mach, G-Load, FPS */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 flex flex-col items-center">
          <div className="flex items-center gap-3 px-4 py-1.5 bg-[#080d14]/78 border border-emerald-500/30 rounded text-xs font-mono-hud text-emerald-300">
            <span>HDG {String(telemetry.headingDeg).padStart(3, '0')}°</span>
            <span className="text-slate-500">|</span>
            <span>M {telemetry.mach.toFixed(2)}</span>
            <span className="text-slate-500">|</span>
            <span className={telemetry.gForce > 6.5 || telemetry.gForce < -2.5 ? 'text-amber-400 font-semibold' : ''}>
              {telemetry.gForce.toFixed(1)} G
            </span>
            <span className="text-slate-500">|</span>
            <span className="text-slate-300">{telemetry.fps} FPS</span>
          </div>
        </div>

        {/* Top-Right: Weather, Time-of-Day, Wind Vector & Runway */}
        <div className="absolute top-4 right-5 flex items-center gap-2.5 text-xs font-mono-hud bg-[#080d14]/78 px-3.5 py-2 rounded border border-sky-500/30 tabular-nums">
          <Wind
            className={`w-3.5 h-3.5 ${
              telemetry.weatherRegime === 'STORM' || telemetry.weatherRegime === 'SQUALL'
                ? 'text-amber-400'
                : 'text-sky-300'
            }`}
          />
          <span
            className={
              telemetry.weatherRegime === 'STORM'
                ? 'text-red-300 font-semibold'
                : telemetry.weatherRegime === 'SQUALL'
                ? 'text-amber-300 font-semibold'
                : 'text-sky-200 font-semibold'
            }
          >
            {telemetry.weatherLabel}
          </span>
          <span className="text-slate-500">/</span>
          <span className="text-slate-200 uppercase">{telemetry.timeOfDay}</span>
          <span className="text-slate-500">/</span>
          <div className="flex items-center gap-1.5 text-slate-200">
            <svg width="14" height="14" viewBox="-10 -10 20 20" className="shrink-0">
              <g transform={`rotate(${telemetry.windRelativeDeg + 180})`}>
                <line x1={0} y1={7} x2={0} y2={-6} stroke="#38bdf8" strokeWidth={2} strokeLinecap="round" />
                <polygon points="0,-8 -3.5,-2 3.5,-2" fill="#38bdf8" />
              </g>
            </svg>
            <span>
              {String(telemetry.windFromDeg).padStart(3, '0')}° · {telemetry.windSpeedKts}G{telemetry.gustSpeedKts}KT
            </span>
          </div>
          <span className="text-slate-500">/</span>
          <span className="text-sky-300">
            RWY {telemetry.runwayDistanceKm.toFixed(1)}KM ({String(telemetry.runwayBearingDeg).padStart(3, '0')}°)
          </span>
        </div>

        {/* Left & Right Flight Telemetry Readouts */}
        <div className="absolute left-6 top-1/2 -translate-y-1/2 flex flex-col items-end gap-1 font-mono-hud text-emerald-300 bg-[#080d14]/70 px-3 py-2.5 rounded border border-emerald-500/25">
          <span className="text-[10px] text-emerald-400/75 tracking-wider">IAS KTS</span>
          <span className="text-2xl font-bold leading-none">{telemetry.airspeedKts}</span>
          <span className="text-[11px] text-slate-300 mt-1">AOA {telemetry.aoaDeg.toFixed(1)}°</span>
          <span className="text-[11px] text-amber-300">
            THR {telemetry.throttlePct}%{telemetry.afterburner ? ' AB' : ''}
          </span>
          {telemetry.airbrake && <span className="text-[11px] text-cyan-300 font-semibold">AIRBRAKE</span>}
          {telemetry.gearDown && (
            <span className="text-[11px] text-sky-300 font-semibold">
              {telemetry.onRunwayGround ? 'ON RWY' : 'GEAR DN'}
            </span>
          )}
        </div>

        <div className="absolute right-6 top-1/2 -translate-y-1/2 flex flex-col items-start gap-1 font-mono-hud text-emerald-300 bg-[#080d14]/70 px-3 py-2.5 rounded border border-emerald-500/25">
          <span className="text-[10px] text-emerald-400/75 tracking-wider">ALT FT</span>
          <span className="text-2xl font-bold leading-none">{telemetry.altitudeFt.toLocaleString()}</span>
          <span className="text-[11px] text-slate-300 mt-1">RALT {telemetry.radarAltitudeFt.toLocaleString()} FT</span>
          <span className="text-[11px] text-slate-300">VS {telemetry.verticalSpeedFpm} FPM</span>
          {telemetry.runwayApproachActive && (
            <div className="mt-1 pt-1 border-t border-slate-700/80 flex flex-col gap-0.5 text-[11px] text-sky-300">
              <span>
                X-WND {Math.abs(telemetry.crosswindKts)} KT {telemetry.crosswindKts > 1 ? '◄' : telemetry.crosswindKts < -1 ? '►' : ''}
              </span>
              <span>
                {telemetry.headwindKts >= 0 ? 'HDWND' : 'TLWND'} {Math.abs(telemetry.headwindKts)} KT
              </span>
            </div>
          )}
          {telemetry.lockedTargetCallsign && (
            <span className="text-[11px] text-amber-300 mt-0.5">
              TGT {telemetry.lockedTargetRangeKm?.toFixed(1)} KM · {telemetry.lockStatus}
            </span>
          )}
        </div>

        {/* Center Alert Stack */}
        <div className="absolute top-24 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5">
          {telemetry.missileWarning && (
            <div className="px-4 py-1 bg-red-600/90 border border-red-300 rounded text-xs font-mono-hud font-bold tracking-widest text-white">
              MISSILE INBOUND · DEPLOY FLARES [F]
            </div>
          )}
          {!telemetry.missileWarning && telemetry.rwrLockWarning && (
            <div className="px-3.5 py-1 bg-amber-600/85 border border-amber-300 rounded text-xs font-mono-hud font-semibold tracking-wider text-white">
              RWR RADAR LOCK
            </div>
          )}
          {telemetry.terrainWarning && (
            <div className="px-4 py-1 bg-red-700/90 border border-amber-300 rounded text-xs font-mono-hud font-bold tracking-widest text-amber-100">
              PULL UP · TERRAIN
            </div>
          )}
          {telemetry.stallWarning && (
            <div className="px-3.5 py-1 bg-amber-700/85 border border-amber-300 rounded text-xs font-mono-hud font-semibold tracking-wider text-amber-100">
              STALL · ANGLE OF ATTACK
            </div>
          )}
          {telemetry.killBanner && (
            <div className="px-4 py-1.5 bg-[#080d14]/88 border border-emerald-400/60 rounded text-sm font-display font-bold tracking-wider text-emerald-300">
              {telemetry.killBanner}
            </div>
          )}
          {telemetry.resupplyNotice && (
            <div className="px-4 py-1 bg-sky-900/90 border border-sky-400 rounded text-xs font-mono-hud font-semibold text-sky-100">
              {telemetry.resupplyNotice}
            </div>
          )}
        </div>

        {/* Bottom-Left Tactical Radar Scope (9 KM) */}
        <div className="absolute bottom-5 left-5 bg-[#080d14]/85 border border-emerald-500/35 rounded-full p-1.5">
          <svg width="136" height="136" viewBox="-100 -100 200 200">
            <circle cx={0} cy={0} r={96} fill="rgba(6, 22, 16, 0.72)" stroke="#22c55e" strokeWidth={1.2} strokeOpacity={0.45} />
            <circle cx={0} cy={0} r={64} fill="none" stroke="#22c55e" strokeWidth={0.8} strokeOpacity={0.25} />
            <circle cx={0} cy={0} r={32} fill="none" stroke="#22c55e" strokeWidth={0.8} strokeOpacity={0.25} />
            <line x1={0} y1={-96} x2={0} y2={96} stroke="#22c55e" strokeWidth={0.7} strokeOpacity={0.25} />
            <line x1={-96} y1={0} x2={96} y2={0} stroke="#22c55e" strokeWidth={0.7} strokeOpacity={0.25} />
            <polygon points="0,0 -48,-83 48,-83" fill="rgba(74, 222, 128, 0.08)" />

            {telemetry.radarBlips.map((b) => {
              const x = b.dx * 90;
              const y = b.dz * 90;
              if (b.isFriendlyRunway) {
                return <rect key={b.id} x={x - 3} y={y - 3} width={6} height={6} fill="#38bdf8" />;
              }
              if (b.isAlly) {
                return <polygon key={b.id} points={`${x},${y - 5} ${x + 5},${y} ${x},${y + 5} ${x - 5},${y}`} fill="#38bdf8" />;
              }
              if (b.isObjective) {
                return <circle key={b.id} cx={x} cy={y} r={4.2} fill="none" stroke="#22d3ee" strokeWidth={1.6} />;
              }
              if (b.isMissile) {
                return (
                  <polygon
                    key={b.id}
                    points={`${x},${y - 5} ${x + 4},${y + 4} ${x - 4},${y + 4}`}
                    fill="#ef4444"
                  />
                );
              }
              return (
                <g key={b.id} transform={`translate(${x}, ${y})`}>
                  <circle cx={0} cy={0} r={b.isLocked ? 4.5 : 3.2} fill={b.isLocked ? '#f59e0b' : '#ef4444'} />
                  {b.isLocked && <circle cx={0} cy={0} r={7.5} fill="none" stroke="#f59e0b" strokeWidth={1.2} />}
                </g>
              );
            })}

            <polygon points="0,-7 5,5 0,2 -5,5" fill="#4ade80" />
          </svg>
        </div>

        {/* Bottom-Right Airframe Hull & Ordnance Status */}
        <div className="absolute bottom-5 right-5 flex flex-col gap-2 bg-[#080d14]/82 border border-slate-700/80 rounded-lg px-4 py-3 text-xs font-mono-hud min-w-[228px]">
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-400">AIRFRAME</span>
            <span className={telemetry.hullPct >= 50 ? 'text-emerald-300 font-semibold' : 'text-red-400 font-semibold'}>
              {telemetry.hullPct}%
            </span>
          </div>
          <div className="w-full h-1.5 bg-slate-800 rounded overflow-hidden">
            <div
              className={`h-full ${telemetry.hullPct >= 50 ? 'bg-emerald-400' : 'bg-red-500'}`}
              style={{ width: `${telemetry.hullPct}%` }}
            />
          </div>
          {telemetry.hullPct < 50 && (
            <div className="text-[10px] font-semibold tracking-wider text-amber-400">
              {telemetry.hullPct < 25 ? 'ENG 1 FLAMEOUT · CRITICAL' : 'ENG 1 DAMAGE · SMOKE'}
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1 border-t border-slate-800">
            <div className="flex justify-between">
              <span className="text-slate-400">20MM</span>
              <span className="text-slate-100">{telemetry.gunAmmo}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">FLARE</span>
              <span className="text-amber-300">{telemetry.flares}</span>
            </div>
            <div className={`flex justify-between ${telemetry.selectedWeapon === 'missile_ir' ? 'text-emerald-300 font-semibold' : 'text-slate-400'}`}>
              <span>AIM-9X</span>
              <span>{telemetry.missilesIr}</span>
            </div>
            <div className={`flex justify-between ${telemetry.selectedWeapon === 'missile_radar' ? 'text-emerald-300 font-semibold' : 'text-slate-400'}`}>
              <span>AIM-120</span>
              <span>{telemetry.missilesRadar}</span>
            </div>
          </div>
        </div>
      </div>

      {/* In-Game Gemini Co-Pilot Tactical Assistant Drawer */}
      {copilotOpen && (
        <div className="fixed right-5 bottom-44 z-30 w-80 bg-[#08101c]/95 border border-sky-500/45 rounded-xl shadow-2xl pointer-events-auto flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-slate-800">
            <div className="flex items-center gap-2 text-xs font-display font-bold tracking-wide text-sky-200">
              <Bot className="w-4 h-4 text-sky-400" />
              <span>WSO CO-PILOT</span>
            </div>
            <button
              type="button"
              onClick={onToggleCopilot}
              className="p-1 rounded text-slate-400 hover:text-white cursor-pointer"
              aria-label="Close Co-Pilot"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="p-3 space-y-2 max-h-52 overflow-y-auto text-xs">
            {copilotMessages.length === 0 && (
              <p className="text-slate-400 text-[11px] leading-snug">
                Ask for crosswind landing guidance, energy-fighting tips, or active control bindings.
              </p>
            )}
            {copilotMessages.map((m) => (
              <div
                key={m.id}
                className={`px-2.5 py-1.5 rounded-lg leading-snug ${
                  m.role === 'pilot'
                    ? 'bg-emerald-500/15 text-emerald-100 ml-5'
                    : m.role === 'error'
                    ? 'bg-red-950/80 border border-red-500/40 text-red-200'
                    : 'bg-slate-800/90 text-slate-200 mr-4'
                }`}
              >
                {m.text}
              </div>
            ))}
          </div>

          <div className="px-3 pb-2 flex flex-wrap gap-1.5">
            {['Tactical advice?', 'How to land in wind?', 'Explain controls'].map((q) => (
              <button
                key={q}
                type="button"
                disabled={copilotBusy}
                onClick={() => onAskCopilot(q)}
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-mono-hud text-sky-200 cursor-pointer disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmitCopilot} className="flex items-center gap-1.5 p-2.5 border-t border-slate-800">
            <input
              type="text"
              value={questionInput}
              onChange={(e) => setQuestionInput(e.target.value)}
              placeholder="Ask Co-Pilot..."
              className="flex-1 bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-400"
            />
            <button
              type="submit"
              disabled={copilotBusy || !questionInput.trim()}
              className="p-1.5 rounded bg-sky-500 hover:bg-sky-400 text-slate-950 cursor-pointer disabled:opacity-50"
              aria-label="Send to Co-Pilot"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      )}

      {/* Physiological G-LOC / Redout Tunnel Vision & Screen Darkening */}
      {telemetry.gLocIntensity > 0.015 && (
        <>
          <div
            className="absolute inset-0 z-20 pointer-events-none"
            style={{
              backgroundColor: `rgba(2, 4, 8, ${Math.max(0, (telemetry.gLocIntensity - 0.55) * 1.45)})`,
            }}
          />
          <div
            className="absolute inset-0 z-20 pointer-events-none"
            style={{
              background: `radial-gradient(circle at center, rgba(2,4,8,${(telemetry.gLocIntensity * 0.42).toFixed(3)}) ${Math.max(4, 56 - telemetry.gLocIntensity * 52)}%, rgba(2,4,8,${Math.min(0.98, 0.35 + telemetry.gLocIntensity * 0.72).toFixed(3)}) ${Math.max(22, 92 - telemetry.gLocIntensity * 58)}%, rgba(0,0,0,0.99) 100%)`,
            }}
          />
        </>
      )}
      {telemetry.redoutIntensity > 0.015 && (
        <div
          className="absolute inset-0 z-20 pointer-events-none"
          style={{
            background: `radial-gradient(circle at center, rgba(153,27,27,${(telemetry.redoutIntensity * 0.25).toFixed(3)}) 22%, rgba(185,28,28,${Math.min(0.88, telemetry.redoutIntensity * 0.85).toFixed(3)}) 100%)`,
          }}
        />
      )}

      {(telemetry.gLocActive || telemetry.gLocIntensity > 0.16) && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-30 pointer-events-none flex flex-col items-center gap-1.5">
          <div
            className={`px-4 py-1.5 rounded border text-xs font-mono-hud font-bold tracking-widest ${
              telemetry.gLocActive
                ? 'bg-red-950/90 border-red-400 text-red-200'
                : 'bg-amber-950/85 border-amber-400 text-amber-200'
            }`}
          >
            {telemetry.gLocActive
              ? 'G-LOC · LOSS OF CONSCIOUSNESS · RECOVERING'
              : `HIGH-G BLACKOUT · PERFUSION ${telemetry.gTolerancePct}%`}
          </div>
        </div>
      )}

      {/* Collapsible Bottom-Center Control Dock */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-auto z-30">
        <button
          type="button"
          onClick={() => setDockCollapsed((c) => !c)}
          className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-medium text-slate-300 bg-[#0b121c]/90 border border-slate-700/80 rounded-t-md hover:text-white transition-colors cursor-pointer"
        >
          {dockCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span>{dockCollapsed ? 'Show Flight Bar' : 'Hide Bar'}</span>
        </button>

        {!dockCollapsed && (
          <div className="flex items-center gap-1.5 px-3 py-2 bg-[#0b121c]/92 border border-slate-700/80 rounded-lg shadow-lg text-xs">
            <div className="flex items-center gap-1 bg-slate-900/90 p-0.5 rounded">
              <Camera className="w-3.5 h-3.5 text-slate-400 mx-1" />
              {(['chase', 'cockpit', 'cinematic'] as CameraMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onSetCamera(mode)}
                  className={`px-2 py-1 rounded text-xs font-medium capitalize whitespace-nowrap transition-colors cursor-pointer ${
                    telemetry.cameraMode === mode
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {mode === 'cinematic' ? 'Orbit' : mode}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 bg-slate-900/90 p-0.5 rounded">
              <button
                type="button"
                onClick={() => onSetWeapon('missile_ir')}
                className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  telemetry.selectedWeapon === 'missile_ir'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                AIM-9X
              </button>
              <button
                type="button"
                onClick={() => onSetWeapon('missile_radar')}
                className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  telemetry.selectedWeapon === 'missile_radar'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                AIM-120
              </button>
            </div>

            <button
              type="button"
              onClick={onToggleGear}
              className={`flex items-center gap-1 px-2 py-1.5 rounded border whitespace-nowrap transition-colors cursor-pointer ${
                telemetry.gearDown
                  ? 'bg-sky-500/20 text-sky-300 border-sky-400/50'
                  : 'bg-slate-900/90 text-slate-300 hover:text-white border-slate-700/70'
              }`}
              title="Toggle Landing Gear & ILS Approach (G)"
            >
              <PlaneLanding className="w-3.5 h-3.5" />
              <span>{telemetry.gearDown ? 'Gear DN' : 'Gear UP'}</span>
            </button>

            <button
              type="button"
              onClick={() => onSetControlMode(telemetry.controlMode === 'mouse' ? 'keyboard' : 'mouse')}
              className="flex items-center gap-1 px-2 py-1.5 rounded bg-slate-900/90 text-slate-200 hover:bg-slate-800 border border-slate-700/70 whitespace-nowrap transition-colors cursor-pointer"
            >
              <Crosshair className="w-3.5 h-3.5 text-sky-400" />
              <span>{telemetry.controlMode === 'mouse' ? 'Mouse' : 'Keys'}</span>
            </button>

            <button
              type="button"
              onClick={onToggleCopilot}
              className={`flex items-center gap-1 px-2 py-1.5 rounded border whitespace-nowrap transition-colors cursor-pointer ${
                copilotOpen
                  ? 'bg-sky-500/20 text-sky-200 border-sky-400/50'
                  : 'bg-slate-900/90 text-slate-300 hover:text-white border-slate-700/70'
              }`}
              title="Toggle Co-Pilot Tactical Assistant (H)"
            >
              <Bot className="w-3.5 h-3.5 text-sky-400" />
              <span>Co-Pilot</span>
            </button>

            <button
              type="button"
              onClick={onOpenSettings}
              className="p-1.5 rounded bg-slate-900/90 text-slate-300 hover:text-white border border-slate-700/70 transition-colors cursor-pointer"
              title="Graphics & Keybindings"
            >
              <Sliders className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onToggleMute}
              className="p-1.5 rounded bg-slate-900/90 text-slate-300 hover:text-white border border-slate-700/70 transition-colors cursor-pointer"
              title="Toggle Audio (M)"
            >
              {telemetry.isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
            </button>

            <button
              type="button"
              onClick={onPause}
              className="p-1.5 rounded bg-slate-900/90 text-slate-300 hover:text-white border border-slate-700/70 transition-colors cursor-pointer"
              title="Pause (Esc)"
            >
              <Pause className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
