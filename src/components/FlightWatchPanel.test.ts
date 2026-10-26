import { describe, it, expect } from 'vitest';
import {
  toFeet,
  formatAlt,
  greatCircleKm,
  onCorridor,
  resolveEndpoints,
  type Airport,
  type AircraftDetail,
} from './FlightWatchPanel';
import { rideRouteText } from '@/lib/cockpit-osd';

const ap = (icao: string, iata: string, lat: number, lng: number): Airport =>
  ({ icao, iata, lat, lng });

const CLT = ap('KCLT', 'CLT', 35.2140, -80.9431);
const DTW = ap('KDTW', 'DTW', 42.2124, -83.3534);
const FLL = ap('KFLL', 'FLL', 26.0742, -80.1506);
const MUC = ap('EDDM', 'MUC', 48.3538, 11.7861);
const SLC = ap('KSLC', 'SLC', 40.7884, -111.9778);
const CLE = ap('KCLE', 'CLE', 41.4117, -81.8498);

const detail = (over: Partial<AircraftDetail>): AircraftDetail => ({
  icao24: 'a0e250',
  registration: 'N123AA',
  typeCode: 'B738',
  model: 'BOEING 737-800',
  operator: 'American Airlines',
  track: [[-83.35, 42.21], [-81.5, 33.0]],
  points: 2,
  ...over,
});

describe('toFeet / formatAlt', () => {
  it('converts metres to feet, rounded to the nearest 25', () => {
    expect(toFeet(10000)).toBe(32800);
    expect(toFeet(1)).toBe(0);
  });

  it('says Ground rather than an altitude when the aircraft is on it', () => {
    expect(formatAlt(0, true)).toBe('Ground');
  });

  it('falls back for a missing or unusable altitude', () => {
    expect(formatAlt(undefined)).toBe('—');
    expect(formatAlt(NaN)).toBe('—');
  });
});

describe('greatCircleKm', () => {
  it('measures a known leg', () => {
    // DTW–FLL is about 1,800 km.
    expect(greatCircleKm([-83.3534, 42.2124], [-80.1506, 26.0742])).toBeGreaterThan(1750);
    expect(greatCircleKm([-83.3534, 42.2124], [-80.1506, 26.0742])).toBeLessThan(1870);
  });

  it('is zero for a point against itself', () => {
    expect(greatCircleKm([10, 50], [10, 50])).toBe(0);
  });
});

describe('onCorridor', () => {
  it('accepts an aircraft partway along the route', () => {
    expect(onCorridor([-81.7, 34.1], DTW, FLL)).toBe(true);
  });

  it('rejects one nowhere near it', () => {
    // Salt Lake City is not on the way from Cleveland to Detroit.
    expect(onCorridor([-111.98, 40.79], CLE, DTW)).toBe(false);
  });

  it('tolerates the vectoring that dominates a short hop', () => {
    // 60 km off a 150 km route is normal departure routing, not a wrong leg.
    expect(onCorridor([-82.6, 42.4], CLE, DTW)).toBe(true);
  });
});

