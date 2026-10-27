/**
 * Glass Earth — Cockpit view (ride a tracked flight).
 *
 * The pure machinery behind the cockpit: dead reckoning between feed fixes,
 * a follow smoother that glides the camera instead of jumping it, the
 * nearby-contacts selection, and the enter/exit state machine. Everything
 * here is framework-free so it can be tested without a map.
 *
 * The feed only reports every so often (the page polls /api/flights on a
 * minutes-long cadence normally, 30 s while a ride is on), so between fixes
 * the aircraft's position is extrapolated along its reported track at its
 * reported ground speed — dead reckoning, the way a real tracker bridges
 * gaps. Extrapolation is capped: past the cap the pose holds at the last
 * reckoned point rather than flying off on stale data.
 */

import type { ViewSnapshot } from './view-history';

/** Camera framing while riding: close enough to feel aboard, pitched to a
 *  horizon view. Bearing comes from the aircraft, not the map default. */
export const COCKPIT_ZOOM = 11.5;
export const COCKPIT_PITCH = 76;

/**
 * FPV framing: the map is padded at the top by this fraction of the CLEAR
 * height — the screen above the glass PFD band (lib/cockpit-pfd) — which
 * drops the aircraft low in that clear area, a nose near its bottom, so
 * the stage is overwhelmingly the world ahead: horizon up top, ground
 * streaming below. (MapLibre places the camera centre at (1 + fraction)
 * / 2 of the padded height: 0.52 puts the aircraft ~76% down the clear
 * area.)
 */
export const COCKPIT_TOP_PADDING_FRACTION = 0.52;

/**
 * While a ride owns the screen, the map's popups stay shut: the forward
 * view is the product, and a panel anchored over it is exactly what the
 * FPV rework removed. Entering a ride dismisses any open popup, and the
 * popup helper refuses to open another until the ride ends.
 */
export function mapPopupsAllowed(rideActive: boolean): boolean {
  return !rideActive;
}

/** Contacts roster radius — the same 250 km bubble the comparison used. */
export const CONTACT_RADIUS_KM = 250;
/** How many contacts the roster lists, nearest first. */
export const CONTACT_LIMIT = 12;

/** Dead reckoning is trusted this far past the last fix, no further. */
export const EXTRAPOLATE_CAP_MS = 75_000;
/** A target unseen for this long is gone — the ride ends with a message.
    Five minutes of COMPLETE-sweep absence (see nextAbsenceMs): sparse
    ADS-B coverage — oceanic, northern, low-altitude — can hide an airborne
    aircraft from several consecutive sweeps, and the 90 s this used to be
    ended healthy rides mid-flight (the 2026-10-26 gauntlet watched a
    25-minute hop declared lost ~60 s in). At the ride's 30 s refresh,
    five minutes is ~10 complete sweeps in a row with no sign of the
    target; meanwhile the pose dead-reckons to its cap and holds there,
    the OSD shows the last report under a FEED GAP note, and a landing
    still ends the ride at once via the feed's grounded flag. */
export const LOST_GRACE_MS = 300_000;

/**
 * Absence accounting for the ride's lost-target rule.
 *
 * "Unseen" must mean unseen by a COMPLETE sweep. The flights route's fast
 * first wave is flagged `partial` and simply does not contain most of the
 * sky; when a ride's 30 s refresh lands on one, the ridden aircraft is
 * absent from it through no fault of its own — the 2026-10-26 browser
 * verification watched a ride blank its OSD and stall on exactly that.
 * So absence accumulates only on ticks where the current payload is
 * complete: a partial payload is no-new-data, neither sighting nor gap.
 * A sighting resets the clock outright.
 */
export function nextAbsenceMs(
  absenceMs: number,
  seen: boolean,
  payloadPartial: boolean,
  tickMs: number,
): number {
  if (seen) return 0;
  return payloadPartial ? absenceMs : absenceMs + tickMs;
}

/** Has the target now been absent from complete sweeps past the grace? */
export function absenceIsLoss(absenceMs: number, graceMs: number = LOST_GRACE_MS): boolean {
  return absenceMs > graceMs;
}

const EARTH_R_KM = 6371;
const KNOT_TO_KM_H = 1.852;
const DEG = Math.PI / 180;

/** One position report for the ridden aircraft, as the feed last gave it. */
export interface CockpitFix {
  lat: number;
  lng: number;
  /** True track over the ground, degrees clockwise from north. */
  headingDeg: number;
  speedKnots: number;
  grounded?: boolean;
  /** Client clock (ms) when this fix was taken in — extrapolation ages from here. */
  atMs: number;
}

/** A feed row distilled to what a fix is made from. */
export interface CockpitFixInput {
  lat: number;
  lng: number;
  headingDeg: number;
  speedKnots: number;
  grounded?: boolean;
}

