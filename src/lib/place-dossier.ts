/**
 * Glass Earth — Place Dossier (weekly pick, chosen by Rick 2026-11-23).
 *
 * One panel for one spot on the planet, assembled entirely from inputs
 * the app already owns — no new data plumbing anywhere:
 *   • nearest cameras from the page's loaded catalogue,
 *   • active weather events from /api/weather (the page's loaded rows),
 *   • aircraft overhead from the flight feed's buckets, via lib/look-up,
 *   • the next ISS pass from the Look Up! passes route (the SGP4 math
 *     stays server-side; this module never touches it),
 *   • local radio from the Listen to This Place route (mode=near),
 *   • recent earthquakes from /api/earthquakes (USGS M2.5+, last 24 h),
 *   • sunrise / sunset / dawn state from the app's own solar model —
 *     the same sunElevation that shades Live Clouds and that Sunrise
 *     Chaser rides (lib/live-clouds via lib/sunrise-chaser).
 *
 * This module is the pure half: selection, distance and solar math over
 * plain rows. The panel fetches and renders; every figure here is
 * computed from the row's own coordinates and times, and a row without
 * usable coordinates is skipped, never placed by guesswork. A section
 * whose feed failed is the panel's "unavailable" state — nothing in
 * here ever fabricates a zero to fill a gap.
 */

import { distanceKm, type QuakeLike } from './smart-alerts';
import { sunElevationDeg, sunriseState } from './sunrise-chaser';

/** The spot the dossier is about. */
export interface DossierPoint {
  lat: number;
  lng: number;
}

/* ── Cameras ────────────────────────────────────────────────────────── */

export const DOSSIER_CAMERA_RADIUS_KM = 250;
export const DOSSIER_CAMERA_LIMIT = 6;

/** A catalogue row, as loosely as the catalogue itself carries it. */
export interface DossierCameraLike {
  id?: string | number;
  name?: unknown;
  city?: unknown;
  country?: unknown;
  lat?: unknown;
  lng?: unknown;
  [key: string]: unknown;
}

export interface CameraNear {
  cam: DossierCameraLike;
  distanceKm: number;
}

export interface CameraProximity {
  /** The nearest cameras inside the radius, nearest first. */
  within: CameraNear[];
  /** How many catalogue cameras sit inside the radius in total. */
  totalWithin: number;
  /** The single nearest camera anywhere in the catalogue, or null when
      the catalogue holds no positioned camera at all. */
  nearest: CameraNear | null;
}

