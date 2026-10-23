import { describe, it, expect } from 'vitest';
import {
  dedupeKey,
  fetchNewYorkCameras,
  mapFeature,
  mapRecord,
  mergeNewYorkCameras,
  type Ny511Feature,
  type NycDotCameraRecord,
} from './newyork';

/** A live NYSDOT video camera, verbatim from api-511x-nysdot.carsprogram.org/cameras/map-features. */
const liveNysdot: Ny511Feature = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-77.5483220271554, 43.19782329167395] },
  properties: {
    type: 'cameras',
    id: 34278,
    name: 'NY-104 Eastbound Over NY-590',
    tooltip: 'NY-104 Eastbound Over NY-590',
    public: true,
    route: 'NY 104',
    lastUpdated: 1792770546464,
    location: { fips: 36, routeId: 'NY 104', linearReference: 85.88489832804247, localRoad: false, cityReference: 'near Rochester' },
    icon: 'icon-camera-fill-solid',
    iconColor: '#707070',
    cameraOwner: 'NYSDOT',
    views: [{ name: 'NY-104 Eastbound Over NY-590', type: 'WMP', url: 'https://s51.nysdot.skyvdn.com/rtplive/R4_001/playlist.m3u8', videoPreviewUrl: 'https://public.carsprogram.org/cameras/NYSDOT/R4_001.flv.png', broken: false }],
  },
};

/** An NYC DOT camera as 511NY republishes it, verbatim from the same response. */
const live511Nyc: Ny511Feature = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-73.969353, 40.785302] },
  properties: {
    type: 'cameras',
    id: 20930,
    name: 'Central Park West @ 86 St',
    tooltip: 'Central Park West @ 86 St',
    public: true,
    route: 'Central Park West @ 86 St',
    lastUpdated: 1792178214193,
    location: { fips: 36, routeId: 'Central Park West @ 86 St', localRoad: true },
    icon: 'icon-camera-fill-solid',
    iconColor: '#707070',
    cameraOwner: 'NYC DOT',
    views: [{ name: 'Central Park West @ 86 St', type: 'STILL_IMAGE', url: 'https://nyctmc.org/api/cameras/8a6bc417-4877-4ebe-8052-88c1b261baf1/image', videoPreviewUrl: 'https://nyctmc.org/api/cameras/8a6bc417-4877-4ebe-8052-88c1b261baf1/image', broken: false }],
  },
};

/** A real 511NY feature whose coordinates were never set — it sits at [0, 0]. */
const liveNoCoords: Ny511Feature = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [0, 0] },
  properties: {
    type: 'cameras',
    id: 34302,
    name: 'Falcon Camera',
    tooltip: 'Falcon Camera',
    public: true,
    route: 'Unknown',
    lastUpdated: 1792160347015,
    location: { fips: 36, routeId: 'Unknown', localRoad: true },
    icon: 'icon-camera-fill-solid',
    iconColor: '#707070',
    cameraOwner: 'NYSDOT',
    views: [{ name: 'Falcon Camera', type: 'WMP', url: 'https://s53.nysdot.skyvdn.com/rtplive/TA_Falcon/playlist.m3u8', videoPreviewUrl: 'https://public.carsprogram.org/cameras/NYSDOT/TA_Falcon.flv.png', broken: false }],
  },
};

/** The same camera as live511Nyc, verbatim from webcams.nyctmc.org/api/cameras/ — note the different host. */
const liveNycDirect: NycDotCameraRecord = {
  id: '8a6bc417-4877-4ebe-8052-88c1b261baf1',
  name: 'Central Park West @ 86 St',
  latitude: 40.785302,
  longitude: -73.969353,
  area: 'Manhattan',
  isOnline: 'true',
  imageUrl: 'https://webcams.nyctmc.org/api/cameras/8a6bc417-4877-4ebe-8052-88c1b261baf1/image',
};

