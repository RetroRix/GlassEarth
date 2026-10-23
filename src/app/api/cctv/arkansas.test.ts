import { describe, it, expect } from 'vitest';
import { fetchArkansasCameras, mapFeature, type ArdotFeature } from './arkansas';

/** A verbatim feature from layers.idrivearkansas.com/cameras.geojson (Texarkana, I-30). */
const sample: ArdotFeature = {
  properties: {
    id: 457,
    status: 'online',
    name: 'I-30 @ Red River',
  },
  geometry: { type: 'Point', coordinates: [-93.815969, 33.605106] },
};

describe('mapFeature', () => {
  it('maps an online camera to its layers-host snapshot', () => {
    expect(mapFeature(sample)).toEqual({
      id: 'ardot-457',
      lat: 33.605106,
      lng: -93.815969,
      name: 'I-30 @ Red River',
      city: 'Arkansas',
      country: 'US',
      feed_url: 'https://layers.idrivearkansas.com/cameras/457.jpg',
      source: 'ARDOT',
    });
  });

  it('carries no stream — the HLS CDN requires a signed session the map cannot obtain', () => {
    expect(mapFeature(sample)?.stream_url).toBeUndefined();
  });

  it('drops cameras that are not online', () => {
    expect(mapFeature({ ...sample, properties: { ...sample.properties, status: 'disabled' } })).toBeNull();
    expect(mapFeature({ ...sample, properties: { ...sample.properties, status: 'offline' } })).toBeNull();
  });

  it('drops the Memphis, Tennessee bridge cameras — east of the state box', () => {
    expect(mapFeature({
      properties: { id: 1, status: 'online', name: 'I-40 at Danny Thomas Blvd.' },
      geometry: { type: 'Point', coordinates: [-90.042524, 35.151461] },
    })).toBeNull();
  });

  it('drops rows without usable geometry', () => {
    expect(mapFeature({ ...sample, geometry: null })).toBeNull();
    expect(mapFeature({ ...sample, geometry: { type: 'Point', coordinates: [0, 0] } })).toBeNull();
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real IDrive layers host).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchArkansasCameras (live)', () => {
  liveIt('returns the statewide online set, well-formed', async () => {
    const cams = await fetchArkansasCameras();
    expect(cams.length).toBeGreaterThan(450);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.id).toMatch(/^ardot-\d+$/);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('ARDOT');
      expect(cam.lat).toBeGreaterThanOrEqual(33.0);
      expect(cam.lat).toBeLessThanOrEqual(36.5);
      expect(cam.lng).toBeGreaterThanOrEqual(-94.6);
      expect(cam.lng).toBeLessThanOrEqual(-90.1);
      expect(cam.feed_url).toMatch(/^https:\/\/layers\.idrivearkansas\.com\/cameras\/\d+\.jpg$/);
      expect(cam.stream_url).toBeUndefined();
    }
  }, 60_000);
});
