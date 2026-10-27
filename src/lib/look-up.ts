import { propagateTLE, type SatPosition } from './orbit';
import { haversine } from './geo';

/**
 * OSIRIS — Look Up: what is above one place, right now.
 *
 * Three questions, all answered from machinery the app already runs:
 *
 *   - When does the ISS next pass over here? Propagated from its TLE with
 *     lib/orbit (the same satellite.js SGP4 the server positions and orbit
 *     tracks come from), scanned for horizon crossings.
 *   - What satellites are above the horizon now? Look angles computed from
 *     the satellite feed's own propagated positions — the very rows the
 *     map draws — so the panel can never disagree with the map.
 *   - What aircraft are nearby? Great-circle distance over the flight
 *     feed's rows, the way lib/share-target searches the same buckets.
 *
 * The one piece of astronomy the app did not already have is the sun: a
 * low-precision solar position (the Astronomical Almanac algorithm, good
 * to ~0.01°) for the "Visible" label. A pass earns that label from real
 * geometry only — the station sunlit, the sky dark — never from the clock.
 */

export interface Observer {
  lat: number;
  lng: number;
}

/* ── ECEF geometry (WGS84) ─────────────────────────────────────────────── */

const WGS84_A_KM = 6378.137;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);

type Vec3 = [number, number, number];

function geodeticToEcef(latDeg: number, lngDeg: number, altKm: number): Vec3 {
  const phi = (latDeg * Math.PI) / 180;
  const lam = (lngDeg * Math.PI) / 180;
  const sinPhi = Math.sin(phi);
  const n = WGS84_A_KM / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
  return [
    (n + altKm) * Math.cos(phi) * Math.cos(lam),
    (n + altKm) * Math.cos(phi) * Math.sin(lam),
    (n * (1 - WGS84_E2) + altKm) * sinPhi,
  ];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

export interface LookAngle {
  /** Degrees above the observer's horizon; negative means below it. */
  elevationDeg: number;
  /** Degrees clockwise from north, 0–360. */
  azimuthDeg: number;
  /** Slant range, observer to target, km. */
  rangeKm: number;
}

/** Where a target sits in the observer's sky, from its geodetic position. */
export function lookAngle(observer: Observer, target: SatPosition): LookAngle {
  const phi = (observer.lat * Math.PI) / 180;
  const lam = (observer.lng * Math.PI) / 180;
  const d = sub(
    geodeticToEcef(target.lat, target.lng, target.altKm),
    geodeticToEcef(observer.lat, observer.lng, 0),
  );
  const east: Vec3 = [-Math.sin(lam), Math.cos(lam), 0];
  const north: Vec3 = [-Math.sin(phi) * Math.cos(lam), -Math.sin(phi) * Math.sin(lam), Math.cos(phi)];
  const up: Vec3 = [Math.cos(phi) * Math.cos(lam), Math.cos(phi) * Math.sin(lam), Math.sin(phi)];
  const e = dot(d, east);
  const n = dot(d, north);
  const u = dot(d, up);
  return {
    elevationDeg: (Math.atan2(u, Math.hypot(e, n)) * 180) / Math.PI,
    azimuthDeg: (Math.atan2(e, n) * 180 / Math.PI + 360) % 360,
    rangeKm: norm(d),
  };
}

/* ── The sun ───────────────────────────────────────────────────────────── */

/**
 * The subsolar point — where the sun is directly overhead — from the
 * low-precision solar coordinates in the Astronomical Almanac. Latitude is
 * the sun's declination; longitude follows from right ascension minus
 * Greenwich sidereal time. Accurate to ~0.01°, far inside what a
 * visible/not-visible label needs.
 */
export function subsolarPoint(when: Date): { lat: number; lng: number } {
  const jd = when.getTime() / 86_400_000 + 2_440_587.5;
  const d = jd - 2_451_545.0; // days since J2000.0
  const meanLng = ((280.46 + 0.9856474 * d) % 360 + 360) % 360;
  const anomaly = ((357.528 + 0.9856003 * d) % 360) * (Math.PI / 180);
  const eclipticLng =
    (meanLng + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * (Math.PI / 180);
  const obliquity = (23.439 - 0.0000004 * d) * (Math.PI / 180);
  const raDeg =
    (Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLng), Math.cos(eclipticLng)) * 180) / Math.PI;
  const decDeg =
    (Math.asin(Math.sin(obliquity) * Math.sin(eclipticLng)) * 180) / Math.PI;
  const gmstDeg = ((18.697374558 + 24.06570982441908 * d) % 24) * 15;
  let lng = raDeg - gmstDeg;
  lng = ((((lng + 180) % 360) + 360) % 360) - 180;
  return { lat: decDeg, lng };
}

