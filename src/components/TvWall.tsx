'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  LayoutGrid, Maximize2, Minimize2, Star, X,
} from 'lucide-react';
import { WALL_LAYOUTS, type WallLayout } from '@/lib/theater-wall';
import { MAX_TV_WALL_PLAYING, newsFirst, type TvChannel } from '@/lib/stations';
import HlsPlayer from './HlsPlayer';

/**
 * Glass Earth — TV WALL.
 *
 * TheaterWall's shape, pointed at television: a grid of live channels
 * (IPTV-org directory, same data layer as the Stations panel) playing
 * muted, click-to-focus with sound, 2×2 / 3×3 / 4×4.
 *
 * The camera wall's rationing applies verbatim, because a TV decoder is
 * heavier than a camera's: at most MAX_TV_WALL_PLAYING tiles run a stream
 * at once; overflow tiles hold their channel logo until focused, and the
 * focused tile always plays. A channel that fails shows its logo and an
 * "unavailable" label — never a silent black box. Fullscreen goes through
 * the same Safari guard as the camera wall (commit 8ecbe5b): the call may
 * return undefined, so nothing is ever chained off its result.
 */

type PoolMode = 'news' | 'current' | 'favorites';

interface TvWallProps {
  /** The slice the operator was browsing in the Stations panel. */
  channels: TvChannel[];
  favorites: TvChannel[];
  onClose: () => void;
}

