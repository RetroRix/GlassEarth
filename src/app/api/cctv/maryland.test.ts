import { describe, it, expect } from 'vitest';
import { fetchMarylandCameras, mapRecord, streamUrl, type ChartCameraRecord } from './maryland';

/** A verbatim record from getCameraMapDataJSON.do. */
const sample: ChartCameraRecord = {
  cameraCategories: ['Wash. DC'],
  cctvIp: 'strmr5.sha.maryland.gov',
  commMode: 'ONLINE',
  description: 'I-270 & Old Hundred Rd (MD 109)(CAM 165)',
  id: '7a00a1dc01250075004d823633235daa',
  lastCachedDataUpdateTime: 1792679880395,
  lat: 39.2773,
  lon: -77.3236,
  milePost: 22.29,
  name: 'I-270 & Old Hundred Rd (MD 109)',
  opStatus: 'OK',
  publicVideoURL: 'https://chart.maryland.gov/Video/GetVideo/7a00a1dc01250075004d823633235daa',
  routeNumber: 270,
  routePrefix: 'IS',
  routeSuffix: '',
} as ChartCameraRecord;

describe('mapRecord', () => {
  it('rebuilds the HLS playlist from the streaming host and id', () => {
    expect(mapRecord(sample)).toEqual({
      id: 'mdot-7a00a1dc01250075004d823633235daa',
      lat: 39.2773,
      lng: -77.3236,
      name: 'I-270 & Old Hundred Rd (MD 109)(CAM 165)',
      city: 'Wash. DC',
      country: 'US',
      stream_url: 'https://strmr5.sha.maryland.gov/rtplive/7a00a1dc01250075004d823633235daa/playlist.m3u8',
      stream_type: 'hls',
      external_url: 'https://chart.maryland.gov/Video/GetVideo/7a00a1dc01250075004d823633235daa',
      source: 'MDOT CHART',
    });
    expect(streamUrl('strmr3.sha.maryland.gov', 'abc'))
      .toBe('https://strmr3.sha.maryland.gov/rtplive/abc/playlist.m3u8');
  });

  /* Half the feed puts a bare asset number in `name`; the description is
     the place. Another verbatim record, asset name and all. */
  it('labels the camera by its description when the name is an asset number', () => {
    const cam = mapRecord({
      ...sample,
      id: '9201ff5801f700d700437a45351f0214',
      description: 'I-70 East of I-270',
      name: '710002',
      lat: 39.39761,
      lon: -77.42188,
      cameraCategories: ['Western MD'],
      publicVideoURL: 'https://chart.maryland.gov/Video/GetVideo/9201ff5801f700d700437a45351f0214',
    });
    expect(cam?.name).toBe('I-70 East of I-270');
    expect(cam?.city).toBe('Western MD');
  });

  it('keeps a camera whose momentary status is not OK', () => {
    expect(mapRecord({ ...sample, opStatus: 'COMM_FAILURE' } as ChartCameraRecord)).not.toBeNull();
    expect(mapRecord({ ...sample, commMode: 'OFFLINE' } as ChartCameraRecord)).not.toBeNull();
  });

  it('drops records with no id, no streaming host, or a host that is not a hostname', () => {
    expect(mapRecord({ ...sample, id: null })).toBeNull();
    expect(mapRecord({ ...sample, id: '  ' })).toBeNull();
    expect(mapRecord({ ...sample, cctvIp: null })).toBeNull();
    expect(mapRecord({ ...sample, cctvIp: 'evil.example/x?y' })).toBeNull();
  });

  it('drops rows without usable coordinates, and any that land outside Maryland', () => {
    expect(mapRecord({ ...sample, lat: null })).toBeNull();
    expect(mapRecord({ ...sample, lat: 0, lon: 0 })).toBeNull();
    // Wilmington, Delaware — over the state line, so not ours to draw.
    expect(mapRecord({ ...sample, lat: 39.7391, lon: -75.5398 })).toBeNull();
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real CHART endpoint).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchMarylandCameras (live)', () => {
  liveIt('returns the statewide CHART network as well-formed HLS cameras', async () => {
    const cams = await fetchMarylandCameras();
    expect(cams.length).toBeGreaterThan(400);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.id).toMatch(/^mdot-[0-9a-f]+$/);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('MDOT CHART');
      expect(cam.stream_type).toBe('hls');
      expect(cam.stream_url).toMatch(/^https:\/\/strmr\d+\.sha\.maryland\.gov\/rtplive\/[0-9a-f]+\/playlist\.m3u8$/);
      expect(cam.lat).toBeGreaterThanOrEqual(37.9);
      expect(cam.lat).toBeLessThanOrEqual(39.7);
      expect(cam.lng).toBeGreaterThanOrEqual(-79.5);
      expect(cam.lng).toBeLessThanOrEqual(-75.0);
    }
  }, 60_000);
});
