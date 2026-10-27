/* ═══════════════════════════════════════════════════════════════
   Glass Earth — Fly the Route (lib/route-flight)

   The maths behind the scenic camera flight along a planned route:
   a route geometry becomes an arc-length-parameterised path, so the
   camera can be asked "where am I at distance d, facing which way"
   without caring how the engine spaced its vertices. Pure functions —
   the map component owns the clock and the camera; this module owns
   the geometry and the flight rules, and is unit-tested.

   Flight rules (also stated in the build report):
   - Duration scales with route length at a nominal ground speed of
     1,200 m/s, clamped to [12 s, 120 s]: a 5 km hop still gets a
     readable 12 s tour; a cross-country route is capped at two
     minutes rather than crawling for an hour.
   - The camera rides pitched at 62° with its bearing following the
     direction of travel, smoothed by a capped turn rate so vertex
     kinks never snap the view around.
   - Zoom steps down as routes get longer, so the road ahead stays
     in frame instead of streaming past at street level.
   ═══════════════════════════════════════════════════════════════ */

export type LngLat = [number, number];

export interface RoutePath {
  coords: LngLat[];
  /** Metres from the route start to each vertex (same length as coords). */
  cumulative: number[];
  /** Total route length in metres. */
  total: number;
}

export interface RoutePose {
  lng: number;
  lat: number;
  /** Direction of travel at this point, degrees clockwise from north. */
  bearing: number;
  /** Index of the segment the pose sits on. */
  segment: number;
}

/** Nominal camera ground speed for the flight duration rule. */
export const ROUTE_FLIGHT_SPEED_MPS = 1200;
/** Shortest / longest a route flight may run, milliseconds. */
export const ROUTE_FLIGHT_MIN_MS = 12_000;
export const ROUTE_FLIGHT_MAX_MS = 120_000;
/** Fixed camera pitch for the flight — steep enough to feel airborne, shallow enough to keep the road ahead in frame. */
export const ROUTE_FLIGHT_PITCH = 62;
/** Fastest the camera bearing may chase the road, degrees per second. */
export const ROUTE_FLIGHT_TURN_DEG_PER_SEC = 90;

const EARTH_R = 6_371_000;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance between two [lng, lat] points, metres. */
export function haversineLngLat(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

/** Initial bearing from a to b, degrees clockwise from north, [0, 360). */
export function bearingLngLat(a: LngLat, b: LngLat): number {
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Parameterise a route geometry by arc length. Degenerate inputs (fewer than two distinct points) yield total 0. */
export function buildRoutePath(coords: LngLat[]): RoutePath {
  const clean = (coords || []).filter(
    (c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]),
  );
  const cumulative: number[] = [];
  let total = 0;
  for (let i = 0; i < clean.length; i++) {
    if (i > 0) total += haversineLngLat(clean[i - 1], clean[i]);
    cumulative.push(total);
  }
  return { coords: clean, cumulative, total };
}

/**
 * The pose at `distanceM` metres along the path. Distances outside the
 * path clamp to its ends. Within a segment the position interpolates
 * linearly between vertices (segments are short — engine vertices —
 * so the chord error against the great circle is negligible), and the
 * bearing is the segment's.
 */
export function sampleRoute(path: RoutePath, distanceM: number): RoutePose | null {
  const { coords, cumulative, total } = path;
  if (coords.length === 0) return null;
  if (coords.length === 1) return { lng: coords[0][0], lat: coords[0][1], bearing: 0, segment: 0 };

  const d = Math.min(Math.max(distanceM, 0), total);
  // Find the segment: the last vertex whose cumulative distance is <= d.
  let seg = 0;
  while (seg < coords.length - 2 && cumulative[seg + 1] < d) seg++;
  // Zero-length segments (duplicate vertices) carry no travel — skip them.
  while (seg < coords.length - 2 && cumulative[seg + 1] <= cumulative[seg]) seg++;

  const a = coords[seg];
  const b = coords[seg + 1];
  const segLen = cumulative[seg + 1] - cumulative[seg];
  const t = segLen > 0 ? (d - cumulative[seg]) / segLen : 0;
  return {
    lng: a[0] + (b[0] - a[0]) * t,
    lat: a[1] + (b[1] - a[1]) * t,
    bearing: bearingLngLat(a, b),
    segment: seg,
  };
}

/** The coordinates of the path up to `distanceM` — the flown-so-far line, ending exactly at the pose. */
export function flownCoords(path: RoutePath, distanceM: number): LngLat[] {
  const pose = sampleRoute(path, distanceM);
  if (!pose) return [];
  const out: LngLat[] = [];
  for (let i = 0; i <= pose.segment && i < path.coords.length; i++) out.push(path.coords[i]);
  out.push([pose.lng, pose.lat]);
  return out;
}

/** Flight duration for a route of `totalM` metres, per the rule at the top of this file. */
export function routeFlightDurationMs(totalM: number): number {
  if (!Number.isFinite(totalM) || totalM <= 0) return ROUTE_FLIGHT_MIN_MS;
  const raw = (totalM / ROUTE_FLIGHT_SPEED_MPS) * 1000;
  return Math.min(ROUTE_FLIGHT_MAX_MS, Math.max(ROUTE_FLIGHT_MIN_MS, raw));
}

/** Camera zoom for the flight: closer for short hops, wider as routes grow. */
export function routeFlightZoom(totalM: number): number {
  if (totalM <= 3_000) return 15;
  if (totalM <= 15_000) return 14;
  if (totalM <= 60_000) return 13;
  if (totalM <= 200_000) return 11.5;
  return 10;
}

/** Signed shortest turn from one bearing to another, degrees in (-180, 180]. */
export function shortestTurnDeg(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

/**
 * Turn `current` toward `target` by at most `maxStepDeg` (shortest way
 * round). The flight loop calls this per frame with the turn-rate cap,
 * so the camera swings through corners instead of snapping to them.
 */
export function turnToward(current: number, target: number, maxStepDeg: number): number {
  const delta = shortestTurnDeg(current, target);
  const step = Math.min(Math.abs(delta), Math.max(0, maxStepDeg));
  return (current + Math.sign(delta) * step + 360) % 360;
}
