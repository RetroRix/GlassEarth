import { describe, it, expect } from 'vitest';
import { fetchOhioCameras, mapRecord, type OhgoRecord } from './ohio';

/** A verbatim record from api.ohgo.com/cameras. */
const sample: OhgoRecord = {
  Id: '00000000000001',
  Latitude: 41.50557,
  Longitude: -82.84921,
  Location: 'SR-2 at S Lightner Rd, 5060',
  Category: '',
  Description: 'SR-2 at S Lightner Rd, 5060',
  Provider: null,
  Cameras: [{
    Direction: 'View',
    SmallURL: 'https://itscameras.dot.state.oh.us:443/images/toledo/SR2-EB-WestSign.jpg',
    LargeURL: 'https://itscameras.dot.state.oh.us:443/images/toledo/SR2-EB-WestSign.jpg',
  }],
};

describe('mapRecord', () => {
  it('maps a camera site by its first view', () => {
    expect(mapRecord(sample)).toEqual({
      id: 'ohdot-00000000000001',
      lat: 41.50557,
      lng: -82.84921,
      name: 'SR-2 at S Lightner Rd, 5060',
      city: 'Ohio',
      country: 'US',
      feed_url: 'https://itscameras.dot.state.oh.us:443/images/toledo/SR2-EB-WestSign.jpg',
      source: 'ODOT',
    });
  });

  it('falls back to the large image, then the description, when fields are missing', () => {
    const largeOnly = mapRecord({
      ...sample,
      Cameras: [{ Direction: 'View', SmallURL: '', LargeURL: 'https://itscameras.dot.state.oh.us/images/CMH/2134.jpg' }],
    });
    expect(largeOnly?.feed_url).toBe('https://itscameras.dot.state.oh.us/images/CMH/2134.jpg');
    expect(mapRecord({ ...sample, Location: null })?.name).toBe('SR-2 at S Lightner Rd, 5060');
    expect(mapRecord({ ...sample, Location: null, Description: null })?.name).toBe('ODOT Camera 00000000000001');
  });

  it('drops sites with no id, no view, or no usable coordinates', () => {
    expect(mapRecord({ ...sample, Id: null })).toBeNull();
    expect(mapRecord({ ...sample, Cameras: [] })).toBeNull();
    expect(mapRecord({ ...sample, Cameras: [{ Direction: 'View', SmallURL: '', LargeURL: '' }] })).toBeNull();
    expect(mapRecord({ ...sample, Latitude: null })).toBeNull();
  });

  it('drops the border sites ODOT republishes from neighbouring states', () => {
    // Verbatim coordinates of the I-275 at US-50 site — in Indiana, west of the state line.
    expect(mapRecord({ ...sample, Id: '00000000000021', Latitude: 39.121895, Longitude: -84.834216 })).toBeNull();
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real OHGO endpoint).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchOhioCameras (live)', () => {
  liveIt('returns the whole state as well-formed cameras', async () => {
    const cams = await fetchOhioCameras();
    expect(cams.length).toBeGreaterThan(1000);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      // Most ids are zero-padded numbers; the KYTC bridge cameras keep
      // their `422_CCTV09002`-style ids and serve frames from trimarc.org.
      expect(cam.id).toMatch(/^ohdot-.+$/);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('ODOT');
      expect(cam.feed_url).toMatch(/^https:\/\/(itscameras\.dot\.state\.oh\.us(:443)?|www\.trimarc\.org)\//);
      expect(cam.lat).toBeGreaterThanOrEqual(38.4);
      expect(cam.lat).toBeLessThanOrEqual(41.98);
      expect(cam.lng).toBeGreaterThanOrEqual(-84.8);
      expect(cam.lng).toBeLessThanOrEqual(-80.5);
    }
  }, 60_000);
});