function rowCoords(row: { lat?: unknown; lng?: unknown }): { lat: number; lng: number } | null {
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/**
 * The catalogue around a point: everything inside the radius counted,
 * the nearest few listed, and — for the empty places — the nearest
 * camera there is, at its true distance, so the section can say how far
 * "nearby" really is instead of pretending there is none or inventing
 * one closer.
 */
export function cameraProximity(
  cameras: readonly DossierCameraLike[],
  point: DossierPoint,
  radiusKm: number = DOSSIER_CAMERA_RADIUS_KM,
  limit: number = DOSSIER_CAMERA_LIMIT,
): CameraProximity {
  let nearest: CameraNear | null = null;
  const within: CameraNear[] = [];
  for (const cam of cameras) {
    const coords = rowCoords(cam);
    if (!coords) continue;
    const d = distanceKm(point.lat, point.lng, coords.lat, coords.lng);
    if (!nearest || d < nearest.distanceKm) nearest = { cam, distanceKm: d };
    if (d <= radiusKm) within.push({ cam, distanceKm: d });
  }
  within.sort((a, b) => a.distanceKm - b.distanceKm);
  return { within: within.slice(0, limit), totalWithin: within.length, nearest };
}

/* ── Earthquakes ────────────────────────────────────────────────────── */

export const DOSSIER_QUAKE_RADIUS_KM = 500;
/** The feed's own window — /api/earthquakes is the USGS M2.5+ day feed. */
export const DOSSIER_QUAKE_WINDOW_MS = 24 * 60 * 60_000;
export const DOSSIER_QUAKE_LIMIT = 5;

export interface QuakeNear {
  quake: QuakeLike;
  distanceKm: number;
}

/**
 * Quakes near the point from the feed's last-24-hours window, newest
 * first. A quake with no magnitude, a future origin time, or broken
 * coordinates is a feed artefact, not an event — skipped, the way
 * Smart Alerts skips them.
 */
export function nearbyQuakes(
  quakes: readonly QuakeLike[],
  point: DossierPoint,
  now: number,
  radiusKm: number = DOSSIER_QUAKE_RADIUS_KM,
  limit: number = DOSSIER_QUAKE_LIMIT,
): { list: QuakeNear[]; total: number } {
  const found: QuakeNear[] = [];
  for (const q of quakes) {
    if (q.magnitude === null || !Number.isFinite(q.magnitude)) continue;
    if (!Number.isFinite(q.lat) || !Number.isFinite(q.lng) || !Number.isFinite(q.time)) continue;
    if (q.time > now || now - q.time > DOSSIER_QUAKE_WINDOW_MS) continue;
    const d = distanceKm(point.lat, point.lng, q.lat, q.lng);
    if (d > radiusKm) continue;
    found.push({ quake: q, distanceKm: d });
  }
  found.sort((a, b) => b.quake.time - a.quake.time);
  return { list: found.slice(0, limit), total: found.length };
}

/* ── Weather events ─────────────────────────────────────────────────── */

export const DOSSIER_WEATHER_RADIUS_KM = 250;
export const DOSSIER_WEATHER_LIMIT = 5;

/** An /api/weather event row (NASA EONET / NOAA-NWS / GDACS). */
export interface WeatherEventLike {
  id?: unknown;
  title?: unknown;
  category?: unknown;
  severity?: unknown;
  provider?: unknown;
  lat?: unknown;
  lng?: unknown;
  date?: unknown;
  expires?: unknown;
  [key: string]: unknown;
}

export interface WeatherNear {
  event: WeatherEventLike;
  distanceKm: number;
}

const SEVERITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

/**
 * Active weather events near the point, worst first, then nearest —
 * an alert's severity matters more than a few kilometres. Rows without
 * real coordinates can't be near anything and are skipped.
 */
export function nearbyWeatherEvents(
  events: readonly WeatherEventLike[],
  point: DossierPoint,
  radiusKm: number = DOSSIER_WEATHER_RADIUS_KM,
  limit: number = DOSSIER_WEATHER_LIMIT,
): { list: WeatherNear[]; total: number } {
  const found: WeatherNear[] = [];
  for (const event of events) {
    const coords = rowCoords(event);
    if (!coords) continue;
    const d = distanceKm(point.lat, point.lng, coords.lat, coords.lng);
    if (d > radiusKm) continue;
    found.push({ event, distanceKm: d });
  }
  const rank = (e: WeatherEventLike) => SEVERITY_RANK[String(e.severity ?? '')] ?? 0;
  found.sort((a, b) => rank(b.event) - rank(a.event) || a.distanceKm - b.distanceKm);
  return { list: found.slice(0, limit), total: found.length };
}

/* ── Sun ────────────────────────────────────────────────────────────── */

export type SunPhase = 'day' | 'dawn' | 'dusk' | 'night';

export interface SunEvents {
  /** The next sunrise after `now`, or null when the sun doesn't cross
      the horizon within the search horizon (polar day / night). */
  nextSunriseMs: number | null;
  /** The next sunset after `now`, same rule. */
  nextSunsetMs: number | null;
}

const SUN_SEARCH_STEP_MS = 4 * 60_000;
const SUN_SEARCH_HORIZON_MS = 48 * 60 * 60_000;

/**
 * The next sunrise and sunset at a place, found by walking the app's
 * own solar model forward and bisecting each horizon crossing to the
 * minute. Nothing is table-driven: if the model says the sun never
 * crosses (polar day/night), the answer is null and the panel says so.
 */
export function nextSunEvents(lat: number, lng: number, nowMs: number): SunEvents {
  let sunrise: number | null = null;
  let sunset: number | null = null;
  let prevT = nowMs;
  let prevElev = sunElevationDeg(lat, lng, prevT);
  const end = nowMs + SUN_SEARCH_HORIZON_MS;
  for (let t = nowMs + SUN_SEARCH_STEP_MS; t <= end && (sunrise === null || sunset === null); t += SUN_SEARCH_STEP_MS) {
    const elev = sunElevationDeg(lat, lng, t);
    if ((prevElev < 0 && elev >= 0) || (prevElev >= 0 && elev < 0)) {
      /* A crossing between prevT and t — bisect to ~30 s. */
      let lo = prevT;
      let hi = t;
      const rising = prevElev < 0;
      while (hi - lo > 30_000) {
        const mid = (lo + hi) / 2;
        const midElev = sunElevationDeg(lat, lng, mid);
        if ((midElev < 0) === rising) lo = mid; else hi = mid;
      }
      const at = Math.round((lo + hi) / 2);
      if (rising && sunrise === null) sunrise = at;
      if (!rising && sunset === null) sunset = at;
    }
    prevT = t;
    prevElev = elev;
  }
  return { nextSunriseMs: sunrise, nextSunsetMs: sunset };
}

export interface SolarSummary {
  /** Sun elevation right now, degrees (negative = below the horizon). */
  elevationDeg: number;
  /** The sun is climbing — the morning side of the terminator. */
  rising: boolean;
  phase: SunPhase;
  /** Inside Sunrise Chaser's dawn band (−2°…+6°, rising side). */
  inDawnBand: boolean;
  nextSunriseMs: number | null;
  nextSunsetMs: number | null;
}

/** Everything the dossier's Sun section shows, from the one solar model. */
export function solarSummary(lat: number, lng: number, nowMs: number): SolarSummary {
  const state = sunriseState(lat, lng, nowMs);
  const events = nextSunEvents(lat, lng, nowMs);
  const elev = state.elevationDeg;
  const phase: SunPhase = elev >= 0
    ? 'day'
    : elev > -6
      ? (state.rising ? 'dawn' : 'dusk')
      : 'night';
  return {
    elevationDeg: elev,
    rising: state.rising,
    phase,
    inDawnBand: state.inDawnBand,
    nextSunriseMs: events.nextSunriseMs,
    nextSunsetMs: events.nextSunsetMs,
  };
}

/* ── Naming + formatting ────────────────────────────────────────────── */

/** "31.7619° N, 106.4850° W" — the title when no real name exists. */
export function formatCoords(lat: number, lng: number): string {
  const la = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}`;
  const lo = `${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? 'E' : 'W'}`;
  return `${la}, ${lo}`;
}

/**
 * The dossier's title, in strict order of trust: the name the visitor
 * actually picked (a search result for this spot), then the app's own
 * reverse-geocode label for the coordinate, then the coordinates
 * themselves. A name is never composed, guessed or rounded up from a
 * nearby place the label didn't claim.
 */
export function dossierTitle(
  nameHint: string | null | undefined,
  reverseLabel: string | null | undefined,
  lat: number,
  lng: number,
): string {
  const hint = typeof nameHint === 'string' ? nameHint.trim() : '';
  if (hint) return hint;
  const label = typeof reverseLabel === 'string' ? reverseLabel.trim() : '';
  if (label) return label;
  return formatCoords(lat, lng);
}

/** Distances the way the app's other panels say them: "4.2 km", "37 km", "1,240 km". */
export function formatKm(km: number): string {
  if (!Number.isFinite(km)) return '—';
  if (km < 10) return `${km.toFixed(1)} km`;
  if (km < 1000) return `${Math.round(km)} km`;
  return `${Math.round(km).toLocaleString('en-US')} km`;
}
