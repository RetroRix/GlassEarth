import { describe, it, expect } from 'vitest';
import { fetchDcCameras, mapFeature, type DdotFeature } from './dc';

/** A verbatim feature from DDOT's CCTV_Location_Feeds layer ( downtown DC). */
const sample: DdotFeature = {
  attributes: {
    id: 155,
    description: '17th St. and I St. NW',
    https_url: 'https://ddotsfs1.us-east-1.skyvdn.com:443/rtplive/1o64ht64ol469hz7a62g2pd13rp34o4s/playlist.m3u8',
    active: 1,
    problem_stream: 0,
  },
  geometry: { x: -77.038518, y: 38.901326 },
};

describe('mapFeature', () => {
  it('maps an active DDOT camera as an HLS video tile named by its description', () => {
    expect(mapFeature(sample)).toEqual({
      id: 'ddot-155',
      lat: 38.901326,
      lng: -77.038518,
      name: '17th St. and I St. NW',
      city: 'Washington',
      country: 'US',
      stream_url: 'https://ddotsfs1.us-east-1.skyvdn.com:443/rtplive/1o64ht64ol469hz7a62g2pd13rp34o4s/playlist.m3u8',
      stream_type: 'hls',
      source: 'DDOT',
    });
  });

  it('drops cameras DDOT marks inactive or problem streams', () => {
    expect(mapFeature({ ...sample, attributes: { ...sample.attributes, active: 0 } })).toBeNull();
    expect(mapFeature({ ...sample, attributes: { ...sample.attributes, problem_stream: 1 } })).toBeNull();
  });

  it('drops rows without geometry, and any that land outside the District', () => {
    expect(mapFeature({ ...sample, geometry: null })).toBeNull();
    // Baltimore — outside the District line, so not ours to draw.
    expect(mapFeature({ ...sample, geometry: { x: -76.6122, y: 39.2904 } })).toBeNull();
  });

  it('drops rows whose stream URL is not a playlist', () => {
    expect(mapFeature({ ...sample, attributes: { ...sample.attributes, https_url: 'rtmp://example.invalid/live' } })).toBeNull();
    expect(mapFeature({ ...sample, attributes: { ...sample.attributes, https_url: null } })).toBeNull();
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real DDOT ArcGIS layer).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchDcCameras (live)', () => {
  liveIt('returns the District camera set, well-formed', async () => {
    const cams = await fetchDcCameras();
    expect(cams.length).toBeGreaterThan(100);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);
    for (const cam of cams) {
      expect(cam.lat).toBeGreaterThanOrEqual(38.79);
      expect(cam.lat).toBeLessThanOrEqual(39.0);
      expect(cam.stream_url).toMatch(/\.m3u8(\?|$)/i);
    }
  });
});
