import React, { useEffect, useState } from 'react';
import { Sliders, Keyboard, X, RotateCcw } from 'lucide-react';
import {
  CONTROL_ACTION_LABELS,
  DEFAULT_CONTROL_BINDINGS,
  DEFAULT_GRAPHICS_SETTINGS,
  formatKeyCode,
} from '../sim/defaults';
import type { ControlAction, ControlBindings, GraphicsSettings } from '../sim/types';

interface SettingsModalProps {
  graphics: GraphicsSettings;
  bindings: ControlBindings;
  webGpuSupported: boolean;
  webGpuFlagActive: boolean;
  onChangeGraphics: (next: GraphicsSettings) => void;
  onChangeBindings: (next: ControlBindings) => void;
  onSetCaptureSuppressed: (suppressed: boolean) => void;
  onClose: () => void;
}

const ACTION_ORDER: ControlAction[] = [
  'pitchUp',
  'pitchDown',
  'rollLeft',
  'rollRight',
  'yawLeft',
  'yawRight',
  'throttleUp',
  'throttleDown',
  'afterburner',
  'airbrake',
  'fireGun',
  'fireMissile',
  'flare',
  'gear',
  'cycleTarget',
  'cycleCamera',
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  graphics,
  bindings,
  webGpuSupported,
  webGpuFlagActive,
  onChangeGraphics,
  onChangeBindings,
  onSetCaptureSuppressed,
  onClose,
}) => {
  const [tab, setTab] = useState<'graphics' | 'controls'>('graphics');
  const [listeningAction, setListeningAction] = useState<ControlAction | null>(null);

  useEffect(() => {
    onSetCaptureSuppressed(true);
    return () => onSetCaptureSuppressed(false);
  }, [onSetCaptureSuppressed]);

  useEffect(() => {
    if (!listeningAction) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') {
        setListeningAction(null);
        return;
      }
      onChangeBindings({
        ...bindings,
        [listeningAction]: e.code,
      });
      setListeningAction(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [listeningAction, bindings, onChangeBindings]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#04070d]/82 p-4">
      <div className="w-full max-w-xl bg-[#0b121c] border border-slate-700/80 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[86vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTab('graphics')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                tab === 'graphics'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Graphics & Scaling</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('controls')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                tab === 'controls'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Keyboard className="w-3.5 h-3.5" />
              <span>Control Bindings</span>
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close settings"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {tab === 'graphics' ? (
            <>
              <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-slate-100">Resolution / Render Scale</span>
                  <span className="font-mono-hud text-emerald-300 font-semibold">
                    {Math.round(graphics.renderScale * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={1.25}
                  step={0.05}
                  value={graphics.renderScale}
                  onChange={(e) =>
                    onChangeGraphics({ ...graphics, renderScale: Number(e.target.value) })
                  }
                  className="w-full accent-emerald-400 cursor-pointer"
                />
                <div className="flex justify-between text-[11px] font-mono-hud text-slate-400 mt-1.5">
                  <span>50% (Laptop 60FPS)</span>
                  <span>100% (Native)</span>
                  <span>125% (Supersample)</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {[
                  {
                    key: 'bloomEnabled' as const,
                    title: 'HDR Engine Bloom',
                    desc: 'Afterburner & flare glow',
                  },
                  {
                    key: 'motionBlurEnabled' as const,
                    title: 'High-Speed Motion Blur',
                    desc: 'Peripheral radial blur above M0.6',
                  },
                  {
                    key: 'aaEnabled' as const,
                    title: 'MSAA Anti-Aliasing',
                    desc: '4x edge smoothing on GPU',
                  },
                ].map((opt) => {
                  const enabled = graphics[opt.key];
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => onChangeGraphics({ ...graphics, [opt.key]: !enabled })}
                      className={`p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                        enabled
                          ? 'bg-emerald-500/12 border-emerald-500/45 text-slate-100'
                          : 'bg-slate-900/70 border-slate-800 text-slate-400'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="font-semibold">{opt.title}</span>
                        <span className="font-mono-hud text-[11px] text-emerald-300">
                          {enabled ? 'ON' : 'OFF'}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400">{opt.desc}</div>
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() =>
                    onChangeGraphics({
                      ...graphics,
                      experimentalWebGpu: !graphics.experimentalWebGpu,
                    })
                  }
                  className={`p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                    graphics.experimentalWebGpu
                      ? 'bg-sky-500/15 border-sky-400/50 text-slate-100'
                      : 'bg-slate-900/70 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-semibold">Experimental WebGPU Flag</span>
                    <span className="font-mono-hud text-[11px] text-sky-300">
                      {graphics.experimentalWebGpu ? 'ARMED' : 'OFF'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {webGpuSupported
                      ? webGpuFlagActive
                        ? 'Adapter verified (WebGL2 active fallback)'
                        : 'Browser supports navigator.gpu probe'
                      : 'WebGPU unavailable — running WebGL2'}
                  </div>
                </button>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => onChangeGraphics({ ...DEFAULT_GRAPHICS_SETTINGS })}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Graphics</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="text-slate-400 text-[11px] flex items-center justify-between">
                <span>Click any binding button, then press a new key (Esc cancels).</span>
                <button
                  type="button"
                  onClick={() => onChangeBindings({ ...DEFAULT_CONTROL_BINDINGS })}
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset Keys</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {ACTION_ORDER.map((action) => {
                  const isListening = listeningAction === action;
                  return (
                    <div
                      key={action}
                      className="flex items-center justify-between bg-slate-900/80 border border-slate-800 rounded-lg px-3 py-2"
                    >
                      <span className="text-slate-200 font-medium">{CONTROL_ACTION_LABELS[action]}</span>
                      <button
                        type="button"
                        onClick={() => setListeningAction(action)}
                        className={`min-w-[74px] px-2.5 py-1 rounded font-mono-hud text-[11px] font-semibold transition-colors cursor-pointer ${
                          isListening
                            ? 'bg-amber-500 text-slate-950'
                            : 'bg-slate-800 text-emerald-300 hover:bg-slate-700 border border-slate-700'
                        }`}
                      >
                        {isListening ? 'PRESS KEY' : formatKeyCode(bindings[action])}
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
