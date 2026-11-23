'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, BookOpen, Camera, CloudLightning, Headphones, Plane, Play, Radio, Satellite, Sun, X,
} from 'lucide-react';
import {
  cameraProximity, dossierTitle, formatCoords, formatKm, nearbyQuakes, nearbyWeatherEvents,
  solarSummary,
  DOSSIER_CAMERA_RADIUS_KM, DOSSIER_QUAKE_RADIUS_KM, DOSSIER_WEATHER_RADIUS_KM,
  type DossierCameraLike, type WeatherEventLike,
} from '@/lib/place-dossier';
import { overheadAircraft, type FlightRowLike } from '@/lib/look-up';
import { flightsSweepLanded } from '@/lib/share-target';
import type { IssPassLike, QuakeLike } from '@/lib/smart-alerts';
import type { RadioStation } from '@/lib/stations';

/**
 * Glass Earth — Place Dossier panel (weekly pick, Rick 2026-11-23).
 *
 * One spot on the planet, everything the app already knows about it,
 * live: sun and dawn state from the app's solar model, the next ISS
 * pass from the Look Up! route, the nearest catalogue cameras, aircraft
 * overhead from the flight feed, local radio through the Listen to
 * This Place plumbing, active weather events, and the last day's
 * earthquakes nearby.
 *
 * Every section is honest in the NEAR ME way: a feed that failed reads
 * as unavailable, a feed that answered with nothing nearby says exactly
 * that, and no number is ever composed to fill a gap. Playback belongs
 * to the page's single radio owner (onPlayRadio) — this panel never
 * plays audio itself, and a station the owner reports dead is named
 * and skipped to the next-nearest, like the camera viewer's pairing.
 */

const ISS_NORAD = '25544';
const AIRCRAFT_RADIUS_KM = 100; // Look Up!'s radius — the same question, the same answer.
const RADIO_MAX_KM = 250; // Listen to This Place's honesty cap.

export interface DossierTarget {
  lat: number;
  lng: number;
  /** The name from the visitor's own search pick for this spot, when there is one. */
  nameHint?: string | null;
}

interface PlaceDossierPanelProps {
  target: DossierTarget;
  /** The page's loaded camera catalogue rows. */
  cameras: readonly DossierCameraLike[];
  /** The page's loaded /api/weather events; null = not loaded yet. */
  weatherEvents: readonly WeatherEventLike[] | null;
  /** The page's flight-feed buckets (the same object Look Up! reads). */
  flightData: Record<string, unknown> | null;
  onClose: () => void;
  /** Open a camera in the page's camera viewer. */
  onOpenCamera: (cam: DossierCameraLike) => void;
  /** Hand a station to the page's single radio playback owner. */
  onPlayRadio?: (station: RadioStation) => void;
  /** Dead-stream reports from the playback owner — the skip signal. */
  radioFailure?: { uuid: string; at: number } | null;
  /** The station the page's radio owner is playing right now, if any. */
  currentRadioUuid?: string | null;
  /** Fly to an aircraft and open its popup (Look Up!'s handler). */
  onFocusFlight?: (icao24: string) => void;
}

type FetchPhase = 'loading' | 'ready' | 'error';

function fmtClock(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtDay(d: Date, nowMs: number): string {
  const now = new Date(nowMs);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(d) - startOf(now)) / 86_400_000);
  if (days === 0) return 'today';
  if ( (days === 1)) return 'tomorrow';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }).toLowerCase();
}

function fmtWhen(ms: number, now: number): string {
  const d = new Date(ms);
  return `${fmtClock(d)} ${fmtDay(d, now)}`;
}

