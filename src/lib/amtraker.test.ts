import { describe, it, expect } from 'vitest';
import { decodeAmtrakerFeed } from './amtraker';

/** One train, shaped the way api-v3.amtraker.com/v3/trains answers (trimmed). */
const train = (over: Record<string, unknown> = {}) => ({
  trainNum: 1,
  trainID: '1-26',
  routeName: 'Sunset Limited',
  lat: 29.7604,
  lon: -95.3698,
  velocity: 60,
  heading: 'W',
  trainState: 'Active',
  lastValTS: '2026-10-27T08:20:40-05:00',
  destName: 'Los Angeles Union',
  origName: 'New Orleans',
  eventName: 'Houston',
  ...over,
});
const answer = (byNumber: Record<string, unknown[]>) =>
  new TextEncoder().encode(JSON.stringify(byNumber));

describe('decodeAmtrakerFeed', () => {
  it('reads a moving train: compass to degrees, miles per hour to metres per second', () => {
    const { vehicles } = decodeAmtrakerFeed(answer({ '1': [train()] }));
    expect(vehicles).toHaveLength(1);
    const [v] = vehicles;
    expect(v.id).toBe('1-26');
    expect(v.lat).toBeCloseTo(29.7604);
    expect(v.lng).toBeCloseTo(-95.3698);
    expect(v.bearing).toBe(270);
    expect(v.speed).toBeCloseTo(60 * 0.44704);
    // The rider-facing name is the route; the number is the label.
    expect(v.routeId).toBe('Sunset Limited');
    expect(v.label).toBe('1');
    expect(v.tripId).toBe('1-26');
    expect(v.dest).toBe('Los Angeles Union');
    expect(v.timestamp).toBe(Math.floor(Date.parse('2026-10-27T08:20:40-05:00') / 1000));
  });

  it('keeps a train waiting to depart, at a standstill', () => {
    const { vehicles } = decodeAmtrakerFeed(answer({ '7': [train({ trainNum: 7, trainID: '7-26', trainState: 'Predeparture', velocity: 0, heading: 'NE' })] }));
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].speed).toBe(0);
    expect(vehicles[0].bearing).toBe(45);
  });

  it('leaves out finished runs and fixes that never happened', () => {
    const { vehicles } = decodeAmtrakerFeed(answer({
      '1': [train({ trainID: 'done', trainState: 'Completed' })],
      '2': [train({ trainID: 'null-island', lat: 0, lon: 0 })],
      '3': [train({ trainID: 'no-fix', lat: undefined, lon: undefined })],
      '4': [train({ trainID: 'running' })],
    }));
    expect(vehicles.map(v => v.id)).toEqual(['running']);
  });

  it('survives an unknown heading and a missing report time', () => {
    const { vehicles } = decodeAmtrakerFeed(answer({ '5': [train({ heading: 'north-ish', lastValTS: undefined })] }));
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].bearing).toBeUndefined();
    expect(vehicles[0].timestamp).toBeUndefined();
  });

  it('throws on an answer that is not Amtraker JSON', () => {
    expect(() => decodeAmtrakerFeed(new TextEncoder().encode('<html>nope</html>'))).toThrow();
    expect(() => decodeAmtrakerFeed(new TextEncoder().encode('[1,2,3]'))).toThrow();
  });
});
