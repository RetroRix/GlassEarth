import { describe, expect, it } from 'vitest';
import { rateNearMe, type HeatLike } from './near-me';
import type { IssPassLike, LaunchLike, QuakeLike } from './smart-alerts';

const NOW = Date.parse('2026-11-02T18:00:00Z');
const ANCHOR = { lat: 31.76, lng: -106.48, label: 'El Paso' };

const quake = (partial: Partial<QuakeLike>): QuakeLike => ({
  id: 'q1', lat: 31.76, lng: -103.31, magnitude: 4.0, place: 'West Texas', time: NOW - 3_600_000, ...partial,
});
const pass = (partial: Partial<IssPassLike>): IssPassLike => ({
  riseAt: new Date(NOW + 2 * 3_600_000).toISOString(),
  peakAt: new Date(NOW + 2 * 3_600_000 + 300_000).toISOString(),
  setAt: new Date(NOW + 2 * 3_600_000 + 600_000).toISOString(),
  peakElevationDeg: 63, visible: true, ...partial,
});
const launch = (partial: Partial<LaunchLike>): LaunchLike => ({
  id: 'l1', name: 'Falcon 9 — Starlink', status: 'Go for Launch', statusAbbrev: 'Go',
  net: new Date(NOW + 12 * 3_600_000).toISOString(), siteName: 'Blue Origin Corn Ranch',
  lat: 31.9, lng: -106.3, ...partial,
});
const heat = (i: number): HeatLike => ({ lat: 31.8 + i * 0.01, lng: -106.4, title: 'detection', type: 'fire' });

const base = { anchor: ANCHOR, quakes: [] as QuakeLike[], passes: [] as IssPassLike[], launches: [] as LaunchLike[], fires: null, now: NOW };

describe('rateNearMe', () => {
  it('is QUIET when every feed is calm, and prints every input', () => {
    const r = rateNearMe(base);
    expect(r.level).toBe('QUIET');
    expect(r.reasons).toEqual([]);
    expect(r.inputs).toHaveLength(4);
    expect(r.inputs.join(' ')).toContain('not loaded');
  });

  it('raises WATCH for an M4.5+ quake within 500 km', () => {
    const r = rateNearMe({ ...base, quakes: [quake({ magnitude: 4.6 })] });
    expect(r.level).toBe('WATCH');
    expect(r.reasons[0]).toContain('M4.6 earthquake');
  });

  it('raises ELEVATED for M6.0+ anywhere within 500 km', () => {
    const r = rateNearMe({ ...base, quakes: [quake({ magnitude: 6.1, lng: -101.41 })] });
    expect(r.level).toBe('ELEVATED');
  });

  it('raises ELEVATED for M5.5+ within 250 km but only WATCH at 300 km', () => {
    expect(rateNearMe({ ...base, quakes: [quake({ magnitude: 5.6, lng: -104.37 })] }).level).toBe('ELEVATED');
    expect(rateNearMe({ ...base, quakes: [quake({ magnitude: 5.6, lng: -103.31 })] }).level).toBe('WATCH');
  });

  it('ignores quakes beyond 500 km and null magnitudes', () => {
    const r = rateNearMe({ ...base, quakes: [quake({ magnitude: 7.0, lng: -100.14 }), quake({ magnitude: null, lng: -106.4 })] });
    expect(r.level).toBe('QUIET');
  });

  it('raises WATCH for a visible ISS pass within 3 h, not for an invisible one', () => {
    expect(rateNearMe({ ...base, passes: [pass({})] }).level).toBe('WATCH');
    expect(rateNearMe({ ...base, passes: [pass({ visible: false })] }).level).toBe('QUIET');
  });

  it('raises WATCH for a nearby launch NET within 24 h; flown and far launches do not count', () => {
    expect(rateNearMe({ ...base, launches: [launch({})] }).level).toBe('WATCH');
    expect(rateNearMe({ ...base, launches: [launch({ statusAbbrev: 'Success' })] }).level).toBe('QUIET');
    expect(rateNearMe({ ...base, launches: [launch({ lat: 28.4, lng: -80.6 })] }).level).toBe('QUIET');
  });

  it('raises WATCH (never ELEVATED) for a cluster of heat detections', () => {
    const many = Array.from({ length: 40 }, (_, i) => heat(i));
    expect(rateNearMe({ ...base, fires: many }).level).toBe('WATCH');
    expect(rateNearMe({ ...base, fires: many.slice(0, 7) }).level).toBe('QUIET');
  });

  it('says so when a feed is unavailable instead of scoring its silence', () => {
    const r = rateNearMe({ ...base, quakes: null, passes: null });
    expect(r.level).toBe('QUIET');
    expect(r.inputs.join(' ')).toContain('feed unavailable this check');
  });
});
