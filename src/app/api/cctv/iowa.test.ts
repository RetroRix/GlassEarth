import { describe, it, expect } from 'vitest';
import { fetchIowaCameras, mapFeature, type IowaFeature } from './iowa';

/** A live camera, verbatim from 511ia.org's MapFeatures response. */
const liveCamera: IowaFeature = {
  title: 'I-35: DM - I-35/80 @ MM 136.2 (E 14th)',
  uri: 'camera/59644814',
  features: [{ geometry: { coordinates: [-93.60017, 41.64979] } }],
  __typename: 'Camera',
  active: true,
  views: [{ url: 'https://atmsqf.iowadot.gov/SNAPSHOTS/PUBLIC/Metro/dmtv024hd.jpeg', category: 'VIDEO' }],
};

/** An IMAGE-category camera, verbatim — note the API's own cache-buster query. */
const restAreaCamera: IowaFeature = {
  title: 'I-80: Rest Area: I-80 EB MM 180 near Grinnell',
  uri: 'camera/59644813',
  features: [{ geometry: { coordinates: [-92.77364, 41.69415] } }],
  __typename: 'Camera',
  active: true,
  views: [{ url: 'https://atmsqf.iowadot.gov/snapshots/Public/RestAreas/RA80EB180-01-CENTER.jpg?1792770360000', category: 'IMAGE' }],
};

describe('mapFeature', () => {
  it('maps a live camera to its JPEG snapshot', () => {
    expect(mapFeature(liveCamera)).toEqual({
      id: 'iadot-59644814',
      lat: 41.64979,
      lng: -93.60017,
      name: 'I-35: DM - I-35/80 @ MM 136.2 (E 14th)',
      city: 'Iowa',
      country: 'US',
      feed_url: 'https://atmsqf.iowadot.gov/SNAPSHOTS/PUBLIC/Metro/dmtv024hd.jpeg',
      external_url: 'https://511ia.org/@41.64979,-93.60017,14?show=camera%2F59644814',
      source: 'Iowa DOT',
    });
  });

  it('keeps the snapshot URL exactly as served, cache-buster and all', () => {
    expect(mapFeature(restAreaCamera)?.feed_url)
      .toBe('https://atmsqf.iowadot.gov/snapshots/Public/RestAreas/RA80EB180-01-CENTER.jpg?1792770360000');
  });

  it('publishes no stream — Iowa serves snapshots only', () => {
    const cam = mapFeature(liveCamera);
    expect(cam?.stream_url).toBeUndefined();
    expect(cam?.stream_type).toBeUndefined();
  });

  it('drops a camera whose view is the closed-camera icon or null', () => {
    expect(mapFeature({
      ...liveCamera,
      views: [{ url: '/images/icon-camera-closed-fill-solid-padded.svg', category: 'VIDEO' }],
    })).toBeNull();
    expect(mapFeature({ ...liveCamera, views: [{ url: null, category: 'IMAGE' }] })).toBeNull();
    expect(mapFeature({ ...liveCamera, views: [] })).toBeNull();
  });

  it('drops inactive cameras and non-camera features', () => {
    expect(mapFeature({ ...liveCamera, active: false })).toBeNull();
    expect(mapFeature({ ...liveCamera, __typename: 'Event' })).toBeNull();
  });

  it('drops coordinates outside Iowa', () => {
    // Same record, moved to Los Angeles.
    expect(mapFeature({
      ...liveCamera,
      features: [{ geometry: { coordinates: [-118.24, 34.05] } }],
    })).toBeNull();
  });

  it('drops a record with no coordinates or no id', () => {
    expect(mapFeature({ ...liveCamera, features: [] })).toBeNull();
    expect(mapFeature({ ...liveCamera, uri: null })).toBeNull();
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real 511IA endpoint).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchIowaCameras (live)', () => {
  liveIt('returns the whole state as well-formed snapshot cameras', async () => {
    const cams = await fetchIowaCameras();
    expect(cams.length).toBeGreaterThan(700);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.id).toMatch(/^iadot-\d+$/);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('Iowa DOT');
      expect(cam.feed_url).toMatch(/^https:\/\/atmsqf\.iowadot\.gov\/.+\.jpe?g(\?.*)?$/i);
      expect(cam.stream_url).toBeUndefined();
      expect(cam.lat).toBeGreaterThan(40.4);
      expect(cam.lat).toBeLessThan(43.5);
      expect(cam.lng).toBeGreaterThan(-96.6);
      expect(cam.lng).toBeLessThan(-91.0);
    }
  }, 60_000);
});
