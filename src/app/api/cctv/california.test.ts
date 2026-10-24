import { describe, it, expect } from 'vitest';
import { fetchCaltransCameras, mapCaltransFeature, isPlayableStreamUrl, type CaltransFeature } from './california';

/** A verbatim row from the Caltrans CCTV FeatureServer (OBJECTID 1), plus a
 *  published stream URL of the kind ~2/3 of rows carry. */
const sample: CaltransFeature = {
  attributes: {
    OBJECTID: 1,
    locationName: 'SR-20 : At SR-1 - Looking East (C020)',
    nearbyPlace: 'Fort Bragg',
    county: 'Mendocino',
    latitude: 39.42002,
    longitude: -123.80779,
    currentImageURL: 'https://cwwp2.dot.ca.gov/data/d1/cctv/image/sr20atsr1lookingeast/sr20atsr1lookingeast.jpg',
    streamingVideoURL: 'https://wzmedia.dot.ca.gov/D3/5_Pocket_Rd_OC_SAC5_SB.stream/playlist.m3u8',
  },
  geometry: { x: -123.80779, y: 39.42002 },
};

describe('isPlayableStreamUrl', () => {
  it('accepts an https .m3u8 URL, with or without a query string', () => {
    expect(isPlayableStreamUrl('https://wzmedia.dot.ca.gov/D3/x.stream/playlist.m3u8')).toBe(true);
    expect(isPlayableStreamUrl('https://example.com/live.m3u8?token=abc')).toBe(true);
  });

  it('rejects anything a browser cannot play as HLS', () => {
    expect(isPlayableStreamUrl('http://example.com/live.m3u8')).toBe(false); // plain http
    expect(isPlayableStreamUrl('rtsp://10.0.0.1:554/')).toBe(false); // RTSP, incl. internal ones
    expect(isPlayableStreamUrl('https://example.com/cam.mp4')).toBe(false);
    expect(isPlayableStreamUrl('')).toBe(false);
    expect(isPlayableStreamUrl(undefined)).toBe(false);
  });
});

describe('mapCaltransFeature', () => {
  it('maps a camera with its snapshot and its published HLS stream', () => {
    expect(mapCaltransFeature(sample)).toEqual({
      id: 'cal-1',
      lat: 39.42002,
      lng: -123.80779,
      name: 'SR-20 : At SR-1 - Looking East (C020)',
      city: 'Fort Bragg',
      country: 'US',
      feed_url: 'https://cwwp2.dot.ca.gov/data/d1/cctv/image/sr20atsr1lookingeast/sr20atsr1lookingeast.jpg',
      stream_url: 'https://wzmedia.dot.ca.gov/D3/5_Pocket_Rd_OC_SAC5_SB.stream/playlist.m3u8',
      stream_type: 'hls',
      source: 'Caltrans',
    });
  });

  it('keeps the snapshot and drops the stream when no usable stream is published', () => {
    const noStream = mapCaltransFeature({
      ...sample,
      attributes: { ...sample.attributes, streamingVideoURL: '' },
    });
    expect(noStream?.stream_url).toBeUndefined();
    expect(noStream?.feed_url).toBe(sample.attributes?.currentImageURL);

    // An internal RTSP URL in the published field must never reach a browser.
    const rtsp = mapCaltransFeature({
      ...sample,
      attributes: { ...sample.attributes, streamingVideoURL: 'rtsp://10.53.52.33:554/' },
    });
    expect(rtsp?.stream_url).toBeUndefined();
    expect(rtsp?.feed_url).toBe(sample.attributes?.currentImageURL);
  });

  it('drops unplaceable or snapshot-less rows', () => {
    // No geometry AND no latitude/longitude attributes: nowhere to put it.
    expect(mapCaltransFeature({
      ...sample,
      geometry: undefined,
      attributes: { ...sample.attributes, latitude: undefined, longitude: undefined },
    })).toBeNull();
    // Out-of-bounds latitude in the attributes is dropped, geometry or not.
    expect(mapCaltransFeature({
      ...sample,
      attributes: { ...sample.attributes, latitude: 95 },
    })).toBeNull();
    expect(mapCaltransFeature({
      ...sample,
      attributes: { ...sample.attributes, currentImageURL: '' },
    })).toBeNull();
    expect(mapCaltransFeature({
      ...sample,
      attributes: { ...sample.attributes, OBJECTID: undefined },
    })).toBeNull();
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real Caltrans endpoint).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchCaltransCameras (live)', () => {
  liveIt('returns the full set, paged past the 2,000-row service cap, with live streams wired', async () => {
    const cams = await fetchCaltransCameras();
    expect(cams.length).toBeGreaterThan(2000);
    const live = cams.filter(c => c.stream_type === 'hls' && c.stream_url);
    expect(live.length).toBeGreaterThan(1000);
    expect(cams.every(c => c.feed_url && c.source === 'Caltrans')).toBe(true);
  }, 60000);
});
