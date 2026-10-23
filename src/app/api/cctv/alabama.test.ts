import { describe, it, expect } from 'vitest';
import { fetchAlabamaCameras, mapRecord, type AlgoCameraRecord } from './alabama';

/** A verbatim row from api.algotraffic.com/v4.0/Cameras (Mobile, I-10). */
const sample: AlgoCameraRecord = {
  id: 31385,
  location: {
    latitude: 30.535104999999998,
    longitude: -88.23953,
    city: 'Mobile',
    county: 'Mobile',
    displayRouteDesignator: 'I-10',
    displayCrossStreet: 'McDonald Rd',
    direction: 'East',
  },
  playbackUrls: {
    hls: 'https://cdn3.wowza.com/5/b3FOYzhMRS9aVlI1/mobile-fastly/mob-cam-c095.stream/playlist.m3u8',
  },
  accessLevel: 'Public',
  snapshotImageUrl: 'https://api.algotraffic.com/v4/Cameras/31385/snapshot.jpg',
  permLink: 'https://www.algotraffic.com?cameraId=31385',
};

describe('mapRecord', () => {
  it('maps a public ALGO camera with snapshot and HLS', () => {
    expect(mapRecord(sample)).toEqual({
      id: 'aldot-31385',
      lat: 30.535104999999998,
      lng: -88.23953,
      name: 'I-10 @ McDonald Rd',
      city: 'Mobile',
      country: 'US',
      feed_url: 'https://api.algotraffic.com/v4/Cameras/31385/snapshot.jpg',
      stream_url: 'https://cdn3.wowza.com/5/b3FOYzhMRS9aVlI1/mobile-fastly/mob-cam-c095.stream/playlist.m3u8',
      stream_type: 'hls',
      external_url: 'https://www.algotraffic.com?cameraId=31385',
      source: 'ALDOT',
    });
  });

  it('falls back to road + direction when there is no cross-street', () => {
    const cam = mapRecord({ ...sample, location: { ...sample.location, displayCrossStreet: 'Unknown' } });
    expect(cam?.name).toBe('I-10 East');
  });

  it('drops non-public cameras — ALDOT-only, FirstResponder and Hidden rows share this feed', () => {
    expect(mapRecord({ ...sample, accessLevel: 'ALDOT' })).toBeNull();
    expect(mapRecord({ ...sample, accessLevel: 'FirstResponder' })).toBeNull();
    expect(mapRecord({ ...sample, accessLevel: 'Hidden' })).toBeNull();
  });

  it('drops rows without usable coordinates, and any that land outside Alabama', () => {
    expect(mapRecord({ ...sample, location: null })).toBeNull();
    expect(mapRecord({ ...sample, location: { ...sample.location, latitude: null } })).toBeNull();
    // Atlanta — over the Georgia line, so not ours to draw.
    expect(mapRecord({ ...sample, location: { ...sample.location, latitude: 33.749, longitude: -84.388 } })).toBeNull();
  });

  it('drops rows with neither a snapshot nor a playlist', () => {
    expect(mapRecord({ ...sample, snapshotImageUrl: null, playbackUrls: null })).toBeNull();
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real ALGO API).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchAlabamaCameras (live)', () => {
  liveIt('returns the statewide public camera set, well-formed', async () => {
    const cams = await fetchAlabamaCameras();
    expect(cams.length).toBeGreaterThan(600);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.id).toMatch(/^aldot-\d+$/);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('ALDOT');
      expect(cam.lat).toBeGreaterThanOrEqual(30.1);
      expect(cam.lat).toBeLessThanOrEqual(35.1);
      expect(cam.lng).toBeGreaterThanOrEqual(-88.5);
      expect(cam.lng).toBeLessThanOrEqual(-84.9);
      expect(cam.feed_url).toMatch(/^https:\/\/api\.algotraffic\.com\/v4\/Cameras\/\d+\/snapshot\.jpg$/);
      expect(cam.stream_type).toBe('hls');
      expect(cam.stream_url).toMatch(/\.m3u8$/);
    }
  }, 60_000);
});
