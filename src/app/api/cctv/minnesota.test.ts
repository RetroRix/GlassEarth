import { describe, it, expect } from 'vitest';
import { fetchMinnesotaCameras, mapFeature, type MnDotFeature } from './minnesota';

/** A live video camera, verbatim from api-511x-mn.carsprogram.org/cameras/map-features. */
const liveVideo: MnDotFeature = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-93.12841150353577, 44.85766316217013] },
  properties: {
    type: 'cameras',
    id: 514023,
    name: 'T.H.149 NB @ Vikings Pkwy',
    tooltip: 'T.H.149 NB @ Vikings Pkwy',
    public: true,
    route: 'MN 149',
    lastUpdated: 1792770595586,
    location: { fips: 27, routeId: 'MN 149', linearReference: 3.835158311851874, localRoad: false, cityReference: 'in Eagan' },
    icon: 'icon-camera-fill-solid',
    iconColor: '#707070',
    cameraOwner: 'Iris',
    views: [{ name: 'T.H.149 NB @ Vikings Pkwy', type: 'WMP', url: 'https://video.dot.state.mn.us/public/C4952.stream/playlist.m3u8', videoPreviewUrl: 'https://public.carsprogram.org/cameras/MN/C4952', broken: false }],
  },
};

/** A rural still-only camera with several fixed angles, verbatim from the same response. */
const liveStill: MnDotFeature = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-92.36933439777947, 43.508396524759455] },
  properties: {
    type: 'cameras',
    id: 514039,
    name: 'U.S.63 (Le Roy - MP 0.5)',
    tooltip: 'U.S.63 (Le Roy - MP 0.5)',
    public: true,
    route: 'US 63',
    lastUpdated: 1792770595677,
    location: { fips: 27, routeId: 'US 63', linearReference: 0.5476835521012051, localRoad: false, cityReference: '12 miles south of Spring Valley' },
    icon: 'icon-camera-fill-solid',
    iconColor: '#707070',
    cameraOwner: 'Iris',
    views: [
      { name: 'U.S.63 (Le Roy - MP 0.5) View 1', type: 'STILL_IMAGE', url: 'https://public.carsprogram.org/cameras/MN/C30337-v1', broken: false },
      { name: 'U.S.63 (Le Roy - MP 0.5) View 2', type: 'STILL_IMAGE', url: 'https://public.carsprogram.org/cameras/MN/C30337-v2', broken: false },
      { name: 'U.S.63 (Le Roy - MP 0.5) View 3', type: 'STILL_IMAGE', url: 'https://public.carsprogram.org/cameras/MN/C30337-v3', broken: false },
      { name: 'U.S.63 (Le Roy - MP 0.5) View 4', type: 'STILL_IMAGE', url: 'https://public.carsprogram.org/cameras/MN/C30337-v4', broken: false },
    ],
  },
};

describe('mapFeature', () => {
  it('maps a WMP camera to an HLS stream with its poster frame', () => {
    expect(mapFeature(liveVideo)).toEqual({
      id: 'mndot-514023',
      lat: 44.85766316217013,
      lng: -93.12841150353577,
      name: 'T.H.149 NB @ Vikings Pkwy',
      city: 'Eagan',
      country: 'US',
      feed_url: 'https://public.carsprogram.org/cameras/MN/C4952',
      stream_url: 'https://video.dot.state.mn.us/public/C4952.stream/playlist.m3u8',
      stream_type: 'hls',
      external_url: 'https://new.511mn.org/camera/514023',
      source: 'MnDOT',
    });
  });

  it('maps a still-only camera to its first view, with no stream', () => {
    expect(mapFeature(liveStill)).toEqual({
      id: 'mndot-514039',
      lat: 43.508396524759455,
      lng: -92.36933439777947,
      name: 'U.S.63 (Le Roy - MP 0.5)',
      // "12 miles south of Spring Valley" is a distance, not a place.
      city: 'Minnesota',
      country: 'US',
      feed_url: 'https://public.carsprogram.org/cameras/MN/C30337-v1',
      external_url: 'https://new.511mn.org/camera/514039',
      source: 'MnDOT',
    });
  });

  it('reads a "near <place>" cityReference as the place', () => {
    const cam = mapFeature({
      ...liveVideo,
      properties: {
        ...liveVideo.properties!,
        location: { ...liveVideo.properties!.location, cityReference: 'near Columbia Heights' },
      },
    });
    expect(cam?.city).toBe('Columbia Heights');
  });

  it('drops a camera whose every view is broken, and one with no views', () => {
    expect(mapFeature({
      ...liveVideo,
      properties: {
        ...liveVideo.properties!,
        views: [{ ...liveVideo.properties!.views![0], broken: true }],
      },
    })).toBeNull();
    expect(mapFeature({ ...liveVideo, properties: { ...liveVideo.properties!, views: [] } })).toBeNull();
  });

  it('skips a broken view and uses the next good one', () => {
    const cam = mapFeature({
      ...liveStill,
      properties: {
        ...liveStill.properties!,
        views: [
          { ...liveStill.properties!.views![0], broken: true },
          liveStill.properties!.views![1],
        ],
      },
    });
    expect(cam?.feed_url).toBe('https://public.carsprogram.org/cameras/MN/C30337-v2');
  });

  it('drops coordinates outside Minnesota, and rows without coordinates or an id', () => {
    // Same record, moved to Los Angeles.
    expect(mapFeature({
      ...liveVideo,
      geometry: { type: 'Point', coordinates: [-118.24, 34.05] },
    })).toBeNull();
    expect(mapFeature({ ...liveVideo, geometry: null })).toBeNull();
    expect(mapFeature({ ...liveVideo, properties: { ...liveVideo.properties!, id: null } })).toBeNull();
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real MnDOT endpoint).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchMinnesotaCameras (live)', () => {
  liveIt('returns the whole state as well-formed cameras', async () => {
    const cams = await fetchMinnesotaCameras();
    expect(cams.length).toBeGreaterThan(1000);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.id).toMatch(/^mndot-\d+$/);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('MnDOT');
      expect(cam.feed_url).toBeTruthy();
      expect(cam.lat).toBeGreaterThanOrEqual(43.4);
      expect(cam.lat).toBeLessThanOrEqual(49.4);
      expect(cam.lng).toBeGreaterThanOrEqual(-97.3);
      expect(cam.lng).toBeLessThanOrEqual(-89.4);
      if (cam.stream_url) {
        expect(cam.stream_type).toBe('hls');
        expect(cam.stream_url).toMatch(/\.m3u8(\?|$)/);
      }
    }

    // Most of the state streams; the still-only cameras are the rural minority.
    expect(cams.filter(c => c.stream_url).length).toBeGreaterThan(cams.length * 0.7);
  }, 60_000);
});
