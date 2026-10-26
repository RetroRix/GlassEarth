'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  X, Plane, Gauge, ArrowUp, LocateFixed, ChevronDown, ChevronUp, Loader2,
} from 'lucide-react';
import {
  contactsWithin,
  CONTACT_RADIUS_KM,
  type CockpitTarget,
  type ContactFlight,
} from '@/lib/cockpit';
import {
  formatAlt,
  resolveEndpoints,
  type AircraftDetail,
  type ScheduledRoute,
} from './FlightWatchPanel';

/* ═══════════════════════════════════════════════════════════════
   OSIRIS — Cockpit
   Ride along with a flight: the strip of what the feed knows about
   the aircraft you're sitting in, and the nearby flights you can
   hop to. Every number here comes from the live feed or the
   airframe/route lookups — a field the feed doesn't carry is left
   out rather than filled in.
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

interface CockpitPanelProps {
  target: CockpitTarget;
  /** The target's latest feed record; null during a gap in coverage. */
  flight: CockpitFlightRecord | null;
  lock: 'follow' | 'free';
  /** The whole feed, for the nearby-flights roster. */
  flights: ContactFlight[];
  onHop: (target: CockpitTarget) => void;
  onRecenter: () => void;
  onExit: () => void;
}

function TelemetryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[8px] tracking-[0.14em] text-[var(--text-muted)]">{label}</div>
      <div className="text-[12px] text-[var(--text-primary)] tabular-nums truncate">{value}</div>
    </div>
  );
}