/** The one offline camera in NYC DOT's list, verbatim from the same response. */
const liveNycOffline: NycDotCameraRecord = {
  id: '0952329e-6b6f-4286-b5e3-b682eae94e52',
  name: 'Broadway @ Chambers St',
  latitude: 40.714177,
  longitude: -74.006307,
  area: 'Manhattan',
  isOnline: 'false',
  imageUrl: 'https://webcams.nyctmc.org/api/cameras/0952329e-6b6f-4286-b5e3-b682eae94e52/image',
};

describe('mapFeature (511NY)', () => {
  it('maps a NYSDOT camera to an HLS stream with its poster frame', () => {
    expect(mapFeature(liveNysdot)).toEqual({
      id: 'ny511-34278',
      lat: 43.19782329167395,
      lng: -77.5483220271554,
      name: 'NY-104 Eastbound Over NY-590',
      city: 'Rochester',
      country: 'US',
      feed_url: 'https://public.carsprogram.org/cameras/NYSDOT/R4_001.flv.png',
      stream_url: 'https://s51.nysdot.skyvdn.com/rtplive/R4_001/playlist.m3u8',
      stream_type: 'hls',
      external_url: 'https://www.511ny.org/camera/34278',
      source: 'NYSDOT',
    });
  });

  it('labels a camera 511NY republishes from NYC DOT with that source', () => {
    expect(mapFeature(live511Nyc)).toEqual({
      id: 'ny511-20930',
      lat: 40.785302,
      lng: -73.969353,
      name: 'Central Park West @ 86 St',
      city: 'New York',
      country: 'US',
      feed_url: 'https://nyctmc.org/api/cameras/8a6bc417-4877-4ebe-8052-88c1b261baf1/image',
      external_url: 'https://www.511ny.org/camera/20930',
      source: 'NYC DOT',
    });
  });

  it('drops the real [0, 0] feature and a sign-flipped longitude', () => {
    expect(mapFeature(liveNoCoords)).toBeNull();
    // Real record 35675 ("Portable Camera - PVMS VM 30LC") carries +73.221827.
    expect(mapFeature({
      ...liveNysdot,
      geometry: { type: 'Point', coordinates: [73.221827, 40.812794] },
    })).toBeNull();
  });

  it('drops a camera whose every view is broken, and one with no id', () => {
    expect(mapFeature({
      ...liveNysdot,
      properties: {
        ...liveNysdot.properties!,
        views: [{ ...liveNysdot.properties!.views![0], broken: true }],
      },
    })).toBeNull();
    expect(mapFeature({ ...liveNysdot, properties: { ...liveNysdot.properties!, id: null } })).toBeNull();
  });
});

describe('mapRecord (NYC DOT)', () => {
  it('maps a direct-list camera to its snapshot, captioned by borough', () => {
    expect(mapRecord(liveNycDirect)).toEqual({
      id: 'nycdot-8a6bc417-4877-4ebe-8052-88c1b261baf1',
      lat: 40.785302,
      lng: -73.969353,
      name: 'Central Park West @ 86 St',
      city: 'Manhattan',
      country: 'US',
      feed_url: 'https://webcams.nyctmc.org/api/cameras/8a6bc417-4877-4ebe-8052-88c1b261baf1/image',
      source: 'NYC DOT',
    });
  });

  it('drops the offline camera the list keeps in it', () => {
    expect(mapRecord(liveNycOffline)).toBeNull();
    expect(mapRecord({ ...liveNycDirect, isOnline: false })).toBeNull();
  });

  it('drops rows without an image, an id, or usable coordinates', () => {
    expect(mapRecord({ ...liveNycDirect, imageUrl: null })).toBeNull();
    expect(mapRecord({ ...liveNycDirect, id: null })).toBeNull();
    expect(mapRecord({ ...liveNycDirect, latitude: null })).toBeNull();
    // Albany is in bounds for the state but this record moved to Los Angeles is not.
    expect(mapRecord({ ...liveNycDirect, latitude: 34.05, longitude: -118.24 })).toBeNull();
  });
});

