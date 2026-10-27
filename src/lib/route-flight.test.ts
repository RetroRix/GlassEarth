import { describe, it, expect } from 'vitest';
import {
  buildRoutePath,
  sampleRoute,
  flownCoords,
  routeFlightDurationMs,
  routeFlightZoom,
  turnToward,
  shortestTurnDeg,
  haversineLngLat,
  bearingLngLat,
  ROUTE_FLIGHT_MIN_MS,
  ROUTE_FLIGHT_MAX_MS,
} from './route-flight';

/* One degree of longitude on the equator ≈ 111.19 km — the fixture maths
   below leans on that so expected values are checkable by hand. */
const EAST_1DEG: [number, number][] = [[0, 0], [1, 0]];
const L_SHAPE: [number, number][] = [[0, 0], [1, 0], [1, 1]];

describe('haversineLngLat / bearingLngLat', () => {
  it('measures a degree of equatorial longitude', () => {
    expect(haversineLngLat([0, 0], [1, 0])).toBeCloseTo(111_195, -2);
  });

  it('bearings run clockwise from north', () => {
    expect(bearingLngLat([0, 0], [0, 1])).toBeCloseTo(0, 6); // north
    expect(bearingLngLat([0, 0], [1, 0])).toBeCloseTo(90, 6); // east
    expect(bearingLngLat([0, 0], [0, -1])).toBeCloseTo(180, 6); // south
    expect(bearingLngLat([0, 0], [-1, 0])).toBeCloseTo(270, 6); // west
  });
});

describe('buildRoutePath', () => {
  it('accumulates arc length across vertices', () => {
    const p = buildRoutePath(L_SHAPE);
    expect(p.cumulative[0]).toBe(0);
    expect(p.cumulative[1]).toBeCloseTo(111_195, -2);
    expect(p.total).toBeCloseTo(222_390, -2);
    expect(p.cumulative[2]).toBe(p.total);
  });

  it('drops non-finite vertices and tolerates empties', () => {
    expect(buildRoutePath([]).total).toBe(0);
    const p = buildRoutePath([[0, 0], [Number.NaN, 5], [1, 0]]);
    expect(p.coords).toHaveLength(2);
    expect(p.total).toBeCloseTo(111_195, -2);
  });
});

describe('sampleRoute', () => {
  const path = buildRoutePath(L_SHAPE);

  it('clamps to the ends', () => {
    const start = sampleRoute(path, -50)!;
    expect(start.lng).toBeCloseTo(0, 9);
    expect(start.lat).toBeCloseTo(0, 9);
    const end = sampleRoute(path, path.total + 50)!;
    expect(end.lng).toBeCloseTo(1, 9);
    expect(end.lat).toBeCloseTo(1, 9);
  });

  it('interpolates along a segment and reports its bearing', () => {
    const mid = sampleRoute(path, path.total / 4)!; // halfway along leg 1
    expect(mid.lng).toBeCloseTo(0.5, 6);
    expect(mid.lat).toBeCloseTo(0, 9);
    expect(mid.bearing).toBeCloseTo(90, 6);
    expect(mid.segment).toBe(0);
  });

  it('turns the corner onto the second leg', () => {
    const onLeg2 = sampleRoute(path, path.cumulative[1] + path.total / 4)!;
    expect(onLeg2.segment).toBe(1);
    expect(onLeg2.lng).toBeCloseTo(1, 9);
    expect(onLeg2.lat).toBeCloseTo(0.5, 6);
    expect(onLeg2.bearing).toBeCloseTo(0, 6); // heading north now
  });

  it('returns null for an empty path and a still pose for a single point', () => {
    expect(sampleRoute(buildRoutePath([]), 0)).toBeNull();
    const one = sampleRoute(buildRoutePath([[3, 4]]), 10)!;
    expect(one).toMatchObject({ lng: 3, lat: 4 });
  });
});

describe('flownCoords', () => {
  it('ends exactly at the sampled pose and includes passed vertices', () => {
    const path = buildRoutePath(L_SHAPE);
    const flown = flownCoords(path, path.cumulative[1] + 1000);
    expect(flown[0]).toEqual([0, 0]);
    expect(flown[1]).toEqual([1, 0]);
    const pose = sampleRoute(path, path.cumulative[1] + 1000)!;
    expect(flown[flown.length - 1]).toEqual([pose.lng, pose.lat]);
  });
});

describe('routeFlightDurationMs — the duration rule', () => {
  it('scales with length at the nominal speed', () => {
    // 60 km at 1,200 m/s = 50 s, inside the clamps.
    expect(routeFlightDurationMs(60_000)).toBe(50_000);
  });

  it('never runs shorter than the floor, even for a stroll', () => {
    expect(routeFlightDurationMs(800)).toBe(ROUTE_FLIGHT_MIN_MS);
    expect(routeFlightDurationMs(0)).toBe(ROUTE_FLIGHT_MIN_MS);
  });

  it('never runs longer than the cap, even cross-country', () => {
    expect(routeFlightDurationMs(900_000)).toBe(ROUTE_FLIGHT_MAX_MS);
  });
});

describe('routeFlightZoom', () => {
  it('steps down as routes lengthen', () => {
    expect(routeFlightZoom(1_500)).toBe(15);
    expect(routeFlightZoom(10_000)).toBe(14);
    expect(routeFlightZoom(40_000)).toBe(13);
    expect(routeFlightZoom(120_000)).toBe(11.5);
    expect(routeFlightZoom(800_000)).toBe(10);
  });
});

describe('turnToward', () => {
  it('takes the shortest way round, across north', () => {
    expect(shortestTurnDeg(350, 10)).toBe(20);
    expect(shortestTurnDeg(10, 350)).toBe(-20);
  });

  it('caps the step and lands exactly when within reach', () => {
    expect(turnToward(0, 90, 30)).toBe(30);
    expect(turnToward(350, 10, 30)).toBe(10);
    expect(turnToward(10, 350, 30)).toBe(350);
  });

  it('normalises into [0, 360)', () => {
    const v = turnToward(355, 90, 45);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(360);
  });
});

describe('fixture: a straight equatorial route', () => {
  it('samples its midpoint at half a degree east', () => {
    const p = buildRoutePath(EAST_1DEG);
    const mid = sampleRoute(p, p.total / 2)!;
    expect(mid.lng).toBeCloseTo(0.5, 6);
    expect(mid.bearing).toBeCloseTo(90, 6);
  });
});
