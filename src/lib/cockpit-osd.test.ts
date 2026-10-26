import { describe, it, expect } from 'vitest';
import {
  appendObservedPoint,
  cardinalFor,
  contactsPanelReducer,
  nearbyChipLabel,
  pickRouteTrack,
  rideRouteText,
  routeGeometryFromDetail,
  routeLineFeatures,
  EMPTY_ROUTE_GEOMETRY,
  OBSERVED_MAX_POINTS,
  type CockpitRouteGeometry,
} from './cockpit-osd';
import type { AircraftDetail } from '@/components/FlightWatchPanel';

const detail = (over: Partial<AircraftDetail> = {}): AircraftDetail => ({
  icao24: 'abc123',
  registration: 'N12345',
  typeCode: 'B738',
  model: 'Boeing 737-800',
  operator: 'Example Air',
  track: [[-106.4, 31.7], [-106.2, 31.8], [-106.0, 31.9]],
  points: 3,
  ...over,
});

describe('cardinalFor', () => {
  it('names the eight points of the compass', () => {
    expect(cardinalFor(0)).toBe('N');
    expect(cardinalFor(44)).toBe('NE');
    expect(cardinalFor(90)).toBe('E');
    expect(cardinalFor(135)).toBe('SE');
    expect(cardinalFor(180)).toBe('S');
    expect(cardinalFor(225)).toBe('SW');
    expect(cardinalFor(270)).toBe('W');
    expect(cardinalFor(304)).toBe('NW');
  });

  it('wraps north and tolerates negative headings', () => {
    expect(cardinalFor(359)).toBe('N');
    expect(cardinalFor(360)).toBe('N');
    expect(cardinalFor(-90)).toBe('W');
  });
});

describe('routeGeometryFromDetail', () => {
  it('an unresolved detail draws nothing', () => {
    expect(routeGeometryFromDetail(null)).toEqual(EMPTY_ROUTE_GEOMETRY);
  });

  it('carries the reported track and the corroborated destination', () => {
    const g = routeGeometryFromDetail(detail({
      destination: { icao: 'KDAL', iata: 'DAL', city: 'Dallas', lat: 32.847, lng: -96.852 },
    }));
    expect(g.track).toHaveLength(3);
    expect(g.destination).toEqual({ lat: 32.847, lng: -96.852, label: 'DAL' });
  });

  it('drops track points that are not real positions', () => {
    const g = routeGeometryFromDetail(detail({
      track: [[-106.4, 31.7], [Number.NaN, 31.8], [-106.0, 31.9]],
    }));
    expect(g.track).toEqual([[-106.4, 31.7], [-106.0, 31.9]]);
  });

  it('no destination survives without coordinates', () => {
    const g = routeGeometryFromDetail(detail({
      destination: { icao: 'KDAL', lat: Number.NaN, lng: -96.852 },
    }));
    expect(g.destination).toBeNull();
  });
});

describe('routeLineFeatures', () => {
  const pose = { lat: 31.9, lng: -106.0, bearingDeg: 80 };
  const geometry: CockpitRouteGeometry = {
    track: [[-106.4, 31.7], [-106.2, 31.8], [-106.0, 31.9]],
    destination: { lat: 32.847, lng: -96.852, label: 'DAL' },
  };

  it('empty geometry draws nothing', () => {
    expect(routeLineFeatures(pose, EMPTY_ROUTE_GEOMETRY)).toEqual([]);
    expect(routeLineFeatures(null, EMPTY_ROUTE_GEOMETRY)).toEqual([]);
  });

  it('the flown track is one solid segment behind the aircraft', () => {
    const features = routeLineFeatures(pose, { ...geometry, destination: null });
    expect(features).toHaveLength(1);
    expect(features[0].properties.seg).toBe('flown');
    expect(features[0].geometry).toEqual({ type: 'LineString', coordinates: geometry.track });
  });

  /* Round 2: the line runs to the pose, not just to the last report —
     the final segment is the ride's own dead reckoning. */
  it('extends the flown line from the last report to the current pose', () => {
    const ahead = { lat: 31.95, lng: -105.9, bearingDeg: 80 };
    const features = routeLineFeatures(ahead, { ...geometry, destination: null });
    expect(features[0].geometry).toEqual({
      type: 'LineString',
      coordinates: [...geometry.track, [-105.9, 31.95]],
    });
  });

  it('a single reported point still draws, once a pose exists to join it to', () => {
    // The sparse-coverage start of a ride: one fix so far. A one-point
    // line is nothing — but the fix-to-pose segment is a real trail.
    const features = routeLineFeatures(pose, {
      track: [[-106.4, 31.7]], destination: null,
    });
    expect(features).toHaveLength(1);
    expect(features[0].geometry).toEqual({
      type: 'LineString',
      coordinates: [[-106.4, 31.7], [-106.0, 31.9]],
    });
  });

  it('the route ahead runs from the current pose to the destination', () => {
    const features = routeLineFeatures(pose, geometry);
    const ahead = features.find((f) => f.properties.seg === 'ahead');
    expect(ahead?.geometry).toEqual({
      type: 'LineString',
      coordinates: [[-106.0, 31.9], [-96.852, 32.847]],
    });
    const dest = features.find((f) => f.properties.seg === 'dest');
    expect(dest?.geometry).toEqual({ type: 'Point', coordinates: [-96.852, 32.847] });
  });

  it('without a pose there is no ahead line, but the track still draws', () => {
    const features = routeLineFeatures(null, geometry);
    expect(features.map((f) => f.properties.seg)).toEqual(['flown']);
  });
});

