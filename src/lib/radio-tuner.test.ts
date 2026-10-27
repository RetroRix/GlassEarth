import { describe, expect, it } from 'vitest';
import {
  buildDial, formatLongitude, fractionForLongitude, hasDialCoords, indexAtFraction,
  longitudeAtFraction, nextUntriedIndex, stepIndex, type DialStation,
} from './radio-tuner';
import type { RadioStation } from './stations';

function station(partial: Partial<RadioStation> & { uuid: string }): RadioStation {
  return {
    name: partial.uuid, country: '', state: '', tags: '', bitrate: 128,
    codec: 'MP3', favicon: '', url: 'https://stream.example.com/live',
    votes: 0, ...partial,
  };
}

const NYC = station({ uuid: 'nyc', name: 'New York', lat: 40.75, lng: -73.97 });
const EL_PASO = station({ uuid: 'elp', name: 'El Paso', lat: 31.76, lng: -106.49 });
const LONDON = station({ uuid: 'lon', name: 'London', lat: 51.5, lng: -0.12 });
const TOKYO = station({ uuid: 'tok', name: 'Tokyo', lat: 35.68, lng: 139.69 });
const NO_COORDS = station({ uuid: 'noc', name: 'Nowhere' });
const HTTP_ONLY = station({ uuid: 'http', name: 'Http', lat: 10, lng: 10, url: 'http://stream.example.com/live' });
const BAD_COORDS = station({ uuid: 'bad', name: 'Bad', lat: 140, lng: 0 });

describe('buildDial — who is on the band', () => {
  it('orders stations west → east by longitude', () => {
    const dial = buildDial([TOKYO, LONDON, NYC, EL_PASO]);
    expect(dial.map(s => s.uuid)).toEqual(['elp', 'nyc', 'lon', 'tok']);
  });

  it('excludes stations without coordinates — they stay panel-only', () => {
    expect(buildDial([NYC, NO_COORDS]).map(s => s.uuid)).toEqual(['nyc']);
    expect(hasDialCoords(NO_COORDS)).toBe(false);
  });

  it('excludes out-of-range coordinate garbage', () => {
    expect(buildDial([BAD_COORDS])).toEqual([]);
  });

  it('excludes plain-http streams, which the https app can never play', () => {
    expect(buildDial([HTTP_ONLY])).toEqual([]);
  });

  it('breaks same-longitude ties deterministically (lat, then name)', () => {
    const a = station({ uuid: 'a2', name: 'Beta', lat: 41, lng: -74 });
    const b = station({ uuid: 'a1', name: 'Alpha', lat: 41, lng: -74 });
    const c = station({ uuid: 'a3', name: 'Gamma', lat: 40, lng: -74 });
    expect(buildDial([a, b, c]).map(s => s.uuid)).toEqual(['a3', 'a1', 'a2']);
  });

  it('is empty for an empty catalogue', () => {
    expect(buildDial([])).toEqual([]);
  });
});

describe('stepIndex — wrap-around stepping', () => {
  it('steps forward and backward', () => {
    expect(stepIndex(2, 1, 5)).toBe(3);
    expect(stepIndex(2, -1, 5)).toBe(1);
  });
  it('wraps at both ends', () => {
    expect(stepIndex(4, 1, 5)).toBe(0);
    expect(stepIndex(0, -1, 5)).toBe(4);
  });
  it('is -1 on an empty dial', () => {
    expect(stepIndex(0, 1, 0)).toBe(-1);
  });
});

describe('needle fractions — a true longitude scale', () => {
  const dial = buildDial([TOKYO, LONDON, NYC, EL_PASO]) as DialStation[];
  // dial order: ELP (-106.49), NYC (-73.97), LON (-0.12), TOK (139.69)

  it('places a longitude on the band linearly', () => {
    expect(fractionForLongitude(-180)).toBe(0);
    expect(fractionForLongitude(0)).toBe(0.5);
    expect(fractionForLongitude(180)).toBe(1);
    expect(fractionForLongitude(540)).toBe(1);
  });

  it('lands on the station nearest the needle longitude', () => {
    expect(indexAtFraction(fractionForLongitude(-100), dial)).toBe(0); // near El Paso
    expect(indexAtFraction(0.5, dial)).toBe(2); // Greenwich → London
    expect(indexAtFraction(1, dial)).toBe(3); // far east edge → Tokyo
    expect(indexAtFraction(0, dial)).toBe(0); // far west edge → El Paso
  });

  it('round-trips every station on a distinct meridian', () => {
    dial.forEach((s, i) => {
      expect(indexAtFraction(fractionForLongitude(s.lng), dial)).toBe(i);
    });
  });

  it('clamps drag fractions to the band and handles an empty dial', () => {
    expect(indexAtFraction(-0.5, dial)).toBe(0);
    expect(indexAtFraction(1.7, dial)).toBe(3);
    expect(indexAtFraction(0.3, [])).toBe(-1);
  });

  it('reads the needle as a longitude', () => {
    expect(longitudeAtFraction(0)).toBe(-180);
    expect(longitudeAtFraction(0.5)).toBe(0);
    expect(longitudeAtFraction(1)).toBe(180);
    expect(formatLongitude(longitudeAtFraction(0.25))).toBe('90.0° W');
    expect(formatLongitude(0)).toBe('0.0°');
    expect(formatLongitude(139.69)).toBe('139.7° E');
  });
});

describe('nextUntriedIndex — the dead-stream skip', () => {
  it('advances to the next station', () => {
    expect(nextUntriedIndex(2, 1, 5, new Set([2]))).toBe(3);
  });
  it('skips over stations that already failed in this chain', () => {
    expect(nextUntriedIndex(2, 1, 6, new Set([2, 3, 4]))).toBe(5);
  });
  it('wraps around the dial', () => {
    expect(nextUntriedIndex(4, 1, 5, new Set([4, 0]))).toBe(1);
  });
  it('returns -1 when every station has failed', () => {
    expect(nextUntriedIndex(1, 1, 3, new Set([0, 1, 2]))).toBe(-1);
  });
  it('is -1 on an empty dial', () => {
    expect(nextUntriedIndex(0, 1, 0, new Set())).toBe(-1);
  });
});