function sunUnitEcef(when: Date): Vec3 {
  const s = subsolarPoint(when);
  const phi = (s.lat * Math.PI) / 180;
  const lam = (s.lng * Math.PI) / 180;
  return [Math.cos(phi) * Math.cos(lam), Math.cos(phi) * Math.sin(lam), Math.sin(phi)];
}

/** The sun's elevation above the observer's horizon, degrees. */
export function sunElevationDeg(observer: Observer, when: Date): number {
  const phi = (observer.lat * Math.PI) / 180;
  const lam = (observer.lng * Math.PI) / 180;
  const up: Vec3 = [Math.cos(phi) * Math.cos(lam), Math.cos(phi) * Math.sin(lam), Math.sin(phi)];
  return (Math.asin(Math.max(-1, Math.min(1, dot(sunUnitEcef(when), up)))) * 180) / Math.PI;
}

/**
 * Is a satellite in sunlight at this moment? Cylindrical-shadow model:
 * the Earth blocks the sun when the satellite is on the anti-sun side of
 * the terminator plane and its perpendicular distance from the sun axis
 * is less than Earth's radius. The standard first-order test every pass
 * predictor starts from; it ignores the penumbra taper, which at ISS
 * altitude is a matter of seconds.
 */
export function isSunlit(target: SatPosition, when: Date): boolean {
  const sun = sunUnitEcef(when);
  const x = geodeticToEcef(target.lat, target.lng, target.altKm);
  const along = dot(x, sun);
  if (along >= 0) return true;
  const perp: Vec3 = [x[0] - along * sun[0], x[1] - along * sun[1], x[2] - along * sun[2]];
  return norm(perp) >= WGS84_A_KM;
}

/* ── ISS passes ────────────────────────────────────────────────────────── */

export interface IssPass {
  riseAt: Date;
  peakAt: Date;
  setAt: Date;
  /** Peak elevation above the horizon, degrees. */
  peakElevationDeg: number;
  /** Azimuth at the peak, degrees clockwise from north. */
  peakAzimuthDeg: number;
  /**
   * The honest label. True only when the geometry supports seeing the
   * station with the naked eye at the peak: the ISS is sunlit AND the
   * sun is at least 6° below the observer's horizon (civil darkness).
   * Anything else is a pass overhead, in daylight or with the station
   * eclipsed — real, but not promised as visible.
   */
  visible: boolean;
}

export interface PassSearchOptions {
  from?: Date;
  /** How many passes to return. */
  count?: number;
  /** Search horizon; passes beyond it are not reported as absent, just not found. */
  horizonHours?: number;
  /** A pass must peak at or above this elevation to be listed at all. */
  minPeakElevationDeg?: number;
  /** Coarse scan step. A listed pass spends minutes near its peak, so 30 s
   *  sampling cannot step over one; crossings are then refined exactly. */
  stepSeconds?: number;
}

/**
 * The next ISS passes over an observer, propagated from the TLE with the
 * app's own SGP4 wrapper. Rise/set are the 0°-elevation crossings refined
 * by bisection; the peak is found by golden-section search between them.
 * Deterministic for a fixed TLE and start time.
 */
