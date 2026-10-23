import { describe, it, expect } from 'vitest';
import {
  fetchKentuckyCameras,
  mapKytcFeature,
  mapLexingtonFeature,
  type KytcFeature,
  type LexingtonFeature,
} from './kentucky';

/** A verbatim feature from KYTC's trafficCamerasCur_Prd layer (Louisville). */
const kytcSample: KytcFeature = {
  attributes: {
    OBJECTID: 600061,
    name: 'CCTV05161',
    description: 'I-71 at Old Brownsboro Rd',
    snapshot: 'https://www.trimarc.org/images/milestone/CCTV_05_71_0103.jpg',
    status: 'Online',
    latitude: 38.320179,
    longitude: -85.561249,
    county: 'Jefferson',
  },
};

/** A verbatim feature from the Lexington layer. */
const lexSample: LexingtonFeature = {
  attributes: {
    objectid: 1,
    location: 'Alumni/New Circle',
    still_url: 'https://6855e4345af72.streamlock.net:1935/thumbnail?application=lexington-live&streamname=lex-cam-014.stream&fitmode=stretch&size=600x400',
  },
  geometry: { x: -84.46457133969764, y: 37.99517367214168 },
};

describe('mapKytcFeature', () => {
  it('labels by description — the name field is an asset code', () => {
    expect(mapKytcFeature(kytcSample)).toEqual({
      id: 'kytc-600061',
      lat: 38.320179,
      lng: -85.561249,
      name: 'I-71 at Old Brownsboro Rd',
      city: 'Jefferson County',
      country: 'US',
      feed_url: 'https://www.trimarc.org/images/milestone/CCTV_05_71_0103.jpg',
      source: 'KYTC',
    });
  });

  it('drops the cross-listed Indiana rows (no name/county/status, dead snapshots)', () => {
    expect(mapKytcFeature({
      attributes: {
        OBJECTID: 600052,
        name: null,
        description: 'I-65 just South of I-265 Exit 6 Indiana',
        snapshot: 'http://pws.trafficwise.org/pullover/172_65_56_11.jpg',
        status: null,
        latitude: 38.345217,
        longitude: -85.753507,
        county: null,
      },
    })).toBeNull();
  });

  it('drops offline cameras and out-of-state coordinates', () => {
    expect(mapKytcFeature({ attributes: { ...kytcSample.attributes, status: 'Offline' } })).toBeNull();
    // North of the Ohio river line the box covers — not ours to draw.
    expect(mapKytcFeature({ attributes: { ...kytcSample.attributes, latitude: 39.7684, longitude: -86.1581 } })).toBeNull();
  });
});

describe('mapLexingtonFeature', () => {
  it('maps a Lexington thumbnail camera', () => {
    expect(mapLexingtonFeature(lexSample)).toEqual({
      id: 'kytc-lex-1',
      lat: 37.99517367214168,
      lng: -84.46457133969764,
      name: 'Alumni/New Circle',
      city: 'Lexington',
      country: 'US',
      feed_url: 'https://6855e4345af72.streamlock.net:1935/thumbnail?application=lexington-live&streamname=lex-cam-014.stream&fitmode=stretch&size=600x400',
      source: 'KYTC',
    });
  });

  it('drops the row whose still_url is a private-IP viewer page, not an image', () => {
    expect(mapLexingtonFeature({
      attributes: { objectid: 999, location: 'Cooper/Sports Center', still_url: 'http://172.19.40.191/aca/index.html#view' },
      geometry: { x: -84.50180004335785, y: 38.0257002666745 },
    })).toBeNull();
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits both real ArcGIS layers).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchKentuckyCameras (live)', () => {
  liveIt('returns both layers, well-formed', async () => {
    const cams = await fetchKentuckyCameras();
    expect(cams.length).toBeGreaterThan(300);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.id).toMatch(/^kytc-(lex-)?\d+$/);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('KYTC');
      expect(cam.lat).toBeGreaterThanOrEqual(36.5);
      expect(cam.lat).toBeLessThanOrEqual(39.2);
      expect(cam.lng).toBeGreaterThanOrEqual(-89.6);
      expect(cam.lng).toBeLessThanOrEqual(-82.0);
      expect(cam.feed_url).toBeTruthy();
    }
  }, 60_000);
});
