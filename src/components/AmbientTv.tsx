'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { loadCameraCatalog, mergeCameraCatalog } from '@/lib/camera-catalog';
import { ambientPool, type WallCamera } from '@/lib/theater-wall';
import CameraTileMedia from './CameraTileMedia';

/**
 * Glass Earth — AMBIENT TV.
 *
 * The lean-back mode: one scenic camera at a time, fullscreen, changing every
 * 45 seconds, with nothing on screen but the place and the time. It is a
 * screensaver for a television that happens to be showing the real planet —
 * beaches, harbours, falls and skylines from the public-webcam catalogue,
 * scored for scenery in lib/theater-wall.
 *
 * The pool is ordered for a television (lib/theater-wall's ambientPool):
 * cameras that actually move — live streams — lead, and snapshot cameras
 * only fill the slots the streams cannot, because a still that refreshes
 * every 15 seconds reads as a stutter on a big screen. The frame is shown
 * whole over a blurred copy of itself rather than cropped to fill, and
 * the stills that do appear crossfade and drift instead of jump-cutting.
 *
 * Behaviour follows screensaver rules: it asks for real fullscreen on the
 * way in, any key leaves, and the overlay (place, clock, exit) appears when
 * the mouse moves and fades away again after a few still seconds.
 */

const DWELL_MS = 45_000;
const FADE_MS = 700;
const OVERLAY_IDLE_MS = 4_000;

interface AmbientTvProps {
  cameras: WallCamera[];
  onExit: () => void;
}

export default function AmbientTv({ cameras, onExit }: AmbientTvProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [catalog, setCatalog] = useState<WallCamera[]>(cameras);
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const [overlay, setOverlay] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Same self-sufficiency as the wall: top the catalogue up directly. */
  useEffect(() => {
    return loadCameraCatalog(
      batch => setCatalog(prev => mergeCameraCatalog(prev, batch as WallCamera[])),
      () => { /* partial catalogue is fine — the pool scores what arrived */ },
    );
  }, []);

  /* The current place is derived from the pool, never stored: the pool grows
     as the catalogue streams in, and the index simply rides along.
     Memoised on the catalogue — the clock below re-renders this component
     every second, and a freshly-computed pool array would read as a new
     dependency to the rotation effect, resetting its 45-second timer on
     every tick so no scene would ever rotate away. */
  const pool = useMemo(() => ambientPool(catalog), [catalog]);
  const current = pool.length ? pool[index % pool.length] : null;
  const clock = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateLine = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  /* The rotation: fade to black, swap, fade back. One camera at a time means
     one decoder, which is the whole point of the mode. */
  useEffect(() => {
    if (pool.length < 2) return;
    const iv = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIndex(i => (i + 1) % pool.length);
        setVisible(true);
      }, FADE_MS);
    }, DWELL_MS);
    return () => clearInterval(iv);
  }, [pool]);

  /* Clock, ticking quietly in the corner. */
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  /* Fullscreen on the way in (best effort — a browser may refuse without a
     fresh gesture, and the mode still works windowed), and out on exit if we
     were the ones who asked. */
  useEffect(() => {
    const el = rootRef.current;
    let entered = false;
    if (el && !document.fullscreenElement) {
      /* requestFullscreen returns a promise only in newer browsers; older
         Safari/WebKit hands back undefined, and chaining .then off that
         threw a TypeError that took this whole screen down on entry.
         Keep the promise if there is one; never let a refusal — or a
         missing promise — become an exception. */
      try {
        const asked: unknown = el.requestFullscreen();
        if (asked instanceof Promise) asked.then(() => { entered = true; }).catch(() => {});
        else entered = true;
      } catch { /* refused outright: the mode still works windowed */ }
    }
    return () => {
      if (entered && document.fullscreenElement) {
        try {
          const left: unknown = document.exitFullscreen();
          if (left instanceof Promise) left.catch(() => {});
        } catch { /* already out */ }
      }
    };
  }, []);

  /* Screensaver rules: any key leaves. */
  useEffect(() => {
    const onKey = () => onExit();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  const wakeOverlay = () => {
    setOverlay(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setOverlay(false), OVERLAY_IDLE_MS);
  };
  /* The overlay starts awake; this only arms its first fade. */
  useEffect(() => {
    idleTimer.current = setTimeout(() => setOverlay(false), OVERLAY_IDLE_MS);
    return () => { if (idleTimer.current) clearTimeout(idleTimer.current); };
  }, []);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={rootRef}
      className={`fixed inset-0 z-[960] bg-black ${overlay ? '' : 'cursor-none'}`}
      onMouseMove={wakeOverlay}
    >
      {/* The picture */}
      <div
        className="absolute inset-0 transition-opacity ease-in-out"
        style={{ opacity: visible ? 1 : 0, transitionDuration: `${FADE_MS}ms` }}
      >
        {current && (
          /* Keyed by camera id: a new place mounts a fresh player rather
             than re-pointing the old one mid-fade. */
          <div key={String(current.id)} className="h-full w-full">
            {/* No badge here: Ambient is a lean-back screensaver, and a trust
                mark over the picture adds nothing to it. */}
            <CameraTileMedia cam={current} variant="ambient" showBadge={false} />
          </div>
        )}
      </div>

      {/* A whisper of shade at the edges so the overlay type stays readable
          over a bright beach at noon. */}
      <div className="pointer-events-none absolute inset-0" style={{ boxShadow: 'inset 0 0 180px rgba(0,0,0,0.55)' }} />

      {/* Overlay — place, brand, clock, exit. Fades with inactivity. */}
      <div
        className="absolute inset-0 transition-opacity duration-700"
        style={{ opacity: overlay ? 1 : 0, pointerEvents: overlay ? 'auto' : 'none' }}
      >
        <div className="absolute left-6 top-6 flex items-baseline gap-3">
          <span className="font-mono text-[13px] font-bold tracking-[0.35em] text-white/90">GLASS EARTH</span>
          <span className="border border-white/30 px-1.5 py-0.5 font-mono text-[8px] tracking-[0.25em] text-white/60">AMBIENT</span>
        </div>

        <button
          onClick={onExit}
          className="absolute right-6 top-6 flex items-center gap-2 rounded-sm border border-white/25 bg-black/40 px-3 py-2 font-mono text-[9px] tracking-[0.2em] text-white/80 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white"
        >
          <X className="h-3.5 w-3.5" /> EXIT
        </button>

        <div className="absolute bottom-8 left-6 max-w-[70vw]">
          <div className="truncate text-3xl font-light tracking-wide text-white" style={{ textShadow: '0 2px 18px rgba(0,0,0,0.8)' }}>
            {current?.name ?? 'Tuning the planet…'}
          </div>
          <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.25em] text-white/60">
            {current ? `${current.city ?? ''}${current.country ? ` · ${current.country}` : ''}` : 'Loading scenic cameras'}
          </div>
        </div>

        <div className="absolute bottom-8 right-6 text-right">
          <div className="text-5xl font-extralight tabular-nums tracking-wider text-white" style={{ textShadow: '0 2px 18px rgba(0,0,0,0.8)' }}>
            {clock}
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.25em] text-white/60">{dateLine}</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
