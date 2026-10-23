import { describe, it, expect } from 'vitest';
import { fetchNorthDakotaCameras, mapFeature, cleanDescription, type NddotFeature } from './northdakota';

/** A live site, verbatim from the Cameras-Still layer query (outSR=4326). */
const liveSite: NddotFeature = {
  attributes: {
    OBJECTID: 6,
    Description: 'Capital - West - NDDOT',
    Link: 'https://www.dot.nd.gov/travel-info/cameras/capitalnw00001.jpg',
    Description2: 'Capital - Northeast - NDDOT',
    Link2: 'https://www.dot.nd.gov/travel-info/cameras/capitalse00001.jpg',
    Description3: null,
    Link3: null,
    Description4: null,
    Link4: null,
    Description5: null,
    Link5: null,
    Description6: null,
    Link6: null,
    Active: 'Y',
  },
  geometry: { x: -100.78242742265495, y: 46.82073926724982 },
};

describe('mapFeature', () => {
  it('maps each published view of a site to its own camera', () => {
    expect(mapFeature(liveSite)).toEqual([
      {
        id: 'nddot-6-1',
        lat: 46.82073926724982,
        lng: -100.78242742265495,
        name: 'Capital - West',
        city: 'North Dakota',
        country: 'US',
        feed_url: 'https://www.dot.nd.gov/travel-info/cameras/capitalnw00001.jpg',
        source: 'NDDOT',
      },
      {
        id: 'nddot-6-2',
        lat: 46.82073926724982,
        lng: -100.78242742265495,
        name: 'Capital - Northeast',
        city: 'North Dakota',
        country: 'US',
        feed_url: 'https://www.dot.nd.gov/travel-info/cameras/capitalse00001.jpg',
        source: 'NDDOT',
      },
    ]);
  });

  it('skips empty view slots', () => {
    const cams = mapFeature({
      ...liveSite,
      attributes: { ...liveSite.attributes, Link: null, Description: null },
    });
    expect(cams.map(c => c.id)).toEqual(['nddot-6-2']);
  });

  it('drops inactive sites and sites without geometry', () => {
    expect(mapFeature({ ...liveSite, attributes: { ...liveSite.attributes, Active: 'N' } })).toEqual([]);
    expect(mapFeature({ ...liveSite, geometry: null })).toEqual([]);
  });

  it('drops coordinates outside North Dakota', () => {
    // Same site, moved to Minneapolis.
    expect(mapFeature({ ...liveSite, geometry: { x: -93.265, y: 44.978 } })).toEqual([]);
  });

  /* The state line is the Red River: Fargo's cameras stand east of −97.0
     and are North Dakota's, so the box runs to −96.7. */
  it('keeps Red River border cameras east of −97.0', () => {
    const cams = mapFeature({ ...liveSite, geometry: { x: -96.7818, y: 46.8772 } });
    expect(cams).toHaveLength(2);
  });
});

describe('cleanDescription', () => {
  it('strips the agency tag the layer appends to every description', () => {
    expect(cleanDescription('Ray - West (US 2 MP 51.3) - NDDOT')).toBe('Ray - West (US 2 MP 51.3)');
    expect(cleanDescription('Capital - West - NDDOT')).toBe('Capital - West');
    expect(cleanDescription('No tag here')).toBe('No tag here');
    expect(cleanDescription(null)).toBe('');
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real NDDOT ArcGIS service).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchNorthDakotaCameras (live)', () => {
  liveIt('returns every published view, well-formed', async () => {
    const cams = await fetchNorthDakotaCameras();
    expect(cams.length).toBeGreaterThan(700);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.id).toMatch(/^nddot-\d+-\d+$/);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('NDDOT');
      expect(cam.lat).toBeGreaterThan(45.9);
      expect(cam.lat).toBeLessThan(49.0);
      expect(cam.lng).toBeGreaterThan(-104.1);
      expect(cam.lng).toBeLessThan(-96.7);
      expect(cam.feed_url).toMatch(/^https:\/\/www\.dot\.nd\.gov\/travel-info\/cameras\/.+\.jpg$/);
    }
  }, 60_000);
});
