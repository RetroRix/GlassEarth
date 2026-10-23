import { describe, it, expect } from 'vitest';
import { fetchDelawareCameras, mapRecord, type DelDotCameraRecord } from './delaware';

/** A verbatim record from tmc.deldot.gov/json/videocamera.json. */
const sample: DelDotCameraRecord = {
  urls: {
    rtmp: 'rtmpt://video.deldot.gov:80/live/KCAM001.stream',
    f4m: 'http://video.deldot.gov:1935/live/KCAM001.stream/manifest.f4m',
    m3u8: 'http://video.deldot.gov:1935/live/KCAM001.stream/playlist.m3u8',
    m3u8s: 'https://video.deldot.gov:443/live/KCAM001.stream/playlist.m3u8',
    mssmooth: 'http://video.deldot.gov:1935/live/KCAM001.stream/Manifest',
  },
  id: 'KCAM001',
  title: 'DE 1 @ MILFORD NECK ROAD (NORTH OFF)',
  county: 'Kent',
  lat: 38.990931,
  lon: -75.448625,
  hash: '1760142867',
  enabled: true,
  status: 'Active',
} as DelDotCameraRecord;

describe('mapRecord', () => {
  it('plays the HTTPS HLS playlist, not its http twin', () => {
    expect(mapRecord(sample)).toEqual({
      id: 'deldot-KCAM001',
      lat: 38.990931,
      lng: -75.448625,
      name: 'DE 1 @ MILFORD NECK ROAD (NORTH OFF)',
      city: 'Kent County',
      country: 'US',
      stream_url: 'https://video.deldot.gov:443/live/KCAM001.stream/playlist.m3u8',
      stream_type: 'hls',
      source: 'DelDOT',
    });
  });

  it('drops a camera DelDOT has switched off, but keeps one momentarily Unavailable', () => {
    expect(mapRecord({ ...sample, enabled: false })).toBeNull();
    expect(mapRecord({ ...sample, status: 'Unavailable' } as DelDotCameraRecord)).not.toBeNull();
  });

  it('drops records with no id or no HTTPS playlist', () => {
    expect(mapRecord({ ...sample, id: null })).toBeNull();
    expect(mapRecord({ ...sample, urls: {} })).toBeNull();
    expect(mapRecord({ ...sample, urls: { m3u8s: 'https://video.deldot.gov/live/KCAM001.stream/Manifest' } })).toBeNull();
  });

  it('drops rows without usable coordinates, and any that land outside Delaware', () => {
    expect(mapRecord({ ...sample, lat: null })).toBeNull();
    expect(mapRecord({ ...sample, lat: 0, lon: 0 })).toBeNull();
    // Philadelphia — over the state line, so not ours to draw.
    expect(mapRecord({ ...sample, lat: 39.9526, lon: -75.1652 })).toBeNull();
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real DelDOT endpoint).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchDelawareCameras (live)', () => {
  liveIt('returns the statewide DelDOT network as well-formed HLS cameras', async () => {
    const cams = await fetchDelawareCameras();
    expect(cams.length).toBeGreaterThan(300);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.id).toMatch(/^deldot-[A-Z]+\d+$/);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('DelDOT');
      expect(cam.stream_type).toBe('hls');
      expect(cam.stream_url).toMatch(/^https:\/\/video\.deldot\.gov:443\/live\/.+\.stream\/playlist\.m3u8$/);
      expect(cam.lat).toBeGreaterThanOrEqual(38.4);
      expect(cam.lat).toBeLessThanOrEqual(39.9);
      expect(cam.lng).toBeGreaterThanOrEqual(-75.8);
      expect(cam.lng).toBeLessThanOrEqual(-75.0);
    }
  }, 60_000);
});
