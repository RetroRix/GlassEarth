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
 */
export function routeLineFeatures(
  pose: CockpitPose | null,
  geometry: CockpitRouteGeometry,
): CockpitRouteFeature[] {
  const features: CockpitRouteFeature[] = [];
  if (geometry.track.length >= 2) {
    features.push({
      type: 'Feature',
      properties: { seg: 'flown' },
      geometry: { type: 'LineString', coordinates: geometry.track },
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
