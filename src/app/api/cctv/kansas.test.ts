import { describe, it, expect } from 'vitest';
import { fetchKansasCameras, mapFeature, type KdotFeature } from './kansas';

/** A live camera, verbatim from kandrive.gov's MapFeatures response. */
const liveCamera: KdotFeature = {
  title: 'K-23 Meade State Lake, South',
  uri: 'camera/15',
  features: [{ geometry: { type: 'Point', coordinates: [-100.41994, 37.17007] } }],
  __typename: 'Camera',
  active: true,
  views: [{ category: 'IMAGE', url: 'https://kscam.carsprogram.org/D6_MeadeStateLake_S.jpg?1792771320000' }],
};

describe('mapFeature', () => {
  it('maps a live camera to its snapshot, cache-buster stripped', () => {
    expect(mapFeature(liveCamera)).toEqual({
      id: 'kdot-15',
      lat: 37.17007,
      lng: -100.41994,
      name: 'K-23 Meade State Lake, South',
      city: 'Kansas',
      country: 'US',
      feed_url: 'https://kscam.carsprogram.org/D6_MeadeStateLake_S.jpg',
      external_url: 'https://www.kandrive.gov/@37.17007,-100.41994,14?show=camera%2F15',
      source: 'KDOT',
    });
  });

  it('keeps Kansas City Scout snapshots', () => {
    const cam = mapFeature({
      title: '435 SB @ Farley/Hampton Rd',
      uri: 'camera/2356',
      features: [{ geometry: { type: 'Point', coordinates: [-94.76378, 39.27769] } }],
      __typename: 'Camera',
      active: true,
      views: [{ category: 'IMAGE', url: 'https://www.kcscout.net/TransSuite.VCS.CameraSnapshots/PTCCTV0044-LQ.jpg?1792771320000' }],
    });
    expect(cam?.feed_url).toBe('https://www.kcscout.net/TransSuite.VCS.CameraSnapshots/PTCCTV0044-LQ.jpg');
    expect(cam?.stream_url).toBeUndefined();
  });

  /* The 202 views labelled VIDEO are `.jpeg` stills on the snapshots path,
     not playlists — they belong on feed_url, not in the HLS player. */
  it('treats a VIDEO-category view whose URL is a JPEG as a snapshot', () => {
    const cam = mapFeature({
      title: 'US-54 at Maize',
      uri: 'camera/2401',
      features: [{ geometry: { type: 'Point', coordinates: [-97.4601, 37.66575] } }],
      __typename: 'Camera',
      active: true,
      views: [{ category: 'VIDEO', url: 'https://kscam.carsprogram.org/snapshots/GEN_5-054-2089-2-US-54atMaize.jpeg' }],
    });
    expect(cam?.feed_url).toBe('https://kscam.carsprogram.org/snapshots/GEN_5-054-2089-2-US-54atMaize.jpeg');
    expect(cam?.stream_url).toBeUndefined();
  });

  /* 41 of the 455 live rows publish a view whose url is null — the API
     offers no image address for them at all. Verbatim row: */
  it('drops a camera whose only view has no URL', () => {
    expect(mapFeature({
      title: 'K-39 at Neosho River, Chanute MP 27',
      uri: 'camera/1',
      features: [{ geometry: { type: 'Point', coordinates: [-95.46492, 37.688] } }],
      __typename: 'Camera',
      active: true,
      views: [{ category: 'IMAGE', url: null }],
    })).toBeNull();
  });

  /* Some refreshes return this Wichita camera with only the cache-buster
     where its address should be — verbatim from a live response. The base
     URL cannot be reconstructed honestly, so the row drops. */
  it('drops a camera whose URL came back as only a cache-buster', () => {
    expect(mapFeature({
      title: 'US-54 at Maize',
      uri: 'camera/2401',
      features: [{ geometry: { type: 'Point', coordinates: [-97.4601, 37.66575] } }],
      __typename: 'Camera',
      active: true,
      views: [{ category: 'VIDEO', url: '?1792771620000' }],
    })).toBeNull();
  });

  it('drops inactive cameras and non-camera features', () => {
    expect(mapFeature({ ...liveCamera, active: false })).toBeNull();
    expect(mapFeature({ ...liveCamera, __typename: 'Event' })).toBeNull();
  });

  it('drops coordinates outside Kansas', () => {
    // Same record, moved to Oklahoma City.
    expect(mapFeature({
      ...liveCamera,
      features: [{ geometry: { type: 'Point', coordinates: [-97.5164, 35.4676] } }],
    })).toBeNull();
  });

  it('drops a record with no coordinates or no id', () => {
    expect(mapFeature({ ...liveCamera, features: [] })).toBeNull();
    expect(mapFeature({ ...liveCamera, uri: null })).toBeNull();
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real KanDrive endpoint).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchKansasCameras (live)', () => {
  liveIt('queries the whole state and returns well-formed cameras', async () => {
    const cams = await fetchKansasCameras();
    expect(cams.length).toBeGreaterThan(350);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.id).toMatch(/^kdot-\d+$/);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('KDOT');
      expect(cam.lat).toBeGreaterThan(36.9);
      expect(cam.lat).toBeLessThan(40.1);
      expect(cam.lng).toBeGreaterThan(-102.1);
      expect(cam.lng).toBeLessThan(-94.6);
      expect(cam.feed_url || cam.stream_url).toBeTruthy();
      if (cam.feed_url) expect(cam.feed_url).not.toContain('?');
    }
  }, 60_000);
});
