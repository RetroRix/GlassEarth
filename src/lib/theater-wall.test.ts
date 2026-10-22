import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FAVORITES_KEY,
  isWallPlayable,
  loadAssignments,
  loadFavorites,
  loadLayout,
  rotateWindow,
  saveAssignments,
  saveFavorites,
  saveLayout,
  scenicPool,
  texasPreset,
  wallMedia,
  type WallCamera,
} from './theater-wall';

const cam = (over: Partial<WallCamera>): WallCamera => ({ id: 'x', name: 'Cam', ...over });

afterEach(() => vi.unstubAllGlobals());

describe('wallMedia', () => {
  it('plays snapshots, streams and direct embeds; refuses the rest', () => {
    expect(wallMedia(cam({ stream_type: 'jpg', feed_url: 'https://a/1.jpg' }))?.kind).toBe('jpg');
    expect(wallMedia(cam({ stream_type: 'hls', stream_url: 'https://a/s.m3u8' }))?.kind).toBe('hls');
    expect(wallMedia(cam({ stream_type: 'iframe', stream_url: 'https://www.youtube.com/embed/abc' }))?.kind).toBe('iframe');
    /* A wrapper page with no direct URL needs the resolver — not a tile. */
    expect(wallMedia(cam({ stream_type: 'iframe', external_url: 'https://skylinewebcams.com/x' }))).toBeNull();
    expect(wallMedia(cam({}))).toBeNull();
    expect(isWallPlayable(cam({ feed_url: 'https://a/1.jpg' }))).toBe(true);
  });
});

describe('texasPreset', () => {
  it('keeps only playable TxDOT cameras, El Paso district first', () => {
    const cameras = [
      cam({ id: 'dal', source: 'TxDOT', city: 'Dallas', feed_url: 'https://a/d.jpg' }),
      cam({ id: 'elp-1', source: 'TxDOT', city: 'El Paso', feed_url: 'https://a/e1.jpg' }),
      cam({ id: 'tfL', source: 'TfL', city: 'London', feed_url: 'https://a/l.jpg' }),
      cam({ id: 'elp-2', source: 'TxDOT', city: 'El Paso', feed_url: 'https://a/e2.jpg' }),
      cam({ id: 'hou-dead', source: 'TxDOT', city: 'Houston' }),
    ];
    expect(texasPreset(cameras).map(c => c.id)).toEqual(['elp-1', 'elp-2', 'dal']);
  });
});

describe('scenicPool', () => {
  it('ranks curated scenic cameras above plain playable ones', () => {
    const cameras = [
      cam({ id: 'road', source: 'WSDOT', name: 'I-5 Interchange', feed_url: 'https://a/r.jpg' }),
      cam({ id: 'beach', source: 'Public Webcam', name: 'Maho Beach', stream_type: 'hls', stream_url: 'https://a/b.m3u8' }),
      cam({ id: 'falls', source: 'Public Webcam', name: 'Brooks Falls', feed_url: 'https://a/f.jpg' }),
    ];
    const pool = scenicPool(cameras);
    expect(pool.map(c => c.id)).toContain('beach');
    expect(pool[0].id).toBe('beach');
  });

  it('falls back to any playable camera when nothing scores', () => {
    const cameras = [cam({ id: 'road', source: 'WSDOT', name: 'I-5 Interchange', feed_url: 'https://a/r.jpg' })];
    expect(scenicPool(cameras).map(c => c.id)).toEqual(['road']);
  });
});

describe('rotateWindow', () => {
  it('pages through the pool and wraps', () => {
    const pool = ['a', 'b', 'c', 'd', 'e'];
    expect(rotateWindow(pool, 2, 0)).toEqual(['a', 'b']);
    expect(rotateWindow(pool, 2, 1)).toEqual(['c', 'd']);
    expect(rotateWindow(pool, 2, 2)).toEqual(['e', 'a']);
    expect(rotateWindow([], 4, 0)).toEqual([]);
  });
});

describe('persistence', () => {
  function fakeStorage() {
    const map = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, v); },
      removeItem: (k: string) => { map.delete(k); },
    });
    return map;
  }

  it('round-trips favourites, assignments and layout', () => {
    fakeStorage();
    saveFavorites(['a', 'b']);
    expect(loadFavorites()).toEqual(['a', 'b']);
    saveAssignments(['a', null, 'c']);
    expect(loadAssignments()).toEqual(['a', null, 'c']);
    saveLayout(4);
    expect(loadLayout()).toBe(4);
  });

  it('survives corrupt and absent storage', () => {
    const map = fakeStorage();
    map.set(FAVORITES_KEY, '{not json');
    expect(loadFavorites()).toEqual([]);
    expect(loadLayout()).toBe(3);
    vi.unstubAllGlobals();
    expect(loadFavorites()).toEqual([]);
    expect(loadAssignments()).toBeNull();
  });
});
