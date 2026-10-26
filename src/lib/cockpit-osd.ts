/**
 * Glass Earth — Cockpit OSD (the FPV rework's pure logic).
 *
 * The shipped cockpit put a panel over the bottom of the frame; the pilot
 * "could hardly see over the top of it". The rework moves everything the
 * ride shows into screen corners, the way a flight OSD sits in FPV
 * goggles. This module holds the derivations behind that chrome — heading
 * cardinals, the route geometry the map draws, the contacts chip's
 * collapse behaviour — framework-free so it can be tested without a DOM.
 */

import type { CockpitPose } from './cockpit';
import { haversineKm } from './cockpit';
import type { AircraftDetail } from '@/components/FlightWatchPanel';

/** Eight-point cardinal for a heading in degrees. */
const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

export function cardinalFor(headingDeg: number): string {
  const deg = ((headingDeg % 360) + 360) % 360;
  return CARDINALS[Math.round(deg / 45) % 8];
}

/** The route the map draws for the ridden aircraft. */
export interface CockpitRouteGeometry {
  /** The reported track so far, [lng, lat] pairs, oldest first. */
  track: [number, number][];
  /** Where the leg is going, when corroboration produced one. */
  destination: { lat: number; lng: number; label: string } | null;
}

export const EMPTY_ROUTE_GEOMETRY: CockpitRouteGeometry = { track: [], destination: null };

/**
 * The flown track the ride itself has observed, point by point.
 *
 * The drawn track used to come only from the adsb.lol trace files — and
 * when that lookup fails (it sits behind a bot-verification wall as of
 * 2026-10-26, so it fails for every aircraft) the ride drew nothing at
 * all, even though the live feed was reporting the aircraft's position
 * the whole time. So the ride also keeps its own trail: every position
 * the feed reports for the ridden aircraft while the ride is on, spaced
 * far enough apart to be a path rather than a pile of duplicates. It is
 * the aircraft's real reported positions — observed, never interpolated.
 */
export const OBSERVED_MIN_SPACING_KM = 0.4;
/** A ride is minutes-to-hours; this caps the trail at a long day's flying. */
export const OBSERVED_MAX_POINTS = 1000;

export function appendObservedPoint(
  track: [number, number][],
  point: [number, number],
  minSpacingKm: number = OBSERVED_MIN_SPACING_KM,
): [number, number][] {
  if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return track;
  const last = track[track.length - 1];
  if (last && haversineKm({ lat: last[1], lng: last[0] }, { lat: point[1], lng: point[0] }) < minSpacingKm) {
    return track;
  }
  const next = [...track, point];
  return next.length > OBSERVED_MAX_POINTS ? next.slice(next.length - OBSERVED_MAX_POINTS) : next;
}

/**
 * Which track to draw: the trace's, when it actually resolved (it covers
 * the leg from departure, denser than anything the ride can gather), and
 * the ride's own observed trail when it didn't. A one-point trace is no
 * line at all, so it never shadows the trail.
 */
export function pickRouteTrack(
  traceTrack: [number, number][],
  observed: [number, number][],
): [number, number][] {
  return traceTrack.length >= 2 ? traceTrack : observed;
}

/** The OSD's route line, derived from a resolved detail — or null when the
 *  data supports no route at all (neither endpoint known). The label state
 *  carries the same honesty as the watch panel: an observed arrival is
 *  'landed', an accepted destination is a schedule claim, and with only an
 *  origin there is nothing to claim. */
export interface RideRouteText {
  originLabel: string;
  destinationLabel: string;
  state: 'landed' | 'scheduled' | 'unknown';
}

export function rideRouteText(detail: AircraftDetail | null): RideRouteText | null {
  if (!detail || (!detail.origin && !detail.destination)) return null;
  return {
    originLabel: detail.origin ? detail.origin.iata || detail.origin.icao : '····',
    destinationLabel: detail.destination ? detail.destination.iata || detail.destination.icao : '····',
    state: detail.arrival ? 'landed' : detail.destination ? 'scheduled' : 'unknown',
  };
}

