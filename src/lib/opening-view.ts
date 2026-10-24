/**
 * Glass Earth — the opening view.
 *
 * Where the map flies to when it opens. Precedence, strict:
 *   shared-view link > remembered last view > IP-located city > El Paso home base.
 * The shared link lives in lib/share-view and is handled by the page itself;
 * this module owns the other three rungs, the storage, and the validation.
 *
 * Privacy, by construction: the IP lookup is a city-level guess from the
 * connection (Vercel's geo headers on our host, an IP service only as a
 * fallback), no permission prompt, nothing about the visitor is stored on a
 * server. The last view lives only in the visitor's own localStorage and is
 * never sent anywhere.
 */

/** Home base: El Paso, TX — the fallback opening, and the Home control. */
export const HOME_BASE = { lat: 31.7619, lng: -106.485, zoom: 9 } as const;

/** Where the last view is remembered, in the visitor's own browser. */
export const LAST_VIEW_KEY = 'osiris:last-view';

/** A city-level guess at the visitor's location, from /api/geo. */
export interface GeoLocation {
  lat: number;
  lng: number;
  city?: string;
  country?: string;
}

/** The map view a visitor left behind, as stored. */
export interface LastView {
  lat: number;
  lng: number;
  zoom: number;
}

/** An opening flight target, and which rung of the precedence chose it. */
export interface OpeningTarget {
  lat: number;
  lng: number;
  zoom: number;
  source: 'last-view' | 'geo' | 'home';
}

const LAT_RANGE: [number, number] = [-90, 90];
const LNG_RANGE: [number, number] = [-180, 180];
/** Zoom the map can actually show; the writer never stores the globe view. */
const ZOOM_RANGE: [number, number] = [0.5, 22];

/**
 * A latitude/longitude pair is usable only if both numbers are finite, in
 * range, and not 0,0 — the null-island reading a failed lookup returns.
 * Accepts unknown because both the geo response and stored JSON are untrusted.
 */
export function isValidLatLon(lat: unknown, lon: unknown): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= LAT_RANGE[0] &&
    lat <= LAT_RANGE[1] &&
    lon >= LNG_RANGE[0] &&
    lon <= LNG_RANGE[1] &&
    !(lat === 0 && lon === 0)
  );
}

/**
 * Pull a location out of a /api/geo response. Anything malformed — a failed
 * lookup, a missing coordinate, a string where a number belongs, 0,0 — is
 * null, and the caller falls back to home base rather than flying somewhere
 * wrong. The response's `status` is checked first: the route answers
 * `{ status: 'fail' }` when it cannot place the visitor at all.
 */
export function parseGeoResponse(d: unknown): GeoLocation | null {
  if (!d || typeof d !== 'object') return null;
  const { lat, lon, city, country, status } = d as Record<string, unknown>;
  if (status === 'fail') return null;
  // The guard narrows lat; lon needs its own check (one predicate cannot narrow both).
  if (!isValidLatLon(lat, lon) || typeof lon !== 'number') return null;
  return {
    lat,
    lng: lon,
    ...(typeof city === 'string' && city ? { city } : {}),
    ...(typeof country === 'string' && country ? { country } : {}),
  };
}

/**
 * Read the remembered view. Garbage in storage — corrupt JSON, a coordinate
 * out of range, a missing zoom — degrades to "no last view", never to a
 * broken opening.
 */
export function readLastView(): LastView | null {
  try {
    const raw = localStorage.getItem(LAST_VIEW_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as unknown;
    if (!d || typeof d !== 'object') return null;
    const { lat, lng, zoom } = d as Record<string, unknown>;
    // The guard narrows lat; lng needs its own check (one predicate cannot narrow both).
    if (!isValidLatLon(lat, lng) || typeof lng !== 'number') return null;
    if (typeof zoom !== 'number' || !Number.isFinite(zoom) || zoom < ZOOM_RANGE[0] || zoom > ZOOM_RANGE[1]) return null;
    return { lat, lng, zoom };
  } catch {
    return null;
  }
}

/** Remember a settled view. Swallows storage failures (private mode). */
export function writeLastView(view: { lat: number; lng: number; zoom: number }): void {
  try {
    localStorage.setItem(LAST_VIEW_KEY, JSON.stringify({ ...view, savedAt: Date.now() }));
  } catch {
    /* private mode — the next visit simply opens by IP again */
  }
}

/**
 * Pick the opening target. A remembered view beats the IP guess (the visitor
 * chose to be there); the IP guess beats home base; home base is the
 * fallback when neither answers. The shared link is not a rung here — the
 * page cancels this whole flight when one is present.
 */
export function resolveOpeningTarget({
  lastView,
  geo,
}: {
  lastView?: LastView | null;
  geo?: GeoLocation | null;
}): OpeningTarget {
  if (lastView) return { lat: lastView.lat, lng: lastView.lng, zoom: lastView.zoom, source: 'last-view' };
  if (geo) return { lat: geo.lat, lng: geo.lng, zoom: HOME_BASE.zoom, source: 'geo' };
  return { lat: HOME_BASE.lat, lng: HOME_BASE.lng, zoom: HOME_BASE.zoom, source: 'home' };
}
