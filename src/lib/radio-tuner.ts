/**
 * Glass Earth — Radio Tuner dial logic (pure, unit-tested).
 *
 * The tuner is an analog radio dial stretched around the planet: the band
 * is every coordinate-bearing, browser-playable station in the Radio
 * Browser catalogue pool the API route serves (mode=tuner), ordered by
 * longitude — dragging the needle scans west → east, and wherever it
 * lands, the globe flies to the broadcaster and the station plays.
 *
 * Two honest filters shape the band:
 *  · No coordinates → not on the dial. The station stays playable in the
 *    Stations panel; a dial stop has to be somewhere the globe can fly.
 *  · Plain-http stream → not on the dial. On this https app the browser
 *    refuses mixed content outright, so such a stop could never play —
 *    it would only ever be an instant skip. The panel marks those
 *    "http only" instead of hiding them; the dial just doesn't stop there.
 */

import { isMixedContent, type RadioStation } from './stations';

/** A station with real coordinates — the only kind a dial stop can be. */
export interface DialStation extends RadioStation {
  lat: number;
  lng: number;
}

export function hasDialCoords(s: RadioStation): s is DialStation {
  return (
    typeof s.lat === 'number' && Number.isFinite(s.lat) && Math.abs(s.lat) <= 90 &&
    typeof s.lng === 'number' && Number.isFinite(s.lng) && Math.abs(s.lng) <= 180
  );
}

/**
 * Build the dial: coordinate-bearing, https-playable stations ordered by
 * longitude west → east. Ties (networks rebroadcast from one rooftop)
 * break by latitude, then name, then uuid, so the order is deterministic
 * and two stations at the same spot still get separate stops.
 */
export function buildDial(stations: RadioStation[]): DialStation[] {
  return stations
    .filter((s): s is DialStation => hasDialCoords(s) && !isMixedContent(s.url))
    .sort((a, b) =>
      a.lng - b.lng ||
      a.lat - b.lat ||
      a.name.localeCompare(b.name) ||
      a.uuid.localeCompare(b.uuid));
}

/** Wrap-around stepping for the prev/next controls and arrow keys. */
export function stepIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  return (((current + delta) % count) + count) % count;
}

/** Needle position for a dial index: 0 at the far west edge, 1 far east. */
export function fractionForIndex(index: number, count: number): number {
  if (count <= 1 || index < 0) return 0;
  return index / (count - 1);
}

/** The dial index nearest a needle fraction (a drag position). */
export function indexAtFraction(fraction: number, count: number): number {
  if (count <= 0) return -1;
  const f = Math.min(1, Math.max(0, fraction));
  return Math.round(f * (count - 1));
}

/** The longitude a needle fraction points at — the dial IS the equator. */
export function longitudeAtFraction(fraction: number): number {
  const f = Math.min(1, Math.max(0, fraction));
  return -180 + f * 360;
}

export function formatLongitude(lng: number): string {
  const rounded = Math.round(lng * 10) / 10;
  if (rounded === 0) return '0.0°';
  return `${Math.abs(rounded).toFixed(1)}° ${rounded < 0 ? 'W' : 'E'}`;
}

/**
 * Dead-stream skip: from the station that just failed, walk in `dir` to
 * the first index not already in `tried` (the set of indices that have
 * failed during this landing chain). -1 when the whole dial has failed —
 * the tuner then says so plainly instead of spinning forever.
 */
export function nextUntriedIndex(
  from: number,
  dir: 1 | -1,
  count: number,
  tried: ReadonlySet<number>,
): number {
  if (count <= 0) return -1;
  for (let step = 1; step <= count; step++) {
    const idx = stepIndex(from, dir * step, count);
    if (!tried.has(idx)) return idx;
  }
  return -1;
}