describe('mergeNewYorkCameras', () => {
  it('collapses the 511NY and direct copies of the same NYC camera into one', () => {
    const from511 = mapFeature(live511Nyc)!;
    const direct = mapRecord(liveNycDirect)!;
    // Different ids and different hosts — the camera UUID in the still URL joins them.
    expect(from511.id).not.toBe(direct.id);
    const merged = mergeNewYorkCameras([from511], [direct]);
    expect(merged).toEqual([from511]);
  });

  it('keeps two same-name, same-place cameras whose streams differ', () => {
    // Real pair: 511NY ids 34345 (R8_006) and 34823 (R8_086), both named
    // "Stormville Rest Area" at the same coordinates.
    const a = mapFeature({
      ...liveNysdot,
      geometry: { type: 'Point', coordinates: [-73.72504, 41.54726] },
      properties: {
        ...liveNysdot.properties!,
        id: 34345,
        name: 'Stormville Rest Area',
        views: [{ name: 'Stormville Rest Area', type: 'WMP', url: 'https://s7.nysdot.skyvdn.com/rtplive/R8_006/playlist.m3u8', videoPreviewUrl: 'https://public.carsprogram.org/cameras/NYSDOT/R8_006.flv.png', broken: false }],
      },
    })!;
    const b = mapFeature({
      ...liveNysdot,
      geometry: { type: 'Point', coordinates: [-73.72504, 41.54726] },
      properties: {
        ...liveNysdot.properties!,
        id: 34823,
        name: 'Stormville Rest Area',
        views: [{ name: 'Stormville Rest Area', type: 'WMP', url: 'https://s9.nysdot.skyvdn.com/rtplive/R8_086/playlist.m3u8', videoPreviewUrl: 'https://public.carsprogram.org/cameras/NYSDOT/R8_086.flv.png', broken: false }],
      },
    })!;
    expect(mergeNewYorkCameras([a, b])).toEqual([a, b]);
  });

  it('keeps distinct cameras from both sub-sources', () => {
    const merged = mergeNewYorkCameras(
      [mapFeature(liveNysdot)!, mapFeature(live511Nyc)!],
      [mapRecord({ ...liveNycDirect, id: '368290bb-cebf-4845-8644-92382dcccd96', name: 'WBB SIR -2 @ Manhattan Mid Span', latitude: 40.714325, longitude: -73.9748335, imageUrl: 'https://webcams.nyctmc.org/api/cameras/368290bb-cebf-4845-8644-92382dcccd96/image' })!],
    );
    expect(merged.map(c => c.id)).toEqual([
      'ny511-34278',
      'ny511-20930',
      'nycdot-368290bb-cebf-4845-8644-92382dcccd96',
    ]);
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real 511NY + NYC DOT endpoints).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchNewYorkCameras (live)', () => {
  liveIt('merges both sub-sources into well-formed, de-duplicated cameras', async () => {
    const cams = await fetchNewYorkCameras();
    expect(cams.length).toBeGreaterThan(2500);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);
    // No camera survives twice under its other sub-source's id either.
    expect(new Set(cams.map(c => dedupeKey(c))).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.id).toMatch(/^(ny511|nycdot)-/);
      expect(cam.country).toBe('US');
      expect(['NYSDOT', 'NYC DOT']).toContain(cam.source);
      expect(cam.lat).toBeGreaterThanOrEqual(40.4);
      expect(cam.lat).toBeLessThanOrEqual(45.1);
      expect(cam.lng).toBeGreaterThanOrEqual(-79.8);
      expect(cam.lng).toBeLessThanOrEqual(-71.8);
      if (cam.stream_url) {
        expect(cam.stream_type).toBe('hls');
        expect(cam.stream_url).toMatch(/\.m3u8(\?|$)/);
      }
    }

    const nysdot = cams.filter(c => c.source === 'NYSDOT');
    expect(nysdot.length).toBeGreaterThan(1700);
    expect(nysdot.every(c => c.stream_url)).toBe(true);
    expect(cams.filter(c => c.source === 'NYC DOT').length).toBeGreaterThan(900);
  }, 60_000);
});