/**
 * The smoother's next fix, from the latest feed row. The feed rows carry
 * no per-aircraft timestamp, so the client clock is the only clock a fix
 * has — and it must only restart when the row actually says something
 * new. The follow loop re-reads the current payload every second; when
 * the route is serving a cached snapshot (or coverage is sparse) the
 * same row comes back again and again, and stamping it fresh each time
 * would pin the dead reckoning at age ~0 forever — the aircraft frozen
 * on its last reported point, the exact freeze the 2026-10-26 gauntlet
 * watched for three minutes. A row identical to the previous fix keeps
 * the previous fix's clock, so the reckoning ages honestly to its cap
 * and holds there until a genuinely new report lands.
 */
export function advanceFix(
  prev: CockpitFix | null,
  row: CockpitFixInput,
  nowMs: number,
): CockpitFix {
  const repeated = prev !== null
    && prev.lat === row.lat
    && prev.lng === row.lng
    && prev.headingDeg === row.headingDeg
    && prev.speedKnots === row.speedKnots
    && !!prev.grounded === !!row.grounded;
  return { ...row, atMs: repeated ? prev.atMs : nowMs };
}

/** Where the camera should sit: a point, looking along a bearing. */
export interface CockpitPose {
  lat: number;
  lng: number;
  bearingDeg: number;
}

/** The point reached by travelling `distanceKm` from a start along a bearing. */
export function destinationPoint(
  lat: number,
  lng: number,
  bearingDeg: number,
  distanceKm: number,
): { lat: number; lng: number } {
  const d = distanceKm / EARTH_R_KM;
  const br = bearingDeg * DEG;
  const lat1 = lat * DEG;
  const lng1 = lng * DEG;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br),
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(br) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
  );
  return { lat: lat2 / DEG, lng: ((lng2 / DEG + 540) % 360) - 180 };
}

/** Great-circle distance between two points, kilometres. */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.sqrt(h));
}

/** Initial bearing from one point to another, degrees clockwise from north. */
export function initialBearingDeg(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const dLng = (to.lng - from.lng) * DEG;
  const lat1 = from.lat * DEG;
  const lat2 = to.lat * DEG;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) / DEG) + 360) % 360;
}

/**
 * Where the aircraft should be at `nowMs`, given its last fix: the fix
 * position advanced along its track at its ground speed. A grounded or
 * stationary aircraft stays put; time before the fix and past the
 * extrapolation cap is clamped, so a stale fix ages to a standstill at the
 * cap point instead of wandering.
 */
export function deadReckon(
  fix: CockpitFix,
  nowMs: number,
  capMs: number = EXTRAPOLATE_CAP_MS,
): { lat: number; lng: number } {
  if (fix.grounded || !(fix.speedKnots > 0)) return { lat: fix.lat, lng: fix.lng };
  const elapsed = Math.min(Math.max(nowMs - fix.atMs, 0), capMs);
  if (elapsed === 0) return { lat: fix.lat, lng: fix.lng };
  const distanceKm = fix.speedKnots * KNOT_TO_KM_H * (elapsed / 3_600_000);
  return destinationPoint(fix.lat, fix.lng, fix.headingDeg, distanceKm);
}

