import { describe, it, expect } from 'vitest';
import { mapIbi511Record, type Ibi511Record } from './ibi511';
import { AKDOT, fetchAlaskaCameras } from './alaska';

/**
 * A verbatim row from 511.alaska.gov/List/GetData/Cameras (fields the mapper
 * consumes). The real row carries eight images for its views; the mapper
 * uses the first, which is the one kept here.
 */
const sample: Ibi511Record = {
  id: 1,
  roadway: 'Seward Highway',
  direction: 'Northbound',
  location: 'Seward Highway MP 78.9 / Portage Glacier Road (#0)',
  county: null,
  city: null,
  latLng: { geography: { wellKnownText: 'POINT (-148.975515 60.818883)' } },
  images: [{
    description: 'N/A',
    imageUrl: '/map/Cctv/1',
    isVideoAuthRequired: false,
    videoDisabled: false,
    blocked: false,
    disabled: false,
  }],
};

describe('mapIbi511Record (Alaska)', () => {
  it('maps a real Alaska DOT camera to its snapshot (the feed publishes no video)', () => {
    expect(mapIbi511Record(sample, AKDOT)).toEqual({
      id: 'akdot-1',
      lat: 60.818883,
      lng: -148.975515,
      name: 'Seward Highway MP 78.9 / Portage Glacier Road (#0)',
      city: 'Alaska',
      country: 'US',
      feed_url: 'https://511.alaska.gov/map/Cctv/1',
      source: 'Alaska DOT',
    });
  });

  it('drops blocked, disabled and imageless rows', () => {
    expect(mapIbi511Record({ ...sample, images: [{ ...sample.images![0], blocked: true }] }, AKDOT)).toBeNull();
    expect(mapIbi511Record({ ...sample, images: [{ ...sample.images![0], disabled: true }] }, AKDOT)).toBeNull();
    expect(mapIbi511Record({ ...sample, images: [] }, AKDOT)).toBeNull();
  });

  it('drops rows without usable coordinates, and any that land outside Alaska', () => {
    expect(mapIbi511Record({ ...sample, latLng: null }, AKDOT)).toBeNull();
    expect(mapIbi511Record({ ...sample, latLng: { geography: { wellKnownText: null } } }, AKDOT)).toBeNull();
    expect(mapIbi511Record({ ...sample, latLng: { geography: { wellKnownText: 'POINT (0 0)' } } }, AKDOT)).toBeNull();
    // Seattle, Washington — well south of Alaska, so not ours to draw.
    expect(mapIbi511Record({ ...sample, latLng: { geography: { wellKnownText: 'POINT (-122.33 47.61)' } } }, AKDOT)).toBeNull();
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real Alaska 511 endpoint).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchAlaskaCameras (live)', () => {
  liveIt('pages the whole state and returns well-formed cameras', async () => {
    const cams = await fetchAlaskaCameras();
    expect(cams.length).toBeGreaterThan(50);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.id).toMatch(/^akdot-\d+$/);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('Alaska DOT');
      expect(cam.lat).toBeGreaterThanOrEqual(54.5);
      expect(cam.lat).toBeLessThanOrEqual(71.4);
      expect(cam.lng).toBeGreaterThanOrEqual(-170.0);
      expect(cam.lng).toBeLessThanOrEqual(-129.9);
    }
  }, 120_000);
});
