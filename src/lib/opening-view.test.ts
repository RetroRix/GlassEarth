import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HOME_BASE,
  LAST_VIEW_KEY,
  isValidLatLon,
  parseGeoResponse,
  readLastView,
  resolveOpeningTarget,
  writeLastView,
} from './opening-view';

afterEach(() => {
  vi.unstubAllGlobals();
});

const memoryStore = () => {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  });
  return map;
};

describe('isValidLatLon', () => {
  it('accepts ordinary coordinates', () => {
    expect(isValidLatLon(31.7619, -106.485)).toBe(true);
    expect(isValidLatLon(-33.9, 151.2)).toBe(true);
  });

  it('rejects 0,0 — the null-island reading of a failed lookup', () => {
    expect(isValidLatLon(0, 0)).toBe(false);
  });

  it('rejects out-of-range and non-numeric values', () => {
    expect(isValidLatLon(91, 0)).toBe(false);
    expect(isValidLatLon(0, 181)).toBe(false);
    expect(isValidLatLon(NaN, 0)).toBe(false);
    expect(isValidLatLon('31.7', -106)).toBe(false);
    expect(isValidLatLon(null, null)).toBe(false);
    expect(isValidLatLon(undefined, -106)).toBe(false);
  });
});

describe('parseGeoResponse', () => {
  it('accepts a good /api/geo answer', () => {
    expect(parseGeoResponse({ status: 'success', lat: 51.5, lon: -0.13, city: 'London', country: 'United Kingdom' })).toEqual({
      lat: 51.5,
      lng: -0.13,
      city: 'London',
      country: 'United Kingdom',
    });
  });

  it('accepts an answer with no status field', () => {
    expect(parseGeoResponse({ lat: 51.5, lon: -0.13 })).toEqual({ lat: 51.5, lng: -0.13 });
  });

  it('rejects a failed lookup, 0,0, and malformed shapes', () => {
    expect(parseGeoResponse({ status: 'fail', message: 'Visitor address unknown' })).toBeNull();
    expect(parseGeoResponse({ status: 'success', lat: 0, lon: 0 })).toBeNull();
    expect(parseGeoResponse({ status: 'success', lat: 91, lon: 0 })).toBeNull();
    expect(parseGeoResponse({ status: 'success', lat: '51.5', lon: -0.13 })).toBeNull();
    expect(parseGeoResponse({ status: 'success' })).toBeNull();
    expect(parseGeoResponse(null)).toBeNull();
    expect(parseGeoResponse('London')).toBeNull();
  });
});

describe('last-view storage', () => {
  it('round-trips a view under the osiris: key', () => {
    const map = memoryStore();
    writeLastView({ lat: 40.7, lng: -74, zoom: 10 });
    expect(map.has(LAST_VIEW_KEY)).toBe(true);
    expect(readLastView()).toEqual({ lat: 40.7, lng: -74, zoom: 10 });
  });

  it('degrades to null when storage is absent or corrupt', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => '{not json',
      setItem: () => {},
      removeItem: () => {},
    });
    expect(readLastView()).toBeNull();
    expect(() => writeLastView({ lat: 1, lng: 2, zoom: 9 })).not.toThrow();
  });

  it('rejects stored views with bad coordinates or zoom', () => {
    const map = memoryStore();
    map.set(LAST_VIEW_KEY, JSON.stringify({ lat: 0, lng: 0, zoom: 9 }));
    expect(readLastView()).toBeNull();
    map.set(LAST_VIEW_KEY, JSON.stringify({ lat: 40, lng: -74, zoom: 99 }));
    expect(readLastView()).toBeNull();
    map.set(LAST_VIEW_KEY, JSON.stringify({ lat: 40, lng: -74 }));
    expect(readLastView()).toBeNull();
  });
});

describe('resolveOpeningTarget', () => {
  const geo = { lat: 51.5, lng: -0.13, city: 'London' };
  const lastView = { lat: 40.7, lng: -74, zoom: 10 };

  it('a remembered view beats the IP guess', () => {
    expect(resolveOpeningTarget({ lastView, geo })).toEqual({ lat: 40.7, lng: -74, zoom: 10, source: 'last-view' });
  });

  it('the IP guess beats home base, at the home-base zoom', () => {
    expect(resolveOpeningTarget({ lastView: null, geo })).toEqual({ lat: 51.5, lng: -0.13, zoom: HOME_BASE.zoom, source: 'geo' });
  });

  it('home base is the fallback when neither answers', () => {
    expect(resolveOpeningTarget({ lastView: null, geo: null })).toEqual({
      lat: HOME_BASE.lat,
      lng: HOME_BASE.lng,
      zoom: HOME_BASE.zoom,
      source: 'home',
    });
    expect(resolveOpeningTarget({})).toEqual({
      lat: HOME_BASE.lat,
      lng: HOME_BASE.lng,
      zoom: HOME_BASE.zoom,
      source: 'home',
    });
  });
});
