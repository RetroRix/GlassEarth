'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { loadCameraCatalog, mergeCameraCatalog } from '@/lib/camera-catalog';
import { scenicPool, type WallCamera } from '@/lib/theater-wall';
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
  const [current, setCurrent] = useState<WallCamera | null>(null);
  const [visible, setVisible] = useState(true);
  const [overlay, setOverlay] = useState(true);
  const [clock, setClock] = useState('');
  const [dateLine, setDateLine] = useState('');
  const indexRef = useRef(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Same self-sufficiency as the wall: top the catalogue up directly. */
  useEffect(() => {
    return loadCameraCatalog(
      batch => setCatalog(prev => mergeCameraCatalog(prev, batch as WallCamera[])),
      () => { /* partial catalogue is fine — the pool scores what arrived */ },
    );
  }, []);

  const pool = scenicPool(catalog);
  const poolRef = useRef(pool);
  poolRef.current = pool;

  /* First camera as soon as the pool has anything in it. */
  useEffect(() => {
    if (!current && pool.length) setCurrent(pool[0]);
  }, [pool, current]);

  /* The rotation: fade to black, swap, fade back. One camera at a time means
     one decoder, which is the whole point of the mode. */
  useEffect(() => {
    if (!current) return;
    const iv = setInterval(() => {
      const list = poolRef.current;
      if (list.length < 2) return;
      setVisible(false);
      setTimeout(() => {
        indexRef.current = (indexRef.current + 1) % list.length;
        setCurrent(list[indexRef.current]);
        setVisible(true);
      }, FADE_MS);
    }, DWELL_MS);
    return () => clearInterval(iv);
  }, [current]);

  /* Clock, ticking quietly in the corner. */
  useEffect(() => {
    const update = () => {
      const now = new Date();
      setClock(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      setDateLine(now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }));
    };
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, []);

  /* Fullscreen on the way in (best effort — a browser may refuse without a
     fresh gesture, and the mode still works windowed), and out on exit if we
     were the ones who asked. */
  useEffect(() => {
    const el = rootRef.current;
    let entered = false;
    if (el && !document.fullscreenElement) {
      el.requestFullscreen().then(() => { entered = true; }).catch(() => {});
    }
    return () => { if (entered && document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
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
  useEffect(() => {
    wakeOverlay();
    return () => { if (idleTimer.current) clearTimeout(idleTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            <CameraTileMedia cam={current} />
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
