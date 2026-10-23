import { describe, it, expect } from 'vitest';
import { fetchNewMexicoCameras, mapRecord, slugify, type NmdotCameraRecord } from './newmexico';

/** A live camera, verbatim from servicev5.nmroads.com/RealMapWAR/GetCameraInfo. */
const liveCamera: NmdotCameraRecord = {
  name: 'I-25@La_Bajada_Lower',
  title: 'I-25 @ Lower La Bajada',
  lat: 35.506001,
  lon: -106.244,
  grouping: 'Santa Fe Area',
  snapshotFile: 'http://ss.nmroads.com/snapshots/i25_lowerlabajada.jpg',
  enabled: true,
};

describe('mapRecord', () => {
  it('maps a live camera to its snapshot', () => {
    expect(mapRecord(liveCamera)).toEqual({
      id: 'nmdot-i-25-la-bajada-lower',
      lat: 35.506001,
      lng: -106.244,
      name: 'I-25 @ Lower La Bajada',
      city: 'Santa Fe Area',
      country: 'US',
      feed_url: 'http://ss.nmroads.com/snapshots/i25_lowerlabajada.jpg',
      source: 'NMDOT',
    });
  });

  it('falls back to the state when there is no grouping, and to the raw name when there is no title', () => {
    expect(mapRecord({ ...liveCamera, grouping: null })?.city).toBe('New Mexico');
    expect(mapRecord({ ...liveCamera, title: null })?.name).toBe('I-25@La_Bajada_Lower');
  });

  it('drops disabled cameras and cameras without a snapshot', () => {
    expect(mapRecord({ ...liveCamera, enabled: false })).toBeNull();
    expect(mapRecord({ ...liveCamera, snapshotFile: null })).toBeNull();
    expect(mapRecord({ ...liveCamera, snapshotFile: '  ' })).toBeNull();
  });

  it('drops rows without usable coordinates, and any that land outside New Mexico', () => {
    expect(mapRecord({ ...liveCamera, lat: null })).toBeNull();
    // Lubbock — over the Texas line, so not ours to draw.
    expect(mapRecord({ ...liveCamera, lat: 33.58, lon: -101.85 })).toBeNull();
  });
});

describe('slugify', () => {
  it('turns the feed-internal camera name into an id slug', () => {
    expect(slugify('I-25@La_Bajada_Lower')).toBe('i-25-la-bajada-lower');
    expect(slugify('US-550@Aztec')).toBe('us-550-aztec');
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real NMRoads endpoint).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchNewMexicoCameras (live)', () => {
  liveIt('returns the whole state, well-formed', async () => {
    const cams = await fetchNewMexicoCameras();
    expect(cams.length).toBeGreaterThan(150);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.id).toMatch(/^nmdot-/);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('NMDOT');
      expect(cam.lat).toBeGreaterThan(31.3);
      expect(cam.lat).toBeLessThan(37.0);
      expect(cam.lng).toBeGreaterThan(-109.1);
      expect(cam.lng).toBeLessThan(-103.0);
      expect(cam.feed_url).toMatch(/^http:\/\/ss\.nmroads\.com\/snapshots\/.+\.jpg$/);
    }
  }, 60_000);
});
