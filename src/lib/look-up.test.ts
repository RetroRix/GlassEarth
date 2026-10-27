import { describe, it, expect } from 'vitest';
import {
  lookAngle, subsolarPoint, sunElevationDeg, isSunlit,
  findIssPasses, overheadSatellites, overheadAircraft,
  type Observer,
} from './look-up';
import { propagateTLE } from './orbit';

/**
 * Fixtures with known geometry. The ISS TLE is the same fixed element set
 * lib/orbit's tests use (epoch 2024-01-01), so propagation is deterministic
 * and every assertion below is reproducible offline.
 */
const ISS_1 = '1 25544U 98067A   24001.50000000  .00016717  00000-0  30777-3 0  9993';
const ISS_2 = '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49309239 43458';

const EL_PASO: Observer = { lat: 31.7619, lng: -106.485 };

describe('lookAngle', () => {
  it('puts a satellite directly overhead at ~90° and range ≈ its altitude', () => {
    const a = lookAngle(EL_PASO, { lat: EL_PASO.lat, lng: EL_PASO.lng, altKm: 420 });
    expect(a.elevationDeg).toBeGreaterThan(89);
    expect(a.rangeKm).toBeCloseTo(420, 0);
  });

  it('puts a satellite at the antipode far below the horizon', () => {
    const a = lookAngle(EL_PASO, { lat: -EL_PASO.lat, lng: EL_PASO.lng + 180, altKm: 420 });
    expect(a.elevationDeg).toBeLessThan(-80);
  });

  it('gives azimuth 90° for a satellite due east on the horizon line', () => {
    // On the equator an offset along the parallel IS due east. (At higher
    // latitudes it is not — meridian convergence bends the bearing north
    // of east, which is the lib being right, not wrong.) For a 420 km
    // satellite the geometric horizon sits at a central angle of
    // acos(Re/(Re+h)) ≈ 19.9°, with Re the equatorial radius the lib uses.
    const equator: Observer = { lat: 0, lng: 0 };
    const a = lookAngle(equator, { lat: 0, lng: 19.9, altKm: 420 });
    expect(a.azimuthDeg).toBeCloseTo(90, 0);
    expect(Math.abs(a.elevationDeg)).toBeLessThan(2);
  });

  it('gives azimuth 0° for a satellite due north', () => {
    const a = lookAngle(EL_PASO, { lat: EL_PASO.lat + 10, lng: EL_PASO.lng, altKm: 420 });
    expect(a.azimuthDeg).toBeCloseTo(0, 0);
    expect(a.elevationDeg).toBeGreaterThan(0);
  });
});

describe('the sun', () => {
  it('puts the declination near +23.4° at the June solstice and near 0 at the equinox', () => {
    const june = subsolarPoint(new Date('2024-06-20T12:00:00Z'));
    expect(june.lat).toBeGreaterThan(22.9);
    expect(june.lat).toBeLessThan(23.9);
    const march = subsolarPoint(new Date('2024-03-20T12:00:00Z'));
    expect(Math.abs(march.lat)).toBeLessThan(1);
  });

  it('has the sun up at local noon and down at local midnight', () => {
    // 19:00 UTC ≈ 12:00 MST in El Paso (UTC-7): the sun is high.
    expect(sunElevationDeg(EL_PASO, new Date('2024-06-20T19:00:00Z'))).toBeGreaterThan(40);
    // 07:00 UTC ≈ 00:00 MST: deep night.
    expect(sunElevationDeg(EL_PASO, new Date('2024-06-20T07:00:00Z'))).toBeLessThan(-20);
  });

  it('calls a satellite at the subsolar point sunlit and one at the anti-solar point eclipsed', () => {
    const when = new Date('2024-06-20T12:00:00Z');
    const sub = subsolarPoint(when);
    expect(isSunlit({ lat: sub.lat, lng: sub.lng, altKm: 420 }, when)).toBe(true);
    const antiLng = sub.lng <= 0 ? sub.lng + 180 : sub.lng - 180;
    expect(isSunlit({ lat: -sub.lat, lng: antiLng, altKm: 420 }, when)).toBe(false);
  });
});

