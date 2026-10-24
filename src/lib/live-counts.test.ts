import { describe, expect, it } from 'vitest';
import { counterMetricStates, deriveLiveCounts } from './live-counts';

const NOW = 1_761_000_000_000; // a fixed "now" so the 24h window is testable
const HOUR = 60 * 60 * 1000;

describe('deriveLiveCounts', () => {
  it('sums the four flight buckets, and counts satellites and cameras directly', () => {
    const counts = deriveLiveCounts({
      commercial_flights: [1, 2, 3],
      private_flights: [1],
      private_jets: [],
      military_flights: [1, 2],
      satellites: new Array(42),
      cameras: new Array(66000),
      earthquakes: [],
    }, NOW);
    expect(counts).toEqual({ aircraft: 6, satellites: 42, cameras: 66000, quakes24h: 0 });
  });

  it('counts only the buckets that exist when some flight data has arrived', () => {
    const counts = deriveLiveCounts({ commercial_flights: [1, 2] }, NOW);
    expect(counts.aircraft).toBe(2);
  });

  it('reports null — never zero — for data that has not arrived', () => {
    expect(deriveLiveCounts({}, NOW)).toEqual({ aircraft: null, satellites: null, cameras: null, quakes24h: null });
    expect(deriveLiveCounts(null, NOW)).toEqual({ aircraft: null, satellites: null, cameras: null, quakes24h: null });
    expect(deriveLiveCounts(undefined, NOW).aircraft).toBeNull();
    /* A non-array where a feed should be is "unavailable", not a count. */
    expect(deriveLiveCounts({ satellites: 'lots' }, NOW).satellites).toBeNull();
  });

  it('counts quakes inside the trailing 24 hours only', () => {
    const counts = deriveLiveCounts({
      earthquakes: [
        { time: NOW - 1 * HOUR },
        { time: NOW - 23 * HOUR },
        { time: NOW - 25 * HOUR },        // yesterday's news: outside the window
        { time: NOW + 2 * 60 * 1000 },    // source clock skew: tolerated
        { time: NOW + 1 * HOUR },         // an hour in the future is not skew
        { time: 'recently' },             // unparseable: not counted
        {},                               // no timestamp: not counted
      ],
    }, NOW);
    expect(counts.quakes24h).toBe(3);
  });

  it('an arrived-but-empty earthquake feed is a real zero', () => {
    expect(deriveLiveCounts({ earthquakes: [] }, NOW).quakes24h).toBe(0);
  });
});

describe('counterMetricStates', () => {
  const EMPTY = { aircraft: null, satellites: null, cameras: null, quakes24h: null };
  const FULL = { aircraft: 5000, satellites: 42, cameras: 66000, quakes24h: 3 };

  it('shows numbers for arrived data and hides the rest', () => {
    expect(counterMetricStates(FULL, 'idle')).toEqual({
      aircraft: 'number', satellites: 'number', cameras: 'number', quakes24h: 'number',
    });
    expect(counterMetricStates(EMPTY, 'idle')).toEqual({
      aircraft: 'hidden', satellites: 'hidden', cameras: 'hidden', quakes24h: 'hidden',
    });
  });

  it('keeps AIR visible while flights load — spinner, never a silent absence', () => {
    const states = counterMetricStates(EMPTY, 'loading');
    expect(states.aircraft).toBe('loading');
    expect(states.satellites).toBe('hidden');
    /* Once a number has landed, the number wins over the loading state. */
    expect(counterMetricStates(FULL, 'loading').aircraft).toBe('number');
  });

  it('shows AIR as an error dash after a failed fetch, still not a zero', () => {
    expect(counterMetricStates(EMPTY, 'error').aircraft).toBe('error');
    expect(counterMetricStates(FULL, 'error').aircraft).toBe('number');
  });
});
