import { describe, expect, it } from 'vitest';
import {
  FLIGHT_RETRY_DELAYS_MS,
  FLIGHT_STALE_REFETCH_ATTEMPTS,
  FLIGHT_STALE_REFETCH_MS,
  hasFlightData,
  isPartialFlightPayload,
  isStaleFlightPayload,
  nextFlightRetryDelay,
  normalizeFlightPayload,
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
