import { describe, expect, it } from 'vitest';
import {
  FLIGHT_RETRY_DELAYS_MS,
  FLIGHT_STALE_REFETCH_ATTEMPTS,
  FLIGHT_STALE_REFETCH_MS,
  flightsForRide,
  hasFlightData,
  isPartialFlightPayload,
  isStaleFlightPayload,
  nextFlightRetryDelay,
  FLIGHT_SWEEP_DEADLINE_MS,
  isStaleSweepPromise,
  normalizeFlightPayload,
  recordForRide,
} from './flight-load';

describe('nextFlightRetryDelay', () => {
  it('backs off 15s then 30s, then stops', () => {
    expect(FLIGHT_RETRY_DELAYS_MS).toEqual([15_000, 30_000]);
    expect(nextFlightRetryDelay(0)).toBe(15_000);
    expect(nextFlightRetryDelay(1)).toBe(30_000);
    expect(nextFlightRetryDelay(2)).toBeNull();
    expect(nextFlightRetryDelay(99)).toBeNull();
    expect(nextFlightRetryDelay(-1)).toBeNull();
  });

  it('bounds the stale/partial refetch to a couple of quick comebacks', () => {
    expect(FLIGHT_STALE_REFETCH_MS).toBe(30_000);
    expect(FLIGHT_STALE_REFETCH_ATTEMPTS).toBe(2);
  });
});

describe('hasFlightData', () => {
  it('is true once any bucket has aircraft', () => {
    expect(hasFlightData({ commercial_flights: [1] })).toBe(true);
    expect(hasFlightData({ military_flights: [1, 2] })).toBe(true);
    expect(hasFlightData({ private_jets: [1] })).toBe(true);
  });

  it('is false for no data, null, or arrived-but-empty feeds', () => {
    expect(hasFlightData({})).toBe(false);
    expect(hasFlightData(null)).toBe(false);
    expect(hasFlightData(undefined)).toBe(false);
    expect(hasFlightData({ commercial_flights: [], private_flights: [] })).toBe(false);
    expect(hasFlightData({ commercial_flights: 'lots' })).toBe(false);
  });
});

describe('payload shape flags', () => {
  it('reads the route\'s partial/stale markers strictly', () => {
    expect(isPartialFlightPayload({ partial: true })).toBe(true);
    expect(isPartialFlightPayload({ partial: false })).toBe(false);
    expect(isPartialFlightPayload({})).toBe(false);
    expect(isPartialFlightPayload(null)).toBe(false);
    expect(isStaleFlightPayload({ stale: true })).toBe(true);
    expect(isStaleFlightPayload({ stale: 1 })).toBe(false);
    expect(isStaleFlightPayload(undefined)).toBe(false);
  });
});

describe('normalizeFlightPayload', () => {
  it('coerces a stale flag to a real boolean and keeps the buckets', () => {
    const out = normalizeFlightPayload({ stale: 1, commercial_flights: [1, 2] });
    expect(out.stale).toBe(false);
    expect(out.partial).toBe(false);
    expect(out.commercial_flights).toEqual([1, 2]);
  });
  it('keeps a true stale flag and drops a stale flag after a fresh payload', () => {
    expect(normalizeFlightPayload({ stale: true }).stale).toBe(true);
    expect(normalizeFlightPayload({}).stale).toBe(false);
    expect(normalizeFlightPayload({ partial: true }).partial).toBe(true);
  });
});

describe('sweep deadline', () => {
  it('sits comfortably inside the route maxDuration', () => {
    expect(FLIGHT_SWEEP_DEADLINE_MS).toBeLessThan(60_000);
  });
});

describe('isStaleSweepPromise', () => {
  it('keeps a young promise and discards one older than maxDuration', () => {
    expect(isStaleSweepPromise(1_000, 60_000)).toBe(false);
    expect(isStaleSweepPromise(1_000, 66_001)).toBe(true);
    expect(isStaleSweepPromise(1_000, 66_000)).toBe(false);
  });
});

/* ── The 2026-10-26 fix: a ride must survive a partial sweep ── */

describe('recordForRide', () => {
  const held = { icao24: 'abc123', alt: 35_000 };
  const current = { icao24: 'abc123', alt: 36_000 };

  it('prefers the current record whenever the feed has it', () => {
    expect(recordForRide(current, held, true)).toBe(current);
    expect(recordForRide(current, held, false)).toBe(current);
    expect(recordForRide(current, null, true)).toBe(current);
  });

  it('holds the last record through a partial payload — absence there is no data', () => {
    expect(recordForRide(null, held, true)).toBe(held);
    expect(recordForRide(undefined, held, true)).toBe(held);
  });

  it('a complete payload is allowed to say the aircraft is gone', () => {
    expect(recordForRide(null, held, false)).toBeNull();
    expect(recordForRide(null, null, true)).toBeNull();
  });
});

describe('flightsForRide', () => {
  const a = { icao24: 'a', alt: 1 };
  const b = { icao24: 'b', alt: 2 };
  const c = { icao24: 'c', alt: 3 };

  it('returns the current rows untouched outside a partial payload', () => {
    expect(flightsForRide([a], [a, b, c], false)).toEqual([a]);
  });

  it('merges held rows under the partial rows, current winning per aircraft', () => {
    const aFresh = { icao24: 'a', alt: 99 };
    const merged = flightsForRide([aFresh], [a, b, c], true);
    expect(merged).toHaveLength(3);
    expect(merged.find(f => f.icao24 === 'a')?.alt).toBe(99);
    expect(merged.map(f => f.icao24).sort()).toEqual(['a', 'b', 'c']);
  });

  it('with nothing held, the partial rows stand alone', () => {
    expect(flightsForRide([a], [], true)).toEqual([a]);
  });
});
