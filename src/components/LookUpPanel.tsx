'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Crosshair, MapPin, Navigation, Plane, Satellite, Telescope, X } from 'lucide-react';
import {
  overheadAircraft, overheadSatellites,
  type FlightRowLike, type IssPass, type Observer, type SatelliteRowLike,
} from '@/lib/look-up';
import { compassPoint } from '@/lib/geo';
import { parseGeoResponse, type GeoLocation } from '@/lib/opening-view';
import { flightsSweepLanded } from '@/lib/share-target';

/**
 * Glass Earth — LOOK UP!
 *
 * What is above you, right now: the next ISS passes, the satellites
 * currently over your horizon, and the aircraft within 100 km. Every
 * number comes from a feed the app already runs — ISS passes propagated
 * from the catalogue's own TLE with lib/orbit (the SGP4 the map's
 * positions and orbit tracks use), computed by the passes route because
 * the propagator cannot ride in the browser bundle (lib/look-up-passes),
 * satellites from the satellite feed's
 * rows (the same rows the map draws, so the two cannot disagree), and
 * aircraft from the flight feed's buckets.
 *
 * The anchor is always named. It is the visitor's located position when
 * the app has one — a live GPS fix during navigation, else the same
 * IP city-level location the opening view used — and otherwise the map
 * centre, snapshotted when asked for. A pass is labelled VISIBLE only
 * when the geometry supports it (lib/look-up: station sunlit, sun at
 * least 6° below the horizon); anything else is a pass overhead, in
 * daylight or eclipse, and the panel says no more than that.
 */

const ISS_NORAD = '25544';
const AIRCRAFT_RADIUS_KM = 100;

interface LookUpData {
  satellites?: SatelliteRowLike[];
  satellites_at?: string;
  commercial_flights?: FlightRowLike[];
  private_flights?: FlightRowLike[];
  private_jets?: FlightRowLike[];
  military_flights?: FlightRowLike[];
}

interface LookUpPanelProps {
  data: LookUpData;
  /** The app's IP-located position (opening view), when it has one. */
  visitorGeo: GeoLocation | null;
  /** A live GPS fix, when one is running (navigation). */
  liveLocation: { lat: number; lng: number } | null;
  /** The map's current centre, for the centre anchor. */
  mapCenter: { lat: number; lng: number } | null;
  onClose: () => void;
  onFocusFlight: (icao24: string) => void;
  onFocusSatellite: (noradId: string) => void;
  /** Ask the page to refetch the satellite + flight feeds. */
  onRefreshFeeds: () => void;
}

/* The passes route's last answer for one anchor. Pass times are shown
   to the minute, so a five-minute-old copy is fresh enough, and
   reopening the panel — or flipping between anchors — stays instant. */
let issPassesCache: { key: string; passes: IssPass[]; at: number } | null = null;
const PASSES_CACHE_MS = 5 * 60_000;

function fmtClock(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtDay(d: Date, now: Date): string {
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(d) - startOf(now)) / 86_400_000);
  if (days === 0) return 'TODAY';
  if (days === 1) return 'TOMORROW';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();
}

