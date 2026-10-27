'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Radio, Star, X } from 'lucide-react';
import {
  loadRadioFavorites, saveRadioFavorites, type RadioStation,
} from '@/lib/stations';
import {
  buildDial, formatLongitude, fractionForLongitude, indexAtFraction,
  longitudeAtFraction, nextUntriedIndex, stepIndex, type DialStation,
} from '@/lib/radio-tuner';

/**
 * Glass Earth — RADIO TUNER.
 *
 * The analog-dial front end on the same Radio Browser catalogue and the
 * same playback owner as the Stations panel: this component never touches
 * an <audio> element. Landing a station calls the page's onPlayRadio —
 * the one RadioNowPlaying bar is the app's only audio element, so the
 * tuner and the panel can never play over each other; starting either
 * replaces the other.
 *
 * The band is the dial from lib/radio-tuner: coordinate-bearing,
 * https-playable stations ordered west → east by longitude. Dragging the
 * needle scans — the globe flies along and the readout previews each
 * stop, but nothing plays mid-scan; releasing lands and plays. Precise
 * stepping lives on the ‹ › buttons and the arrow keys.
 *
 * Dead streams are a fact of the catalogue. When the playback owner
 * reports the landed station failed, the tuner says so, waits a short
 * beat (SKIP_BEAT_MS), and tunes on to the next station that hasn't
 * already failed in this chain — never sitting silent pretending.
 */

const SKIP_BEAT_MS = 1400;
const SCAN_ZOOM = 4;
const LAND_ZOOM = 5;

interface RadioTunerProps {
  onClose: () => void;
  onPlayRadio: (station: RadioStation) => void;
  onFlyTo: (lat: number, lng: number, zoom?: number, duration?: number) => void;
  currentRadioUuid: string | null;
  /** The playback owner's dead-stream report: { uuid, at } per failure. */
  failureSignal: { uuid: string; at: number } | null;
}

const btn = 'rounded-sm border border-white/15 p-2 text-white/75 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent';

