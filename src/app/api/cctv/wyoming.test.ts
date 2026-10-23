import { describe, it, expect } from 'vitest';
import { fetchWyomingCameras, parseFeed, mapSite, deobfuscate, type WydotSite } from './wyoming';

/**
 * One site entry, byte-for-byte from the live WebCamerasFeed
 * (map.wyoroad.info/wti511map-data/Msg-FFBK373B.pbf), re-wrapped as a
 * one-entry feed and base64-encoded: Cheyenne South POE, device 55.
 */
const LIVE_FEED_B64 =
  'Ct0CCDcSGEJnTU5NeFZZR1JaSE1nY0dCUU5KSjNvchqsAggBEiRERXRhZjFCMUh4WWVCQVlkRkVzNUdFY2FRUWNnYnhZdEF6TTM' +
  'a/wFMUjhjT2dNTVdGd1FGaDlkQmhJR0JWb1BCVVl2SVRVc1dEWXJKaHdaQ1RkcUNBa3BHRk5JQVFJSFZTVWxJUzRVQnp3cFBpczdD' +
  'ZzRrCk5RMG1hUW9yRFNrdENTNURZQzRpTVRNOEZpUXhJaFVFSkRBNUtnRmdEREo1ZmlWbUNpVTRkQzVjS0VKYU1TSUtGUkU0UVZJ' +
  'a0pYQmYKQUQ4QmRpY09IbmszSlFJU01nTVdIMTRvTjNnOEVsWTdJeVVjUFFjbUJDTlNJM1VCRUJBZEZ4a2xBaTlZRGk4K0VDaERj' +
  'MFVYVlRjZQpFRU05TFNWTUdpVWtQQm9sSmpFRWR3PT0gAUEuceSByDZawEmDNc6mI4pEQA==';

const LIVE_IMAGE_URL =
  'https://www.wyoroad.info/web-cam/cache?ref=VTJGc2RHVmtYMStCbXpCWlFad3VYQVRTeUZKb1JQQlN3OE80aWpMb1E4b2lFQmtyK09MRE1aWG9tMi8ya3hZYSt6bGNKa1ZKVmVnQ1M3K3NCSjVWa3U0TjUxb3E2d2Vvc2VDRytDLzUveFE9';

function liveFeed(): Uint8Array {
  return new Uint8Array(Buffer.from(LIVE_FEED_B64, 'base64'));
}

describe('deobfuscate', () => {
  it('decodes the feed URL the map bundle carries for this layer', () => {
    expect(deobfuscate('LR8cOgMMWFwKABhdBhIGBVoPBUYvITUsWDY6LQRLWTckG0UuEUIWXCoSD143LSs8BllSKmg/MSU='))
      .toBe('https://map.wyoroad.info/wti511map-data/Msg-FFBK373B.pbf');
  });
});

describe('parseFeed', () => {
  it('decodes a verbatim live site: id, name, coordinates, image', () => {
    const sites = parseFeed(liveFeed());
    expect(sites).toEqual([{
      deviceId: 55,
      name: 'Cheyenne South POE',
      lat: 41.079213,
      lng: -104.855988,
      images: [{ id: 1, label: 'I 25 Cheyenne Port of Entry', url: LIVE_IMAGE_URL }],
    }]);
  });
});

describe('mapSite', () => {
  it('maps the live site to its camera', () => {
    const [site] = parseFeed(liveFeed());
    expect(mapSite(site)).toEqual([{
      id: 'wydot-55-1',
      lat: 41.079213,
      lng: -104.855988,
      name: 'I 25 Cheyenne Port of Entry',
      city: 'Cheyenne South POE',
      country: 'US',
      feed_url: LIVE_IMAGE_URL,
      source: 'WYDOT',
    }]);
  });

  it('falls back to the site name when an image has no label', () => {
    const site: WydotSite = {
      deviceId: 61,
      name: 'Green River Tunnel East',
      lat: 41.531855,
      lng: -109.45995,
      images: [{ id: 549, label: '', url: LIVE_IMAGE_URL }],
    };
    expect(mapSite(site)[0].name).toBe('Green River Tunnel East');
  });

  it('drops images without a usable URL, and sites without images', () => {
    const base: WydotSite = { deviceId: 1, name: 'X', lat: 43, lng: -107, images: [] };
    expect(mapSite(base)).toEqual([]);
    expect(mapSite({ ...base, images: [{ id: 1, label: 'A', url: '' }] })).toEqual([]);
  });

  it('drops coordinates outside Wyoming', () => {
    // Same shape, moved to Salt Lake City.
    const site: WydotSite = {
      deviceId: 1,
      name: 'X',
      lat: 40.7608,
      lng: -111.891,
      images: [{ id: 1, label: 'A', url: LIVE_IMAGE_URL }],
    };
    expect(mapSite(site)).toEqual([]);
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real WYDOT protobuf feed).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchWyomingCameras (live)', () => {
  liveIt('decodes the whole state, well-formed', async () => {
    const cams = await fetchWyomingCameras();
    expect(cams.length).toBeGreaterThan(700);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.id).toMatch(/^wydot-\d+-\d+$/);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('WYDOT');
      expect(cam.lat).toBeGreaterThan(40.9);
      expect(cam.lat).toBeLessThan(45.0);
      expect(cam.lng).toBeGreaterThan(-111.1);
      expect(cam.lng).toBeLessThan(-104.0);
      expect(cam.feed_url).toMatch(/^https:\/\/www\.wyoroad\.info\/web-cam\/cache\?ref=/);
    }
  }, 60_000);
});
