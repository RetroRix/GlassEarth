import { describe, it, expect } from 'vitest';
import { mapIbi511Record, type Ibi511Record } from './ibi511';
import { CTDOT, fetchConnecticutCameras } from './connecticut';

/** A verbatim row from ctroads.org/List/GetData/Cameras (fields the mapper consumes). */
const sample: Ibi511Record = {
  id: 475,
  roadway: 'I-84 EB Waterbury W/O Exit 23 (Washington St)',
  direction: 'Eastbound',
  location: 'Cam 137 Waterbury I-84 EB W/O Exit 25 Hamilton Ave',
  city: 'Waterbury',
  county: null,
  latLng: { geography: { wellKnownText: 'POINT (-73.026686 41.5452)' } },
  images: [{
    imageUrl: '/map/Cctv/475',
    videoUrl: null,
    isVideoAuthRequired: true,
    blocked: false,
    disabled: false,
    videoDisabled: false,
  }],
};

describe('mapIbi511Record (Connecticut)', () => {
  it('maps a real CTDOT camera to its public snapshot (the feed publishes no playable video)', () => {
    expect(mapIbi511Record(sample, CTDOT)).toEqual({
      id: 'ctdot-475',
      lat: 41.5452,
      lng: -73.026686,
      name: 'Cam 137 Waterbury I-84 EB W/O Exit 25 Hamilton Ave',
      city: 'Waterbury',
      country: 'US',
      feed_url: 'https://ctroads.org/map/Cctv/475',
      source: 'CTDOT',
    });
  });

  it('drops blocked, disabled and imageless rows', () => {
    expect(mapIbi511Record({ ...sample, images: [{ ...sample.images![0], blocked: true }] }, CTDOT)).toBeNull();
    expect(mapIbi511Record({ ...sample, images: [{ ...sample.images![0], disabled: true }] }, CTDOT)).toBeNull();
    expect(mapIbi511Record({ ...sample, images: [] }, CTDOT)).toBeNull();
  });

  it('drops rows without usable coordinates, and any that land outside Connecticut', () => {
    expect(mapIbi511Record({ ...sample, latLng: null }, CTDOT)).toBeNull();
    expect(mapIbi511Record({ ...sample, latLng: { geography: { wellKnownText: null } } }, CTDOT)).toBeNull();
    expect(mapIbi511Record({ ...sample, latLng: { geography: { wellKnownText: 'POINT (0 0)' } } }, CTDOT)).toBeNull();
    // Springfield, Massachusetts — over the state line, so not ours to draw.
    expect(mapIbi511Record({ ...sample, latLng: { geography: { wellKnownText: 'POINT (-72.5898 42.1015)' } } }, CTDOT)).toBeNull();
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real CTroads endpoint).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchConnecticutCameras (live)', () => {
  liveIt('pages the whole state and returns well-formed cameras', async () => {
    const cams = await fetchConnecticutCameras();
    expect(cams.length).toBeGreaterThan(300);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.id).toMatch(/^ctdot-\d+$/);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('CTDOT');
      expect(cam.feed_url).toMatch(/^https:\/\/ctroads\.org\/map\/Cctv\/\d+$/);
      expect(cam.stream_url).toBeUndefined();
      expect(cam.lat).toBeGreaterThanOrEqual(40.95);
      expect(cam.lat).toBeLessThanOrEqual(42.05);
      expect(cam.lng).toBeGreaterThanOrEqual(-73.75);
      expect(cam.lng).toBeLessThanOrEqual(-71.75);
    }
  }, 120_000);
});