export default function RadioTuner({ onClose, onPlayRadio, onFlyTo, currentRadioUuid, failureSignal }: RadioTunerProps) {
  const [dial, setDial] = useState<DialStation[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [index, setIndex] = useState(-1);
  const [scanning, setScanning] = useState(false);
  const [scanFraction, setScanFraction] = useState(0.5);
  const [scanIndex, setScanIndex] = useState(-1);
  const [notice, setNotice] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<RadioStation[]>(() => loadRadioFavorites());

  const trackRef = useRef<HTMLDivElement>(null);
  const triedRef = useRef<Set<number>>(new Set());
  const handledFailureAtRef = useRef(0);
  const skipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScanFlownRef = useRef(-1);
  const dialRef = useRef<DialStation[] | null>(null);
  const indexRef = useRef(-1);
  dialRef.current = dial;
  indexRef.current = index;

  useEffect(() => { saveRadioFavorites(favorites); }, [favorites]);

  /* Load the dial pool once. The route already filtered to stations with
     coordinates; buildDial applies the ordering + playability rules. */
  useEffect(() => {
    let cancelled = false;
    fetch('/api/stations/radio?mode=tuner')
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        const built = buildDial(Array.isArray(d.stations) ? d.stations : []);
        setDial(built);
        if (d.error) setLoadError(d.error);
        /* If a station is already playing (started in the panel), park
           the needle on it when it's a dial stop. */
        if (currentRadioUuid) {
          const i = built.findIndex(s => s.uuid === currentRadioUuid);
          if (i >= 0) setIndex(i);
        }
      })
      .catch(() => { if (!cancelled) { setDial([]); setLoadError('Radio directory unavailable'); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const land = useCallback((idx: number, manual: boolean) => {
    const d = dialRef.current;
    if (!d || idx < 0 || idx >= d.length) return;
    if (manual) triedRef.current = new Set();
    setIndex(idx);
    setNotice(null);
    const s = d[idx];
    onFlyTo(s.lat, s.lng, LAND_ZOOM, 1600);
    onPlayRadio(s);
  }, [onFlyTo, onPlayRadio]);

  const step = useCallback((delta: number) => {
    const d = dialRef.current;
    if (!d || !d.length) return;
    const from = indexRef.current >= 0 ? indexRef.current : (delta > 0 ? -1 : 0);
    land(stepIndex(from, delta, d.length), true);
  }, [land]);

  /* Dead-stream skip: the playback owner reported the landed station
     failed. Show it, wait the beat, tune on past everything that has
     already failed in this chain. */
  useEffect(() => {
    if (!failureSignal) return;
    if (failureSignal.at <= handledFailureAtRef.current) return;
    const d = dialRef.current;
    const idx = indexRef.current;
    if (!d || idx < 0 || d[idx]?.uuid !== failureSignal.uuid) return;
    handledFailureAtRef.current = failureSignal.at;
    triedRef.current.add(idx);
    const failedName = d[idx].name;
    const next = nextUntriedIndex(idx, 1, d.length, triedRef.current);
    if (next < 0) {
      setNotice(`${failedName} did not answer — and every other station on the dial has been tried. Drag the needle somewhere new.`);
      return;
    }
    setNotice(`${failedName} did not answer — tuning on…`);
    if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
    skipTimerRef.current = setTimeout(() => land(next, false), SKIP_BEAT_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failureSignal]);

  useEffect(() => () => { if (skipTimerRef.current) clearTimeout(skipTimerRef.current); }, []);

  /* Arrow keys step the dial while the tuner is open. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  const fractionFromClientX = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };

  const updateScan = (frac: number) => {
    const d = dialRef.current;
    setScanFraction(frac);
    if (!d || !d.length) return;
    const idx = indexAtFraction(frac, d);
    setScanIndex(idx);
    if (idx >= 0 && idx !== lastScanFlownRef.current) {
      lastScanFlownRef.current = idx;
      const s = d[idx];
      onFlyTo(s.lat, s.lng, SCAN_ZOOM, 700);
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dial || !dial.length) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setScanning(true);
    lastScanFlownRef.current = -1;
    updateScan(fractionFromClientX(e.clientX));
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (scanning) updateScan(fractionFromClientX(e.clientX));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scanning) return;
    setScanning(false);
    const d = dialRef.current;
    const idx = d ? indexAtFraction(fractionFromClientX(e.clientX), d) : -1;
    if (idx >= 0) land(idx, true);
  };

  const favUuids = useMemo(() => new Set(favorites.map(s => s.uuid)), [favorites]);
  const shown: DialStation | null = dial
    ? (scanning && scanIndex >= 0 ? dial[scanIndex] : index >= 0 ? dial[index] : null)
    : null;
  const needleFraction = scanning
    ? scanFraction
    : shown ? fractionForLongitude(shown.lng) : 0.5;
  const isFav = shown ? favUuids.has(shown.uuid) : false;

  const toggleFav = (s: RadioStation) =>
    setFavorites(prev => (prev.some(x => x.uuid === s.uuid) ? prev.filter(x => x.uuid !== s.uuid) : [s, ...prev]));

  const dots = useMemo(() => {
    if (!dial) return null;
    return dial.map((s, i) => (
      <span
        key={s.uuid}
        className={`absolute top-1/2 h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full ${i === index ? 'bg-[#00E5FF]' : 'bg-white/25'}`}
        style={{ left: `${fractionForLongitude(s.lng) * 100}%` }}
      />
    ));
  }, [dial, index]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed bottom-32 left-1/2 z-[935] w-[min(880px,calc(100vw-16px))] -translate-x-1/2 md:bottom-[6.5rem]">
      <div className="border border-white/15 bg-[#0a0a0a]/95 shadow-2xl backdrop-blur-sm">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
          <Radio className="h-4 w-4 shrink-0 text-[#00E5FF]" />
          <span className="font-mono text-[11px] font-bold tracking-[0.25em] text-white">RADIO TUNER</span>
          <span className="hidden font-mono text-[8px] uppercase tracking-wider text-white/35 md:block">
            {dial === null
              ? 'Tuning the dial…'
              : dial.length
                ? `${dial.length} stations on the dial — the world's coordinate-bearing stations, west → east`
                : 'No stations on the dial'}
          </span>
          <button onClick={onClose} className="ml-auto rounded-sm border border-white/15 p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white" title="Close tuner (the music keeps playing)">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Readout */}
        <div className="flex items-center gap-2 px-3 pt-2.5">
          <button onClick={() => step(-1)} disabled={!dial?.length} className={btn} title="Previous station (←)" aria-label="Previous station">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1 text-center">
            {dial === null ? (
              <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">Tuning the dial…</div>
            ) : loadError && !dial.length ? (
              <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-red-300/80">{loadError}</div>
            ) : shown ? (
              <>
                <div className="truncate font-mono text-[13px] font-bold uppercase tracking-wider text-white">
                  {scanning && <span className="mr-2 text-[#00E5FF]">Scanning</span>}
                  {shown.name}
                </div>
                <div className="truncate font-mono text-[8px] uppercase tracking-wider text-white/40">
                  {shown.state ? `${shown.state} · ` : ''}{shown.country}
                  {shown.codec ? ` · ${shown.codec}` : ''}{shown.bitrate ? ` ${shown.bitrate}k` : ''}
                  {` · ${shown.lat.toFixed(2)}°, ${formatLongitude(shown.lng)}`}
                  {dial ? ` · station ${(scanning ? scanIndex : index) + 1} of ${dial.length}` : ''}
                </div>
              </>
            ) : (
              <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
                Drag the needle — or step with ‹ ›
              </div>
            )}
            {notice && (
              <div className="mt-0.5 truncate font-mono text-[8px] uppercase tracking-wider text-amber-300/90">{notice}</div>
            )}
          </div>
          {shown && !scanning && (
            <button
              onClick={() => toggleFav(shown)}
              className="rounded-sm border border-white/15 p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-[var(--gold-primary)]"
              title={isFav ? 'Remove from favourites (shared with the Stations panel)' : 'Favourite — shared with the Stations panel'}
            >
              <Star className="h-4 w-4" fill={isFav ? 'var(--gold-primary)' : 'none'} stroke={isFav ? 'var(--gold-primary)' : 'currentColor'} />
            </button>
          )}
          <button onClick={() => step(1)} disabled={!dial?.length} className={btn} title="Next station (→)" aria-label="Next station">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* The dial */}
        <div className="px-3 pb-1.5 pt-2">
          <div
            ref={trackRef}
            role="slider"
            aria-label="Radio tuner dial"
            aria-valuemin={0}
            aria-valuemax={dial?.length ?? 0}
            aria-valuenow={index + 1}
            aria-valuetext={shown ? shown.name : 'Not tuned'}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setScanning(false)}
            className="relative h-14 cursor-ew-resize touch-none select-none overflow-hidden border border-white/10 bg-gradient-to-r from-[#0b1622] via-[#101826] to-[#0b1622] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#00E5FF]/60"
          >
            {/* Longitude graticule */}
            {[-180, -120, -60, 0, 60, 120, 180].map(lng => (
              <span key={lng} className="absolute inset-y-0 border-l border-white/[0.07]" style={{ left: `${((lng + 180) / 360) * 100}%` }}>
                <span className="absolute left-1 top-0.5 font-mono text-[7px] tracking-wider text-white/30">{formatLongitude(lng)}</span>
              </span>
            ))}
            {/* Station dots */}
            {dots}
            {/* Needle */}
            <span className="absolute inset-y-0 w-[2px] bg-[#00E5FF] shadow-[0_0_8px_rgba(0,229,255,0.8)]" style={{ left: `calc(${needleFraction * 100}% - 1px)` }}>
              <span className="absolute -left-[5px] top-0 h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-[#00E5FF]" />
            </span>
          </div>
          <div className="flex items-center justify-between pt-1 font-mono text-[7px] uppercase tracking-wider text-white/30">
            <span>180° W — the Pacific</span>
            <span>{dial?.length ? `needle ${formatLongitude(longitudeAtFraction(needleFraction))}` : ' '}</span>
            <span>180° E</span>
          </div>
        </div>

        <p className="border-t border-white/10 px-3 py-2 font-mono text-[8px] uppercase leading-relaxed tracking-wider text-white/30">
          Directory: Radio Browser · streams play directly from each broadcaster — Glass Earth hosts and proxies nothing ·
          stations without coordinates live in the Stations panel · favourites are shared with it
        </p>
      </div>
    </div>,
    document.body,
  );
}
