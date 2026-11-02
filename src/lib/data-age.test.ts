import { describe, expect, it } from 'vitest';
import { describeDataAge, FEED_STALE_AFTER_MS, formatAgeMs } from './data-age';

const NOW = Date.parse('2026-11-02T18:00:00Z');

describe('describeDataAge', () => {
  it('reports fresh data with its real age', () => {
    const info = describeDataAge(NOW - 2 * 60_000, NOW, FEED_STALE_AFTER_MS.flights);
    expect(info.state).toBe('fresh');
    expect(info.label).toBe('DATA 2M OLD');
  });

  it('flags data past its feed threshold as STALE', () => {
    const info = describeDataAge(NOW - 10 * 60_000, NOW, FEED_STALE_AFTER_MS.flights);
    expect(info.state).toBe('stale');
    expect(info.label).toContain('STALE');
  });

  it('never invents an age for a missing or bogus timestamp', () => {
    for (const bad of [null, undefined, 0, -5, Number.NaN]) {
      const info = describeDataAge(bad as number | null, NOW, FEED_STALE_AFTER_MS.quakes);
      expect(info.state).toBe('unknown');
      expect(info.label).toBe('AGE UNKNOWN');
      expect(info.ageMs).toBeNull();
    }
  });

  it('treats a future timestamp as just-now rather than a negative age', () => {
    const info = describeDataAge(NOW + 60_000, NOW, FEED_STALE_AFTER_MS.flights);
    expect(info.ageMs).toBe(0);
    expect(info.label).toBe('DATA JUST NOW');
  });

  it('uses per-feed thresholds — the same age is fresh for launches, stale for flights', () => {
    const at = NOW - 50 * 60_000;
    expect(describeDataAge(at, NOW, FEED_STALE_AFTER_MS.launches).state).toBe('fresh');
    expect(describeDataAge(at, NOW, FEED_STALE_AFTER_MS.flights).state).toBe('stale');
  });
});

describe('formatAgeMs', () => {
  it('formats minutes, hours and days', () => {
    expect(formatAgeMs(30_000)).toBe('JUST NOW');
    expect(formatAgeMs(12 * 60_000)).toBe('12M OLD');
    expect(formatAgeMs(3 * 3_600_000)).toBe('3H OLD');
    expect(formatAgeMs(3 * 3_600_000 + 25 * 60_000)).toBe('3H 25M OLD');
    expect(formatAgeMs(50 * 3_600_000)).toBe('2D OLD');
  });
});
