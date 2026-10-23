import { describe, it, expect } from 'vitest';
import { mapIbi511Record, type Ibi511Record } from './ibi511';
import { NE511, fetchNewEnglandCameras } from './newengland';

/** A verbatim row from newengland511.org/List/GetData/Cameras (fields the mapper consumes). */
const sample: Ibi511Record = {
  id: 622,
  roadway: 'I-189',
  direction: 'Westbound',
  location: 'I-189 SOUTH BURLINGTON',
  county: null,
  city: null,
  latLng: { geography: { wellKnownText: 'POINT (-73.199637 44.449335)' } },
  images: [{
    imageUrl: '/map/Cctv/1230',
    isVideoAuthRequired: false,
    videoDisabled: false,
    blocked: false,
    disabled: false,
  }],
};

describe('mapIbi511Record (New England)', () => {
  it('maps a real New England 511 camera to its snapshot (the feed publishes no video)', () => {
    expect(mapIbi511Record(sample, NE511)).toEqual({
      id: 'ne511-622',
      lat: 44.449335,
      lng: -73.199637,
      name: 'I-189 SOUTH BURLINGTON',
      city: 'New England',
      country: 'US',
      feed_url: 'https://newengland511.org/map/Cctv/1230',
      source: 'New England 511',
    });
  });

  it('drops blocked, disabled and imageless rows', () => {
    expect(mapIbi511Record({ ...sample, images: [{ ...sample.images![0], blocked: true }] }, NE511)).toBeNull();
    expect(mapIbi511Record({ ...sample, images: [{ ...sample.images![0], disabled: true }] }, NE511)).toBeNull();
    expect(mapIbi511Record({ ...sample, images: [] }, NE511)).toBeNull();
  });

  it('drops rows without usable coordinates, and any that land outside New England', () => {
    expect(mapIbi511Record({ ...sample, latLng: null }, NE511)).toBeNull();
    expect(mapIbi511Record({ ...sample, latLng: { geography: { wellKnownText: null } } }, NE511)).toBeNull();
    expect(mapIbi511Record({ ...sample, latLng: { geography: { wellKnownText: 'POINT (0 0)' } } }, NE511)).toBeNull();
    // Boston, Massachusetts — south of this deployment's three states, so not ours to draw.
    expect(mapIbi511Record({ ...sample, latLng: { geography: { wellKnownText: 'POINT (-71.06 42.36)' } } }, NE511)).toBeNull();
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real New England 511 endpoint).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchNewEnglandCameras (live)', () => {
  liveIt('pages Vermont, New Hampshire and Maine and returns well-formed cameras', async () => {
    const cams = await fetchNewEnglandCameras();
    expect(cams.length).toBeGreaterThan(50);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.id).toMatch(/^ne511-\d+$/);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('New England 511');
      expect(cam.lat).toBeGreaterThanOrEqual(42.7);
      expect(cam.lat).toBeLessThanOrEqual(47.5);
      expect(cam.lng).toBeGreaterThanOrEqual(-73.5);
      expect(cam.lng).toBeLessThanOrEqual(-66.9);
    }
  }, 120_000);
});
