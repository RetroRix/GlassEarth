import { describe, it, expect } from 'vitest';
import { fetchIllinoisCameras, mapFeature, type IdotFeature } from './illinois';

/** A verbatim feature from IDOT's TrafficCamerasTM_Public FeatureServer. */
const sample: IdotFeature = {
  attributes: {
    OBJECTID: 1,
    ImgPath: 'https://travelmidwest.com/showCamera?id=IL-IDOTD1-IK14B&direction=NONE',
    CameraLocation: 'Hillside Tower Camera 9',
    CameraDirection: 'NONE',
    y: 41.88597,
    x: -87.91483,
    SnapShot: 'https://cctv.travelmidwest.com/snapshots/IL-IDOTD1_1_Cook_WB_Albin_4188597_-8791483_2_NONE.jpg',
    WarningAge: 'false',
    TooOld: 'false',
    AgeInMinutes: '3',
  },
  geometry: { x: -87.91483, y: 41.88597 },
};

describe('mapFeature', () => {
  it('maps a camera view with its live snapshot and viewer page', () => {
    expect(mapFeature(sample)).toEqual({
      id: 'idot-1',
      lat: 41.88597,
      lng: -87.91483,
      name: 'Hillside Tower Camera 9',
      city: 'Illinois',
      country: 'US',
      feed_url: 'https://cctv.travelmidwest.com/snapshots/IL-IDOTD1_1_Cook_WB_Albin_4188597_-8791483_2_NONE.jpg',
      external_url: 'https://travelmidwest.com/showCamera?id=IL-IDOTD1-IK14B&direction=NONE',
      source: 'IDOT',
    });
  });

  it('reads coordinates from the attributes when the geometry is absent', () => {
    const cam = mapFeature({ attributes: sample.attributes });
    expect(cam?.lat).toBe(41.88597);
    expect(cam?.lng).toBe(-87.91483);
  });

  it('drops features without an id or a snapshot', () => {
    expect(mapFeature({ ...sample, attributes: { ...sample.attributes, OBJECTID: null } })).toBeNull();
    expect(mapFeature({ ...sample, attributes: { ...sample.attributes, SnapShot: null } })).toBeNull();
    expect(mapFeature({ ...sample, attributes: { ...sample.attributes, SnapShot: '  ' } })).toBeNull();
  });

  it('drops features without usable coordinates, and any outside Illinois', () => {
    expect(mapFeature({ attributes: { ...sample.attributes, x: null, y: null } })).toBeNull();
    // Gary, Indiana — over the state line.
    expect(mapFeature({ ...sample, geometry: { x: -87.34, y: 41.6 } })).toBeNull();
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real IDOT FeatureServer).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchIllinoisCameras (live)', () => {
  liveIt('pages the whole layer and returns well-formed cameras', async () => {
    const cams = await fetchIllinoisCameras();
    expect(cams.length).toBeGreaterThan(3000);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.id).toMatch(/^idot-\d+$/);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('IDOT');
      expect(cam.feed_url).toMatch(/^https:\/\/.+\.jpg$/);
      expect(cam.lat).toBeGreaterThanOrEqual(36.9);
      expect(cam.lat).toBeLessThanOrEqual(42.5);
      expect(cam.lng).toBeGreaterThanOrEqual(-91.6);
      expect(cam.lng).toBeLessThanOrEqual(-87.5);
    }
  }, 60_000);
});
