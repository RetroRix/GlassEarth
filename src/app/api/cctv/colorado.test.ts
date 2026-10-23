import { describe, it, expect } from 'vitest';
import { fetchColoradoCameras, mapFeature, cityName, type CotripFeature } from './colorado';

/** A live streaming camera, verbatim from the COtrip cameras layer feed. */
const liveStream: CotripFeature = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-105.012378, 39.724894] },
  properties: {
    id: 16657,
    name: 'I-25 MP 209.15 NB at 6th Ave/US 6',
    public: true,
    location: { cityReference: 'in Denver' },
    views: [{
      name: 'I-25 MP 209.15 NB at 6th Ave/US 6',
      type: 'WMP',
      url: 'https://publicstreamer1.cotrip.org/rtplive/025N20915CAM1RP1/playlist.m3u8',
      videoPreviewUrl: 'https://cocam.carsprogram.org/Snapshots/025N20915CAM1RP1.flv.png',
      broken: false,
    }],
  },
};

/** A live snapshot-only camera, verbatim from the same feed. */
const liveStill: CotripFeature = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-105.882614, 39.684727] },
  properties: {
    id: 16710,
    name: 'I-70 MP 216.60 EB : 0.4 miles E of US 6 Loveland Pass 3',
    public: true,
    location: { cityReference: '8 miles west of the Silver Plume area' },
    views: [{
      name: 'I-70 MP 216.60 EB : 0.4 miles E of US 6 Loveland Pass 3',
      type: 'STILL_IMAGE',
      url: 'https://cocam.carsprogram.org/Snapshots/070E21660CAM1RHS-3.flv.png',
      broken: false,
    }],
  },
};

describe('mapFeature', () => {
  it('maps a WMP view to an HLS stream with its poster as the snapshot', () => {
    expect(mapFeature(liveStream)).toEqual({
      id: 'cdot-16657',
      lat: 39.724894,
      lng: -105.012378,
      name: 'I-25 MP 209.15 NB at 6th Ave/US 6',
      city: 'Denver',
      country: 'US',
      feed_url: 'https://cocam.carsprogram.org/Snapshots/025N20915CAM1RP1.flv.png',
      stream_url: 'https://publicstreamer1.cotrip.org/rtplive/025N20915CAM1RP1/playlist.m3u8',
      stream_type: 'hls',
      source: 'CDOT',
    });
  });

  it('maps a STILL_IMAGE view to a snapshot only', () => {
    const cam = mapFeature(liveStill);
    expect(cam?.feed_url).toBe('https://cocam.carsprogram.org/Snapshots/070E21660CAM1RHS-3.flv.png');
    expect(cam?.stream_url).toBeUndefined();
    expect(cam?.city).toBe('8 miles west of the Silver Plume area');
  });

  it('drops broken views, non-public cameras and viewless features', () => {
    expect(mapFeature({
      ...liveStream,
      properties: { ...liveStream.properties, views: [{ ...liveStream.properties!.views![0], broken: true }] },
    })).toBeNull();
    expect(mapFeature({ ...liveStream, properties: { ...liveStream.properties, public: false } })).toBeNull();
    expect(mapFeature({ ...liveStream, properties: { ...liveStream.properties, views: [] } })).toBeNull();
  });

  it('drops coordinates outside Colorado', () => {
    // Same record, moved to Kansas City.
    expect(mapFeature({ ...liveStream, geometry: { type: 'Point', coordinates: [-94.5786, 39.0997] } })).toBeNull();
  });
});

describe('cityName', () => {
  it('strips the feed\'s leading "in"', () => {
    expect(cityName('in Denver')).toBe('Denver');
    expect(cityName('in Idaho Springs')).toBe('Idaho Springs');
    expect(cityName('8 miles west of the Silver Plume area')).toBe('8 miles west of the Silver Plume area');
    expect(cityName(null)).toBe('Colorado');
    expect(cityName('')).toBe('Colorado');
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real COtrip layer feed).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchColoradoCameras (live)', () => {
  liveIt('returns the whole state, well-formed', async () => {
    const cams = await fetchColoradoCameras();
    expect(cams.length).toBeGreaterThan(800);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.id).toMatch(/^cdot-\d+$/);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('CDOT');
      expect(cam.lat).toBeGreaterThan(36.9);
      expect(cam.lat).toBeLessThan(41.0);
      expect(cam.lng).toBeGreaterThan(-109.1);
      expect(cam.lng).toBeLessThan(-102.0);
      expect(cam.feed_url || cam.stream_url).toBeTruthy();
      if (cam.stream_url) {
        expect(cam.stream_type).toBe('hls');
        expect(cam.stream_url).toMatch(/\.m3u8$/);
      }
    }

    // Most of the network streams; the map should be showing video, not stills.
    expect(cams.filter(c => c.stream_url).length).toBeGreaterThan(cams.length * 0.9);
  }, 60_000);
});