/**
 * Pull the drawable route out of a resolved aircraft detail: the reported
 * track (observed positions — the path actually flown) and the destination
 * the watch panel's corroboration logic accepted. A detail that hasn't
 * resolved, or resolved to nothing drawable, yields the empty geometry.
 */
export function routeGeometryFromDetail(detail: AircraftDetail | null): CockpitRouteGeometry {
  if (!detail) return EMPTY_ROUTE_GEOMETRY;
  const track = (detail.track || []).filter(
    (p): p is [number, number] =>
      Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]),
  );
  const d = detail.destination;
  const destination = d && Number.isFinite(d.lat) && Number.isFinite(d.lng)
    ? { lat: d.lat, lng: d.lng, label: d.iata || d.icao || '' }
    : null;
  return { track, destination };
}

export type CockpitRouteSeg = 'flown' | 'ahead' | 'dest';

export interface CockpitRouteFeature {
  type: 'Feature';
  properties: { seg: CockpitRouteSeg };
  geometry:
    | { type: 'LineString'; coordinates: [number, number][] }
    | { type: 'Point'; coordinates: [number, number] };
}

/**
 * The GeoJSON the follow loop writes to the route source each frame: the
 * flown track as a solid line, a dashed-intent line from the aircraft's
 * current (smoothed) pose to its destination — the route ahead, readable
 * in the pitched view — and a ring point on the destination itself. Any
 * piece the data doesn't support is simply absent.
 *
 * The flown line runs all the way to the pose: its final segment is the
 * dead reckoning from the last reported point to the position the ride
 * is presenting — the same reckoning the marker and the camera fly by,
 * capped like they are, so the segment can never stretch past what the
 * ride itself asserts. Ending the line at the last report instead left
 * it kilometres behind the nose on sparse coverage (and a one-point
 * track drew nothing at all), so the first minutes of a real ride showed
 * no trail even though the feed had been reporting all along — the
 * flown-line half of the 2026-10-26 gauntlet failure.
 */
export function routeLineFeatures(
  pose: CockpitPose | null,
  geometry: CockpitRouteGeometry,
): CockpitRouteFeature[] {
  const features: CockpitRouteFeature[] = [];
  const track = geometry.track;
  const last = track[track.length - 1];
  const flown: [number, number][] = pose && last && !(last[0] === pose.lng && last[1] === pose.lat)
    ? [...track, [pose.lng, pose.lat]]
    : track;
  if (flown.length >= 2) {
    features.push({
      type: 'Feature',
      properties: { seg: 'flown' },
      geometry: { type: 'LineString', coordinates: flown },
    });
  }
  if (pose && geometry.destination) {
    features.push({
      type: 'Feature',
      properties: { seg: 'ahead' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [pose.lng, pose.lat],
          [geometry.destination.lng, geometry.destination.lat],
        ],
      },
    });
    features.push({
      type: 'Feature',
      properties: { seg: 'dest' },
      geometry: {
        type: 'Point',
        coordinates: [geometry.destination.lng, geometry.destination.lat],
      },
    });
  }
  return features;
}

/** The right-edge chip the contacts roster collapses into. */
export function nearbyChipLabel(count: number): string {
  return `NEARBY · ${count}`;
}

export type ContactsPanelEvent = 'TOGGLE' | 'HOP' | 'TARGET';

/**
 * The roster's collapse behaviour: it starts shut (a chip, never a panel),
 * the chip toggles it, and hopping to a contact — or the ride changing
 * target any other way — shuts it again, so the list never lingers over
 * the view after it has done its job.
 */
export function contactsPanelReducer(open: boolean, event: ContactsPanelEvent): boolean {
  switch (event) {
    case 'TOGGLE':
      return !open;
    case 'HOP':
    case 'TARGET':
      return false;
    default:
      return open;
  }
}
