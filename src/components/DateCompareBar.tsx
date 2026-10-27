'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, ChevronLeft, ChevronRight, MoveHorizontal, Satellite, ZoomIn } from 'lucide-react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap, RasterTileSource } from 'maplibre-gl';
import {
  addDays, cachedProbe, clampToWindow, DC_MIN_GOOD_ZOOM, DC_SENSORS, diffDays, formatDcDate,
  gibsTiles, headProbe, isoDay, resolveSide, sampleTiles, windowEnding,
  type DcResolved, type DcWindow,
} from '@/lib/date-compare';
import { applyMapProjection } from '@/lib/map-projection';
import { BoxShell, IconButton, Tune } from '@/components/TimeBox';

/**
 * OSIRIS — satellite date comparison (lib/date-compare): NASA HLS daily
 * imagery as an A/B swipe over the current view.
 *
 * Two maps do the swiping — the visitor's own map carries side A (one
 * raster layer over a dark backdrop, under the place names), and a
 * second, non-interactive map rides exactly on top of it carrying side
 * B, clipped by CSS to the right of the divider. The visitor's basemap
 * and layer set are never touched: entering adds our layers, leaving
 * removes them, and their saved style is what's underneath throughout —
 * the same hygiene the cockpit ride's derived satellite style follows.
 *
 * Both sides label the ACTUAL date and sensor resolved for this view
 * (probed from GIBS's own availability headers), never the picked date
 * when the two differ. The sensor looks filter every map canvas, this
 * overlay's included, so a look treats the comparison like the rest of
 * the world.
 */

const STORE = 'osiris.dc';
const A_SRC = 'dc-a-src';
const B_SRC = 'dc-b-src';
const BACK = '#04060a';

interface Side {
  pick: string;
  resolved: DcResolved | null;
  /** Resolution ran for the current view and found nothing. */
  empty: boolean;
  busy: boolean;
}

function readSettings(): { open: boolean; opacity: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    return {
      open: saved?.open !== false,
      opacity: typeof saved?.opacity === 'number' ? Math.min(1, Math.max(0.3, saved.opacity)) : 1,
    };
  } catch { return { open: true, opacity: 1 }; }
}

/** Under the place names (and under live clouds when they're up). */
function beneath(map: MlMap): string | undefined {
  const firstLabel = map.getStyle().layers.find(l => l.type === 'symbol')?.id;
  return firstLabel && map.getLayer(firstLabel) ? firstLabel : undefined;
}

function sideLine(side: Side): string {
  if (side.busy) return 'FINDING PASSES…';
  if (!side.resolved) return side.empty ? 'NO PASS IN THE LAST 30 DAYS HERE' : '—';
  const r = side.resolved;
  const base = `SHOWING ${formatDcDate(r.actual)} · ${DC_SENSORS[r.sensor].label.toUpperCase()}`;
  if (r.snappedDays === 0) return base;
  const d = diffDays(r.picked, r.actual);
  return `${base} · NEAREST PASS ${d > 0 ? '+' : '−'}${Math.abs(d)}D FROM PICK`;
}

