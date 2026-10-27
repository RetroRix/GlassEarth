import { describe, expect, it } from 'vitest';
import {
  addDays, cachedProbe, clampToWindow, dcTileUrl, dcTiles, diffDays, formatDcDate, gibsTileUrl, gibsTiles,
  headProbe, parseDcTileParams, parseGibsLatest, resolveSide, sampleTiles, snapCandidates, tileXY, windowEnding,
  type DcProbe, type DcTile,
} from './date-compare';

const W = windowEnding('2026-10-25'); // start 2026-09-26, end 2026-10-25
const TILES: DcTile[] = [{ z: 12, x: 828, y: 1647 }];

describe('calendar', () => {
  it('windows the last 30 days ending at the latest published date', () => {
    expect(W).toEqual({ start: '2026-09-26', end: '2026-10-25' });
  });
  it('adds and diffs days across month borders', () => {
    expect(addDays('2026-10-25', -14)).toBe('2026-10-11');
    expect(addDays('2026-09-26', 29)).toBe('2026-10-25');
    expect(diffDays('2026-10-11', '2026-10-25')).toBe(14);
  });
  it('clamps picks into the window', () => {
    expect(clampToWindow('2026-08-01', W)).toBe('2026-09-26');
    expect(clampToWindow('2026-12-01', W)).toBe('2026-10-25');
    expect(clampToWindow('2026-10-10', W)).toBe('2026-10-10');
  });
  it('labels dates in UTC', () => {
    expect(formatDcDate('2026-10-24')).toBe('SAT 24 OCT');
    expect(formatDcDate('2026-09-26')).toBe('SAT 26 SEP');
  });
});

describe('snapCandidates', () => {
  it('walks nearest-first, earlier date winning the tie', () => {
    expect(snapCandidates('2026-10-20', W).slice(0, 5)).toEqual([
      '2026-10-20', '2026-10-19', '2026-10-21', '2026-10-18', '2026-10-22',
    ]);
  });
  it('stays inside the window at the edges and covers it whole', () => {
    const atEnd = snapCandidates('2026-10-25', W);
    expect(atEnd[0]).toBe('2026-10-25');
    expect(new Set(atEnd).size).toBe(30);
    expect(Math.min(...atEnd.map(d => diffDays('2026-09-26', d)))).toBe(0);
    const atStart = snapCandidates('2026-09-26', W);
    expect(new Set(atStart).size).toBe(30);
  });
  it('clamps an out-of-window pick before walking', () => {
    expect(snapCandidates('2026-08-01', W)[0]).toBe('2026-09-26');
  });
});

describe('tiles', () => {
  it('builds the verified GIBS WMTS template', () => {
    expect(gibsTileUrl('s30', '2026-10-24', 12, 828, 1647)).toBe(
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/HLS_S30_Nadir_BRDF_Adjusted_Reflectance/default/2026-10-24/GoogleMapsCompatible_Level12/12/1647/828.png',
    );
    expect(gibsTiles('l30', '2026-10-23')[0]).toContain('HLS_L30_Nadir_BRDF_Adjusted_Reflectance/default/2026-10-23/GoogleMapsCompatible_Level12/{z}/{y}/{x}.png');
  });
  it('locates Elephant Butte reservoir at zoom 12', () => {
    expect(tileXY(33.15, -107.18, 12)).toEqual({ x: 828, y: 1647 });
  });
  it('samples a deduped lattice across a view', () => {
    const tiles = sampleTiles({ west: -107.6, south: 32.8, east: -106.8, north: 33.5 });
    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles.length).toBeLessThanOrEqual(9);
    expect(new Set(tiles.map(t => `${t.x}/${t.y}`)).size).toBe(tiles.length);
    const tiny = sampleTiles({ west: -107.19, south: 33.14, east: -107.17, north: 33.16 });
    expect(tiny.length).toBe(1);
  });
});

/** A probe scripted by "sensor:date" keys that carry imagery. */
const scripted = (have: Set<string>): DcProbe =>
  async (sensor, date) => have.has(`${sensor}:${date}`);

describe('resolveSide', () => {
  it('takes the picked date on Sentinel-2 when it has a pass', async () => {
    const r = await resolveSide('2026-10-24', W, TILES, scripted(new Set(['s30:2026-10-24'])));
    expect(r).toEqual({ picked: '2026-10-24', actual: '2026-10-24', sensor: 's30', snappedDays: 0 });
  });
  it('falls back to Landsat on the same date before snapping away', async () => {
    const r = await resolveSide('2026-10-24', W, TILES, scripted(new Set(['l30:2026-10-24'])));
    expect(r?.sensor).toBe('l30');
    expect(r?.actual).toBe('2026-10-24');
  });
  it('snaps to the nearest covered date, earlier first', async () => {
    const r = await resolveSide('2026-10-24', W, TILES, scripted(new Set(['s30:2026-10-22', 's30:2026-10-25'])));
    // walk order from the pick: 24, 23, 25 — the +1 day is reached before −2
    expect(r?.actual).toBe('2026-10-25');
    expect(r?.snappedDays).toBe(1);
  });
  it('prefers the earlier date when both neighbours are one day out', async () => {
    const r = await resolveSide('2026-10-24', W, TILES, scripted(new Set(['l30:2026-10-23', 's30:2026-10-25'])));
    expect(r?.actual).toBe('2026-10-23');
    expect(r?.sensor).toBe('l30');
  });
  it('returns null when nothing in the window covers the view', async () => {
    expect(await resolveSide('2026-10-24', W, TILES, scripted(new Set()))).toBeNull();
    expect(await resolveSide('2026-10-24', W, [], scripted(new Set(['s30:2026-10-24'])))).toBeNull();
  });
});