export default function TvWall({ channels, favorites, onClose }: TvWallProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<WallLayout>(3);
  const [poolMode, setPoolMode] = useState<PoolMode>(channels.length ? 'current' : 'news');
  const [newsPool, setNewsPool] = useState<TvChannel[]>([]);
  const [focus, setFocus] = useState<number | null>(null);
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [isFs, setIsFs] = useState(false);

  const count = layout * layout;

  /* The World News preset is a directory slice of its own: fetched once,
     news-group channels first. */
  useEffect(() => {
    let cancelled = false;
    fetch('/api/stations/tv?category=news')
      .then(r => r.json())
      .then(d => { if (!cancelled && Array.isArray(d.channels)) setNewsPool(newsFirst(d.channels)); })
      .catch(() => { /* the preset simply stays empty; the header count says so */ });
    return () => { cancelled = true; };
  }, []);

  const pool = useMemo(() => {
    const raw = poolMode === 'news' ? newsPool : poolMode === 'favorites' ? favorites : channels;
    const seen = new Set<string>();
    return raw.filter(c => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  }, [poolMode, newsPool, favorites, channels]);

  const slots = useMemo(() => {
    const out: (TvChannel | null)[] = pool.slice(0, count);
    while (out.length < count) out.push(null);
    return out;
  }, [pool, count]);

  /* Decoder rationing: the first MAX_TV_WALL_PLAYING tiles play; the
     focused tile always plays. */
  const playing = useMemo(() => {
    const allowed = new Set<number>();
    slots.forEach((ch, i) => {
      if (ch && allowed.size < MAX_TV_WALL_PLAYING) allowed.add(i);
    });
    if (focus !== null) allowed.add(focus);
    return allowed;
  }, [slots, focus]);

  const markFailed = (id: string) =>
    setFailed(prev => (prev.has(id) ? prev : new Set(prev).add(id)));

  const toggleFullscreen = () => {
    /* Older Safari/WebKit returns undefined rather than a promise from
       requestFullscreen — never chain off the result (see TheaterWall). */
    try {
      const result: unknown = document.fullscreenElement
        ? document.exitFullscreen()
        : rootRef.current?.requestFullscreen();
      if (result instanceof Promise) result.catch(() => {});
    } catch { /* fullscreen is best effort */ }
  };
  useEffect(() => {
    const onFs = () => setIsFs(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (focus !== null) setFocus(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus, onClose]);

  const btn = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm border font-mono text-[9px] tracking-[0.15em] uppercase transition-colors';
  const btnIdle = 'border-white/15 text-white/60 hover:bg-white/10 hover:text-white';
  const btnActive = 'border-[var(--gold-primary)]/60 bg-[var(--gold-primary)]/15 text-[var(--gold-primary)]';

  const renderTile = (slotIndex: number, big: boolean) => {
    const ch = slots[slotIndex];
    const isPlaying = playing.has(slotIndex);
    const isFailed = ch ? failed.has(ch.id) : false;
    return (
      <div
        key={slotIndex}
        /* Focused tiles are plain blocks whose children are absolutely
           positioned — without an explicit height the tile collapses and
           clips the picture (the camera wall's 8ecbe5b lesson). */
        className={`group relative overflow-hidden bg-black ${big ? 'h-full' : ''}`}
        style={{ border: '1px solid rgba(255,255,255,0.09)' }}
      >
        {ch && !isFailed && (isPlaying || big) && (
          <div className="absolute inset-0">
            <HlsPlayer
              key={`${ch.id}-${big ? 'focus' : 'tile'}`}
              url={ch.url}
              muted={!big}
              onFatal={() => markFailed(ch.id)}
              className="h-full w-full bg-black object-contain"
            />
          </div>
        )}
        {ch && (isFailed || (!isPlaying && !big)) && (
          <button className="absolute inset-0 flex h-full w-full flex-col items-center justify-center gap-2 bg-[#050505] px-3 text-center" onClick={() => setFocus(slotIndex)} title="Focus this channel">
            {ch.logo
              ? /* eslint-disable-next-line @next/next/no-img-element -- remote channel logos */
                <img src={ch.logo} alt="" className="max-h-12 max-w-[60%] object-contain opacity-80" loading="lazy" />
              : <LayoutGrid className="h-6 w-6 text-white/25" />}
            <span className="truncate font-mono text-[10px] font-bold uppercase tracking-wider text-white/75">{ch.name}</span>
            <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-white/35">
              {isFailed ? 'Unavailable' : 'Focus to play'}
            </span>
          </button>
        )}
        {!ch && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-white/25">
              {pool.length ? 'Empty tile' : 'Linking channels…'}
            </span>
          </div>
        )}

        {ch && !isFailed && isPlaying && (
          <button className="absolute inset-0 h-full w-full cursor-pointer" onClick={() => setFocus(big ? null : slotIndex)} title={big ? 'Back to the wall' : 'Focus this channel'} />
        )}

        {/* Label bar */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-2 pb-1.5 pt-5">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ch && !isFailed && isPlaying ? 'bg-red-500 animate-pulse' : 'bg-white/30'}`} />
          <span className="truncate font-mono text-[10px] font-bold uppercase tracking-wider text-white">{ch?.name ?? '—'}</span>
          <span className="hidden truncate font-mono text-[8px] uppercase tracking-wider text-white/45 md:block">
            {ch ? `${ch.category || 'General'} · ${ch.country}` : ''}
          </span>
          {big && <span className="ml-auto shrink-0 font-mono text-[8px] uppercase tracking-wider text-white/45">Click picture to go back</span>}
        </div>
      </div>
    );
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div ref={rootRef} className="fixed inset-0 z-[950] flex flex-col bg-black">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-black/90 px-3 py-2">
        <div className="flex items-center gap-2 pr-1">
          <LayoutGrid className="h-4 w-4 text-[var(--gold-primary)]" />
          <span className="font-mono text-[12px] font-bold tracking-[0.25em] text-white">TV WALL</span>
          <span className="hidden font-mono text-[9px] tracking-wider text-white/35 lg:block">
            {pool.length.toLocaleString()} CHANNELS IN POOL · {Math.min(playing.size, count)} PLAYING
          </span>
        </div>

        <div className="mx-1 hidden h-4 w-px bg-white/10 md:block" />

        <button onClick={() => { setPoolMode('news'); setFocus(null); }} className={`${btn} ${poolMode === 'news' ? btnActive : btnIdle}`}>World News</button>
        <button onClick={() => { setPoolMode('current'); setFocus(null); }} className={`${btn} ${poolMode === 'current' ? btnActive : btnIdle}`} disabled={!channels.length} title={channels.length ? 'The slice open in the Stations panel' : 'Open a slice in the Stations panel first'}>
          Current slice ({channels.length})
        </button>
        <button onClick={() => { setPoolMode('favorites'); setFocus(null); }} className={`${btn} ${poolMode === 'favorites' ? btnActive : btnIdle}`}>
          <Star className="h-3 w-3" /> Favourites ({favorites.length})
        </button>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex overflow-hidden rounded-sm border border-white/15">
            {WALL_LAYOUTS.map(l => (
              <button
                key={l}
                onClick={() => { setLayout(l); setFocus(null); }}
                className={`px-2 py-1.5 font-mono text-[9px] tracking-widest transition-colors ${layout === l ? 'bg-[var(--gold-primary)]/20 text-[var(--gold-primary)]' : 'text-white/55 hover:bg-white/10'}`}
              >
                {l}×{l}
              </button>
            ))}
          </div>
          <button onClick={toggleFullscreen} className={`${btn} ${btnIdle}`} title="Fullscreen">
            {isFs ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
            <span className="hidden lg:inline">Fullscreen</span>
          </button>
          <button onClick={onClose} className="rounded-sm border border-red-500/30 bg-red-900/20 p-1.5 text-red-300 transition-colors hover:bg-red-500/25" title="Close the TV wall (Esc)">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {focus !== null ? (
        <div className="relative flex-1 p-1.5">{renderTile(focus, true)}</div>
      ) : (
        <div
          className="grid flex-1 gap-1.5 p-1.5"
          style={{
            gridTemplateColumns: `repeat(${layout}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${layout}, minmax(0, 1fr))`,
          }}
        >
          {Array.from({ length: count }, (_, i) => renderTile(i, false))}
        </div>
      )}

      <div className="border-t border-white/10 bg-black/90 px-3 py-1.5">
        <p className="font-mono text-[8px] uppercase tracking-wider text-white/30">
          TV directory: IPTV-org community · Tiles play muted; focus one for sound · At most {MAX_TV_WALL_PLAYING} streams decode at once — the rest hold their logos.
        </p>
      </div>
    </div>,
    document.body,
  );
}