describe('resolveEndpoints', () => {
  it('uses the observed departure as the origin, not the schedule', () => {
    const { origin } = resolveEndpoints(
      detail({ departure: DTW }),
      { found: true, origin: MUC, destination: CLT },
    );
    expect(origin?.iata).toBe('DTW');
  });

  it('takes the schedule destination when the schedule origin matches what was seen', () => {
    const { origin, destination } = resolveEndpoints(
      detail({ departure: DTW }),
      { found: true, origin: DTW, destination: FLL },
    );
    expect(origin?.iata).toBe('DTW');
    expect(destination?.iata).toBe('FLL');
  });

  // The failure the user saw: a dot thousands of km from the track, joined to
  // it by a straight line the aircraft never flew.
  it('drops the destination when the schedule describes a different leg', () => {
    const { origin, destination } = resolveEndpoints(
      detail({ departure: SLC }),
      { found: true, origin: CLE, destination: DTW },
    );
    expect(origin?.iata).toBe('SLC');
    expect(destination).toBeNull();
  });

  it('falls back to the corridor test when the departure was never seen', () => {
    const onRoute = resolveEndpoints(
      detail({ departure: null, track: [[-81.7, 34.1]] }),
      { found: true, origin: DTW, destination: FLL },
    );
    expect(onRoute.destination?.iata).toBe('FLL');

    const offRoute = resolveEndpoints(
      detail({ departure: null, track: [[-111.98, 40.79]] }),
      { found: true, origin: CLE, destination: DTW },
    );
    expect(offRoute.destination).toBeNull();
  });

  it('prefers the observed arrival over anything the schedule claims', () => {
    const { origin, destination } = resolveEndpoints(
      detail({ departure: DTW, arrival: CLT }),
      { found: true, origin: DTW, destination: FLL },
    );
    expect(origin?.iata).toBe('DTW');
    expect(destination?.iata).toBe('CLT');
  });

  it('reports nothing at all when there is no track and no schedule', () => {
    expect(resolveEndpoints(detail({ track: [], points: 0 }), null))
      .toEqual({ origin: null, destination: null });
  });

  it('ignores a schedule lookup that found nothing', () => {
    const { destination } = resolveEndpoints(
      detail({ departure: DTW }),
      { found: false, origin: DTW, destination: FLL },
    );
    expect(destination).toBeNull();
  });

  /* The 2026-10-26 failure: the trace lookup came back empty for every
     aircraft, so this used to return nothing no matter what the schedule
     said — the cockpit OSD showed no route for flights whose route was
     known. The live feed position stands in for the missing track. */
  it('corroborates the schedule from the live position when there is no track at all', () => {
    // DAL835's shape: LGA → RSW, last reported just off the Florida coast
    // on the LGA→RSW line — the schedule's destination is believed.
    const RSW = ap('KRSW', 'RSW', 26.5362, -81.7552);
    const LGA = ap('KLGA', 'LGA', 40.7769, -73.8740);
    const { origin, destination } = resolveEndpoints(
      detail({ track: [], points: 0, departure: null }),
      { found: true, origin: LGA, destination: RSW },
      [-81.9, 27.4],
    );
    expect(destination?.iata).toBe('RSW');
    // Round 2 (the CAV1478 "···· → YWG" gauntlet failure): the schedule
    // that was just believed about the destination also names the origin.
    // With nothing observed, its claim is the display origin — labelled
    // 'scheduled' downstream, exactly like the destination.
    expect(origin?.iata).toBe('LGA');
  });

  it('still rejects an uncorroborated schedule when the live position is off its corridor', () => {
    const { origin, destination } = resolveEndpoints(
      detail({ track: [], points: 0, departure: null }),
      { found: true, origin: CLE, destination: DTW },
      [-111.98, 40.79], // over Utah — nowhere near CLE→DTW
    );
    expect(origin).toBeNull();
    expect(destination).toBeNull();
  });

  it('without a live position either, an empty track still corroborates nothing', () => {
    const { destination } = resolveEndpoints(
      detail({ track: [], points: 0, departure: null }),
      { found: true, origin: DTW, destination: FLL },
      null,
    );
    expect(destination).toBeNull();
  });

  /* The 2026-10-26 gauntlet, exactly: CAV1478, Churchill → Winnipeg, no
     trace, no observed departure, live position mid-route. The OSD read
     "···· → YWG"; the schedule knew YYQ all along. Both ends now resolve,
     and the pair carries the schedule-claim label, not an observation's. */
  it('names both ends of a northern hop from its corroborated schedule (the CAV1478 shape)', () => {
    const YYQ = ap('CYYQ', 'YYQ', 58.74, -94.07);
    const YWG = ap('CYWG', 'YWG', 49.91, -97.24);
    const merged: AircraftDetail = {
      ...detail({ track: [], points: 0, departure: null }),
      ...resolveEndpoints(
        detail({ track: [], points: 0, departure: null }),
        { found: true, origin: YYQ, destination: YWG },
        [-95.6, 54.3],
      ),
    };
    expect(merged.origin?.iata).toBe('YYQ');
    expect(merged.destination?.iata).toBe('YWG');
    expect(rideRouteText(merged)).toEqual({
      originLabel: 'YYQ', destinationLabel: 'YWG', state: 'scheduled',
    });
  });
});