describe('headProbe', () => {
  const tile: DcTile[] = [{ z: 12, x: 1, y: 2 }];
  const fakeFetch = (headers: Record<string, string>, ok = true) =>
    (async () => ({ ok, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } })) as unknown as typeof fetch;
  it('reads the layer-time-actual header as the ground truth', async () => {
    const probe = headProbe(fakeFetch({ 'layer-time-actual': '2026-10-24T00:00:00Z' }));
    expect(await probe('s30', '2026-10-24', tile)).toBe(true);
  });
  it('treats a blank-tile 200 (no header) as no data', async () => {
    const probe = headProbe(fakeFetch({}));
    expect(await probe('s30', '2026-10-23', tile)).toBe(false);
  });
  it('treats failures as no data, never as data', async () => {
    const boom = (async () => { throw new Error('net'); }) as unknown as typeof fetch;
    expect(await headProbe(boom)('l30', '2026-10-24', tile)).toBe(false);
    expect(await headProbe(fakeFetch({ 'layer-time-actual': 'x' }, false))('l30', '2026-10-24', tile)).toBe(false);
  });
});

describe('the same-origin tile hop', () => {
  it('builds app-relative tile URLs for probes and sources', () => {
    expect(dcTileUrl('s30', '2026-10-24', 12, 828, 1647)).toBe(
      '/api/date-compare/tile?l=s30&d=2026-10-24&z=12&x=828&y=1647');
    expect(dcTiles('l30', '2026-10-23')[0]).toBe(
      '/api/date-compare/tile?l=l30&d=2026-10-23&z={z}&x={x}&y={y}');
  });
  it('probes ask the app route, never GIBS directly', async () => {
    const seen: string[] = [];
    const spy = (async (u: string) => {
      seen.push(String(u));
      return { ok: true, headers: { get: () => '2026-10-24T00:00:00Z' } };
    }) as unknown as typeof fetch;
    expect(await headProbe(spy)('s30', '2026-10-24', TILES)).toBe(true);
    expect(seen[0]).toMatch(/^\/api\/date-compare\/tile\?/);
  });
  it('validates tile params and rejects anything off-spec', () => {
    const q = (s: string) => new URLSearchParams(s);
    expect(parseDcTileParams(q('l=s30&d=2026-10-24&z=12&x=828&y=1647'))).toEqual(
      { sensor: 's30', date: '2026-10-24', z: 12, x: 828, y: 1647 });
    expect(parseDcTileParams(q('l=viirs&d=2026-10-24&z=12&x=1&y=1'))).toBeNull();
    expect(parseDcTileParams(q('l=s30&d=24-10-2026&z=12&x=1&y=1'))).toBeNull();
    expect(parseDcTileParams(q('l=s30&d=2026-13-40&z=12&x=1&y=1'))).toBeNull();
    expect(parseDcTileParams(q('l=s30&d=2026-10-24&z=13&x=1&y=1'))).toBeNull();
    expect(parseDcTileParams(q('l=s30&d=2026-10-24&z=12&x=4096&y=1'))).toBeNull();
    expect(parseDcTileParams(q('l=s30&d=2026-10-24&z=12&x=-1&y=1'))).toBeNull();
  });
});

describe('parseGibsLatest', () => {
  const xml = `<Layer><ows:Identifier>HLS_S30_Nadir_BRDF_Adjusted_Reflectance</ows:Identifier>
    <Dimension><ows:Identifier>Time</ows:Identifier><Default>2026-10-25</Default>
    <Value>2023-07-14/2025-08-24/P1D</Value><Value>2025-08-26/2026-10-25/P1D</Value></Dimension></Layer>
    <Layer><ows:Identifier>HLS_L30_Nadir_BRDF_Adjusted_Reflectance</ows:Identifier>
    <Dimension><ows:Identifier>Time</ows:Identifier><Default>2026-10-24</Default>
    <Value>2022-11-02/2026-10-24/P1D</Value></Dimension></Layer>`;
  it('reads each layer’s own newest date', () => {
    expect(parseGibsLatest(xml, 's30')).toBe('2026-10-25');
    expect(parseGibsLatest(xml, 'l30')).toBe('2026-10-24');
  });
  it('returns null for a missing layer', () => {
    expect(parseGibsLatest('<Layer></Layer>', 's30')).toBeNull();
  });
});

describe('cachedProbe', () => {
  it('asks the underlying probe once per sensor/date/tiles', async () => {
    let calls = 0;
    const inner: DcProbe = async () => { calls += 1; return true; };
    const probe = cachedProbe(inner);
    await probe('s30', '2026-10-24', TILES);
    await probe('s30', '2026-10-24', TILES);
    await probe('s30', '2026-10-23', TILES);
    expect(calls).toBe(2);
  });
});
