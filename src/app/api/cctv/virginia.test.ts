import { describe, it, expect } from 'vitest';
import { fetchVirginiaCameras, mapRecord } from './virginia';
import type { IterisCameraFeature } from './iteris';

/** A verbatim row from 511.vdot.virginia.gov/services/511/map/array/cameras. */
const sample: IterisCameraFeature = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-77.3055, 38.84519] },
  properties: {
    image_url: 'https://snapshot.vdotcameras.com/thumbs/0i6a7bfbs60yq2lbgivq0b8xk3scij3c.flv.png',
    direction: '',
    preroll_url: 'https://media-sfs7.vdotcameras.com/preroll/0i6a7bfbs60yq2lbgivq0b8xk3scij3c/playlist.m3u8',
    id: '3958',
    name: '0i6a7bfbs60yq2lbgivq0b8xk3scij3c',
    jurisdiction: 'City of Fairfax',
    active: true,
    route: '',
    https_url: 'https://media-sfs7.vdotcameras.com/rtplive/0i6a7bfbs60yq2lbgivq0b8xk3scij3c/playlist.m3u8',
    problem_stream: false,
    description: 'University Drive and Sager Avenue',
  },
};

describe('mapRecord (Virginia)', () => {
  it('maps a camera with its snapshot and its rtplive stream — never the preroll', () => {
    expect(mapRecord(sample)).toEqual({
      id: 'vdot-3958',
      lat: 38.84519,
      lng: -77.3055,
      name: 'University Drive and Sager Avenue',
      city: 'City of Fairfax',
      country: 'US',
      feed_url: 'https://snapshot.vdotcameras.com/thumbs/0i6a7bfbs60yq2lbgivq0b8xk3scij3c.flv.png',
      stream_url: 'https://media-sfs7.vdotcameras.com/rtplive/0i6a7bfbs60yq2lbgivq0b8xk3scij3c/playlist.m3u8',
      stream_type: 'hls',
      source: 'VDOT',
    });
  });

  it('keeps the snapshot and drops the stream when the row flags its stream as broken', () => {
    const cam = mapRecord({
      ...sample,
      properties: { ...sample.properties, problem_stream: true },
    });
    expect(cam?.stream_url).toBeUndefined();
    expect(cam?.feed_url).toBe('https://snapshot.vdotcameras.com/thumbs/0i6a7bfbs60yq2lbgivq0b8xk3scij3c.flv.png');
  });

  it('drops inactive and unplaceable rows', () => {
    expect(mapRecord({ ...sample, properties: { ...sample.properties, active: false } })).toBeNull();
    expect(mapRecord({ ...sample, geometry: null })).toBeNull();
    expect(mapRecord({ ...sample, properties: { ...sample.properties, id: '' } })).toBeNull();
  });

  /* A real published row: I-66 @ VA-243 S, Fairfax — with the longitude's
     sign flipped in the source, which would put it in the Atlantic. */
  it('drops the sign-flipped I-66 row VDOT publishes', () => {
    const flipped: IterisCameraFeature = {
      type: 'Feature',
      geometry: { coordinates: [77.266727, 38.880113], type: 'Point' },
      properties: {
        id: '3656',
        name: 'NOVACCTVI66F00007VA243S',
        description: 'I66 @ VA-243 S',
        jurisdiction: 'Fairfax',
        route: 'I-66',
        image_url: 'https://snapshot.vdotcameras.com/thumbs/NOVACCTVI66F00007VA243S.flv.png',
        https_url: 'https://media-sfs8.vdotcameras.com/rtplive/NOVACCTVI66F00007VA243S/playlist.m3u8',
        active: true,
        problem_stream: false,
      },
    };
    expect(mapRecord(flipped)).toBeNull();
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real VDOT endpoint).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchVirginiaCameras (live)', () => {
  liveIt('returns the statewide array as well-formed cameras', async () => {
    const cams = await fetchVirginiaCameras();
    expect(cams.length).toBeGreaterThan(1500);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      // Most ids are numeric; ~100 cameras from a merged system carry hex ids.
      expect(cam.id).toMatch(/^vdot-[0-9a-z]+$/i);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('VDOT');
      expect(cam.lat).toBeGreaterThanOrEqual(36.5);
      expect(cam.lat).toBeLessThanOrEqual(39.5);
      expect(cam.lng).toBeGreaterThanOrEqual(-83.7);
      expect(cam.lng).toBeLessThanOrEqual(-75.2);
      if (cam.stream_url) {
        expect(cam.stream_type).toBe('hls');
        expect(cam.stream_url).toMatch(/\.m3u8$/);
        expect(cam.stream_url).not.toContain('/preroll/');
      }
    }
  }, 60_000);
});
