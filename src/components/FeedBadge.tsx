'use client';

import { useEffect, useState } from 'react';
import { formatFrameAge, type FeedBadge } from '@/lib/feed-badge';

/**
 * Glass Earth — the honest feed badge.
 *
 * A small mono trust mark, top-left over the picture: LIVE VIDEO when a
 * stream is actually playing, LIVE STILL with the frame's age when the
 * picture is a snapshot, UNAVAILABLE (grey, no age) when the picture is
 * one of the agency's placeholder graphics rather than a camera frame.
 * The age ticks every 5 seconds from `frameAt` —
 * when the displayed frame arrived in the browser, never a guess.
 *
 * Legibility is borrowed from the map tiles' own LIVE chip: a dark pill
 * with light text, so it reads the same over any picture in both the day
 * and the night theme. No theme token is needed because the chip brings
 * its own dark background with it — the day-mode failure was white text
 * on a light panel, and this is white text on black.
 *
 * A demoted badge (a dead stream standing in as a snapshot) reads exactly
 * like any other still — the demotion is the badge itself, not a warning —
 * but its title says why, for anyone who hovers.
 */

function useNow(active: boolean, everyMs = 5000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(iv);
  }, [active, everyMs]);
  return now;
}

export default function FeedBadgeView({ badge, frameAt, size = 'sm', className = '' }: {
  badge: FeedBadge | null;
  /** ms since epoch when the displayed frame arrived; required for the age. */
  frameAt?: number | null;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const showAge = badge?.showAge && frameAt != null;
  const now = useNow(Boolean(showAge));
  if (!badge) return null;

  const isVideo = badge.kind === 'live-video';
  const isUnavailable = badge.kind === 'unavailable';
  const label = isVideo ? 'LIVE VIDEO' : isUnavailable ? 'UNAVAILABLE' : 'LIVE STILL';
  const age = showAge && frameAt != null ? formatFrameAge(now - frameAt) : null;

  return (
    <span
      className={`pointer-events-none inline-flex items-center gap-1 bg-black/70 font-mono tracking-[0.18em] text-white/90 ${
        size === 'md' ? 'px-2 py-1 text-[9px]' : 'px-1 py-[1px] text-[7px]'
      } ${className}`}
      title={
        isUnavailable
          ? 'The camera is not sending pictures — the operator placeholder is shown instead'
          : badge.demoted
            ? 'The live stream failed — showing the camera snapshot instead'
            : isVideo
              ? 'Live video stream, playing now'
              : 'Snapshot, refreshed from the camera feed'
      }
    >
      <span className={`h-1 w-1 shrink-0 rounded-full ${isVideo ? 'bg-emerald-400 animate-pulse' : isUnavailable ? 'bg-zinc-400' : 'bg-amber-300'}`} />
      <span>{label}</span>
      {age !== null && <span className="text-white/60">· {age}</span>}
    </span>
  );
}
