import { describe, it, expect } from 'vitest';
import { fetchMontanaCameras, mapFeature, type MdtFeature } from './montana';

/** A verbatim RWIS feature from mt.cdn.iteris-atis.com/…/icons.rwis.geojson. */
const rwisSample: MdtFeature = {
  id: '302007',
  geometry: { coordinates: [-104.37, 47.426] },
  properties: {
    id: '302007',
    name: 'Savage',
    description: 'MT-16 MP 29.5',
    route: 'MT-16',
    cameras: [
      {
        id: '302070-00-01',
        name: 'Savage - North Elev 2015',
        description: 'North Elev 2015',
        image: 'https://mt.cdn.iteris-atis.com/rwis_images/302070-00-01.jpg',
      },
      {
        id: '302071-00-02',
        name: 'Savage - East Elev 2015',
        description: 'East Elev 2015',
        image: 'https://mt.cdn.iteris-atis.com/rwis_images/302071-00-02.jpg',
      },
      {
        id: '302072-00-03',
        name: 'Savage - Roadway Elev 2015',
        description: 'Roadway Elev 2015',
        image: 'https://mt.cdn.iteris-atis.com/rwis_images/302072-00-03.jpg',
      },
      {
        id: '302073-00-04',
        name: 'Savage - South Elev 2015',
        description: 'South Elev 2015',
        image: 'https://mt.cdn.iteris-atis.com/rwis_images/302073-00-04.jpg',
      },
    ],
  },
};

/** A verbatim feature from mt.cdn.iteris-atis.com/…/icons.cameras.geojson. */
const camerasSample: MdtFeature = {
  id: '6683',
  geometry: { coordinates: [-108.621555, 44.96677] },
  properties: {
    id: '6683',
    name: '',
    description: 'US-310 Frannie WY Port of Entry',
    route: 'WY US-310',
    cameras: [
      {
        id: '6683-1',
        name: 'View Facing South',
        description: 'US-310 Frannie WY Port of Entry',
        image: 'https://mt.cdn.iteris-atis.com/camera_images/other_cameras_6683.jpg',
      },
    ],
  },
};

describe('mapFeature', () => {
  it('maps an RWIS site by its first view, joining place and road position', () => {
    expect(mapFeature(rwisSample)).toEqual({
      id: 'mdt-302007',
      lat: 47.426,
      lng: -104.37,
      name: 'Savage — MT-16 MP 29.5',
      city: 'Montana',
      country: 'US',
      feed_url: 'https://mt.cdn.iteris-atis.com/rwis_images/302070-00-01.jpg',
      source: 'MDT',
    });
  });

  it('labels a cameras-file site by its description alone', () => {
    expect(mapFeature(camerasSample)).toEqual({
      id: 'mdt-6683',
      lat: 44.96677,
      lng: -108.621555,
      name: 'US-310 Frannie WY Port of Entry',
      city: 'Montana',
      country: 'US',
      feed_url: 'https://mt.cdn.iteris-atis.com/camera_images/other_cameras_6683.jpg',
      source: 'MDT',
    });
  });

  it('drops sites with no usable view or no id', () => {
    expect(mapFeature({ ...rwisSample, properties: { ...rwisSample.properties, cameras: [] } })).toBeNull();
    expect(mapFeature({
      ...rwisSample,
      properties: { ...rwisSample.properties, cameras: [{ id: 'x', image: null }] },
    })).toBeNull();
    expect(mapFeature({ ...rwisSample, id: null, properties: { ...rwisSample.properties, id: null } })).toBeNull();
  });

  it('drops sites without coordinates, and any that land outside Montana', () => {
    expect(mapFeature({ ...rwisSample, geometry: null })).toBeNull();
    // A Canadian highway camera MDT republishes, north of the 49th parallel.
    expect(mapFeature({ ...rwisSample, geometry: { coordinates: [-111.293392, 50.287365] } })).toBeNull();
    // A North Dakota camera MDT republishes, east of the state line.
    expect(mapFeature({ ...rwisSample, geometry: { coordinates: [-103.2170739, 48.3429669] } })).toBeNull();
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real MDT CDN indexes).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchMontanaCameras (live)', () => {
  liveIt('merges both Iteris indexes into well-formed Montana cameras', async () => {
    const cams = await fetchMontanaCameras();
    expect(cams.length).toBeGreaterThan(100);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.id).toMatch(/^mdt-/);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('MDT');
      expect(cam.feed_url).toMatch(/^https:\/\/mt\.cdn\.iteris-atis\.com\/.+\.jpg$/);
      expect(cam.lat).toBeGreaterThanOrEqual(44.3);
      expect(cam.lat).toBeLessThanOrEqual(49.0);
      expect(cam.lng).toBeGreaterThanOrEqual(-116.1);
      expect(cam.lng).toBeLessThanOrEqual(-104.0);
    }
  }, 60_000);
});
