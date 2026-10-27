'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Radar, SkipBack, SkipForward } from 'lucide-react';
import type { Map as MlMap } from 'maplibre-gl';
import { CLOUDS_LAYER } from '@/lib/live-clouds';
import {
  framesAt, halfHourTicks, unionTimeline, wmsTileUrl, WX_DRAW_ORDER, WX_SOURCES,
  type WxFrames, type WxSourceKey,
} from '@/lib/weather-imagery';
import { BoxShell, clock, IconButton, Legend, TextButton, TimeReadout, TimeTrack, Tune } from '@/components/TimeBox';

/**
 * OSIRIS — the NOAA weather-imagery suite's box: nowCOAST's MRMS radar,
 * GOES longwave IR and lightning-density layers under ONE history
 * timeline (see lib/weather-imagery).
 *
 * The timeline's steps are the union of the frames the active sources
 * actually published. Each source shows its nearest published frame to
 * the slider, and the box names that frame's own time — a source is
 * never drawn at a time it did not publish. Playing steps frame to
 * frame and rests on the newest; left there, the layers follow each new
 * frame as nowCOAST lands it (the frame list refreshes every 2 minutes).
 *
 * Each frame on screen is its own raster layer; the next step's frames
 * ride along invisible-but-loading so stepping does not wait on tiles.
 */

const MIN = 60_000;
const PREFIX = 'wx-';
const STORE = 'osiris.wx';
/** Union steps advanced per play tick. */
const RATES = [1, 2, 4];
const TICK_MS = 650;
/** Frame layers kept per source: the one on screen, the next, and a few recent. */
const KEEP = 6;

const RADAR_SCALE = [
  { value: '15', color: '#88ddee', name: 'Light' },
  { value: '25', color: '#0077aa', name: 'Moderate' },
  { value: '35', color: '#ffee00', name: 'Heavy' },
  { value: '45', color: '#ff4400', name: 'Very heavy' },
  { value: '55', color: '#ffaaff', name: 'Hail' },
];
const IR_SCALE = [
  { value: '', color: '#3a3a3a', name: 'Warm / clear' },
  { value: '', color: '#8a8a8a', name: 'Low cloud' },
  { value: '', color: '#d8d8d8', name: 'Mid cloud' },
  { value: '', color: '#ffffff', name: 'Cold tops' },
];
const LIGHTNING_SCALE = [
  { value: '', color: '#5e35b1', name: 'Few strikes' },
  { value: '', color: '#c2185b', name: 'Active' },
  { value: '', color: '#ffb300', name: 'Dense' },
];

interface Settings {
  opacity: Record<WxSourceKey, number>;
  rate: number;
  open: boolean;
}
const DEFAULTS: Settings = {
  opacity: { radar: WX_SOURCES.radar.opacity, satellite: WX_SOURCES.satellite.opacity, lightning: WX_SOURCES.lightning.opacity },
  rate: 1,
  open: false,
};
const VERSION = 1;

function readSettings(): Settings {
  const out: Settings = { ...DEFAULTS, opacity: { ...DEFAULTS.opacity } };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    for (const k of Object.keys(out.opacity) as WxSourceKey[]) {
      const v = saved?.opacity?.[k];
      if (typeof v === 'number') out.opacity[k] = Math.min(1, Math.max(0.2, v));
    }
    if (RATES.includes(saved?.rate)) out.rate = saved.rate;
    if (saved?.v === VERSION && typeof saved?.open === 'boolean') out.open = saved.open;
  } catch { /* storage blocked or corrupt */ }
  return out;
}

/** Under the clouds layer if it is up; else under the place names. */
function beneath(map: MlMap): string | undefined {
  if (map.getLayer(CLOUDS_LAYER)) return CLOUDS_LAYER;
  const satellite = map.getLayer('satellite-layer') && map.getLayoutProperty('satellite-layer', 'visibility') !== 'none';
  const firstLabel = map.getStyle().layers.find(l => l.type === 'symbol')?.id;
  const before = satellite || !firstLabel ? 'day-night-fill' : firstLabel;
  return map.getLayer(before) ? before : undefined;
}

/** "−40MIN", "−1H 20MIN" — how long before now. */
function ago(ms: number): string {
  const mins = Math.max(0, Math.round(ms / MIN));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `−${h ? `${h}H` : ''}${h && m ? ' ' : ''}${m || !h ? `${m}MIN` : ''}`;
}

