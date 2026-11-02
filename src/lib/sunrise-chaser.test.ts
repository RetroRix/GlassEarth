import { describe, it, expect } from 'vitest';
import { sunElevationDeg, sunriseCameras, sunriseState } from './sunrise-chaser';
import type { WallCamera } from './theater-wall';

// 2026-11-02 12:00 UTC: the app's solar model puts the subsolar longitude
// at 0°, so on the equator lng −90° sits exactly on the dawn terminator
// and lng +90° exactly on the dusk terminator — deterministic geometry
// from the model's own conventions.
const NOON_UTC = Date.UTC(2026, 10, 2, 12, 0, 0);

describe('sunElevationDeg', () => {
  it('is ~0 at the terminator, positive at the subsolar point, negative at the antipode', () => {
    expect(Math.abs(sunElevationDeg(0, -90, NOON_UTC))).toBeLessThan(0.6);
    expect(sunElevationDeg(0, 0, NOON_UTC)).toBeGreaterThan(60);
    expect(sunElevationDeg(0, 180, NOON_UTC)).toBeLessThan(-60);
  });
});

describe('sunriseState', () => {
  it('calls the dawn terminator rising and in band', () => {
    const s = sunriseState(0, -90, NOON_UTC);
    expect(s.rising).toBe(true);
    expect(s.inDawnBand).toBe(true);
    expect(s.minutesToSunrise).not.toBeNull();
    expect(Math.abs(s.minutesToSunrise!)).toBeLessThan(10);
  });

  it('calls the dusk terminator falling and out of band', () => {
    const s = sunriseState(0, 90, NOON_UTC);
    expect(s.rising).toBe(false);
    expect(s.inDawnBand).toBe(false);
  });

  it('leaves midday and midnight out of the band', () => {
    expect(sunriseState(0, 0, NOON_UTC).inDawnBand).toBe(false);
    expect(sunriseState(0, 180, NOON_UTC).inDawnBand).toBe(false);
  });
});

describe('sunriseCameras', () => {
  const cam = (id: string, lat: number, lng: number, over: Partial<WallCamera> = {}): WallCamera => ({
    id, lat, lng, name: id, source: 'test',
    feed_url: 'https://example.test/frame.jpg',
    ...over,
  } as WallCamera);

  it('keeps the dawn camera, drops dusk/midday/unplayable ones', () => {
    const out = sunriseCameras([
      cam('dawn', 0, -90),
      cam('dusk', 0, 90),
      cam('midday', 0, 0),
      cam('link-only', 0, -90, { feed_url: undefined, external_url: 'https://example.test' }),
    ], NOON_UTC);
    expect(out.map(c => c.cam.id)).toEqual(['dawn']);
  });

  it('orders closest-to-sunrise first', () => {
    const out = sunriseCameras([
      cam('rose-a-while-ago', 0, -86.5), // ~3.5° up: rose a few model-minutes ago
      cam('right-at-dawn', 0, -90),
    ], NOON_UTC);
    expect(out.map(c => c.cam.id)).toEqual(['right-at-dawn', 'rose-a-while-ago']);
  });
});
