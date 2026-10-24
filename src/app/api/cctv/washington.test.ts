import { describe, it, expect } from 'vitest';
import { fetchWSDOTCameras, mapWsdotFeature, webMercatorToWgs84, type WsdotFeature } from './washington';

/** A verbatim row from the WSDOT TravelInfoCamerasWeather FeatureServer. */
const sample: WsdotFeature = {
  attributes: {
    OBJECTID: 1234,
    CameraTitle: 'I-5 at MP 3.2: Main St',
    ImageURL: 'https://images.wsdot.wa.gov/sw/005vc00320.jpg',
    CompassDirection: 'S',
  },
  geometry: { x: -13655105.30305963, y: 5725939.2820585705 },
};

describe('webMercatorToWgs84', () => {
  it('converts the sample geometry to the right corner of Washington', () => {
    const { lat, lng } = webMercatorToWgs84(-13655105.30305963, 5725939.2820585705);
    expect(lat).toBeCloseTo(45.659428, 4);
    expect(lng).toBeCloseTo(-122.665898, 4);
  });
});

describe('mapWsdotFeature', () => {
  it('maps a WSDOT still, converting its Web Mercator geometry', () => {
    expect(mapWsdotFeature(sample)).toEqual({
      id: 'wsdot-1234',
      lat: expect.closeTo(45.659428, 4),
      lng: expect.closeTo(-122.665898, 4),
      name: 'I-5 at MP 3.2: Main St',
      city: 'Washington',
      country: 'US',
      feed_url: 'https://images.wsdot.wa.gov/sw/005vc00320.jpg',
      source: 'WSDOT',
    });
  });

  it('drops Oregon TripCheck stills that ride along in the layer', () => {
    const tripcheck: WsdotFeature = {
      attributes: {
        OBJECTID: 1001,
        CameraTitle: 'I-5 at Interstate Bridge SB, north end',
        ImageURL: 'https://www.tripcheck.com/RoadCams/cams/I-5%20Bridge%20SB%20North_pid4676.jpg',
        CompassDirection: 'S',
      },
      geometry: { x: -13656007.102254549, y: 5719738.545086239 },
    };
    expect(mapWsdotFeature(tripcheck)).toBeNull();
  });

  it('drops unplaceable rows', () => {
    expect(mapWsdotFeature({ ...sample, geometry: undefined })).toBeNull();
    expect(mapWsdotFeature({
      ...sample,
      attributes: { ...sample.attributes, ImageURL: '' },
    })).toBeNull();
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real WSDOT endpoint).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchWSDOTCameras (live)', () => {
  liveIt('restores Washington from the FeatureServer, snapshot-only', async () => {
    const cams = await fetchWSDOTCameras();
    expect(cams.length).toBeGreaterThan(1000);
    expect(cams.every(c => c.source === 'WSDOT' && c.feed_url && !c.stream_url)).toBe(true);
  }, 60000);
});