const layerId = (key: WxSourceKey, t: number) => `${PREFIX}${key}-${t}`;

export default function WxImageryBar({ mapRef, mapStyle, active, onOff }: {
  mapRef: React.RefObject<MlMap | null>;
  mapStyle?: string;
  /** Which of the suite's layers are switched on. */
  active: Record<WxSourceKey, boolean>;
  onOff?: () => void;
}) {
  const activeKeys = useMemo(() => WX_DRAW_ORDER.filter(k => active[k]), [active.radar, active.satellite, active.lightning]); // eslint-disable-line react-hooks/exhaustive-deps
  const [frames, setFrames] = useState<WxFrames | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  /** The slider; Infinity follows the newest frame. */
  const [time, setTime] = useState(Infinity);
  const timeRef = useRef(time);
  const [now, setNow] = useState(() => Date.now());
  const [playing, setPlaying] = useState(false);
  const [tuning, setTuning] = useState(false);
  const [settings, setSettings] = useState<Settings>(readSettings);
  /** Union steps that have been on screen (their frames were requested). */
  const [visited, setVisited] = useState<ReadonlySet<number>>(() => new Set());
  /** Bumped when the base style is swapped, so layers re-add themselves. */
  const [styleTick, setStyleTick] = useState(0);

  /** Frame layers on the map, per source. */
  const added = useRef(new Map<WxSourceKey, Map<number, string>>());

  const seek = useCallback((t: number) => { timeRef.current = t; setTime(t); }, []);
  useEffect(() => { timeRef.current = time; }, [time]);
  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify({ ...settings, v: VERSION })); } catch { /* storage blocked */ }
  }, [settings]);

  // The frame lists. A new radar frame lands roughly every 4 minutes.
  useEffect(() => {
    let cancelled = false;
    const load = () => fetch('/api/weather-imagery')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { frames?: WxFrames }) => {
        const f = body?.frames;
        if (cancelled || !f) return;
        setUnavailable(false);
        setFrames(prev => (JSON.stringify(prev) === JSON.stringify(f) ? prev : f));
      })
      .catch(() => { if (!cancelled) setUnavailable(true); });
    load();
    const refresh = setInterval(load, 2 * MIN);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => { cancelled = true; clearInterval(refresh); clearInterval(tick); };
  }, []);

  // A base-style swap drops every custom source: notice, and re-add below.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onStyle = () => setStyleTick(t => t + 1);
    map.on('styledata', onStyle);
    return () => { map.off('styledata', onStyle); };
  }, [mapRef]);

  const timeline = useMemo(() => (frames ? unionTimeline(frames, activeKeys) : []), [frames, activeKeys]);
  const first = timeline[0] ?? 0;
  const last = timeline.at(-1) ?? 0;
  const at = timeline.length ? Math.min(last, Math.max(first, time)) : 0;
  const shown = useMemo(() => (frames ? framesAt(frames, activeKeys, at) : {}), [frames, activeKeys, at]);
  /** The frame each source will show at the next union step — preloaded. */
  const nextStep = timeline.find(t => t > at);
  const preload = useMemo(
    () => (frames && nextStep !== undefined ? framesAt(frames, activeKeys, nextStep) : {}),
    [frames, activeKeys, nextStep],
  );

  useEffect(() => {
    if (timeline.length) setVisited(prev => (prev.has(at) ? prev : new Set(prev).add(at)));
  }, [at, timeline.length]);

  // Sources + layers for the frames on screen and the ones being preloaded;
  // everything else of ours comes off the map. A source switched off in the
  // layer panel loses all its frame layers here.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !frames) return;
    void styleTick; void mapStyle;
    const before = beneath(map);
    for (const key of Object.keys(WX_SOURCES) as WxSourceKey[]) {
      let mine = added.current.get(key);
      if (!mine) { mine = new Map(); added.current.set(key, mine); }
      const want = new Set<number>();
      if (active[key]) {
        if (shown[key] !== undefined) want.add(shown[key]);
        if (preload[key] !== undefined) want.add(preload[key]);
      }
      // Layers the map no longer has (a style swap took them) are forgotten.
      for (const [t, id] of [...mine]) if (!map.getLayer(id)) mine.delete(t);
      for (const t of want) {
        if (mine.has(t)) continue;
        const id = layerId(key, t);
        if (!map.getSource(id)) {
          map.addSource(id, {
            type: 'raster', tileSize: 256, maxzoom: WX_SOURCES[key].maxZoom,
            attribution: WX_SOURCES[key].attribution,
            tiles: [wmsTileUrl(WX_SOURCES[key], t)],
          });
        }
        if (!map.getLayer(id)) {
          map.addLayer({
            id, type: 'raster', source: id, layout: { visibility: 'none' },
            paint: { 'raster-opacity': 0, 'raster-fade-duration': 300 },
          }, before);
        }
        mine.set(t, id);
      }
      // Prune: keep the wanted frames plus the most recent handful.
      const keepTimes = [...mine.keys()].sort((a, b) => b - a);
      for (const t of keepTimes) {
        if (want.has(t)) continue;
        if (keepTimes.indexOf(t) < KEEP) continue;
        const id = mine.get(t)!;
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
        mine.delete(t);
      }
      // Keep the suite's draw order: satellite under radar under lightning.
      for (const t of [...mine.keys()].sort((a, b) => a - b)) {
        const id = mine.get(t)!;
        if (map.getLayer(id)) map.moveLayer(id, before);
      }
    }
  }, [mapRef, frames, shown, preload, active, styleTick, mapStyle]);

  // Paint: the shown frame at the source's opacity; the preload frame
  // visible at 0 so its tiles stream in; the rest hidden.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const key of Object.keys(WX_SOURCES) as WxSourceKey[]) {
      const mine = added.current.get(key);
      if (!mine) continue;
      for (const [t, id] of mine) {
        if (!map.getLayer(id)) continue;
        if (active[key] && t === shown[key]) {
          map.setLayoutProperty(id, 'visibility', 'visible');
          map.setPaintProperty(id, 'raster-opacity', settings.opacity[key]);
        } else if (active[key] && t === preload[key]) {
          map.setLayoutProperty(id, 'visibility', 'visible');
          map.setPaintProperty(id, 'raster-opacity', 0);
        } else {
          map.setLayoutProperty(id, 'visibility', 'none');
        }
      }
    }
  }, [mapRef, shown, preload, active, settings.opacity]);

  // Unmount (all three layers off): take every frame layer away.
  useEffect(() => {
    const mine = added.current;
    return () => {
      const map = mapRef.current;
      if (!map) return;
      for (const per of mine.values()) {
        for (const id of per.values()) {
          if (map.getLayer(id)) map.removeLayer(id);
          if (map.getSource(id)) map.removeSource(id);
        }
        per.clear();
      }
    };
  }, [mapRef]);

  // Play: step through the union timeline; rest on the newest, then follow it.
  useEffect(() => {
    if (!playing || timeline.length < 2) return;
    const iv = setInterval(() => {
      const cur = Math.min(last, Math.max(first, timeRef.current));
      const idx = timeline.findIndex(t => t >= cur);
      const stepIdx = (idx < 0 ? timeline.length - 1 : idx) + settings.rate;
      if (stepIdx >= timeline.length) { seek(Infinity); setPlaying(false); }
      else seek(timeline[stepIdx]);
    }, TICK_MS);
    return () => clearInterval(iv);
  }, [playing, timeline, first, last, settings.rate, seek]);

  const live = time === Infinity;
  const place = (t: number) => seek(t >= last ? Infinity : t);
  const togglePlay = () => {
    if (!playing && at >= last) seek(first);
    if (playing && at >= last) seek(Infinity);
    setPlaying(p => !p);
  };
  const stepFrame = (dir: 1 | -1) => {
    const target = dir > 0 ? timeline.find(t => t > at + 1) : timeline.findLast(t => t < at - 1);
    if (target !== undefined) place(target);
  };
  const update = (patch: Partial<Settings>) => setSettings(s => ({ ...s, ...patch }));
  const setOpacity = (key: WxSourceKey, v: number) => setSettings(s => ({ ...s, opacity: { ...s.opacity, [key]: v } }));

  const date = new Date(at);
  const rel = live || (!playing && at >= last) ? 'LIVE' : ago(now - at);
  const tone = rel === 'LIVE' ? 'text-[var(--gold-light)]' : 'text-white/55';
  const marks = timeline.length ? halfHourTicks(first, last) : [];
  const activeDefs = WX_DRAW_ORDER.filter(k => active[k]).map(k => WX_SOURCES[k]);

  return (
    <BoxShell
      icon={Radar} title="NOAA Weather" source="NOWCOAST"
      open={settings.open} playing={playing} tuning={tuning} tuneLabel="Tune the weather layers"
      onOpen={() => update({ open: true })}
      onFold={() => { setTuning(false); update({ open: false }); }}
      onTune={() => setTuning(o => !o)}
      onOff={onOff}
      chip={frames && timeline.length > 0 && (
        <>
          <span className="text-[10.5px] font-semibold tracking-wider text-[var(--gold-light)] tabular-nums">{clock(date)}</span>
          <span className={`text-[9px] tracking-wider tabular-nums ${tone}`}>{rel}</span>
        </>
      )}
      tune={(
        <>
          {activeDefs.map(def => (
            <Tune key={def.key} label={def.label.toUpperCase()} value={settings.opacity[def.key]} min={0.2} max={1} step={0.05}
              format={v => `${Math.round(v * 100)}%`} onChange={v => setOpacity(def.key, v)} />
          ))}
          {active.radar && <Legend title="RADAR · REFLECTIVITY dBZ" steps={RADAR_SCALE} />}
          {active.satellite && <Legend title="SATELLITE · LONGWAVE IR" steps={IR_SCALE} />}
          {active.lightning && <Legend title="LIGHTNING · STRIKE DENSITY" steps={LIGHTNING_SCALE} />}
        </>
      )}
    >
      {frames && timeline.length ? (
        <TimeReadout at={date} rel={rel} tone={tone} waiting={false} live={rel === 'LIVE'} />
      ) : (
        <div className="min-h-[34px] pt-1 text-[10px] tracking-[0.18em] text-white/40">{unavailable ? 'NOWCOAST UNAVAILABLE — RETRYING' : 'LOADING FRAMES…'}</div>
      )}

      {frames && timeline.length > 0 && (
        <div className="mt-1 flex flex-col gap-0.5">
          {activeDefs.map(def => {
            const f = shown[def.key];
            if (f === undefined) return null;
            const delta = at - f;
            const held = Math.abs(delta) >= 2 * MIN ? ` · NEAREST ${delta > 0 ? '−' : '+'}${Math.round(Math.abs(delta) / MIN)}MIN` : '';
            return (
              <div key={def.key} className="flex items-baseline gap-1.5 text-[9px] tracking-[0.14em] tabular-nums whitespace-nowrap overflow-hidden">
                <span className="text-white/30 w-[62px] shrink-0">{def.label.toUpperCase()}</span>
                <span className="text-white/60">{`${String(new Date(f).getUTCHours()).padStart(2, '0')}:${String(new Date(f).getUTCMinutes()).padStart(2, '0')}Z`}</span>
                <span className="text-white/35">{held}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-1 flex items-center gap-0.5">
        <IconButton label="Previous frame" onClick={() => stepFrame(-1)} disabled={!timeline.length || at <= first}><SkipBack className="w-3.5 h-3.5" strokeWidth={1.6} /></IconButton>
        <IconButton label={playing ? 'Pause' : 'Play the recent history'} onClick={togglePlay} disabled={timeline.length < 2} active={playing}>
          {playing ? <Pause className="w-3.5 h-3.5" strokeWidth={1.8} /> : <Play className="w-3.5 h-3.5" strokeWidth={1.8} />}
        </IconButton>
        <IconButton label="Next frame" onClick={() => stepFrame(1)} disabled={!timeline.length || at >= last}><SkipForward className="w-3.5 h-3.5" strokeWidth={1.6} /></IconButton>
        <div className="ml-auto flex items-center gap-0.5">
          {rel !== 'LIVE' && <TextButton onClick={() => { setPlaying(false); seek(Infinity); }}>LIVE</TextButton>}
          <TextButton title="Play speed: timeline steps per tick"
            onClick={() => update({ rate: RATES[(RATES.indexOf(settings.rate) + 1) % RATES.length] })}>
            {settings.rate}×
          </TextButton>
        </div>
      </div>

      {timeline.length > 0 && (
        <TimeTrack
          first={first} last={last} now={now} at={at} step={1000}
          times={timeline} loaded={visited}
          ticks={marks} labels={marks.map(t => ({ at: t, label: clock(new Date(t)) }))}
          ariaLabel="Weather history time"
          valueText={`${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}, ${rel === 'LIVE' ? 'latest frames' : `${Math.round((now - at) / MIN)} minutes ago`}`}
          onSeek={t => {
            setPlaying(false);
            // Snap to the union step the visitor landed on (or just past it).
            const target = timeline.find(x => x >= t) ?? last;
            place(target);
          }}
          onSpace={togglePlay}
        />
      )}
    </BoxShell>
  );
}
