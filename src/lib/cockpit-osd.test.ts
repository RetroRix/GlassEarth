import { describe, it, expect } from 'vitest';
import {
  cardinalFor,
  contactsPanelReducer,
  nearbyChipLabel,
  routeGeometryFromDetail,
  routeLineFeatures,
  EMPTY_ROUTE_GEOMETRY,
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
