import { describe, it, expect } from 'vitest';
import { fetchSouthDakotaCameras, mapFeature, type SddotFeature } from './southdakota';

/** A live site, verbatim from icons.cameras.geojson (views trimmed to two). */
const liveSite: SddotFeature = {
  id: 'CSDATY',
  geometry: { type: 'Point', coordinates: [-97.06, 44.95] },
  properties: {
    mrm: '179',
    route: 'I-29',
    name: 'Watertown North',
    cameras: [
      {
        description: 'Watertown-north of town along I-29 @ MP 179 looking south',
        image: 'https://sd.cdn.iteris-atis.com/camera_images/CSDATY/1/latest.jpg',
        name: 'Camera Looking South',
        updateTime: 1792770879,
        id: '1',
      },
      {
        image: 'https://sd.cdn.iteris-atis.com/camera_images/CSDATY/0/latest.jpg',
        description: 'Watertown-north of town along I-29 @ MP 179 looking north',
        id: '0',
        updateTime: 1792770834,
        name: 'Camera Looking North',
      },
    ],
  },
};

describe('mapFeature', () => {
  it('maps each published view of a site to its own camera', () => {
    expect(mapFeature(liveSite)).toEqual([
      {
        id: 'sddot-CSDATY-1',
        lat: 44.95,
        lng: -97.06,
        name: 'Watertown-north of town along I-29 @ MP 179 looking south',
        city: 'Watertown North',
        country: 'US',
        feed_url: 'https://sd.cdn.iteris-atis.com/camera_images/CSDATY/1/latest.jpg',
        source: 'SDDOT',
      },
      {
        id: 'sddot-CSDATY-0',
        lat: 44.95,
        lng: -97.06,
        name: 'Watertown-north of town along I-29 @ MP 179 looking north',
        city: 'Watertown North',
        country: 'US',
        feed_url: 'https://sd.cdn.iteris-atis.com/camera_images/CSDATY/0/latest.jpg',
        source: 'SDDOT',
      },
    ]);
  });

  it('falls back to site and view names when a view has no description', () => {
    const cams = mapFeature({
      ...liveSite,
      properties: {
        ...liveSite.properties,
        cameras: [{ id: '4', name: 'Road Surface View', image: 'https://sd.cdn.iteris-atis.com/camera_images/CSDATY/4/latest.jpg', description: null }],
      },
    });
    expect(cams[0].name).toBe('Watertown North — Road Surface View');
  });

  it('drops views without an image, and sites without views', () => {
    expect(mapFeature({
      ...liveSite,
      properties: { ...liveSite.properties, cameras: [{ id: '9', name: 'X', image: null }] },
    })).toEqual([]);
    expect(mapFeature({ ...liveSite, properties: { ...liveSite.properties, cameras: [] } })).toEqual([]);
  });

  it('drops coordinates outside South Dakota', () => {
    // Same site, moved to Sioux City, Iowa.
    expect(mapFeature({ ...liveSite, geometry: { type: 'Point', coordinates: [-96.4, 42.49] } })).toEqual([]);
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real SD511 GeoJSON).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchSouthDakotaCameras (live)', () => {
  liveIt('returns every published view, well-formed', async () => {
    const cams = await fetchSouthDakotaCameras();
    expect(cams.length).toBeGreaterThan(150);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.id).toMatch(/^sddot-[A-Z0-9]+-\d+$/);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('SDDOT');
      expect(cam.lat).toBeGreaterThan(42.5);
      expect(cam.lat).toBeLessThan(45.9);
      expect(cam.lng).toBeGreaterThan(-104.1);
      expect(cam.lng).toBeLessThan(-96.4);
      expect(cam.feed_url).toMatch(/^https:\/\/sd\.cdn\.iteris-atis\.com\/camera_images\//);
    }
  }, 60_000);
});
