import { describe, it, expect } from 'vitest';
import { mapIbi511Record, type Ibi511Record } from './ibi511';
import { ITD, fetchIdahoCameras } from './idaho';

/** A verbatim row from 511.idaho.gov/List/GetData/Cameras (fields the mapper consumes). */
const sample: Ibi511Record = {
  id: 16,
  roadway: 'I-84',
  direction: 'Westbound',
  location: 'D3 I-84 37.9 Garrity 538',
  county: null,
  city: null,
  latLng: { geography: { wellKnownText: 'POINT (-116.51544 43.599537)' } },
  images: [{
    description: 'D3 I-84 37.9 Garrity 538',
    imageUrl: '/map/Cctv/1051',
    isVideoAuthRequired: false,
    videoDisabled: false,
    blocked: false,
    disabled: false,
  }],
};

describe('mapIbi511Record (Idaho)', () => {
  it('maps a real ITD camera to its snapshot (the feed publishes no video)', () => {
    expect(mapIbi511Record(sample, ITD)).toEqual({
      id: 'itd-16',
      lat: 43.599537,
      lng: -116.51544,
      name: 'D3 I-84 37.9 Garrity 538',
      city: 'Idaho',
      country: 'US',
      feed_url: 'https://511.idaho.gov/map/Cctv/1051',
      source: 'ITD',
    });
  });

  it('drops blocked, disabled and imageless rows', () => {
    expect(mapIbi511Record({ ...sample, images: [{ ...sample.images![0], blocked: true }] }, ITD)).toBeNull();
    expect(mapIbi511Record({ ...sample, images: [{ ...sample.images![0], disabled: true }] }, ITD)).toBeNull();
    expect(mapIbi511Record({ ...sample, images: [] }, ITD)).toBeNull();
  });

  it('drops rows without usable coordinates, and any that land outside Idaho', () => {
    expect(mapIbi511Record({ ...sample, latLng: null }, ITD)).toBeNull();
    expect(mapIbi511Record({ ...sample, latLng: { geography: { wellKnownText: null } } }, ITD)).toBeNull();
    expect(mapIbi511Record({ ...sample, latLng: { geography: { wellKnownText: 'POINT (0 0)' } } }, ITD)).toBeNull();
    // Salt Lake City, Utah — over the state line, so not ours to draw.
    expect(mapIbi511Record({ ...sample, latLng: { geography: { wellKnownText: 'POINT (-111.89 40.76)' } } }, ITD)).toBeNull();
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real Idaho 511 endpoint).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchIdahoCameras (live)', () => {
  liveIt('pages the whole state and returns well-formed cameras', async () => {
    const cams = await fetchIdahoCameras();
    expect(cams.length).toBeGreaterThan(100);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.id).toMatch(/^itd-\d+$/);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('ITD');
      expect(cam.lat).toBeGreaterThanOrEqual(41.9);
      expect(cam.lat).toBeLessThanOrEqual(49.0);
      expect(cam.lng).toBeGreaterThanOrEqual(-117.3);
      expect(cam.lng).toBeLessThanOrEqual(-111.0);
    }
  }, 120_000);
});