function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}H ${mm}M ${ss}S` : `${mm}M ${ss}S`;
}

function fmtUtcClock(iso: string | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' });
}

export default function LookUpPanel({
  data, visitorGeo, liveLocation, mapCenter,
  onClose, onFocusFlight, onFocusSatellite, onRefreshFeeds,
}: LookUpPanelProps) {
  const [now, setNow] = useState(() => new Date());
  const [fetchedGeo, setFetchedGeo] = useState<GeoLocation | null>(null);
  const [centreAnchor, setCentreAnchor] = useState<Observer | null>(null);
  const [preferCentre, setPreferCentre] = useState(false);
  const [passesState, setPassesState] = useState<'ready' | 'loading' | 'error'>('loading');
  const [passes, setPasses] = useState<IssPass[]>([]);
  const refreshedRef = useRef(false);

  /* One-second clock for the countdowns. */
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  /* Fresh feed state on open, then on a slow tick while the panel lives:
     the overhead lists are only as honest as the rows behind them. */
  useEffect(() => {
    if (!refreshedRef.current) {
      refreshedRef.current = true;
      onRefreshFeeds();
    }
    const iv = setInterval(onRefreshFeeds, 60_000);
    return () => clearInterval(iv);
  }, [onRefreshFeeds]);

  /* If the app never located the visitor (a remembered view skips the
     opening lookup), ask the app's own geo endpoint — the same one the
     opening view uses — so the location anchor can exist at all. */
  useEffect(() => {
    if (liveLocation || visitorGeo || fetchedGeo) return;
    let cancelled = false;
    fetch('/api/geo', { signal: AbortSignal.timeout(8000) })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setFetchedGeo(parseGeoResponse(d)); })
      .catch(() => { /* no location: the centre anchor carries the panel */ });
    return () => { cancelled = true; };
  }, [liveLocation, visitorGeo, fetchedGeo]);

  const location: (Observer & { source: 'gps' | 'ip'; city?: string; country?: string }) | null =
    liveLocation
      ? { lat: liveLocation.lat, lng: liveLocation.lng, source: 'gps' }
      : (visitorGeo ?? fetchedGeo)
        ? { lat: (visitorGeo ?? fetchedGeo)!.lat, lng: (visitorGeo ?? fetchedGeo)!.lng, source: 'ip', city: (visitorGeo ?? fetchedGeo)!.city, country: (visitorGeo ?? fetchedGeo)!.country }
        : null;

  const useCentre = preferCentre || !location;
  const anchor: Observer | null = useCentre
    ? (centreAnchor ?? (mapCenter ? { lat: mapCenter.lat, lng: mapCenter.lng } : null))
    : location;

  const anchorKey = anchor ? `${anchor.lat.toFixed(3)},${anchor.lng.toFixed(3)}` : '';
  const passesRef = useRef<IssPass[]>([]);
  useEffect(() => { passesRef.current = passes; }, [passes]);

  /* Passes: fetched when the anchor changes, and again once the last
     listed pass has set — never on the one-second tick. The route runs
     the identical finder over the identical element set this panel used
     to propagate locally; only the arithmetic's address changed. */
  useEffect(() => {
    if (!anchor) return;
    let cancelled = false;
    const load = () => {
      if (cancelled || !anchor) return;
      const cached = issPassesCache;
      if (cached && cached.key === anchorKey && Date.now() - cached.at < PASSES_CACHE_MS) {
        setPasses(cached.passes);
        setPassesState('ready');
        return;
      }
      fetch(`/api/satellites/passes?id=${ISS_NORAD}&lat=${anchor.lat}&lng=${anchor.lng}`)
        .then(r => (r.ok ? r.json() : null))
        .then(d => {
          if (cancelled) return;
          if (Array.isArray(d?.passes)) {
            const parsed: IssPass[] = d.passes.map((p: {
              riseAt: string; peakAt: string; setAt: string;
              peakElevationDeg: number; peakAzimuthDeg: number; visible: boolean;
            }) => ({
              riseAt: new Date(p.riseAt),
              peakAt: new Date(p.peakAt),
              setAt: new Date(p.setAt),
              peakElevationDeg: p.peakElevationDeg,
              peakAzimuthDeg: p.peakAzimuthDeg,
              visible: !!p.visible,
            }));
            issPassesCache = { key: anchorKey, passes: parsed, at: Date.now() };
            setPasses(parsed);
            setPassesState('ready');
          } else {
            setPassesState('error');
          }
        })
        .catch(() => { if (!cancelled) setPassesState('error'); });
    };
    load();
    const iv = setInterval(() => {
      const last = passesRef.current[passesRef.current.length - 1];
      if (!last || last.setAt.getTime() < Date.now()) load();
    }, 60_000);
    return () => { cancelled = true; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey]);

  const sats = useMemo(
    () => (anchor ? overheadSatellites(data.satellites ?? [], anchor, 12) : { above: [], totalAbove: 0 }),
    [data.satellites, anchor],
  );

  const aircraft = useMemo(() => {
    if (!anchor) return { near: [], totalNear: 0 };
    const rows: FlightRowLike[] = [
      ...(data.commercial_flights ?? []),
      ...(data.private_flights ?? []),
      ...(data.private_jets ?? []),
      ...(data.military_flights ?? []),
    ];
    return overheadAircraft(rows, anchor, AIRCRAFT_RADIUS_KM, 10);
  }, [data, anchor]);

  const satsEpoch = fmtUtcClock(data.satellites_at);
  const nextPass = passes[0] ?? null;
  const nextInProgress = nextPass !== null && now >= nextPass.riseAt && now <= nextPass.setAt;

  if (typeof document === 'undefined') return null;

  const sectionTitle = 'font-mono text-[9px] font-bold uppercase tracking-[0.25em] text-white/45';
  const rowBtn = 'flex w-full items-center gap-2 border border-white/10 bg-white/[0.03] px-2.5 py-2 text-left transition-colors hover:bg-white/10';

  return createPortal(
    <div className="fixed bottom-0 right-0 top-0 z-[940] flex w-[min(430px,100vw)] flex-col border-l border-white/10 bg-[#0a0a0a]/[0.98] shadow-2xl" data-testid="look-up-panel">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
        <Telescope className="h-4 w-4 text-[var(--gold-primary)]" />
        <span className="font-mono text-[12px] font-bold tracking-[0.25em] text-white">LOOK UP!</span>
        <span className="hidden font-mono text-[8px] uppercase tracking-wider text-white/35 md:block">What&apos;s overhead, right now</span>
        <button onClick={onClose} className="ml-auto rounded-sm border border-white/15 p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white" title="Close Look Up">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="styled-scrollbar flex-1 overflow-y-auto p-3">
        {/* Anchor — always named, always one tap to move. */}
        <div className="mb-4 border border-white/10 bg-white/[0.03] px-2.5 py-2">
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-[var(--gold-primary)]" />
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-white">
              {useCentre ? 'Overhead at map centre' : 'Overhead at your location'}
            </span>
          </div>
          <div className="mt-1 font-mono text-[8.5px] uppercase tracking-wider text-white/40">
            {anchor
              ? useCentre
                ? `Map centre · ${anchor.lat.toFixed(2)}°, ${anchor.lng.toFixed(2)}°`
                : location?.source === 'gps'
                  ? `GPS fix · ${anchor.lat.toFixed(2)}°, ${anchor.lng.toFixed(2)}°`
                  : `IP location${location?.city ? ` · ${location.city}` : ''}${location?.country ? `, ${location.country}` : ''} · ${anchor.lat.toFixed(2)}°, ${anchor.lng.toFixed(2)}°`
              : 'Locating…'}
          </div>
          <div className="mt-2 flex gap-1.5">
            <button
              onClick={() => setPreferCentre(false)}
              disabled={!location}
              className={`px-2 py-1 rounded-sm border font-mono text-[8.5px] tracking-[0.12em] uppercase transition-colors ${!useCentre ? 'border-[var(--gold-primary)]/60 bg-[var(--gold-primary)]/15 text-[var(--gold-primary)]' : 'border-white/15 text-white/60 hover:bg-white/10 hover:text-white'} disabled:opacity-40 disabled:hover:bg-transparent`}
              title={location ? 'Anchor at your located position' : 'The app has no location for you yet'}
            >
              Your location
            </button>
            <button
              onClick={() => {
                if (mapCenter) setCentreAnchor({ lat: mapCenter.lat, lng: mapCenter.lng });
                setPreferCentre(true);
              }}
              className={`px-2 py-1 rounded-sm border font-mono text-[8.5px] tracking-[0.12em] uppercase transition-colors ${useCentre ? 'border-[var(--gold-primary)]/60 bg-[var(--gold-primary)]/15 text-[var(--gold-primary)]' : 'border-white/15 text-white/60 hover:bg-white/10 hover:text-white'}`}
              title="Anchor at the map's current centre"
            >
              Map centre
            </button>
            {useCentre && (
              <button
                onClick={() => { if (mapCenter) setCentreAnchor({ lat: mapCenter.lat, lng: mapCenter.lng }); }}
                className="px-2 py-1 rounded-sm border border-white/15 font-mono text-[8.5px] tracking-[0.12em] uppercase text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                title="Re-anchor at wherever the map is centred now"
              >
                <span className="flex items-center gap-1"><Crosshair className="h-3 w-3" /> Re-anchor</span>
              </button>
            )}
          </div>
        </div>

        {!anchor && (
          <p className="font-mono text-[9px] uppercase leading-relaxed tracking-wider text-white/40">
            No anchor yet — the map hasn&apos;t reported a centre and no location is available.
          </p>
        )}

        {anchor && (
          <>
            {/* ── ISS passes ── */}
            <div className="mb-4">
              <div className={sectionTitle}>Next ISS passes · times local</div>
              {passesState === 'error' && (
                <p className="mt-2 font-mono text-[9px] uppercase leading-relaxed tracking-wider text-white/40">
                  The ISS element set couldn&apos;t be reached — pass predictions are paused rather than guessed.
                </p>
              )}
              {passesState !== 'error' && passes.length === 0 && (
                <p className="mt-2 font-mono text-[9px] uppercase leading-relaxed tracking-wider text-white/40">
                  {passesState === 'loading' ? 'Working out the next passes…' : 'No ISS passes peaking above 10° in the next three days over this anchor.'}
                </p>
              )}
              {nextPass && (
                <div className="mt-2 border border-[var(--gold-primary)]/40 bg-[var(--gold-primary)]/[0.07] px-2.5 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/50">{fmtDay(nextPass.riseAt, now)}</span>
                    {nextPass.visible
                      ? <span className="font-mono text-[8.5px] font-bold uppercase tracking-[0.15em] text-emerald-300">Visible</span>
                      : <span className="font-mono text-[8.5px] uppercase tracking-[0.15em] text-white/40">Passes overhead</span>}
                  </div>
                  <div className="mt-1 font-mono text-[17px] font-bold tabular-nums text-white" data-testid="iss-countdown">
                    {nextInProgress
                      ? <>OVERHEAD NOW</>
                      : <>RISES IN {fmtCountdown(nextPass.riseAt.getTime() - now.getTime())}</>}
                  </div>
                  <div className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-white/55 tabular-nums">
                    Rise {fmtClock(nextPass.riseAt)} · Peak {Math.round(nextPass.peakElevationDeg)}° at {fmtClock(nextPass.peakAt)} · Set {fmtClock(nextPass.setAt)}
                  </div>
                </div>
              )}
              {passes.slice(1).map(p => (
                <div key={p.riseAt.getTime()} className="mt-1.5 flex items-center gap-2 border border-white/10 bg-white/[0.03] px-2.5 py-1.5">
                  <span className="font-mono text-[8.5px] uppercase tracking-[0.15em] text-white/45">{fmtDay(p.riseAt, now)}</span>
                  <span className="font-mono text-[10px] tabular-nums text-white/85">
                    {fmtClock(p.riseAt)} – {fmtClock(p.setAt)} · peak {Math.round(p.peakElevationDeg)}°
                  </span>
                  {p.visible
                    ? <span className="ml-auto font-mono text-[8.5px] font-bold uppercase tracking-[0.15em] text-emerald-300">Visible</span>
                    : <span className="ml-auto font-mono text-[8.5px] uppercase tracking-[0.15em] text-white/35">Overhead</span>}
                </div>
              ))}
              <p className="mt-1.5 font-mono text-[8px] uppercase leading-relaxed tracking-wider text-white/30">
                A pass is marked VISIBLE only when the station is sunlit and your sky is dark. Times to the minute, from the ISS&apos;s own orbital elements.
              </p>
            </div>

            {/* ── Satellites overhead now ── */}
            <div className="mb-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className={sectionTitle}>Satellites overhead now</span>
                <span className="font-mono text-[8.5px] tabular-nums text-white/40">{sats.totalAbove} ABOVE HORIZON</span>
              </div>
              {satsEpoch && (
                <div className="mt-0.5 font-mono text-[8px] uppercase tracking-wider text-white/30">
                  Feed positions as of {satsEpoch} UTC — the same rows the map draws
                </div>
              )}
              {!data.satellites && (
                <p className="mt-2 font-mono text-[9px] uppercase leading-relaxed tracking-wider text-white/40">
                  The satellite catalogue hasn&apos;t landed yet — it loads with the satellite layers.
                </p>
              )}
              {data.satellites && sats.above.length === 0 && (
                <p className="mt-2 font-mono text-[9px] uppercase leading-relaxed tracking-wider text-white/40">
                  Nothing in the tracked catalogue is above this horizon right now.
                </p>
              )}
              <div className="mt-2 flex flex-col gap-1.5">
                {sats.above.map(({ row, elevationDeg, azimuthDeg, rangeKm }) => (
                  <button
                    key={row.noradId ?? row.name}
                    onClick={() => { if (row.noradId) { onFocusSatellite(row.noradId); onClose(); } }}
                    className={rowBtn}
                    title="Fly to this satellite and open its readout"
                  >
                    <Satellite className="h-3.5 w-3.5 shrink-0" style={{ color: row.color ?? '#00E5FF' }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[10.5px] font-bold tracking-wider text-white">{row.name}</span>
                      <span className="block font-mono text-[8.5px] uppercase tracking-wider text-white/40 tabular-nums">
                        EL {Math.round(elevationDeg)}° · AZ {Math.round(azimuthDeg)}° {compassPoint(azimuthDeg)} · {Math.round(rangeKm).toLocaleString()} km away
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* ── Aircraft overhead now ── */}
            <div className="mb-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className={sectionTitle}>Aircraft within {AIRCRAFT_RADIUS_KM} km</span>
                <span className="font-mono text-[8.5px] tabular-nums text-white/40">{aircraft.totalNear} NEARBY</span>
              </div>
              {!flightsSweepLanded(data as Record<string, unknown>) && (
                <p className="mt-2 font-mono text-[9px] uppercase leading-relaxed tracking-wider text-white/40">
                  The flight feed hasn&apos;t landed yet — it loads with the aviation layers.
                </p>
              )}
              {flightsSweepLanded(data as Record<string, unknown>) && aircraft.near.length === 0 && (
                <p className="mt-2 font-mono text-[9px] uppercase leading-relaxed tracking-wider text-white/40">
                  No tracked aircraft within {AIRCRAFT_RADIUS_KM} km of this anchor right now.
                </p>
              )}
              <div className="mt-2 flex flex-col gap-1.5">
                {aircraft.near.map(f => (
                  <button
                    key={f.icao24}
                    onClick={() => { onFocusFlight(f.icao24); onClose(); }}
                    className={rowBtn}
                    title="Fly to this aircraft and open its popup"
                  >
                    <Plane className="h-3.5 w-3.5 shrink-0 text-[var(--gold-primary)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[10.5px] font-bold tracking-wider text-white">{f.callsign}</span>
                      <span className="block font-mono text-[8.5px] uppercase tracking-wider text-white/40 tabular-nums">
                        {f.altMeters !== null ? `ALT ${f.altMeters.toLocaleString()} m` : 'ALT —'} · {f.distanceKm < 10 ? f.distanceKm.toFixed(1) : Math.round(f.distanceKm)} km away
                      </span>
                    </span>
                    <Navigation className="h-3 w-3 shrink-0 text-white/30" />
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
