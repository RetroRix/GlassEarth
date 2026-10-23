import { describe, it, expect } from 'vitest';
import { fetchTennesseeCameras, mapRecord, type TdotCameraRecord } from './tennessee';

/** A verbatim row from TDOT's RoadwayCameras endpoint (Knoxville, I-40/75). */
const sample: TdotCameraRecord = {
  id: 3165,
  title: 'I-40/75 @ West Hills',
  description: 'I-40/75 @ West Hills',
  thumbnailUrl: 'https://tnsnapshots.com/thumbs/R1_010.flv.png',
  httpsVideoUrl: 'https://mcleansfs1.us-east-1.skyvdn.com/rtplive/R1_010/playlist.m3u8',
  active: 'true',
  jurisdiction: 'Knoxville',
  county: 'Knox',
  lat: 35.928889,
  lng: -84.039167,
};

describe('mapRecord', () => {
  it('maps an active SmartWay camera with poster frame and HLS', () => {
    expect(mapRecord(sample)).toEqual({
      id: 'tdot-3165',
      lat: 35.928889,
      lng: -84.039167,
      name: 'I-40/75 @ West Hills',
      city: 'Knoxville',
      country: 'US',
      feed_url: 'https://tnsnapshots.com/thumbs/R1_010.flv.png',
      stream_url: 'https://mcleansfs1.us-east-1.skyvdn.com/rtplive/R1_010/playlist.m3u8',
      stream_type: 'hls',
      source: 'TDOT',
    });
  });

  it('drops cameras SmartWay itself marks inactive', () => {
    expect(mapRecord({ ...sample, active: 'false' })).toBeNull();
    expect(mapRecord({ ...sample, active: null })).toBeNull();
  });

  it('drops rows without usable coordinates, and any that land outside Tennessee', () => {
    expect(mapRecord({ ...sample, lat: null })).toBeNull();
    // Huntsville — over the Alabama line, so not ours to draw.
    expect(mapRecord({ ...sample, lat: 34.7304, lng: -86.5861 })).toBeNull();
  });

  it('keeps the poster frame when the video URL is not a playlist', () => {
    const cam = mapRecord({ ...sample, httpsVideoUrl: 'rtmp://example.invalid/live' });
    expect(cam?.stream_url).toBeUndefined();
    expect(cam?.feed_url).toBe('https://tnsnapshots.com/thumbs/R1_010.flv.png');
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real TDOT API via SmartWay's public config).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchTennesseeCameras (live)', () => {
  liveIt('returns the statewide camera set, well-formed', async () => {
    const cams = await fetchTennesseeCameras();
    expect(cams.length).toBeGreaterThan(600);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.id).toMatch(/^tdot-\d+$/);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('TDOT');
      expect(cam.lat).toBeGreaterThanOrEqual(34.9);
      expect(cam.lat).toBeLessThanOrEqual(36.7);
      expect(cam.lng).toBeGreaterThanOrEqual(-90.3);
      expect(cam.lng).toBeLessThanOrEqual(-81.6);
      if (cam.stream_url) {
        expect(cam.stream_type).toBe('hls');
        expect(cam.stream_url).toMatch(/\.m3u8$/);
      }
    }
  }, 60_000);
});
