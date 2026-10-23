import { describe, it, expect } from 'vitest';
import { fetchOklahomaCameras, mapRecord, type OklahomaCameraRecord } from './oklahoma';

/** A live public camera, verbatim from oktraffic.org's MapCameras response. */
const liveCamera: OklahomaCameraRecord = {
  id: 2,
  latitude: '36.16456',
  longitude: '-95.86062',
  location: 'I-244 & US-169 N',
  city: 'Tulsa',
  status: 'Free',
  type: 'Web',
  blockAtis: '0',
  streamDictionary: {
    streamSrc: 'https://stream.oktraffic.org/delay-stream/806c1db7c9df3550.stream/playlist.m3u8',
  },
};

describe('mapRecord', () => {
  it('maps a public camera to its Wowza HLS stream', () => {
    expect(mapRecord(liveCamera)).toEqual({
      id: 'odot-2',
      lat: 36.16456,
      lng: -95.86062,
      name: 'I-244 & US-169 N',
      city: 'Tulsa',
      country: 'US',
      stream_url: 'https://stream.oktraffic.org/delay-stream/806c1db7c9df3550.stream/playlist.m3u8',
      stream_type: 'hls',
      source: 'ODOT',
    });
  });

  it('keeps construction cameras — the public filter only excludes out-of-service', () => {
    expect(mapRecord({ ...liveCamera, status: 'Construction' })).not.toBeNull();
  });

  it('drops what ODOT does not publish: out-of-service, non-Web and ATIS-blocked rows', () => {
    expect(mapRecord({ ...liveCamera, status: 'Out Of Service' })).toBeNull();
    expect(mapRecord({ ...liveCamera, type: 'CCTV' })).toBeNull();
    expect(mapRecord({ ...liveCamera, type: 'Security' })).toBeNull();
    expect(mapRecord({ ...liveCamera, blockAtis: '1' })).toBeNull();
  });

  it('drops a camera with no stream dictionary, or a stream that is not a playlist', () => {
    expect(mapRecord({ ...liveCamera, streamDictionary: null })).toBeNull();
    expect(mapRecord({ ...liveCamera, streamDictionary: { streamSrc: null } })).toBeNull();
    expect(mapRecord({
      ...liveCamera,
      streamDictionary: { streamSrc: 'https://stream.oktraffic.org/delay-stream/806c1db7c9df3550.stream' },
    })).toBeNull();
  });

  it('drops rows without usable coordinates, and any that land outside Oklahoma', () => {
    expect(mapRecord({ ...liveCamera, latitude: null })).toBeNull();
    expect(mapRecord({ ...liveCamera, latitude: 'not-a-number' })).toBeNull();
    // Dallas — over the Texas line, so not ours to draw.
    expect(mapRecord({ ...liveCamera, latitude: '32.78', longitude: '-96.80' })).toBeNull();
  });

  it('falls back to the camera id when the row names no location', () => {
    expect(mapRecord({ ...liveCamera, location: null })?.name).toBe('ODOT Camera 2');
    expect(mapRecord({ ...liveCamera, city: null })?.city).toBe('Oklahoma');
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real ODOT endpoint).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchOklahomaCameras (live)', () => {
  liveIt('returns every public camera as a well-formed HLS stream', async () => {
    const cams = await fetchOklahomaCameras();
    expect(cams.length).toBeGreaterThan(400);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);
    expect(new Set(cams.map(c => c.stream_url)).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.id).toMatch(/^odot-\d+$/);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('ODOT');
      expect(cam.stream_type).toBe('hls');
      expect(cam.stream_url).toMatch(/^https:\/\/stream\.oktraffic\.org\/delay-stream\/.+\.stream\/playlist\.m3u8$/);
      expect(cam.lat).toBeGreaterThan(33.6);
      expect(cam.lat).toBeLessThan(37.0);
      expect(cam.lng).toBeGreaterThan(-103.0);
      expect(cam.lng).toBeLessThan(-94.4);
    }
  }, 60_000);
});