/** Signed shortest turn from one angle to another, in (−180, 180]. */
export function angleDeltaDeg(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

/** Move `current` toward `target` along the shortest arc by `alpha` (0..1). */
export function smoothAngleDeg(current: number, target: number, alpha: number): number {
  return ((current + angleDeltaDeg(current, target) * alpha) % 360 + 360) % 360;
}

/** Move a longitude toward a target the short way across the antimeridian. */
export function smoothLng(current: number, target: number, alpha: number): number {
  return ((current + angleDeltaDeg(current, target) * alpha + 540) % 360) - 180;
}

export interface FollowSmoother {
  /** Hand over the newest feed fix. Corrections blend — nothing teleports. */
  pushFix(fix: CockpitFix): void;
  /** Glide from this pose instead (entering the ride, re-centring). */
  reseed(pose: CockpitPose): void;
  /** The camera pose for this instant. Null until the first fix arrives. */
  sample(nowMs: number): CockpitPose | null;
  /** The pose as last sampled (the seed until then). */
  pose(): CockpitPose;
}

/**
 * The follow camera's brain. Holds a display pose that forever chases the
 * dead-reckoned position of the latest fix with exponential smoothing, so:
 *  - entering the ride swoops from wherever the map was to the aircraft;
 *  - between fixes the pose rides the reckoning, not the last stale point;
 *  - a new fix that disagrees with the reckoning bends the path, never snaps.
 * The bearing chases the reported track (a parked or crawling aircraft keeps
 * the bearing it had — spinning the world under a stationary plane is noise).
 */
export function createFollowSmoother(
  seed: CockpitPose,
  opts: { tauMs?: number; extrapolateCapMs?: number } = {},
): FollowSmoother {
  const tauMs = opts.tauMs ?? 1400;
  const capMs = opts.extrapolateCapMs ?? EXTRAPOLATE_CAP_MS;
  let display: CockpitPose = { ...seed };
  let fix: CockpitFix | null = null;
  let lastSampleMs: number | null = null;

  return {
    pushFix(next: CockpitFix) {
      fix = next;
    },
    reseed(pose: CockpitPose) {
      display = { ...pose };
      lastSampleMs = null;
    },
    sample(nowMs: number): CockpitPose | null {
      if (!fix) return null;
      const dt = lastSampleMs === null ? 16 : Math.min(Math.max(nowMs - lastSampleMs, 0), 100);
      lastSampleMs = nowMs;
      const alpha = 1 - Math.exp(-dt / tauMs);
      const target = deadReckon(fix, nowMs, capMs);
      display = {
        lat: display.lat + (target.lat - display.lat) * alpha,
        lng: smoothLng(display.lng, target.lng, alpha),
        bearingDeg:
          !fix.grounded && fix.speedKnots > 5
            ? smoothAngleDeg(display.bearingDeg, fix.headingDeg, alpha)
            : display.bearingDeg,
      };
      return { ...display };
    },
    pose(): CockpitPose {
      return { ...display };
    },
  };
}

/** The least a contact needs: an identity and a position. */
export interface ContactFlight {
  icao24: string;
  callsign?: string;
  lat: number;
  lng: number;
  /** Null when the feed never reported it — "no data", not 0. */
  alt?: number | null;
  speed_knots?: number | null;
  heading?: number | null;
  model?: string;
  grounded?: boolean;
}

export interface Contact {
  flight: ContactFlight;
  distanceKm: number;
  /** Bearing from the ridden aircraft to this one, degrees from north. */
  bearingDeg: number;
}

/**
 * Aircraft within `radiusKm` of a centre, nearest first — the roster you
 * hop between. The ridden aircraft itself is excluded, as is anything
 * without a usable position.
 */
export function contactsWithin(
  center: { lat: number; lng: number },
  flights: ContactFlight[],
  radiusKm: number = CONTACT_RADIUS_KM,
  excludeIcao24?: string,
  limit: number = CONTACT_LIMIT,
): Contact[] {
  const out: Contact[] = [];
  for (const flight of flights) {
    if (!flight || flight.icao24 === excludeIcao24) continue;
    if (!Number.isFinite(flight.lat) || !Number.isFinite(flight.lng)) continue;
    const distanceKm = haversineKm(center, flight);
    if (distanceKm > radiusKm) continue;
    out.push({ flight, distanceKm, bearingDeg: initialBearingDeg(center, flight) });
  }
  out.sort((a, b) => a.distanceKm - b.distanceKm);
  return out.slice(0, limit);
}

/* ── Enter / exit state machine ─────────────────────────────────────────── */

export interface CockpitTarget {
  icao24: string;
  callsign: string;
}

export type CockpitState =
  | { status: 'idle' }
  | {
      status: 'riding';
      target: CockpitTarget;
      /** 'follow' = the camera rides the aircraft. 'free' = the visitor
       *  grabbed the map; the ride is paused, not over. */
      lock: 'follow' | 'free';
      /** The view to restore on exit, captured at entry. */
      savedView: ViewSnapshot;
    }
  | {
      status: 'ended';
      /** Plain-language reason the ride ended (target landed / left the feed). */
      notice: string;
      savedView: ViewSnapshot;
    };

export type CockpitEvent =
  | { type: 'ENTER'; target: CockpitTarget; savedView: ViewSnapshot }
  | { type: 'GRAB' }
  | { type: 'RECENTER' }
  | { type: 'HOP'; target: CockpitTarget }
  | { type: 'EXIT' }
  | { type: 'LOST'; notice: string }
  | { type: 'ACK' };

export const COCKPIT_IDLE: CockpitState = { status: 'idle' };

/**
 * The ride's state machine. Entering from idle starts a ride; entering
 * while already riding is a hop (the original saved view is kept — exit
 * always returns to where the visitor was before the FIRST entry). Grabbing
 * the map only pauses the follow; it never ends the ride. Losing the target
 * lands in 'ended', which carries the notice and the saved view so the page
 * can fly home and explain itself; ACK dismisses it.
 */
export function cockpitReducer(state: CockpitState, event: CockpitEvent): CockpitState {
  switch (event.type) {
    case 'ENTER':
      if (state.status === 'riding') {
        return { ...state, target: event.target, lock: 'follow' };
      }
      if (state.status === 'ended') {
        // Re-entering while the end-of-ride notice is up: the visitor's true
        // pre-ride view is still the one from the first entry.
        return { status: 'riding', target: event.target, lock: 'follow', savedView: state.savedView };
      }
      return { status: 'riding', target: event.target, lock: 'follow', savedView: event.savedView };
    case 'GRAB':
      return state.status === 'riding' && state.lock === 'follow'
        ? { ...state, lock: 'free' }
        : state;
    case 'RECENTER':
      return state.status === 'riding' && state.lock === 'free'
        ? { ...state, lock: 'follow' }
        : state;
    case 'HOP':
      return state.status === 'riding'
        ? { ...state, target: event.target, lock: 'follow' }
        : state;
    case 'EXIT':
      return state.status === 'riding' ? COCKPIT_IDLE : state;
    case 'LOST':
      return state.status === 'riding'
        ? { status: 'ended', notice: event.notice, savedView: state.savedView }
        : state;
    case 'ACK':
      return state.status === 'ended' ? COCKPIT_IDLE : state;
    default:
      return state;
  }
}