describe('findIssPasses', () => {
  const from = new Date('2024-01-01T00:00:00Z');
  const passes = findIssPasses(ISS_1, ISS_2, EL_PASO, { from, count: 3, horizonHours: 72 });

  it('finds passes over El Paso within three days', () => {
    expect(passes.length).toBeGreaterThanOrEqual(1);
    expect(passes.length).toBeLessThanOrEqual(3);
  });

  it('returns them in order, each rise < peak < set, each a few minutes long', () => {
    for (let i = 0; i < passes.length; i++) {
      const p = passes[i];
      expect(p.riseAt.getTime()).toBeLessThan(p.peakAt.getTime());
      expect(p.peakAt.getTime()).toBeLessThan(p.setAt.getTime());
      const minutes = (p.setAt.getTime() - p.riseAt.getTime()) / 60_000;
      expect(minutes).toBeGreaterThan(2);
      expect(minutes).toBeLessThan(12);
      expect(p.peakElevationDeg).toBeGreaterThanOrEqual(10);
      if (i > 0) expect(p.riseAt.getTime()).toBeGreaterThan(passes[i - 1].setAt.getTime());
    }
  });

  it('agrees with a direct propagation at each peak', () => {
    for (const p of passes) {
      const pos = propagateTLE(ISS_1, ISS_2, p.peakAt)!;
      const a = lookAngle(EL_PASO, pos);
      expect(a.elevationDeg).toBeCloseTo(p.peakElevationDeg, 0);
    }
  });

  it('labels visibility by the stated geometry rule, recomputed independently', () => {
    for (const p of passes) {
      const pos = propagateTLE(ISS_1, ISS_2, p.peakAt)!;
      const expected = isSunlit(pos, p.peakAt) && sunElevationDeg(EL_PASO, p.peakAt) <= -6;
      expect(p.visible).toBe(expected);
    }
  });

  it('is deterministic for a fixed TLE and start', () => {
    const again = findIssPasses(ISS_1, ISS_2, EL_PASO, { from, count: 3, horizonHours: 72 });
    expect(again.map(p => p.riseAt.getTime())).toEqual(passes.map(p => p.riseAt.getTime()));
  });

  it('respects a higher peak threshold', () => {
    const high = findIssPasses(ISS_1, ISS_2, EL_PASO, { from, count: 3, horizonHours: 72, minPeakElevationDeg: 60 });
    for (const p of high) expect(p.peakElevationDeg).toBeGreaterThanOrEqual(60);
  });
});

describe('overheadSatellites', () => {
  it('keeps only what is above the horizon, highest first, with a sane range', () => {
    const rows = [
      { name: 'ANTIPODE', lat: -31.7619, lng: 73.515, alt: 420 },
      { name: 'OVERHEAD', lat: 31.7619, lng: -106.485, alt: 420 },
      { name: 'LOW EAST', lat: 31.7619, lng: -96.485, alt: 420 },
    ];
    const { above, totalAbove } = overheadSatellites(rows, EL_PASO);
    expect(totalAbove).toBe(2);
    expect(above[0].row.name).toBe('OVERHEAD');
    expect(above[0].rangeKm).toBeCloseTo(420, 0);
    expect(above[1].row.name).toBe('LOW EAST');
    expect(above[1].elevationDeg).toBeLessThan(above[0].elevationDeg);
  });

  it('skips rows with unusable coordinates rather than placing them', () => {
    const rows = [
      { name: 'BROKEN', lat: Number.NaN, lng: 0, alt: 420 },
      { name: 'OVERHEAD', lat: 31.7619, lng: -106.485, alt: 420 },
    ];
    const { totalAbove } = overheadSatellites(rows, EL_PASO);
    expect(totalAbove).toBe(1);
  });
});

describe('overheadAircraft', () => {
  it('keeps only aircraft inside the stated radius, nearest first', () => {
    const rows = [
      { callsign: 'FAR', icao24: 'aaaaaa', lat: 35.19, lng: -101.83, alt: 10000 },   // Amarillo, ~430 km
      { callsign: 'NEAR', icao24: 'bbbbbb', lat: 31.78, lng: -106.4, alt: 3000 },     // over El Paso
      { callsign: 'MID', icao24: 'cccccc', lat: 32.31, lng: -106.78, alt: 8000 },     // Las Cruces, ~66 km
    ];
    const { near, totalNear } = overheadAircraft(rows, EL_PASO, 100);
    expect(totalNear).toBe(2);
    expect(near.map(f => f.callsign)).toEqual(['NEAR', 'MID']);
    expect(near[0].distanceKm).toBeLessThan(10);
    expect(near[1].distanceKm).toBeGreaterThan(50);
    expect(near[1].distanceKm).toBeLessThan(100);
  });

  it('carries an unreported altitude as null, never as zero', () => {
    const rows = [{ callsign: 'QUIET', icao24: 'dddddd', lat: 31.78, lng: -106.4, alt: null }];
    const { near } = overheadAircraft(rows, EL_PASO, 100);
    expect(near[0].altMeters).toBeNull();
  });

  it('skips position-less and identity-less records', () => {
    const rows = [
      { callsign: 'NOPOS', icao24: 'eeeeee', lat: null, lng: null, alt: 100 },
      { callsign: 'NOID', lat: 31.78, lng: -106.4, alt: 100 },
      { callsign: 'OK', icao24: 'ffffff', lat: 31.78, lng: -106.4, alt: 100 },
    ];
    const { totalNear } = overheadAircraft(rows, EL_PASO, 100);
    expect(totalNear).toBe(1);
  });
});
