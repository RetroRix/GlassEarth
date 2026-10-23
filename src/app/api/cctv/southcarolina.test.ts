import { describe, it, expect } from 'vitest';
import { fetchSouthCarolinaCameras, mapRecord } from './southcarolina';
import type { IterisCameraFeature } from './iteris';

/** A verbatim feature from sc.cdn.iteris-atis.com/geojson/icons/metadata/icons.cameras.geojson. */
const sample: IterisCameraFeature = {
  type: 'Feature',
  geometry: { coordinates: [-79.062775, 33.845627], type: 'Point' },
  properties: {
    id: 'e71ff390-d2a0-11e6-8996-0123456789ab',
    name: '50001',
    description: 'US 501 N @ 16th Ave',
    route: 'US 501',
    jurisdiction: 'Myrtle Beach',
    image_url: 'https://scdotsnap.us-east-1.skyvdn.com/thumbs/50001.flv.png',
    https_url: 'https://s18.us-east-1.skyvdn.com/rtplive/50001/playlist.m3u8',
    active: true,
    problem_stream: false,
  },
};

describe('mapRecord (South Carolina)', () => {
  it('keys the camera by its camera number, not the bare UUID in id', () => {
    expect(mapRecord(sample)).toEqual({
      id: 'scdot-50001',
      lat: 33.845627,
      lng: -79.062775,
      name: 'US 501 N @ 16th Ave',
      city: 'Myrtle Beach',
      country: 'US',
      feed_url: 'https://scdotsnap.us-east-1.skyvdn.com/thumbs/50001.flv.png',
      stream_url: 'https://s18.us-east-1.skyvdn.com/rtplive/50001/playlist.m3u8',
      stream_type: 'hls',
      source: 'SCDOT',
    });
  });

  it('keeps the snapshot and drops the stream when the row flags its stream as broken', () => {
    const cam = mapRecord({
      ...sample,
      properties: { ...sample.properties, problem_stream: true },
    });
    expect(cam?.stream_url).toBeUndefined();
    expect(cam?.feed_url).toBe('https://scdotsnap.us-east-1.skyvdn.com/thumbs/50001.flv.png');
  });

  it('drops inactive, numberless and out-of-state rows', () => {
    expect(mapRecord({ ...sample, properties: { ...sample.properties, active: false } })).toBeNull();
    expect(mapRecord({ ...sample, properties: { ...sample.properties, name: '' } })).toBeNull();
    expect(mapRecord({ ...sample, geometry: null })).toBeNull();
    // Charlotte, NC — over the state line, so not ours to draw.
    expect(mapRecord({ ...sample, geometry: { coordinates: [-80.84, 35.22], type: 'Point' } })).toBeNull();
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real Iteris CDN file).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchSouthCarolinaCameras (live)', () => {
  liveIt('returns the statewide file as well-formed cameras', async () => {
    const cams = await fetchSouthCarolinaCameras();
    expect(cams.length).toBeGreaterThan(700);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.id).toMatch(/^scdot-.+$/);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('SCDOT');
      expect(cam.lat).toBeGreaterThanOrEqual(32.0);
      expect(cam.lat).toBeLessThanOrEqual(35.2);
      expect(cam.lng).toBeGreaterThanOrEqual(-83.4);
      expect(cam.lng).toBeLessThanOrEqual(-78.5);
      if (cam.stream_url) {
        expect(cam.stream_type).toBe('hls');
        expect(cam.stream_url).toMatch(/\.m3u8$/);
        expect(cam.stream_url).not.toContain('/preroll/');
      }
    }
  }, 60_000);
});