export default function DateCompareBar({ mapRef, projection = 'globe', onOff }: {
  mapRef: React.RefObject<MlMap | null>;
  projection?: 'globe' | 'mercator';
  onOff?: () => void;
}) {
  const [win, setWin] = useState<DcWindow | null>(null);
  const [sideA, setSideA] = useState<Side | null>(null);
  const [sideB, setSideB] = useState<Side | null>(null);
  const [split, setSplit] = useState(50);
  const [settings, setSettings] = useState(readSettings);
  const [tuning, setTuning] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [styleTick, setStyleTick] = useState(0);
  const open = settings.open;
  const setOpen = (v: boolean) => setSettings(s => ({ ...s, open: v }));

  const probe = useRef(cachedProbe(headProbe()));
  const runId = useRef(0);
  const splitRef = useRef(split);
  const overlayRef = useRef<MlMap | null>(null);
  const overlayDivRef = useRef<HTMLDivElement | null>(null);
  const dividerRef = useRef<HTMLDivElement | null>(null);
  const chipARef = useRef<HTMLDivElement | null>(null);
  const chipBRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch { /* storage blocked */ }
  }, [settings]);

  // The calendar: the newest dates GIBS actually publishes.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/date-compare')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { latest?: { s30: string; l30: string } }) => {
        if (cancelled || !body.latest) return;
        const latest = body.latest.s30 >= body.latest.l30 ? body.latest.s30 : body.latest.l30;
        const w = windowEnding(latest);
        setWin(w);
        setSideB({ pick: w.end, resolved: null, empty: false, busy: true });
        setSideA({ pick: addDays(w.end, -14), resolved: null, empty: false, busy: true });
      })
      .catch(() => {
        if (cancelled) return;
        const w = windowEnding(isoDay(Date.now() - 2 * 86_400_000));
        setWin(w);
        setSideB({ pick: w.end, resolved: null, empty: false, busy: true });
        setSideA({ pick: addDays(w.end, -14), resolved: null, empty: false, busy: true });
      });
    return () => { cancelled = true; };
  }, []);

  /* ── The overlay map (side B) ─────────────────────────────────────── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const parent = map.getContainer().parentElement;
    if (!parent) return;

    const div = document.createElement('div');
    div.setAttribute('aria-hidden', 'true');
    div.style.cssText = 'position:absolute;inset:0;z-index:5;pointer-events:none;';
    parent.appendChild(div);
    overlayDivRef.current = div;

    const overlay = new maplibregl.Map({
      container: div,
      style: {
        version: 8,
        sources: {},
        layers: [{ id: 'dc-b-back', type: 'background', paint: { 'background-color': BACK } }],
      },
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
      canvasContextAttributes: { antialias: false },
    });
    overlayRef.current = overlay;
    applyMapProjection(overlay, projection);
    const sync = () => overlay.jumpTo({ center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() });
    sync();
    map.on('move', sync);
    const onStyle = () => setStyleTick(t => t + 1);
    map.on('styledata', onStyle);

    const clip = () => { div.style.clipPath = `inset(0 0 0 ${splitRef.current}%)`; };
    clip();

    return () => {
      map.off('move', sync);
      map.off('styledata', onStyle);
      overlay.remove();
      div.remove();
      overlayRef.current = null;
      overlayDivRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRef]);

  // Follow the main map's projection if the visitor flips it mid-compare.
  useEffect(() => {
    if (overlayRef.current) applyMapProjection(overlayRef.current, projection);
  }, [projection]);

  // Clip follows the split (state for the panel slider, ref for drags).
  useEffect(() => {
    splitRef.current = split;
    if (overlayDivRef.current) overlayDivRef.current.style.clipPath = `inset(0 0 0 ${split}%)`;
    if (dividerRef.current) dividerRef.current.style.left = `${split}%`;
  }, [split]);

  /* ── Side B source follows its resolution ─────────────────────────── */
  useEffect(() => {
    const overlay = overlayRef.current;
    const r = sideB?.resolved;
    if (!overlay) return;
    const apply = () => {
      if (!overlay.getSource(B_SRC)) {
        overlay.addSource(B_SRC, {
          type: 'raster', tileSize: 256, maxzoom: 12,
          attribution: r ? DC_SENSORS[r.sensor].attribution : DC_SENSORS.s30.attribution,
          tiles: r ? gibsTiles(r.sensor, r.actual) : gibsTiles('s30', '2000-01-01'),
        });
        overlay.addLayer({ id: 'dc-b', type: 'raster', source: B_SRC, paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 } });
      } else if (r) {
        (overlay.getSource(B_SRC) as RasterTileSource).setTiles(gibsTiles(r.sensor, r.actual));
      }
      overlay.setLayoutProperty('dc-b', 'visibility', r ? 'visible' : 'none');
      if (r) overlay.setPaintProperty('dc-b', 'raster-opacity', settings.opacity);
    };
    if (overlay.isStyleLoaded()) apply();
    else overlay.once('load', apply);
  }, [sideB?.resolved, settings.opacity]);

  /* ── Side A on the visitor's map ───────────────────────────────────── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    void styleTick;
    const r = sideA?.resolved;
    const before = beneath(map);
    if (!map.getSource(A_SRC)) {
      map.addSource(A_SRC, {
        type: 'raster', tileSize: 256, maxzoom: 12,
        attribution: r ? DC_SENSORS[r.sensor].attribution : DC_SENSORS.s30.attribution,
        tiles: r ? gibsTiles(r.sensor, r.actual) : gibsTiles('s30', '2000-01-01'),
      });
    } else if (r) {
      (map.getSource(A_SRC) as RasterTileSource).setTiles(gibsTiles(r.sensor, r.actual));
    }
    if (!map.getLayer('dc-back')) {
      map.addLayer({ id: 'dc-back', type: 'background', paint: { 'background-color': BACK, 'background-opacity': 0.92 } }, before);
    }
    if (!map.getLayer('dc-a')) {
      map.addLayer({ id: 'dc-a', type: 'raster', source: A_SRC, paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 } }, before);
    } else {
      map.moveLayer('dc-back', before);
      map.moveLayer('dc-a', before);
    }
    map.setLayoutProperty('dc-a', 'visibility', r ? 'visible' : 'none');
    map.setLayoutProperty('dc-back', 'visibility', r ? 'visible' : 'none');
    if (r) map.setPaintProperty('dc-a', 'raster-opacity', settings.opacity);
  }, [mapRef, sideA?.resolved, styleTick, settings.opacity]);

  // Leaving compare removes everything we added to the visitor's map.
  useEffect(() => {
    const map = mapRef.current;
    return () => {
      if (!map) return;
      for (const id of ['dc-a', 'dc-back']) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(A_SRC)) map.removeSource(A_SRC);
    };
  }, [mapRef]);

  /* ── Resolution: probe the current view for both picks ────────────── */
  const resolve = useCallback(() => {
    const map = mapRef.current;
    if (!map || !win || !sideA || !sideB) return;
    const run = ++runId.current;
    const b = map.getBounds();
    const tiles = sampleTiles({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
    setZoom(map.getZoom());
    const settle = (set: typeof setSideA) => (res: DcResolved | null) =>
      set(prev => (prev ? { ...prev, resolved: res, empty: !res, busy: false } : prev));
    void resolveSide(sideA.pick, win, tiles, probe.current).then(res => { if (run === runId.current) settle(setSideA)(res); });
    void resolveSide(sideB.pick, win, tiles, probe.current).then(res => { if (run === runId.current) settle(setSideB)(res); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRef, win, sideA?.pick, sideB?.pick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !win) return;
    resolve();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onEnd = () => { clearTimeout(timer); timer = setTimeout(resolve, 350); };
    map.on('moveend', onEnd);
    return () => { map.off('moveend', onEnd); clearTimeout(timer); };
  }, [mapRef, win, resolve]);

  /* ── The divider ──────────────────────────────────────────────────── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const parent = map.getContainer().parentElement;
    if (!parent) return;
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;top:0;bottom:0;left:${splitRef.current}%;z-index:6;pointer-events:none;`;
    const line = document.createElement('div');
    line.style.cssText = 'position:absolute;top:0;bottom:0;left:-1px;width:2px;background:rgba(255,255,255,0.75);box-shadow:0 0 8px rgba(0,0,0,0.6);';
    el.appendChild(line);
    // The two actual dates, riding the top of the divider — A ending at
    // the line from the left, B starting after it. Always on screen,
    // panel open or folded.
    const chipCss = 'position:absolute;top:76px;padding:3px 7px;border-radius:6px;background:rgba(5,8,14,0.72);border:1px solid rgba(255,255,255,0.18);backdrop-filter:blur(4px);color:rgba(255,255,255,0.88);font-family:ui-monospace,monospace;font-size:9px;letter-spacing:0.14em;white-space:nowrap;';
    const chipA = document.createElement('div');
    chipA.style.cssText = `${chipCss}right:10px;`;
    const chipB = document.createElement('div');
    chipB.style.cssText = `${chipCss}left:10px;`;
    el.appendChild(chipA);
    el.appendChild(chipB);
    chipARef.current = chipA;
    chipBRef.current = chipB;
    const grip = document.createElement('button');
    grip.type = 'button';
    grip.setAttribute('aria-label', 'Drag to compare the two dates');
    grip.style.cssText = 'pointer-events:auto;position:absolute;top:50%;left:0;transform:translate(-50%,-50%);width:34px;height:48px;border-radius:10px;border:1px solid rgba(255,255,255,0.35);background:rgba(5,8,14,0.72);backdrop-filter:blur(4px);color:rgba(255,255,255,0.85);display:flex;align-items:center;justify-content:center;cursor:ew-resize;touch-action:none;';
    grip.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m18 8 4 4-4 4"/><path d="m6 8-4 4 4 4"/></svg>';
    el.appendChild(grip);
    parent.appendChild(el);
    dividerRef.current = el;

    let dragging = false;
    const place = (clientX: number) => {
      const rect = parent.getBoundingClientRect();
      const pct = Math.min(96, Math.max(4, ((clientX - rect.left) / rect.width) * 100));
      setSplit(pct);
    };
    const down = (e: PointerEvent) => { dragging = true; grip.setPointerCapture(e.pointerId); place(e.clientX); };
    const move = (e: PointerEvent) => { if (dragging) place(e.clientX); };
    const up = () => { dragging = false; };
    grip.addEventListener('pointerdown', down);
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); setSplit(s => Math.max(4, s - 4)); }
      if (e.key === 'ArrowRight') { e.preventDefault(); setSplit(s => Math.min(96, s + 4)); }
    };
    grip.addEventListener('keydown', keys);
    return () => {
      grip.removeEventListener('pointerdown', down);
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      grip.removeEventListener('keydown', keys);
      el.remove();
      dividerRef.current = null;
      chipARef.current = null;
      chipBRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRef]);

  /* ── Date chips riding the top of the divider ─────────────────────── */
  const chip = (side: Side | null, letter: string) => {
    if (!side) return '…';
    if (side.busy) return `${letter} · FINDING…`;
    if (!side.resolved) return `${letter} · NO PASS`;
    return `${letter} · ${formatDcDate(side.resolved.actual)} · ${DC_SENSORS[side.resolved.sensor].label.toUpperCase()}`;
  };
  useEffect(() => {
    if (chipARef.current) chipARef.current.textContent = chip(sideA, 'A');
    if (chipBRef.current) chipBRef.current.textContent = chip(sideB, 'B');
  });

  const setPick = (which: 'a' | 'b', iso: string) => {
    if (!win) return;
    const clamped = clampToWindow(iso, win);
    const set = which === 'a' ? setSideA : setSideB;
    set(prev => (prev ? { ...prev, pick: clamped, busy: true } : prev));
  };
  const swap = () => {
    if (!sideA || !sideB) return;
    setSideA({ ...sideB, busy: true });
    setSideB({ ...sideA, busy: true });
  };

  const row = (letter: 'A' | 'B', side: Side | null, which: 'a' | 'b') => (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <span className="text-[9px] tracking-[0.2em] text-[var(--gold-light)] w-3">{letter}</span>
        <IconButton label={`Step ${letter} one day earlier`} disabled={!win || !side}
          onClick={() => side && setPick(which, addDays(side.pick, -1))}>
          <ChevronLeft className="w-3.5 h-3.5" strokeWidth={1.6} />
        </IconButton>
        <span className="text-[11px] font-semibold tracking-wider text-white/85 tabular-nums">
          {side ? formatDcDate(side.pick) : '…'}
        </span>
        <IconButton label={`Step ${letter} one day later`} disabled={!win || !side}
          onClick={() => side && setPick(which, addDays(side.pick, 1))}>
          <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.6} />
        </IconButton>
        <input
          type="range" aria-label={`Date ${letter}`} className="ml-1 flex-1 accent-[#c9a227] h-1"
          min={0} max={win ? diffDays(win.start, win.end) : 29} step={1}
          value={win && side ? diffDays(win.start, side.pick) : 0}
          disabled={!win || !side}
          onChange={e => win && setPick(which, addDays(win.start, Number(e.target.value)))}
        />
      </div>
      <div className="pl-4 text-[8.5px] tracking-[0.14em] text-white/40 tabular-nums">
        {side ? sideLine(side) : 'LOADING CALENDAR…'}
      </div>
    </div>
  );

  return (
    <BoxShell
        icon={Satellite} title="Date Compare" source="NASA GIBS · HLS"
        open={open} playing={false} tuning={tuning} tuneLabel="Tune the date comparison"
        onOpen={() => setOpen(true)}
        onFold={() => { setTuning(false); setOpen(false); }}
        onTune={() => setTuning(t => !t)}
        onOff={onOff}
        chip={sideA && sideB && (
          <span className="text-[9px] tracking-wider text-white/55 tabular-nums">
            {formatDcDate(sideA.resolved?.actual ?? sideA.pick)} | {formatDcDate(sideB.resolved?.actual ?? sideB.pick)}
          </span>
        )}
        tune={(
          <Tune label="IMAGERY" value={settings.opacity} min={0.3} max={1} step={0.05}
            format={v => `${Math.round(v * 100)}%`}
            onChange={v => setSettings(s => ({ ...s, opacity: v }))} />
        )}
      >
        <div className="flex flex-col gap-2.5 pb-1.5">
          {row('A', sideA, 'a')}
          {row('B', sideB, 'b')}
          <div className="flex items-center gap-1 pt-0.5">
            <MoveHorizontal className="w-3.5 h-3.5 text-white/35" strokeWidth={1.6} />
            <input
              type="range" aria-label="Swipe divider position" className="flex-1 accent-[#c9a227] h-1"
              min={4} max={96} step={1} value={Math.round(split)}
              onChange={e => setSplit(Number(e.target.value))}
            />
            <button type="button" onClick={swap} title="Swap the two dates"
              className="ml-1 flex items-center gap-1 text-[9px] tracking-[0.16em] text-white/55 hover:text-white/85">
              <ArrowLeftRight className="w-3 h-3" strokeWidth={1.7} /> SWAP
            </button>
          </div>
          {zoom > 0 && zoom < DC_MIN_GOOD_ZOOM && (
            <div className="flex items-center gap-2 text-[9px] tracking-[0.14em] text-amber-200/80">
              <span>ZOOM IN — 30 M PIXELS NEED A CLOSER LOOK</span>
              <button type="button" onClick={() => mapRef.current?.easeTo({ zoom: 11, duration: 900 })}
                className="flex items-center gap-1 text-[var(--gold-light)] hover:text-white">
                <ZoomIn className="w-3 h-3" strokeWidth={1.7} /> GO
              </button>
            </div>
          )}
          <div className="text-[8.5px] tracking-[0.14em] text-white/30">
            DARK = NO SATELLITE PASS THAT DAY · A LEFT · B RIGHT OF THE DIVIDER
          </div>
          <div className="sr-only">{chip(sideA, 'A')} — {chip(sideB, 'B')}</div>
        </div>
      </BoxShell>
  );
}
