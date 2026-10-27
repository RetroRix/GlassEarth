import { describe, expect, it } from 'vitest';
import {
  findSharedFlight,
  findSharedShip,
  flightsSweepLanded,
  shipsSweepLanded,
  shareTargetLabel,
  shareTargetMissingMessage,
} from './share-target';

const data = {
  commercial_flights: [
    { icao24: 'a44f9c', callsign: 'UPS903', lat: 38.28, lng: -94.14, alt: 10676 },
    { icao24: 'a00b2d', callsign: 'ABX3106', lat: 42.87, lng: -76.28, alt: 11285 },
  ],
  private_flights: [],
  private_jets: [{ icao24: 'a9b8c7', callsign: 'EJA123', lat: 31.8, lng: -106.4 }],
  military_flights: [{ icao24: 'adf7c1', callsign: 'RCH123', lat: 50.1, lng: 8.6 }],
  maritime_ships: [
    { mmsi: 230123450, name: 'FINNSTAR', lat: 60.16, lng: 24.95 },
    { id: 211987650, name: 'NORDIC', lat: 59.9, lng: 10.7 },
  ],
};

describe('findSharedFlight', () => {
  it('finds the aircraft by hex in any bucket, with the bucket layer key', () => {
    expect(findSharedFlight(data, 'a44f9c')).toEqual({ lat: 38.28, lng: -94.14, label: 'UPS903', layerKey: 'flights' });
    expect(findSharedFlight(data, 'A9B8C7')).toEqual({ lat: 31.8, lng: -106.4, label: 'EJA123', layerKey: 'jets' });
    expect(findSharedFlight(data, 'adf7c1')?.layerKey).toBe('military');
  });

  it('matches identity only — a shared callsign never substitutes another aircraft', () => {
    // A second aircraft carrying a similar callsign is not the target.
    const other = { ...data, commercial_flights: [{ icao24: 'ffffff', callsign: 'UPS903', lat: 1, lng: 1 }] };
    expect(findSharedFlight(other, 'a44f9c')).toBeNull();
    expect(findSharedFlight(data, 'dead00')).toBeNull();
  });

  it('a record with no usable position is not a find', () => {
    const broken = { commercial_flights: [{ icao24: 'a44f9c', callsign: 'UPS903', lat: null, lng: -94.14 }] };
    expect(findSharedFlight(broken, 'a44f9c')).toBeNull();
    const offPlanet = { commercial_flights: [{ icao24: 'a44f9c', lat: 999, lng: 0 }] };
    expect(findSharedFlight(offPlanet, 'a44f9c')).toBeNull();
  });

  it('falls back to the hex as the label when the feed has no callsign', () => {
    const bare = { military_flights: [{ icao24: 'adf7c1', lat: 50.1, lng: 8.6 }] };
    expect(findSharedFlight(bare, 'adf7c1')?.label).toBe('ADF7C1');
  });

  it('tolerates empty and missing data', () => {
    expect(findSharedFlight(null, 'a44f9c')).toBeNull();
    expect(findSharedFlight(undefined, 'a44f9c')).toBeNull();
    expect(findSharedFlight({}, 'a44f9c')).toBeNull();
    expect(findSharedFlight(data, '')).toBeNull();
  });
});

describe('findSharedShip', () => {
  it('finds the vessel by MMSI, whether the record keys it mmsi or id', () => {
    expect(findSharedShip(data.maritime_ships, '230123450')).toEqual({ lat: 60.16, lng: 24.95, label: 'FINNSTAR', layerKey: 'maritime' });
    expect(findSharedShip(data.maritime_ships, '211987650')?.label).toBe('NORDIC');
  });

  it('returns null for a vessel the feed does not hold, and labels a nameless one by MMSI', () => {
    expect(findSharedShip(data.maritime_ships, '999999999')).toBeNull();
    expect(findSharedShip(null, '230123450')).toBeNull();
    const bare = [{ mmsi: 230123450, lat: 60.16, lng: 24.95 }];
    expect(findSharedShip(bare, '230123450')?.label).toBe('MMSI 230123450');
  });
});

describe('sweep detection + messages', () => {
  it('a sweep has landed when any relevant bucket is present, even empty', () => {
    expect(flightsSweepLanded(data)).toBe(true);
    expect(flightsSweepLanded({ commercial_flights: [] })).toBe(true);
    expect(flightsSweepLanded({})).toBe(false);
    expect(flightsSweepLanded(null)).toBe(false);
    expect(shipsSweepLanded(data)).toBe(true);
    expect(shipsSweepLanded({})).toBe(false);
  });

  it('labels and missing-messages use the link label, plainly worded', () => {
    expect(shareTargetLabel({ kind: 'flight', icao24: 'a44f9c', callsign: 'UPS903' })).toBe('UPS903');
    expect(shareTargetLabel({ kind: 'flight', icao24: 'a44f9c' })).toBe('A44F9C');
    expect(shareTargetLabel({ kind: 'ship', mmsi: '230123450' })).toBe('MMSI 230123450');
    expect(shareTargetMissingMessage({ kind: 'flight', icao24: 'a44f9c', callsign: 'UPS903' }))
      .toContain("That flight (UPS903) isn't being tracked right now");
    expect(shareTargetMissingMessage({ kind: 'ship', mmsi: '230123450', name: 'FINNSTAR' }))
      .toContain("That ship (FINNSTAR) isn't being tracked right now");
  });
});
