'use client';

import { useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from 'react';
import {
  X, Plane, Gauge, ArrowUp, LocateFixed,
} from 'lucide-react';
import {
  contactsWithin,
  CONTACT_RADIUS_KM,
  type CockpitTarget,
  type ContactFlight,
} from '@/lib/cockpit';
import {
  cardinalFor,
  contactsPanelReducer,
  nearbyChipLabel,
  routeGeometryFromDetail,
  appendObservedPoint,
  pickRouteTrack,
  rideRouteText,
  EMPTY_ROUTE_GEOMETRY,
  type CockpitRouteGeometry,
} from '@/lib/cockpit-osd';
import {
  formatAlt,
  resolveEndpoints,
  type AircraftDetail,
  type ScheduledRoute,
} from './FlightWatchPanel';

/* ═══════════════════════════════════════════════════════════════
   OSIRIS — Cockpit OSD (the FPV rework)
   The first cockpit put a panel over the bottom of the frame and the
   pilot could hardly see over the top of it. This is the rework: no
   panel, ever. Everything the ride shows lives in the screen corners,
   the way a flight OSD sits in FPV goggles — small mono readouts on a
   faint dark pill (the same trick the feed badges use, so it reads in
   every theme and stays exempt from the sensor-look filters, which
   only touch the picture). The centre of the screen is the forward
   view, and nothing here is allowed to wander into it.
   ═══════════════════════════════════════════════════════════════ */

/** The live feed record for the ridden aircraft, as the page derives it. */
export interface CockpitFlightRecord {
  icao24: string;
  callsign: string;
  model?: string;
  lat: number;
  lng: number;
  alt: number;
  speed_knots: number | null;
  heading: number;
  grounded?: boolean;
  squawk?: string;
}

interface CockpitOSDProps {
  target: CockpitTarget;
  /** The target's latest feed record; null during a gap in coverage. */
  flight: CockpitFlightRecord | null;
  /** True when `flight` is the last record seen before a partial feed sweep
   *  (the page holds it rather than blanking the OSD — see flight-load). */
  flightHeld?: boolean;
  lock: 'follow' | 'free';
  /** The whole feed, for the nearby-flights roster. */
  flights: ContactFlight[];
  onHop: (target: CockpitTarget) => void;
  onRecenter: () => void;
  onExit: () => void;
  /** The drawable route (flown track + corroborated destination), for the
   *  map to draw under the ride. Reported on resolution, refreshed while
   *  riding, and cleared when the ride ends. */
  onRouteGeometry: (geometry: CockpitRouteGeometry) => void;
}

/* Corner placement: below the header/counter chrome at the top, above the
   bottom control bars, inset by the device safe areas on notched phones. */
const TOP_ROW = 'top-[max(7.25rem,calc(env(safe-area-inset-top)_+_6.75rem))] md:top-[max(8.25rem,calc(env(safe-area-inset-top)_+_7.5rem))]';
const BOTTOM_ROW = 'bottom-[max(6.25rem,calc(env(safe-area-inset-bottom)_+_5.5rem))] md:bottom-[max(7.75rem,calc(env(safe-area-inset-bottom)_+_7rem))]';

const PILL: CSSProperties = {
  background: 'rgba(5,8,14,0.45)',
  backdropFilter: 'blur(3px)',
  borderRadius: 6,
  padding: '4px 8px',
  color: '#E8E6E0',
};
const LABEL: CSSProperties = {
  color: 'rgba(232,230,224,0.55)', fontSize: 8, letterSpacing: '0.14em',
};
const VALUE: CSSProperties = { fontSize: 13, lineHeight: 1.15 };

/** How often the airframe/track lookup re-runs during a ride, so the
 *  drawn track keeps growing behind the aircraft on a long leg. */
const ROUTE_REFRESH_MS = 90_000;

export default function CockpitOSD({
  target, flight, flightHeld = false, lock, flights, onHop, onRecenter, onExit, onRouteGeometry,
}: CockpitOSDProps) {
  /* The resolved detail plus the aircraft it belongs to — a hop swaps the
     target, and a slow lookup for the old plane must not land on the new
     one. */
  const [resolved, setResolved] = useState<{ icao24: string; detail: AircraftDetail | null } | null>(null);
  const [resolveNonce, setResolveNonce] = useState(0);
  const [contactsOpen, dispatchContacts] = useReducer(contactsPanelReducer, false);
  const detail = resolved && resolved.icao24 === target.icao24 ? resolved.detail : null;

  /* The aircraft's live position, for corroborating its schedule when the
     trace lookup cannot (see resolveEndpoints' hereOverride). */
  const hereRef = useRef<[number, number] | null>(null);
  useEffect(() => {
    if (flight) hereRef.current = [flight.lng, flight.lat];
  }, [flight]);

  /* The ride's own observed trail — the positions the feed has reported
     for this aircraft since the ride began. It is the drawn track when
     the trace lookup yields nothing (see appendObservedPoint). Kept with
     React's previous-props pattern — adjusted during render, not in an
     effect — because the trail is a pure function of the props seen so
     far: a new target starts it over, each new feed record extends it. */
  const [trail, setTrail] = useState<{
    icao24: string; seen: CockpitFlightRecord | null; points: [number, number][];
  }>({ icao24: target.icao24, seen: null, points: [] });
  if (trail.icao24 !== target.icao24 || (flight !== null && trail.seen !== flight)) {
    const basePoints = trail.icao24 === target.icao24 ? trail.points : [];
    setTrail({
      icao24: target.icao24,
      seen: flight,
      points: flight ? appendObservedPoint(basePoints, [flight.lng, flight.lat]) : basePoints,
    });
  }
  const observed = trail.icao24 === target.icao24 ? trail.points : EMPTY_ROUTE_GEOMETRY.track;

  /* Airframe + route, the same two lookups the watch panel makes: the trace
     files know what the aircraft is and where it was seen to leave, the
     route lookup knows the schedule — and the schedule is only believed
     when it agrees with what was observed (resolveEndpoints). When the
     trace side knows nothing at all, the endpoints are still resolved
     against an empty shell with the live position standing in for the
     track: a corroborated destination is real information about where
     this flight is going, and dropping it with the failed lookup left
     the OSD showing no route for flights whose route was known. */
  useEffect(() => {
    let cancelled = false;
    const cs = (target.callsign || '').replace(/\s+/g, '');
    Promise.all([
      fetch(`/api/aircraft?icao24=${target.icao24}`)
        .then((r) => (r.ok ? r.json() : null)).catch(() => null),
      cs
        ? fetch(`/api/flight-route?callsign=${encodeURIComponent(cs)}&icao24=${target.icao24}`)
            .then((r) => (r.ok ? r.json() : null)).catch(() => null)
        : Promise.resolve(null),
    ]).then(([ac, route]) => {
      if (cancelled) return;
      const base = ac && !ac.error ? (ac as AircraftDetail) : null;
      const shell: AircraftDetail = base ?? {
        icao24: target.icao24, registration: null, typeCode: null, model: null,
        operator: null, track: [], points: 0, departure: null, arrival: null,
      };
      setResolved({
        icao24: target.icao24,
        detail: { ...shell, ...resolveEndpoints(shell, route as ScheduledRoute | null, hereRef.current) },
      });
    });
    return () => { cancelled = true; };
  }, [target.icao24, target.callsign, resolveNonce]);

  /* Keep the drawn track growing on a long ride. */
  useEffect(() => {
    const t = setInterval(() => setResolveNonce((n) => n + 1), ROUTE_REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  /* Report the drawable route to the page (which hands it to the map).
     The geometry empties the moment the target changes — the line under
     the nose is always this aircraft's, never the previous one's. The
     drawn track is the trace's when it resolved, the ride's own observed
     trail when it didn't. */
  const geometry = useMemo(() => {
    const g = routeGeometryFromDetail(detail);
    const track = pickRouteTrack(g.track, observed);
    return track === g.track ? g : { ...g, track };
  }, [detail, observed]);
  const geometryRef = useRef(onRouteGeometry);
  useEffect(() => { geometryRef.current = onRouteGeometry; }, [onRouteGeometry]);
  useEffect(() => {
    geometryRef.current(geometry);
  }, [geometry]);
  useEffect(() => () => { geometryRef.current(EMPTY_ROUTE_GEOMETRY); }, []);

  /* A new target shuts the roster, whatever state it was left in. */
  useEffect(() => { dispatchContacts('TARGET'); }, [target.icao24]);

  const contacts = useMemo(() => {
    if (!flight) return [];
    return contactsWithin(
      { lat: flight.lat, lng: flight.lng },
      flights,
      CONTACT_RADIUS_KM,
      target.icao24,
    );
  }, [flight, flights, target.icao24]);

  const callsign = (flight?.callsign || target.callsign || target.icao24.toUpperCase()).trim();
  const headingDeg = flight ? Math.round(((flight.heading || 0) % 360 + 360) % 360) : null;
  const routeText = rideRouteText(detail);

  const hop = (c: ContactFlight) => {
    dispatchContacts('HOP');
    onHop({ icao24: c.icao24, callsign: (c.callsign || c.icao24.toUpperCase()).trim() });
  };

  return (
    <div className="absolute inset-0 pointer-events-none select-none" aria-label="Cockpit on-screen display">
      {/* ── TOP-LEFT — who you're riding, and where it's going ── */}
      <div className={`absolute left-4 md:left-[104px] ${TOP_ROW} flex flex-col items-start gap-1`}>
        <div style={PILL}>
          <span className="text-[13px] font-bold tracking-wide">{callsign}</span>
          <span className="ml-2 text-[9px] tabular-nums" style={{ color: 'rgba(232,230,224,0.55)' }}>
            {target.icao24.toUpperCase()}
          </span>
          {routeText && (
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] tabular-nums">
              <span>{routeText.originLabel}</span>
              <span style={{ color: 'rgba(232,230,224,0.55)' }}>&rarr;</span>
              <span>{routeText.destinationLabel}</span>
              {/* Same honesty rule as the watch panel: an unconfirmed
                  destination is a schedule claim, not an observation. */}
              <span className="text-[8px]" style={{ color: 'rgba(232,230,224,0.55)' }}>
                {routeText.state === 'landed' ? 'landed' : routeText.state === 'scheduled' ? 'scheduled' : 'destination unknown'}
              </span>
            </div>
          )}
        </div>
        {!flight && (
          <div style={{ ...PILL, color: 'var(--alert-orange)', fontSize: 10 }}>
            Waiting for the next position report…
          </div>
        )}
        {flight && flightHeld && (
          <div style={{ ...PILL, color: 'var(--alert-orange)', fontSize: 9, letterSpacing: '0.08em' }}>
            FEED GAP — SHOWING LAST REPORT
          </div>
        )}
      </div>

      {/* ── TOP-CENTRE — heading, and the paused warning under it ── */}
      <div className={`absolute left-1/2 -translate-x-1/2 ${TOP_ROW} flex flex-col items-center gap-1`}>
        <div style={PILL} className="tabular-nums whitespace-nowrap">
          <span style={LABEL}>HDG&nbsp;</span>
          <span style={VALUE}>{headingDeg === null ? '—' : `${headingDeg}° ${cardinalFor(headingDeg)}`}</span>
        </div>
        {lock === 'free' && (
          <div
            style={{ ...PILL, color: 'var(--alert-orange)', fontSize: 9, letterSpacing: '0.14em' }}
            role="status"
          >
            FOLLOW PAUSED — YOU&apos;VE GOT THE MAP
          </div>
        )}
      </div>

      {/* ── TOP-RIGHT — the way out, and the way back in ── */}
      <div className={`absolute right-4 md:right-6 ${TOP_ROW} flex flex-col items-end gap-1.5`}>
        <button
          onClick={onExit}
          title="Leave the cockpit — back to the view you had"
          aria-label="Leave the cockpit"
          className="pointer-events-auto flex items-center gap-1 transition-colors hover:text-[#FF8A80]"
          style={{ ...PILL, border: '1px solid rgba(255,255,255,0.18)', fontSize: 10, letterSpacing: '0.12em' }}
        >
          <X className="w-3.5 h-3.5" /> LEAVE
        </button>
        {lock === 'free' && (
          <button
            onClick={onRecenter}
            title="Re-centre on the aircraft"
            className="pointer-events-auto flex items-center gap-1 transition-colors"
            style={{ ...PILL, border: '1px solid rgba(0,229,255,0.45)', color: '#7FE9FF', fontSize: 10, letterSpacing: '0.12em' }}
          >
            <LocateFixed className="w-3.5 h-3.5" /> RE-CENTRE
          </button>
        )}
      </div>

      {/* ── BOTTOM-LEFT — altitude ── */}
      <div className={`absolute left-4 md:left-[104px] ${BOTTOM_ROW}`} style={PILL}>
        <div style={LABEL}>ALT</div>
        <div style={VALUE} className="tabular-nums">
          {flight ? formatAlt(flight.alt, flight.grounded) : '—'}
        </div>
      </div>

      {/* ── BOTTOM-RIGHT — ground speed ── */}
      <div className={`absolute right-4 md:right-6 ${BOTTOM_ROW} text-right`} style={PILL}>
        <div style={LABEL}>GND SPEED</div>
        <div style={VALUE} className="tabular-nums">
          {flight && typeof flight.speed_knots === 'number' ? `${Math.round(flight.speed_knots)} kt` : '—'}
        </div>
      </div>

      {/* ── RIGHT EDGE — nearby flights, a chip until asked ── */}
      {flight && contacts.length > 0 && (
        <div className="absolute right-0 top-1/2 -translate-y-1/2 flex flex-col items-end gap-1.5">
          <button
            onClick={() => dispatchContacts('TOGGLE')}
            aria-expanded={contactsOpen}
            title={contactsOpen ? 'Close nearby flights' : 'Nearby flights — tap to hop'}
            className="pointer-events-auto flex items-center gap-1.5 transition-colors"
            style={{
              ...PILL,
              borderRadius: '6px 0 0 6px',
              border: '1px solid rgba(255,255,255,0.14)',
              borderRight: 'none',
              fontSize: 9,
              letterSpacing: '0.14em',
            }}
          >
            <Gauge className="w-3 h-3" style={{ color: 'rgba(232,230,224,0.55)' }} />
            {nearbyChipLabel(contacts.length)}
          </button>
          {contactsOpen && (
            <div
              className="pointer-events-auto w-[212px] max-h-[44vh] overflow-y-auto styled-scrollbar py-1"
              style={{ background: 'rgba(5,8,14,0.78)', backdropFilter: 'blur(6px)', borderRadius: '6px 0 0 6px' }}
            >
              <div className="px-2 pb-1" style={{ ...LABEL, fontSize: 8 }}>
                WITHIN {CONTACT_RADIUS_KM} KM — TAP TO HOP
              </div>
              {contacts.map(({ flight: c, distanceKm, bearingDeg }) => (
                <button
                  key={c.icao24}
                  onClick={() => hop(c)}
                  title={`Hop to ${c.callsign || c.icao24.toUpperCase()}`}
                  className="flex items-center gap-2 w-full px-2 py-1 text-left transition-colors hover:bg-white/10"
                  style={{ color: '#E8E6E0' }}
                >
                  <span className="text-[10px] tabular-nums truncate min-w-[58px]">
                    {(c.callsign || c.icao24.toUpperCase()).trim()}
                  </span>
                  {c.model && (
                    <span className="text-[9px] truncate" style={{ color: 'rgba(232,230,224,0.5)' }}>{c.model}</span>
                  )}
                  <span className="ml-auto flex items-center gap-1 flex-shrink-0">
                    <ArrowUp
                      className="w-2.5 h-2.5"
                      style={{ transform: `rotate(${Math.round(bearingDeg)}deg)`, color: 'rgba(232,230,224,0.55)' }}
                    />
                    <span className="text-[10px] tabular-nums">
                      {distanceKm < 10 ? distanceKm.toFixed(1) : Math.round(distanceKm)} km
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The plain message shown when a ride ends itself — the flight landed or
 *  left the feed. The visitor is already on their way back to their old
 *  view. During a ride nothing sits in the centre of the screen; this
 *  flashes there only once the ride is over, the way an FPV warning does. */
export function CockpitEndedNotice({ notice, onDismiss }: { notice: string; onDismiss: () => void }) {
  return (
    <div className="glass-panel overflow-hidden" style={{ boxShadow: '0 12px 32px rgba(0,0,0,0.6)' }}>
      <div className="flex items-start gap-2 px-3 py-2.5">
        <Plane className="w-3.5 h-3.5 mt-0.5 text-[var(--alert-orange)] flex-shrink-0" />
        <div className="min-w-0">
          <div className="text-[11px] text-[var(--text-primary)] leading-snug">{notice}</div>
          <div className="text-[9px] text-[var(--text-muted)] mt-0.5">
            Taking you back to the view you had before the ride.
          </div>
        </div>
        <button
          onClick={onDismiss}
          title="Dismiss"
          aria-label="Dismiss"
          className="p-0.5 ml-auto text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors flex-shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
