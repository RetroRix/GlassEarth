'use client';

import { Pause, Play, Plane, X } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════
   Glass Earth — Fly the Route control bar

   The page-level chrome for a route flight (lib/route-flight): what
   is being flown, how far along it is, pause/resume, and the exit
   that restores the pre-flight view. Deliberately plain about what
   it is — a scenic visualisation of the planned route, not live
   navigation and not live traffic.
   ═══════════════════════════════════════════════════════════════ */

interface RouteFlightBarProps {
  fromLabel: string;
  toLabel: string;
  /** 0..1 along the route. */
  progress: number;
  playing: boolean;
  onTogglePlay: () => void;
  onExit: () => void;
}

export default function RouteFlightBar({ fromLabel, toLabel, progress, playing, onTogglePlay, onExit }: RouteFlightBarProps) {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <div
      data-hud
      className="absolute left-1/2 -translate-x-1/2 bottom-5 z-[420] w-[min(92vw,520px)] pointer-events-auto"
      role="group"
      aria-label="Fly the route controls"
    >
      <div className="glass-panel tool-glass relative overflow-hidden rounded-2xl px-4 py-3">
        <span aria-hidden className="absolute inset-x-0 top-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(var(--gold-rgb),0.7) 30%, rgba(var(--gold-rgb),0.7) 70%, transparent)' }} />
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(var(--gold-rgb),0.12)' }}>
            <Plane className="w-4 h-4 text-[var(--gold-primary)]" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-[10px] font-mono tracking-[0.14em] uppercase text-[var(--gold-light)] flex-shrink-0">
                Fly the route
              </span>
              <span className="text-[12px] text-[var(--text-heading)] truncate">
                {fromLabel} → {toLabel}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div
                className="flex-1 h-1.5 rounded-full overflow-hidden bg-white/[0.08]"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                aria-label="Flight progress"
              >
                <div
                  className="h-full rounded-full transition-[width] duration-150"
                  style={{ width: `${pct}%`, background: 'var(--gold-primary)' }}
                />
              </div>
              <span className="text-[11px] font-mono tabular-nums text-[var(--text-secondary)] flex-shrink-0">{pct}%</span>
            </div>
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">
              A scenic flight along the planned route — a visualisation, not live navigation.
            </p>
          </div>
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={playing ? 'Pause the flight' : 'Resume the flight'}
            title={playing ? 'Pause' : 'Resume'}
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--gold-light)] hover:border-[var(--border-active)] transition-colors"
          >
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" fill="currentColor" />}
          </button>
          <button
            type="button"
            onClick={onExit}
            aria-label="End the flight and restore the previous view"
            title="End flight — back to the view you had"
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:border-[var(--border-active)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
