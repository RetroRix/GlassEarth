import { describe, it, expect } from 'vitest';
import { mapIbi511Record, type Ibi511Record } from './ibi511';
import { WISDOT, fetchWisconsinCameras } from './wisconsin';

/** A verbatim row from www.511wi.gov/List/GetData/Cameras (fields the mapper consumes). */
const sample: Ibi511Record = {
  id: 1,
  roadway: 'I-39/US 51',
  direction: 'Unknown',
  location: 'I-39/US 51 at County B',
  county: 'Portage',
  city: null,
  latLng: { geography: { wellKnownText: 'POINT (-89.518702 44.454149)' } },
  images: [{
    imageUrl: '/map/Cctv/937',
    videoUrl: 'https://cctv1.dot.wi.gov/rtplive/CCTV-49-0011/playlist.m3u8',
    isVideoAuthRequired: false,
    videoDisabled: false,
    blocked: false,
    disabled: false,
  }],
};

describe('mapIbi511Record (Wisconsin)', () => {
  it('maps a real WisDOT camera with its open HLS stream', () => {
    expect(mapIbi511Record(sample, WISDOT)).toEqual({
      id: 'wisdot-1',
      lat: 44.454149,
      lng: -89.518702,
      name: 'I-39/US 51 at County B',
      city: 'Portage County',
      country: 'US',
      feed_url: 'https://www.511wi.gov/map/Cctv/937',
      stream_url: 'https://cctv1.dot.wi.gov/rtplive/CCTV-49-0011/playlist.m3u8',
      stream_type: 'hls',
      source: 'WisDOT',
    });
  });

  it('drops blocked, disabled and imageless rows', () => {
    expect(mapIbi511Record({ ...sample, images: [{ ...sample.images![0], blocked: true }] }, WISDOT)).toBeNull();
    expect(mapIbi511Record({ ...sample, images: [{ ...sample.images![0], disabled: true }] }, WISDOT)).toBeNull();
    expect(mapIbi511Record({ ...sample, images: [] }, WISDOT)).toBeNull();
  });

  it('drops rows without usable coordinates, and any that land outside Wisconsin', () => {
    expect(mapIbi511Record({ ...sample, latLng: null }, WISDOT)).toBeNull();
    expect(mapIbi511Record({ ...sample, latLng: { geography: { wellKnownText: null } } }, WISDOT)).toBeNull();
    expect(mapIbi511Record({ ...sample, latLng: { geography: { wellKnownText: 'POINT (0 0)' } } }, WISDOT)).toBeNull();
    // Chicago, Illinois — over the state line, so not ours to draw.
    expect(mapIbi511Record({ ...sample, latLng: { geography: { wellKnownText: 'POINT (-87.63 41.88)' } } }, WISDOT)).toBeNull();
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real 511WI endpoint).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchWisconsinCameras (live)', () => {
  liveIt('pages the whole state and returns well-formed cameras', async () => {
    const cams = await fetchWisconsinCameras();
    expect(cams.length).toBeGreaterThan(100);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.id).toMatch(/^wisdot-\d+$/);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('WisDOT');
      expect(cam.lat).toBeGreaterThanOrEqual(42.4);
      expect(cam.lat).toBeLessThanOrEqual(47.1);
      expect(cam.lng).toBeGreaterThanOrEqual(-92.9);
      expect(cam.lng).toBeLessThanOrEqual(-86.8);
      if (cam.stream_url) {
        expect(cam.stream_type).toBe('hls');
        expect(cam.stream_url).toMatch(/\.m3u8(\?|$)/);
      }
    }
  }, 120_000);
});