export function findIssPasses(
  line1: string,
  line2: string,
  observer: Observer,
  opts: PassSearchOptions = {},
): IssPass[] {
  const from = opts.from ?? new Date();
  const count = opts.count ?? 3;
  const horizonMs = (opts.horizonHours ?? 72) * 3600_000;
  const minPeak = opts.minPeakElevationDeg ?? 10;
  const stepMs = (opts.stepSeconds ?? 30) * 1000;

  const elevationAt = (t: number): { el: number; pos: SatPosition | null } => {
    const pos = propagateTLE(line1, line2, new Date(t));
    if (!pos) return { el: -90, pos: null };
    return { el: lookAngle(observer, pos).elevationDeg, pos };
  };

  /** Bisect the elevation sign change in (a, b] down to ~1 s. */
  const refineCrossing = (a: number, b: number): number => {
    let lo = a;
    let hi = b;
    const loSign = elevationAt(lo).el > 0;
    for (let i = 0; i < 40 && hi - lo > 1000; i++) {
      const mid = (lo + hi) / 2;
      if ((elevationAt(mid).el > 0) === loSign) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };

  const passes: IssPass[] = [];
  const end = from.getTime() + horizonMs;
  let prevT = from.getTime();
  let inPass = elevationAt(prevT).el > 0;
  let riseT = inPass ? prevT : 0;

  for (let t = prevT + stepMs; t <= end && passes.length < count; t += stepMs) {
    const { el } = elevationAt(t);
    if (!inPass && el > 0) {
      riseT = refineCrossing(prevT, t);
      inPass = true;
    } else if (inPass && el <= 0) {
      const setT = refineCrossing(prevT, t);
      // Peak: golden-section maximisation of elevation over [rise, set].
      let a = riseT;
      let b = setT;
      const gr = (Math.sqrt(5) - 1) / 2;
      let c = b - gr * (b - a);
      let d2 = a + gr * (b - a);
      for (let i = 0; i < 48; i++) {
        if (elevationAt(c).el < elevationAt(d2).el) a = c;
        else b = d2;
        c = b - gr * (b - a);
        d2 = a + gr * (b - a);
      }
      const peakT = (a + b) / 2;
      const peak = elevationAt(peakT);
      if (peak.pos && peak.el >= minPeak) {
        const peakAngle = lookAngle(observer, peak.pos);
        passes.push({
          riseAt: new Date(riseT),
          peakAt: new Date(peakT),
          setAt: new Date(setT),
          peakElevationDeg: peak.el,
          peakAzimuthDeg: peakAngle.azimuthDeg,
          visible: isSunlit(peak.pos, new Date(peakT)) && sunElevationDeg(observer, new Date(peakT)) <= -6,
        });
      }
      inPass = false;
    }
    prevT = t;
  }
  return passes;
}

/* ── Overhead now ──────────────────────────────────────────────────────── */

export interface SatelliteRowLike {
  name: string;
  lat: number;
  lng: number;
  /** Kilometres above the ellipsoid, as the feed reports it. */
  alt: number;
  noradId?: string;
  mission?: string;
  category?: string;
  color?: string;
}

export interface OverheadSatellite {
  row: SatelliteRowLike;
  elevationDeg: number;
  azimuthDeg: number;
  rangeKm: number;
}

/**
 * Satellites from the feed currently above the observer's horizon,
 * highest first. Computed from the feed's own propagated positions — the
 * rows the map draws — so the list and the map cannot disagree.
 */
export function overheadSatellites(
  rows: readonly SatelliteRowLike[],
  observer: Observer,
  limit = 12,
): { above: OverheadSatellite[]; totalAbove: number } {
  const above: OverheadSatellite[] = [];
  for (const row of rows) {
    if (!Number.isFinite(row?.lat) || !Number.isFinite(row?.lng) || !Number.isFinite(row?.alt)) continue;
    const a = lookAngle(observer, { lat: row.lat, lng: row.lng, altKm: row.alt });
    if (a.elevationDeg > 0) {
      above.push({ row, elevationDeg: a.elevationDeg, azimuthDeg: a.azimuthDeg, rangeKm: a.rangeKm });
    }
  }
  above.sort((x, y) => y.elevationDeg - x.elevationDeg);
  return { above: above.slice(0, limit), totalAbove: above.length };
}

export interface FlightRowLike {
  callsign?: string;
  icao24?: string;
  lat?: unknown;
  lng?: unknown;
  /** Metres, as the flight feed reports it; null when unreported. */
  alt?: number | null;
}

export interface OverheadAircraft {
  callsign: string;
  icao24: string;
  distanceKm: number;
  /** Metres, or null when the feed never reported one. */
  altMeters: number | null;
}

/**
 * Aircraft from the flight feed within `radiusKm` of the observer,
 * nearest first. A record without a usable position or identity is not
 * an aircraft overhead — it is skipped, never placed by guesswork.
 */
export function overheadAircraft(
  rows: readonly FlightRowLike[],
  observer: Observer,
  radiusKm = 100,
  limit = 10,
): { near: OverheadAircraft[]; totalNear: number } {
  const near: OverheadAircraft[] = [];
  for (const f of rows) {
    if (typeof f?.lat !== 'number' || typeof f?.lng !== 'number') continue;
    if (!Number.isFinite(f.lat) || !Number.isFinite(f.lng)) continue;
    const icao24 = typeof f.icao24 === 'string' ? f.icao24 : '';
    if (!icao24) continue;
    const distanceKm = haversine([observer.lng, observer.lat], [f.lng, f.lat]);
    if (distanceKm > radiusKm) continue;
    const cs = typeof f.callsign === 'string' ? f.callsign.trim() : '';
    near.push({
      callsign: cs || icao24.toUpperCase(),
      icao24,
      distanceKm,
      altMeters: typeof f.alt === 'number' && Number.isFinite(f.alt) ? f.alt : null,
    });
  }
  near.sort((x, y) => x.distanceKm - y.distanceKm);
  return { near: near.slice(0, limit), totalNear: near.length };
}
