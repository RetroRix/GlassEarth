import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ambientPool,
  FAVORITES_KEY,
  isWallPlayable,
  pickRouletteCamera,
  rouletteCandidates,
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

describe('ambientPool', () => {
  it('leads with continuous motion ahead of a higher-scored still', () => {
    const cameras = [
      cam({ id: 'still', source: 'Public Webcam', name: 'Beach', feed_url: 'https://a/s.jpg' }),
      cam({ id: 'stream', source: 'Port', name: 'Harbour', stream_type: 'mjpeg', stream_url: 'https://a/m.mjpeg' }),
    ];
    /* Score order says the still (5) beats the stream (2); Ambient reverses
       them, because on a television the moving picture is the show. */
    expect(scenicPool(cameras).map(c => c.id)).toEqual(['still', 'stream']);
    expect(ambientPool(cameras).map(c => c.id)).toEqual(['stream', 'still']);
  });

  it('keeps scenic-score order inside the motion group and the fill group', () => {
    const cameras = [
      cam({ id: 'jpg-high', source: 'Public Webcam', name: 'Beach Falls Lake', feed_url: 'https://a/j.jpg' }),
      cam({ id: 'hls-low', source: 'Public Webcam', name: 'Pier', stream_type: 'hls', stream_url: 'https://a/1.m3u8' }),
      cam({ id: 'mp4-high', source: 'Public Webcam', name: 'Beach Falls', stream_type: 'mp4', stream_url: 'https://a/v.mp4' }),
      cam({ id: 'jpg-low', source: 'WSDOT', name: 'Beach', feed_url: 'https://a/j2.jpg' }),
    ];
    expect(scenicPool(cameras).map(c => c.id)).toEqual(['jpg-high', 'mp4-high', 'hls-low', 'jpg-low']);
    expect(ambientPool(cameras).map(c => c.id)).toEqual(['mp4-high', 'hls-low', 'jpg-high', 'jpg-low']);
  });

  it('treats iframe embeds as fill, not motion', () => {
    const cameras = [
      cam({ id: 'embed', source: 'Public Webcam', name: 'Beach', stream_type: 'iframe', stream_url: 'https://a/e' }),
      cam({ id: 'clip', source: 'WSDOT', name: 'River', stream_type: 'mp4', stream_url: 'https://a/c.mp4' }),
    ];
    expect(ambientPool(cameras).map(c => c.id)).toEqual(['clip', 'embed']);
  });

  it('pulls a motion camera in from below the scenic cut before filling with stills', () => {
    const stills = Array.from({ length: 50 }, (_, i) =>
      cam({ id: `still-${i}`, source: 'Public Webcam', name: 'Beach', feed_url: `https://a/${i}.jpg` }));
    const stream = cam({ id: 'stream-a', source: 'WSDOT', name: 'Harbour', stream_type: 'hls', stream_url: 'https://a/a.m3u8' });
    const cameras = [...stills, stream];
    /* On score alone the stream ranks 51st and misses the 48-cut entirely. */
    expect(scenicPool(cameras, 48).map(c => c.id)).not.toContain('stream-a');
    const pool = ambientPool(cameras, 48);
    expect(pool).toHaveLength(48);
    expect(pool[0].id).toBe('stream-a');
    expect(pool.filter(c => String(c.id).startsWith('still-'))).toHaveLength(47);
  });

  it('falls back to playable cameras, still motion-first, when nothing scores', () => {
    const cameras = [
      cam({ id: 'road-still', source: 'WSDOT', name: 'I-5 Interchange', feed_url: 'https://a/r.jpg' }),
      cam({ id: 'road-stream', source: 'WSDOT', name: 'I-90 Interchange', stream_type: 'mjpeg', stream_url: 'https://a/r.mjpeg' }),
      cam({ id: 'dead', source: 'WSDOT', name: 'I-5' }),
    ];
    expect(ambientPool(cameras).map(c => c.id)).toEqual(['road-stream', 'road-still']);
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

describe('roulette', () => {
  const still = (id: string, over: Partial<WallCamera> = {}) =>
    cam({ id, feed_url: `https://a/${id}.jpg`, lat: 31.7, lng: -106.4, ...over });
  const stream = (id: string, over: Partial<WallCamera> = {}) =>
    cam({ id, stream_type: 'hls', stream_url: `https://a/${id}.m3u8`, lat: 51.5, lng: -0.12, ...over });

  it('candidates must be playable AND have coordinates', () => {
    const cameras = [
      still('ok'),
      cam({ id: 'no-coords', feed_url: 'https://a/x.jpg' }),
      cam({ id: 'nan-coords', feed_url: 'https://a/x.jpg', lat: Number.NaN, lng: 0 }),
      cam({ id: 'unplayable', lat: 1, lng: 1 }),
      stream('stream-ok'),
    ];
    expect(rouletteCandidates(cameras).map(c => c.id)).toEqual(['ok', 'stream-ok']);
  });

  it('returns null when nothing can be landed on', () => {
    expect(pickRouletteCamera([])).toBeNull();
    expect(pickRouletteCamera([cam({ id: 'dead' })])).toBeNull();
    expect(pickRouletteCamera([cam({ id: 'lost', feed_url: 'https://a/x.jpg' })])).toBeNull();
  });

  it('prefers continuous-motion cameras over stills', () => {
    const cameras = [still('a'), still('b'), stream('live')];
    /* Roll every position in the draw: only the stream may ever come up. */
    for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
      expect(pickRouletteCamera(cameras, null, () => roll)?.id).toBe('live');
    }
  });

  it('draws uniformly across the pool the rng selects', () => {
    const cameras = [stream('s1'), stream('s2'), stream('s3')];
    expect(pickRouletteCamera(cameras, null, () => 0)?.id).toBe('s1');
    expect(pickRouletteCamera(cameras, null, () => 0.5)?.id).toBe('s2');
    expect(pickRouletteCamera(cameras, null, () => 0.999)?.id).toBe('s3');
    /* An out-of-range roll is clamped, never an undefined pick. */
    expect(pickRouletteCamera(cameras, null, () => 1)?.id).toBe('s3');
  });

  it('never repeats the open camera while an alternative exists', () => {
    const cameras = [stream('open'), stream('other-1'), stream('other-2')];
    for (let i = 0; i < 50; i++) {
      const roll = i / 50;
      expect(pickRouletteCamera(cameras, 'open', () => roll)?.id).not.toBe('open');
    }
    /* Numeric ids and string exclusions compare by catalogue key. */
    const numeric = [stream('7', { id: 7 }), stream('8', { id: 8 })];
    expect(pickRouletteCamera(numeric, '7', () => 0)?.id).toBe(8);
  });

  it('falls back to stills when no motion camera exists, and to the sole candidate when exclusion empties the pool', () => {
    const stills = [still('p1'), still('p2')];
    expect(pickRouletteCamera(stills, null, () => 0.9)?.id).toBe('p2');
    expect(pickRouletteCamera([stream('only')], 'only', () => 0)?.id).toBe('only');
  });
});
