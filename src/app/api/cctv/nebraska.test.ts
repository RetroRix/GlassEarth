import { describe, it, expect } from 'vitest';
import { fetchNebraskaCameras, mapFeature, type NdotFeature } from './nebraska';

/** A live camera, verbatim from 511.nebraska.gov's MapFeatures response. */
const liveCamera: NdotFeature = {
  title: 'US 77: S of Cortland',
  uri: 'camera/512',
  features: [{ geometry: { type: 'Point', coordinates: [-96.73382, 40.46516] } }],
  __typename: 'Camera',
  active: true,
  views: [{ category: 'IMAGE', url: 'https://dot511.nebraska.gov/images/vid-001077037-03.jpg?1792771320000' }],
};

describe('mapFeature', () => {
  it('maps a live camera to its snapshot, cache-buster stripped', () => {
    expect(mapFeature(liveCamera)).toEqual({
      id: 'ndot-512',
      lat: 40.46516,
      lng: -96.73382,
      name: 'US 77: S of Cortland',
      city: 'Nebraska',
      country: 'US',
      feed_url: 'https://dot511.nebraska.gov/images/vid-001077037-03.jpg',
      external_url: 'https://511.nebraska.gov/@40.46516,-96.73382,14?show=camera%2F512',
      source: 'NDOT',
    });
  });

  /* One live row of the 340 publishes no view at all. Verbatim: */
  it('drops a camera with no views', () => {
    expect(mapFeature({
      title: 'NE 71: Hwy 71 & Hwy 2 Junction',
      uri: 'camera/638',
      features: [{ geometry: { type: 'Point', coordinates: [-103.30679, 42.32329] } }],
      __typename: 'Camera',
      active: true,
      views: [],
    })).toBeNull();
  });

  it('drops inactive cameras and non-camera features', () => {
    expect(mapFeature({ ...liveCamera, active: false })).toBeNull();
    expect(mapFeature({ ...liveCamera, __typename: 'Event' })).toBeNull();
  });

  it('drops coordinates outside Nebraska', () => {
    // Same record, moved to Des Moines.
    expect(mapFeature({
      ...liveCamera,
      features: [{ geometry: { type: 'Point', coordinates: [-93.6091, 41.5868] } }],
    })).toBeNull();
  });

  it('drops a record with no coordinates or no id', () => {
    expect(mapFeature({ ...liveCamera, features: [] })).toBeNull();
    expect(mapFeature({ ...liveCamera, uri: null })).toBeNull();
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real Nebraska 511 endpoint).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchNebraskaCameras (live)', () => {
  liveIt('queries the whole state and returns well-formed cameras', async () => {
    const cams = await fetchNebraskaCameras();
    expect(cams.length).toBeGreaterThan(300);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.id).toMatch(/^ndot-\d+$/);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('NDOT');
      expect(cam.lat).toBeGreaterThan(40.0);
      expect(cam.lat).toBeLessThan(43.0);
      expect(cam.lng).toBeGreaterThan(-104.1);
      expect(cam.lng).toBeLessThan(-95.3);
      expect(cam.feed_url || cam.stream_url).toBeTruthy();
      if (cam.feed_url) expect(cam.feed_url).not.toContain('?');
    }
  }, 60_000);
});
