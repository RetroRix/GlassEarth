'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { BarSide } from '@/lib/hideable-bars';

/**
 * The slim tab that lives on a screen edge while its bar is tucked away —
 * the affordance that says "something lives here". On touch it is the
 * bar's door handle (tap to show, tap again to hide); under a mouse it is
 * also a visible target for the hover reveal.
 *
 * In `hide` mode the tab rides the outer edge of a tap-stuck bar instead:
 * tapping it is the "tap again to hide" half of the touch gesture.
 */
export default function BarEdgeHandle({
  side,
  mode,
  label,
  low = false,
  onTap,
}: {
  side: BarSide;
  mode: 'show' | 'hide';
  /** What the bar is called, for the accessible name: "layers toolbar". */
  label: string;
  /** Sit below screen centre instead of on it — the right edge's centre
   *  belongs to the cockpit ride's NEARBY chip while a ride is on. */
  low?: boolean;
  onTap: () => void;
}) {
  const left = side === 'left';
  /* The chevron points the way the bar will travel: in from the edge to
     show it, back out to the edge to hide it. */
  const Icon = (mode === 'show') === left ? ChevronRight : ChevronLeft;
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={mode === 'show' ? `Show ${label}` : `Hide ${label}`}
      title={mode === 'show' ? `Show ${label}` : `Hide ${label}`}
      className={`pointer-events-auto absolute z-[260] flex h-[76px] w-[18px] items-center justify-center border border-white/10 bg-black/45 text-white/60 backdrop-blur-sm transition-colors hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50 ${
        left ? 'left-0 rounded-r-lg border-l-0' : 'right-0 rounded-l-lg border-r-0'
      } ${low ? '' : 'top-1/2 -translate-y-1/2'}`}
      style={low ? { top: 'calc(50% + 108px)' } : undefined}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}