export default function CockpitPanel({
  target, flight, lock, flights, onHop, onRecenter, onExit,
}: CockpitPanelProps) {
  /* The resolved detail plus the aircraft it belongs to — a hop swaps the
     target, and a slow lookup for the old plane must not land on the new
     one. "Identifying" is derived (no resolution for THIS target yet), so
     the effect never has to reset state synchronously. */
  const [resolved, setResolved] = useState<{ icao24: string; detail: AircraftDetail | null } | null>(null);
  const [showContacts, setShowContacts] = useState(true);
  const detail = resolved && resolved.icao24 === target.icao24 ? resolved.detail : null;
  const identifying = !resolved || resolved.icao24 !== target.icao24;

  /* Airframe + route, the same two lookups the watch panel makes: the trace
     files know what the aircraft is and where it was seen to leave, the
     route lookup knows the schedule — and the schedule is only believed
     when it agrees with what was observed (resolveEndpoints). */
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
      setResolved({
        icao24: target.icao24,
        detail: base ? { ...base, ...resolveEndpoints(base, route as ScheduledRoute | null) } : null,
      });
    });
    return () => { cancelled = true; };
  }, [target.icao24, target.callsign]);

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

  return (
    <div className="glass-panel overflow-hidden" style={{ boxShadow: '0 12px 32px rgba(0,0,0,0.6)' }}>
      <header className="flex items-center gap-2 px-3 h-9 border-b border-[var(--border-secondary)]">
        <Plane className="w-3.5 h-3.5 text-[var(--cyan-primary)] flex-shrink-0" />
        <span className="text-[11px] font-bold text-[var(--text-primary)] tracking-wide truncate">
          {callsign}
        </span>
        <span className="text-[9px] text-[var(--text-muted)] tabular-nums flex-shrink-0">
          {target.icao24.toUpperCase()}
        </span>
        <span
          className="ml-auto text-[8px] tracking-[0.14em] px-1.5 py-0.5 rounded border flex-shrink-0"
          style={lock === 'follow'
            ? { color: 'var(--cyan-primary)', borderColor: 'var(--border-secondary)' }
            : { color: 'var(--alert-orange)', borderColor: 'var(--border-secondary)' }}
        >
          {lock === 'follow' ? 'RIDING ALONG' : 'FOLLOW PAUSED'}
        </span>
        <button
          onClick={onExit}
          title="Leave the cockpit — back to the view you had"
          aria-label="Leave the cockpit"
          className="flex items-center gap-1 p-1 text-[var(--text-muted)] hover:text-[var(--alert-red)] transition-colors flex-shrink-0"
        >
          <X className="w-3.5 h-3.5" />
          <span className="text-[9px] tracking-wider hidden sm:inline">LEAVE</span>
        </button>
      </header>

      <div className="px-3 py-2">
        {identifying ? (
          <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
            <Loader2 className="w-3 h-3 animate-spin" /> Identifying airframe…
          </div>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-[var(--text-primary)] leading-snug">
            <span>{detail?.model || flight?.model || 'Unidentified type'}</span>
            {detail?.operator && (
              <span className="text-[9px] text-[var(--text-muted)] truncate max-w-[200px]">{detail.operator}</span>
            )}
            {detail?.registration && (
              <span className="text-[9px] text-[var(--text-muted)] tabular-nums">{detail.registration}</span>
            )}
          </div>
        )}

        {flight ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1.5 mt-2">
            <TelemetryCell label="ALTITUDE" value={formatAlt(flight.alt, flight.grounded)} />
            <TelemetryCell
              label="GROUND SPEED"
              value={typeof flight.speed_knots === 'number' ? `${Math.round(flight.speed_knots)} kt` : '—'}
            />
            <TelemetryCell label="HEADING" value={`${Math.round(flight.heading || 0)}°`} />
            <TelemetryCell
              label="POSITION"
              value={`${flight.lat.toFixed(2)}, ${flight.lng.toFixed(2)}`}
            />
          </div>
        ) : (
          <div className="mt-2 text-[10px] text-[var(--alert-orange)]">
            Waiting for the next position report…
          </div>
        )}

        {(detail?.origin || detail?.destination) && (
          <div className="flex items-center gap-1.5 mt-2 pt-1.5 border-t border-[var(--border-secondary)]">
            <span className="text-[11px] text-[var(--text-primary)] tabular-nums">
              {detail.origin ? detail.origin.iata || detail.origin.icao : '····'}
            </span>
            <span className="text-[10px] text-[var(--text-muted)]">&rarr;</span>
            <span className="text-[11px] text-[var(--text-primary)] tabular-nums">
              {detail.destination ? detail.destination.iata || detail.destination.icao : '····'}
            </span>
            {/* Same honesty rule as the watch panel: an unconfirmed destination
                is a schedule claim, not something the aircraft was seen to do. */}
            <span className="text-[9px] text-[var(--text-muted)] ml-auto">
              {detail.arrival ? 'landed' : detail.destination ? 'scheduled' : 'destination unknown'}
            </span>
          </div>
        )}

        {lock === 'free' && (
          <div className="flex items-center gap-2 mt-2 pt-1.5 border-t border-[var(--border-secondary)]">
            <span className="text-[10px] text-[var(--text-secondary)]">
              You&apos;ve got the map — the ride is paused, the plane is still flying.
            </span>
            <button
              onClick={onRecenter}
              className="ml-auto flex items-center gap-1 px-2 py-1 rounded border border-[var(--border-secondary)] text-[9px] tracking-wider text-[var(--cyan-primary)] hover:bg-white/5 transition-colors flex-shrink-0"
            >
              <LocateFixed className="w-3 h-3" /> RE-CENTRE
            </button>
          </div>
        )}

        {flight && contacts.length > 0 && (
          <div className="mt-2 pt-1.5 border-t border-[var(--border-secondary)]">
            <button
              onClick={() => setShowContacts((v) => !v)}
              className="flex items-center gap-1.5 w-full text-left"
              aria-expanded={showContacts}
            >
              <Gauge className="w-2.5 h-2.5 text-[var(--text-muted)]" />
              <span className="text-[9px] tracking-[0.14em] text-[var(--text-muted)]">
                NEARBY FLIGHTS · {contacts.length} WITHIN {CONTACT_RADIUS_KM} KM
              </span>
              {showContacts
                ? <ChevronUp className="w-3 h-3 text-[var(--text-muted)] ml-auto" />
                : <ChevronDown className="w-3 h-3 text-[var(--text-muted)] ml-auto" />}
            </button>
            {showContacts && (
              <div className="mt-1 max-h-40 overflow-y-auto styled-scrollbar">
                {contacts.map(({ flight: c, distanceKm, bearingDeg }) => (
                  <button
                    key={c.icao24}
                    onClick={() => onHop({
                      icao24: c.icao24,
                      callsign: (c.callsign || c.icao24.toUpperCase()).trim(),
                    })}
                    title={`Hop to ${c.callsign || c.icao24.toUpperCase()}`}
                    className="flex items-center gap-2 w-full px-1 py-1 rounded hover:bg-white/5 transition-colors text-left"
                  >
                    <span className="text-[10px] text-[var(--text-primary)] tabular-nums truncate min-w-[64px]">
                      {(c.callsign || c.icao24.toUpperCase()).trim()}
                    </span>
                    {c.model && (
                      <span className="text-[9px] text-[var(--text-muted)] truncate">{c.model}</span>
                    )}
                    <span className="ml-auto flex items-center gap-1 flex-shrink-0">
                      <ArrowUp
                        className="w-2.5 h-2.5 text-[var(--text-muted)]"
                        style={{ transform: `rotate(${Math.round(bearingDeg)}deg)` }}
                      />
                      <span className="text-[10px] text-[var(--text-secondary)] tabular-nums">
                        {distanceKm < 10 ? distanceKm.toFixed(1) : Math.round(distanceKm)} km
                      </span>
                      <span className="text-[9px] text-[var(--text-muted)] tabular-nums w-[64px] text-right">
                        {formatAlt(c.alt, c.grounded)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** The plain message shown when a ride ends itself — the flight landed or
 *  left the feed. The visitor is already on their way back to their old view. */
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
