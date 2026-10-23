import { describe, it, expect } from 'vitest';
import { fetchMassachusettsCameras, mapFeature, type MassCameraFeature } from './massachusetts';

/** A verbatim feature from the Mass511 GraphQL map query. */
const sample: MassCameraFeature = {
  title: 'I-90: I-90-WB-MM79.4-Charlton-@ MSP C10 West side',
  uri: 'camera/13312',
  features: [{ geometry: { coordinates: [-72.04124, 42.13533] } }],
  __typename: 'Camera',
  active: true,
  views: [{ category: 'VIDEO', url: 'https://public.carsprogram.org/cameras/MA/432525-fullJpeg.jpg' }],
};

describe('mapFeature', () => {
  it('maps a real MassDOT camera to its public JPEG', () => {
    expect(mapFeature(sample)).toEqual({
      id: 'massdot-13312',
      lat: 42.13533,
      lng: -72.04124,
      name: 'I-90: I-90-WB-MM79.4-Charlton-@ MSP C10 West side',
      city: 'Massachusetts',
      country: 'US',
      feed_url: 'https://public.carsprogram.org/cameras/MA/432525-fullJpeg.jpg',
      source: 'MassDOT',
    });
  });

  /* Verbatim IMAGE-category feature: its view URL carries the map's
     millisecond cache-buster, which is not part of the address. */
  it('strips the timestamp query some view URLs arrive with', () => {
    const cam = mapFeature({
      title: 'I-93: I-93-NB-MM19.4-Charlestown-before Ex 20',
      uri: 'camera/13366',
      features: [{ geometry: { coordinates: [-71.07661, 42.38059] } }],
      __typename: 'Camera',
      active: true,
      views: [{ category: 'IMAGE', url: 'https://public.carsprogram.org/cameras/MA/430708-fullJpeg.jpg?1792770960000' }],
    });
    expect(cam?.feed_url).toBe('https://public.carsprogram.org/cameras/MA/430708-fullJpeg.jpg');
  });

  it('drops inactive, non-camera and viewless features, and views that are not JPEGs', () => {
    expect(mapFeature({ ...sample, active: false })).toBeNull();
    expect(mapFeature({ ...sample, __typename: 'Event' })).toBeNull();
    expect(mapFeature({ ...sample, views: [] })).toBeNull();
    expect(mapFeature({ ...sample, views: [{ category: 'VIDEO', url: 'https://example.com/playlist.m3u8' }] })).toBeNull();
  });

  it('drops features without usable coordinates, and any that land outside Massachusetts', () => {
    expect(mapFeature({ ...sample, features: [] })).toBeNull();
    expect(mapFeature({ ...sample, features: [{ geometry: { coordinates: [0, 0] } }] })).toBeNull();
    // Burlington, Vermont — north of the state, so not ours to draw.
    expect(mapFeature({ ...sample, features: [{ geometry: { coordinates: [-73.2121, 44.4759] } }] })).toBeNull();
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real Mass511 endpoint).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchMassachusettsCameras (live)', () => {
  liveIt('returns the statewide MassDOT network as well-formed snapshot cameras', async () => {
    const cams = await fetchMassachusettsCameras();
    expect(cams.length).toBeGreaterThan(250);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.id).toMatch(/^massdot-\d+$/);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('MassDOT');
      expect(cam.feed_url).toMatch(/^https:\/\/public\.carsprogram\.org\/cameras\/MA\/\d+-fullJpeg\.jpg$/);
      expect(cam.lat).toBeGreaterThanOrEqual(41.2);
      expect(cam.lat).toBeLessThanOrEqual(42.9);
      expect(cam.lng).toBeGreaterThanOrEqual(-73.5);
      expect(cam.lng).toBeLessThanOrEqual(-69.9);
    }
  }, 60_000);
});