function ago(at: number, now: number): string {
  const mins = Math.max(0, Math.round((now - at) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

const SECTION_TITLE = 'font-mono text-[9px] font-bold uppercase tracking-[0.25em] text-white/45';
const NOTE = 'mt-2 font-mono text-[9px] uppercase leading-relaxed tracking-wider text-white/40';
const ROW = 'flex w-full items-center gap-2 border border-white/10 bg-white/[0.03] px-2.5 py-2 text-left transition-colors hover:bg-white/10';

function Section({ title, right, children }: { title: string; right?: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-white/5 px-3 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className={SECTION_TITLE}>{title}</span>
        {right && <span className="font-mono text-[8.5px] tabular-nums text-white/40">{right}</span>}
      </div>
      {children}
    </div>
  );
}

interface RadioCandidate { station: RadioStation; distanceKm: number }

export default function PlaceDossierPanel({
  target, cameras, weatherEvents, flightData,
  onClose, onOpenCamera, onPlayRadio, radioFailure, currentRadioUuid, onFocusFlight,
}: PlaceDossierPanelProps) {
  const { lat, lng } = target;
  const targetKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  /* ── The name: the visitor's own search pick first, then the app's
        reverse-geocode route (the same one the map's location readout
        uses), then the coordinates themselves. ── */
  const [reverseLabel, setReverseLabel] = useState<{ key: string; label: string | null } | null>(null);
  useEffect(() => {
    if (target.nameHint) return;
    let cancelled = false;
    fetch(`/api/geo/reverse?lat=${lat}&lng=${lng}`, { signal: AbortSignal.timeout(10_000) })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setReverseLabel({ key: targetKey, label: typeof d?.label === 'string' ? d.label : null }); })
      .catch(() => { if (!cancelled) setReverseLabel({ key: targetKey, label: null }); });
    return () => { cancelled = true; };
  }, [lat, lng, targetKey, target.nameHint]);
  const labelForTarget = reverseLabel && reverseLabel.key === targetKey ? reverseLabel.label : null;
  const title = dossierTitle(target.nameHint, labelForTarget, lat, lng);

  /* ── Sun: pure, from the app's own solar model. ── */
  const solar = useMemo(() => solarSummary(lat, lng, now), [lat, lng, now]);
  const phaseLine = solar.phase === 'day'
    ? `Daylight — sun ${Math.round(solar.elevationDeg)}° up`
    : solar.phase === 'night'
      ? `Night — sun ${Math.round(Math.abs(solar.elevationDeg))}° below the horizon`
      : solar.phase === 'dawn'
        ? `Dawn twilight — sun ${Math.abs(solar.elevationDeg).toFixed(1)}° below the horizon and climbing`
        : `Dusk twilight — sun ${Math.abs(solar.elevationDeg).toFixed(1)}° below the horizon and falling`;

  /* The sun-times line, assembled once: each event the model found is
     named once, and an event it never found in two days says so. */
  const sunBits: string[] = [];
  if (solar.nextSunsetMs !== null) sunBits.push(`Sunset ${fmtWhen(solar.nextSunsetMs, now)}`);
  if (solar.nextSunriseMs !== null) sunBits.push(`Sunrise ${fmtWhen(solar.nextSunriseMs, now)}`);
  if (solar.nextSunsetMs === null && solar.nextSunriseMs === null) {
    sunBits.push('The sun does not cross the horizon here in the next two days (polar day/night)');
  } else {
    if (solar.nextSunsetMs === null) sunBits.push('No sunset in the next two days');
    if (solar.nextSunriseMs === null) sunBits.push('No sunrise in the next two days');
  }

  /* ── ISS: the Look Up! passes route; the math stays server-side. ── */
  const [passesState, setPassesState] = useState<{ key: string; phase: FetchPhase; passes: IssPassLike[] }>({ key: '', phase: 'loading', passes: [] });
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/satellites/passes?id=${ISS_NORAD}&lat=${lat}&lng=${lng}`, { signal: AbortSignal.timeout(15_000) })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled) return;
        if (Array.isArray(d?.passes)) setPassesState({ key: targetKey, phase: 'ready', passes: d.passes });
        else setPassesState({ key: targetKey, phase: 'error', passes: [] });
      })
      .catch(() => { if (!cancelled) setPassesState({ key: targetKey, phase: 'error', passes: [] }); });
    return () => { cancelled = true; };
  }, [lat, lng, targetKey]);
  const passes = passesState.key === targetKey ? passesState : { phase: 'loading' as FetchPhase, passes: [] as IssPassLike[] };
  const nextPass = passes.passes.find(p => Date.parse(p.setAt) >= now) ?? null;

  /* ── Quakes: the Smart Alerts feed read, scoped to this spot. ── */
  const [quakesState, setQuakesState] = useState<{ key: string; phase: FetchPhase; quakes: QuakeLike[] }>({ key: '', phase: 'loading', quakes: [] });
  useEffect(() => {
    let cancelled = false;
    fetch('/api/earthquakes', { signal: AbortSignal.timeout(10_000) })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled) return;
        if (Array.isArray(d?.earthquakes)) setQuakesState({ key: targetKey, phase: 'ready', quakes: d.earthquakes });
        else setQuakesState({ key: targetKey, phase: 'error', quakes: [] });
      })
      .catch(() => { if (!cancelled) setQuakesState({ key: targetKey, phase: 'error', quakes: [] }); });
    return () => { cancelled = true; };
  }, [targetKey]);
  const quakes = quakesState.key === targetKey ? quakesState : { phase: 'loading' as FetchPhase, quakes: [] as QuakeLike[] };
  const quakeResult = useMemo(
    () => (quakes.phase === 'ready' ? nearbyQuakes(quakes.quakes, { lat, lng }, now) : null),
    [quakes, lat, lng, now],
  );

  /* ── Cameras + weather + flights: assembled from what the page holds. ── */
  const camResult = useMemo(() => cameraProximity(cameras, { lat, lng }), [cameras, lat, lng]);
  const wxResult = useMemo(
    () => (weatherEvents ? nearbyWeatherEvents(weatherEvents, { lat, lng }) : null),
    [weatherEvents, lat, lng],
  );
  const aircraft = useMemo(() => {
    if (!flightData) return { near: [], totalNear: 0 };
    const rows: FlightRowLike[] = [];
    for (const key of ['commercial_flights', 'private_flights', 'private_jets', 'military_flights']) {
      const bucket = flightData[key];
      if (Array.isArray(bucket)) rows.push(...(bucket as FlightRowLike[]));
    }
    return overheadAircraft(rows, { lat, lng }, AIRCRAFT_RADIUS_KM, 6);
  }, [flightData, lat, lng]);
  const flightsLanded = flightsSweepLanded(flightData);

  /* ── Radio: Listen to This Place's route, ranked by true distance.
        The candidates are kept so a dead station can be named and
        skipped to the next-nearest, exactly as the camera viewer does. ── */
  const [radioState, setRadioState] = useState<{ key: string; phase: FetchPhase | 'none'; list: RadioCandidate[] }>({ key: '', phase: 'loading', list: [] });
  const [radioSkipped, setRadioSkipped] = useState<{ key: string; names: string[] }>({ key: '', names: [] });
  const [startedUuid, setStartedUuid] = useState<{ key: string; uuid: string } | null>(null);
  useEffect(() => {
    if (!onPlayRadio) return;
    let cancelled = false;
    fetch(`/api/stations/radio?mode=near&lat=${lat}&lng=${lng}&limit=8`, { signal: AbortSignal.timeout(20_000) })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled) return;
        const list = (Array.isArray(d?.stations) ? d.stations : [])
          .map((st: RadioStation & { distanceKm?: number }) => ({
            station: st,
            distanceKm: typeof st.distanceKm === 'number' ? st.distanceKm : Number.POSITIVE_INFINITY,
          }))
          .filter((n: RadioCandidate) => n.distanceKm <= RADIO_MAX_KM);
        setRadioState({ key: targetKey, phase: list.length ? 'ready' : 'none', list });
      })
      .catch(() => { if (!cancelled) setRadioState({ key: targetKey, phase: 'error', list: [] }); });
    return () => { cancelled = true; };
  }, [lat, lng, targetKey, onPlayRadio]);
  const radio = radioState.key === targetKey ? radioState : { phase: 'loading' as const, list: [] as RadioCandidate[] };
  const skipped = radioSkipped.key === targetKey ? radioSkipped.names : [];
  const startedHere = startedUuid && startedUuid.key === targetKey ? startedUuid.uuid : null;

  const playCandidate = (c: RadioCandidate) => {
    setStartedUuid({ key: targetKey, uuid: c.station.uuid });
    onPlayRadio?.(c.station);
  };

  /* Auto-skip: only the failure of a station this panel started, only
     while it is the one playing, moves to the next-nearest. */
  useEffect(() => {
    if (!radioFailure || !onPlayRadio || radio.phase !== 'ready') return;
    if (currentRadioUuid !== radioFailure.uuid) return;
    if (startedHere !== radioFailure.uuid) return;
    const idx = radio.list.findIndex(c => c.station.uuid === radioFailure.uuid);
    if (idx < 0) return;
    const deadName = radio.list[idx].station.name;
    const next = radio.list[idx + 1];
    setRadioSkipped(prev => ({
      key: targetKey,
      names: [...(prev.key === targetKey ? prev.names : []), deadName],
    }));
    if (next) playCandidate(next);
    else setStartedUuid(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radioFailure]);

  const camLabel = (cam: DossierCameraLike) => {
    const name = typeof cam.name === 'string' && cam.name.trim() ? cam.name.trim() : 'Camera';
    const where = [cam.city, cam.country].filter(v => typeof v === 'string' && v.trim()).join(', ');
    return { name, where };
  };

  return (
    <div className="fixed bottom-0 right-0 top-0 z-[940] flex w-[min(430px,100vw)] flex-col border-l border-white/10 bg-[#0a0a0a]/[0.98] shadow-2xl" data-testid="place-dossier-panel">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
        <BookOpen className="h-4 w-4 shrink-0 text-[var(--gold-primary)]" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[12px] font-bold tracking-[0.18em] text-white" title={title}>{title.toUpperCase()}</div>
          <div className="font-mono text-[8.5px] uppercase tracking-wider text-white/40">
            Place dossier · {formatCoords(lat, lng)}
          </div>
        </div>
        <button onClick={onClose} className="rounded p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white" aria-label="Close place dossier">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* ── Sun & sky ── */}
        <Section title="Sun & sky" right={solar.inDawnBand ? 'ON THE DAWN LINE' : undefined}>
          <div className="mt-2 flex items-start gap-2">
            <Sun className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#FFD54F]" />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium leading-snug text-white">{phaseLine}</div>
              <div className="mt-0.5 font-mono text-[9px] uppercase leading-relaxed tracking-wider text-white/45">
                {sunBits.join(' · ')}
              </div>
              <div className="mt-0.5 font-mono text-[8px] uppercase tracking-wider text-white/30">
                From the app&apos;s solar model — the one that shades Live Clouds
              </div>
            </div>
          </div>
        </Section>

        {/* ── Next ISS pass ── */}
        <Section title="Next ISS pass">
          {passes.phase === 'loading' && <p className={NOTE}>Working out the next passes…</p>}
          {passes.phase === 'error' && (
            <p className={NOTE}>The ISS element set couldn&apos;t be reached — pass predictions are paused rather than guessed.</p>
          )}
          {passes.phase === 'ready' && !nextPass && (
            <p className={NOTE}>No ISS passes peaking above 10° in the next three days over this spot.</p>
          )}
          {passes.phase === 'ready' && nextPass && (
            <div className="mt-2 flex items-start gap-2">
              <Satellite className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#7DD3FC]" />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium leading-snug text-white">
                  Rises {fmtWhen(Date.parse(nextPass.riseAt), now)} · peaks {Math.round(nextPass.peakElevationDeg)}°
                </div>
                <div className="mt-0.5 font-mono text-[9px] uppercase leading-relaxed tracking-wider text-white/45">
                  Set {fmtWhen(Date.parse(nextPass.setAt), now)} ·{' '}
                  {nextPass.visible
                    ? <span className="text-emerald-300">Visible pass — station sunlit, sky dark</span>
                    : 'Passes overhead (not a visible pass)'}
                </div>
              </div>
            </div>
          )}
        </Section>

        {/* ── Cameras ── */}
        <Section title={`Cameras within ${DOSSIER_CAMERA_RADIUS_KM} km`} right={camResult.totalWithin ? `${camResult.totalWithin} IN RANGE` : undefined}>
          {cameras.length === 0 && (
            <p className={NOTE}>The camera catalogue hasn&apos;t landed yet — it loads with the CCTV layer.</p>
          )}
          {cameras.length > 0 && camResult.within.length === 0 && (
            <p className={NOTE}>
              No catalogue cameras within {DOSSIER_CAMERA_RADIUS_KM} km of this spot.
              {camResult.nearest && (
                <> The nearest there is — {camLabel(camResult.nearest.cam).name} — is {formatKm(camResult.nearest.distanceKm)} away.</>
              )}
            </p>
          )}
          <div className="mt-2 flex flex-col gap-1.5">
            {camResult.within.map(({ cam, distanceKm }) => {
              const { name, where } = camLabel(cam);
              return (
                <button key={String(cam.id)} onClick={() => onOpenCamera(cam)} className={ROW} title="Open this camera">
                  <Camera className="h-3.5 w-3.5 shrink-0 text-[var(--gold-primary)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[10.5px] font-bold tracking-wider text-white">{name}</span>
                    <span className="block font-mono text-[8.5px] uppercase tracking-wider text-white/40 tabular-nums">
                      {where ? `${where} · ` : ''}{formatKm(distanceKm)} away
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </Section>

        {/* ── Aircraft ── */}
        <Section title={`Aircraft within ${AIRCRAFT_RADIUS_KM} km`} right={aircraft.totalNear ? `${aircraft.totalNear} NEARBY` : undefined}>
          {!flightsLanded && (
            <p className={NOTE}>The flight feed hasn&apos;t landed yet — it loads with the aviation layers.</p>
          )}
          {flightsLanded && aircraft.near.length === 0 && (
            <p className={NOTE}>No tracked aircraft within {AIRCRAFT_RADIUS_KM} km of this spot right now.</p>
          )}
          <div className="mt-2 flex flex-col gap-1.5">
            {aircraft.near.map(f => (
              <button
                key={f.icao24}
                onClick={() => onFocusFlight?.(f.icao24)}
                className={ROW}
                title="Fly to this aircraft"
                disabled={!onFocusFlight}
              >
                <Plane className="h-3.5 w-3.5 shrink-0 text-[var(--gold-primary)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[10.5px] font-bold tracking-wider text-white">{f.callsign}</span>
                  <span className="block font-mono text-[8.5px] uppercase tracking-wider text-white/40 tabular-nums">
                    {f.altMeters !== null ? `ALT ${f.altMeters.toLocaleString()} m` : 'ALT —'} · {formatKm(f.distanceKm)} away
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Section>

        {/* ── Radio ── */}
        {onPlayRadio && (
          <Section title={`Local radio · within ${RADIO_MAX_KM} km`}>
            {radio.phase === 'loading' && <p className={NOTE}>Finding this place&apos;s radio…</p>}
            {radio.phase === 'error' && <p className={NOTE}>The radio directory didn&apos;t answer — try again in a moment.</p>}
            {radio.phase === 'none' && (
              <p className={NOTE}>No radio station with published coordinates within {RADIO_MAX_KM} km of this spot (Radio Browser&apos;s geo pool).</p>
            )}
            <div className="mt-2 flex flex-col gap-1.5">
              {radio.list.slice(0, 3).map(c => {
                const playing = currentRadioUuid === c.station.uuid;
                return (
                  <div key={c.station.uuid} className={ROW}>
                    <Radio className="h-3.5 w-3.5 shrink-0 text-[var(--gold-primary)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[10.5px] font-bold tracking-wider text-white">{c.station.name}</span>
                      <span className="block font-mono text-[8.5px] uppercase tracking-wider text-white/40 tabular-nums">
                        {formatKm(c.distanceKm)} away{c.station.country ? ` · ${c.station.country}` : ''} · via Radio Browser
                      </span>
                    </span>
                    <button
                      onClick={() => playCandidate(c)}
                      className="flex shrink-0 items-center gap-1 rounded-sm border border-white/15 px-2 py-1 font-mono text-[8.5px] uppercase tracking-wider text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                      title={playing ? 'Playing now — restart' : 'Play this station'}
                    >
                      {playing ? <Headphones className="h-3 w-3 text-emerald-300" /> : <Play className="h-3 w-3" />}
                      {playing ? 'Playing' : 'Play'}
                    </button>
                  </div>
                );
              })}
            </div>
            {skipped.length > 0 && (
              <p className={NOTE}>Skipped dead: {skipped.join(', ')} — moved to the next-nearest station.</p>
            )}
          </Section>
        )}

        {/* ── Weather ── */}
        <Section title={`Weather events within ${DOSSIER_WEATHER_RADIUS_KM} km`} right={wxResult?.total ? `${wxResult.total} ACTIVE` : undefined}>
          {!wxResult && <p className={NOTE}>The weather feed hasn&apos;t loaded yet — it arrives with the weather layers.</p>}
          {wxResult && wxResult.list.length === 0 && (
            <p className={NOTE}>No active weather events within {DOSSIER_WEATHER_RADIUS_KM} km in the loaded feed (NASA EONET · NOAA/NWS · GDACS).</p>
          )}
          <div className="mt-2 flex flex-col gap-1.5">
            {wxResult?.list.map(({ event, distanceKm }) => (
              <div key={String(event.id)} className="flex items-start gap-2 border border-white/10 bg-white/[0.03] px-2.5 py-2">
                <CloudLightning className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#FFB74D]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-medium leading-snug text-white">{String(event.title ?? 'Weather event')}</span>
                  <span className="mt-0.5 block font-mono text-[8.5px] uppercase tracking-wider text-white/40 tabular-nums">
                    {String(event.severity ?? '')} · {formatKm(distanceKm)} away · {String(event.provider ?? event.source ?? '')}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Earthquakes ── */}
        <Section title={`Earthquakes · ${DOSSIER_QUAKE_RADIUS_KM} km · last 24 h`} right={quakeResult?.total ? `${quakeResult.total} IN RANGE` : undefined}>
          {quakes.phase === 'loading' && <p className={NOTE}>Reading the USGS feed…</p>}
          {quakes.phase === 'error' && <p className={NOTE}>Earthquakes: feed unavailable this check — not scored, never guessed.</p>}
          {quakes.phase === 'ready' && quakeResult && quakeResult.list.length === 0 && (
            <p className={NOTE}>No earthquakes M2.5+ within {DOSSIER_QUAKE_RADIUS_KM} km in the last 24 hours.</p>
          )}
          <div className="mt-2 flex flex-col gap-1.5">
            {quakeResult?.list.map(({ quake, distanceKm }) => (
              <div key={quake.id} className="flex items-start gap-2 border border-white/10 bg-white/[0.03] px-2.5 py-2">
                <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#FF7043]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-medium leading-snug text-white">
                    M{(quake.magnitude ?? 0).toFixed(1)} — {quake.place}
                  </span>
                  <span className="mt-0.5 block font-mono text-[8.5px] uppercase tracking-wider text-white/40 tabular-nums">
                    {formatKm(distanceKm)} away · {ago(quake.time, now)}
                    {typeof quake.depth === 'number' && Number.isFinite(quake.depth) ? ` · depth ${Math.round(quake.depth)} km` : ''}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </Section>

        <div className="px-3 py-3 font-mono text-[9px] leading-relaxed text-white/30">
          Sources: the app&apos;s own feeds only — camera catalogue · flight feed (adsb.lol) · ISS pass times from the
          Look Up! route (CelesTrak elements, propagated server-side) · Radio Browser · NASA EONET / NOAA-NWS / GDACS
          weather events · USGS earthquakes · the app&apos;s solar model. Distances are great-circle, from this spot.
        </div>
      </div>
    </div>
  );
}