describe('contactsPanelReducer — the roster collapse behaviour', () => {
  it('starts shut: a chip, never a panel', () => {
    // The component seeds the reducer with false; the reducer must never
    // open on its own — HOP and TARGET hold it shut from any state.
    expect(contactsPanelReducer(false, 'HOP')).toBe(false);
    expect(contactsPanelReducer(false, 'TARGET')).toBe(false);
  });

  it('the chip toggles the list', () => {
    expect(contactsPanelReducer(false, 'TOGGLE')).toBe(true);
    expect(contactsPanelReducer(true, 'TOGGLE')).toBe(false);
  });

  it('hopping to a contact collapses the list again', () => {
    expect(contactsPanelReducer(true, 'HOP')).toBe(false);
  });

  it('a new ride target collapses the list', () => {
    expect(contactsPanelReducer(true, 'TARGET')).toBe(false);
  });
});

describe('nearbyChipLabel', () => {
  it('counts the contacts on the chip', () => {
    expect(nearbyChipLabel(1)).toBe('NEARBY · 1');
    expect(nearbyChipLabel(7)).toBe('NEARBY · 7');
  });
});

/* ── The 2026-10-26 fix: the ride draws its own trail when the trace
   lookup yields nothing, and the OSD route text is derivable headlessly ── */

describe('appendObservedPoint', () => {
  const A: [number, number] = [-106.4, 31.7];
  const B: [number, number] = [-106.2, 31.8]; // ~21 km from A
  const nearA: [number, number] = [-106.399, 31.7]; // ~90 m from A

  it('starts the trail and appends moved positions', () => {
    expect(appendObservedPoint([], A)).toEqual([A]);
    expect(appendObservedPoint([A], B)).toEqual([A, B]);
  });

  it('ignores sub-spacing jitter and returns the same array (no re-render churn)', () => {
    const t = appendObservedPoint([], A);
    expect(appendObservedPoint(t, nearA)).toBe(t);
  });

  it('ignores non-finite positions', () => {
    const t = appendObservedPoint([], A);
    expect(appendObservedPoint(t, [Number.NaN, 31.7])).toBe(t);
  });

  it('caps the trail, dropping the oldest points', () => {
    let t: [number, number][] = [];
    for (let i = 0; i < OBSERVED_MAX_POINTS + 5; i++) {
      t = appendObservedPoint(t, [-106 + i * 0.01, 31.7], 0);
    }
    expect(t).toHaveLength(OBSERVED_MAX_POINTS);
    expect(t[0][0]).toBeCloseTo(-106 + 5 * 0.01, 6);
  });
});

describe('pickRouteTrack', () => {
  const trace: [number, number][] = [[-106.4, 31.7], [-106.2, 31.8]];
  const observed: [number, number][] = [[-106.3, 31.75], [-106.25, 31.77]];

  it('prefers a real trace', () => {
    expect(pickRouteTrack(trace, observed)).toBe(trace);
  });

  it('falls back to the observed trail when the trace is missing or a single point', () => {
    expect(pickRouteTrack([], observed)).toBe(observed);
    expect(pickRouteTrack([trace[0]], observed)).toBe(observed);
  });
});

describe('rideRouteText', () => {
  const DAL = { icao: 'KDAL', iata: 'DAL', city: 'Dallas', lat: 32.847, lng: -96.852 };
  const LGA = { icao: 'KLGA', iata: 'LGA', city: 'New York', lat: 40.777, lng: -73.874 };

  it('is null when nothing about the route is known', () => {
    expect(rideRouteText(null)).toBeNull();
    expect(rideRouteText(detail())).toBeNull();
  });

  it('shows the corroborated pair as a schedule claim', () => {
    expect(rideRouteText(detail({ origin: LGA, destination: DAL })))
      .toEqual({ originLabel: 'LGA', destinationLabel: 'DAL', state: 'scheduled' });
  });

  it('a destination without an observed origin reads ···· → DAL — the DAL835 shape', () => {
    expect(rideRouteText(detail({ origin: null, destination: DAL })))
      .toEqual({ originLabel: '····', destinationLabel: 'DAL', state: 'scheduled' });
  });

  it('an observed arrival makes it landed', () => {
    expect(rideRouteText(detail({ origin: LGA, destination: DAL, arrival: DAL }))?.state).toBe('landed');
  });

  it('an origin alone claims no destination', () => {
    expect(rideRouteText(detail({ origin: LGA })))
      .toEqual({ originLabel: 'LGA', destinationLabel: '····', state: 'unknown' });
  });
});
