import { describe, it, expect } from 'vitest';
import { mapIbi511Record, type Ibi511Record } from './ibi511';
import { PENNDOT, fetchPennsylvaniaCameras } from './pennsylvania';

/** A verbatim row from www.511pa.com/List/GetData/Cameras (fields the mapper consumes). */
const sample: Ibi511Record = {
  id: 4129,
  roadway: 'I-376',
  direction: 'Westbound',
  location: 'I-376 @ BUNKER HILL ROAD',
  county: 'Beaver',
  city: null,
  latLng: { geography: { wellKnownText: 'POINT (-80.31978 40.61313)' } },
  images: [{
    description: 'Traffic closest to camera is traveling Westbound',
    imageUrl: '/map/Cctv/6178',
    videoUrl: 'https://pa-se1.arcadis-ivds.com:8200/chan-4550/index.m3u8',
    isVideoAuthRequired: true,
    videoDisabled: false,
    blocked: false,
    disabled: false,
  }],
};

describe('mapIbi511Record (Pennsylvania)', () => {
  it('maps a real PennDOT camera to its public snapshot', () => {
    expect(mapIbi511Record(sample, PENNDOT)).toEqual({
      id: 'penndot-4129',
      lat: 40.61313,
      lng: -80.31978,
      name: 'I-376 @ BUNKER HILL ROAD',
      city: 'Beaver County',
      country: 'US',
      feed_url: 'https://www.511pa.com/map/Cctv/6178',
      source: 'PennDOT',
    });
  });

  /* Every sampled PennDOT row gates its playlist behind a session the map
     cannot obtain, so the config is snapshotOnly — even a row that stopped
     flagging itself gated must not hand the player a dead stream. */
  it('keeps the snapshot and drops the gated playlist', () => {
    const cam = mapIbi511Record(sample, PENNDOT);
    expect(cam?.stream_url).toBeUndefined();
    expect(cam?.stream_type).toBeUndefined();
    expect(cam?.feed_url).toBe('https://www.511pa.com/map/Cctv/6178');

    const unflagged = mapIbi511Record(
      { ...sample, images: [{ ...sample.images![0], isVideoAuthRequired: false }] },
      PENNDOT,
    );
    expect(unflagged?.stream_url).toBeUndefined();
    expect(unflagged?.feed_url).toBe('https://www.511pa.com/map/Cctv/6178');
  });

  it('drops blocked, disabled and imageless rows', () => {
    expect(mapIbi511Record({ ...sample, images: [{ ...sample.images![0], blocked: true }] }, PENNDOT)).toBeNull();
    expect(mapIbi511Record({ ...sample, images: [{ ...sample.images![0], disabled: true }] }, PENNDOT)).toBeNull();
    expect(mapIbi511Record({ ...sample, images: [] }, PENNDOT)).toBeNull();
  });

  it('drops rows without usable coordinates, and any that land outside Pennsylvania', () => {
    expect(mapIbi511Record({ ...sample, latLng: null }, PENNDOT)).toBeNull();
    expect(mapIbi511Record({ ...sample, latLng: { geography: { wellKnownText: null } } }, PENNDOT)).toBeNull();
    expect(mapIbi511Record({ ...sample, latLng: { geography: { wellKnownText: 'POINT (0 0)' } } }, PENNDOT)).toBeNull();
    // Columbus, Ohio — over the state line, so not ours to draw.
    expect(mapIbi511Record({ ...sample, latLng: { geography: { wellKnownText: 'POINT (-83.0 39.96)' } } }, PENNDOT)).toBeNull();
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real 511PA endpoint).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchPennsylvaniaCameras (live)', () => {
  liveIt('pages the whole state and returns well-formed cameras', async () => {
    const cams = await fetchPennsylvaniaCameras();
    expect(cams.length).toBeGreaterThan(100);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.id).toMatch(/^penndot-\d+$/);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('PennDOT');
      expect(cam.lat).toBeGreaterThanOrEqual(39.7);
      expect(cam.lat).toBeLessThanOrEqual(42.3);
      expect(cam.lng).toBeGreaterThanOrEqual(-80.6);
      expect(cam.lng).toBeLessThanOrEqual(-74.7);
    }
  }, 120_000);
});
