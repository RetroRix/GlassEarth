import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PREFS, applyFired, distanceKm, evaluateIssPasses, evaluateLaunches,
  evaluateQuakes, loadSmartAlertsRecord, newAlerts, saveSmartAlertsRecord,
  unreadCount, type SmartAlert, type SmartAlertsRecord,
} from './smart-alerts';

const NOW = Date.parse('2026-11-02T17:00:00Z');
const ANCHOR = { lat: 31.76, lng: -106.49, label: 'your area' }; // El Paso

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

describe('distanceKm', () => {
  it('is zero for the same point and sane for a known hop', () => {
    expect(distanceKm(31.76, -106.49, 31.76, -106.49)).toBe(0);
    // El Paso → Las Cruces ≈ 65 km
    const d = distanceKm(31.76, -106.49, 32.31, -106.78);
    expect(d).toBeGreaterThan(55);
    expect(d).toBeLessThan(75);
  });
});

describe('evaluateQuakes', () => {
  const quake = (over: Partial<Parameters<typeof evaluateQuakes>[0][number]> = {}) => ({
    id: 'us7000', lat: 31.9, lng: -106.3, magnitude: 5.1, place: '12km S of somewhere',
    time: NOW - 600_000, depth: 8, url: 'https://example.test/q', ...over,
  });

  it('alerts on a quake meeting magnitude + radius', () => {
    const out = evaluateQuakes([quake()], ANCHOR, DEFAULT_PREFS, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('quake');
    expect(out[0].title).toContain('M5.1');
    expect(out[0].id).toBe('quake:us7000');
  });

  it('skips below-threshold, far, future, and null-magnitude quakes', () => {
    const out = evaluateQuakes([
      quake({ id: 'a', magnitude: 3.0 }),
      quake({ id: 'b', lat: 40, lng: -110 }), // ~950 km away, radius 250
      quake({ id: 'c', time: NOW + 60_000 }),
      quake({ id: 'd', magnitude: null }),
    ], ANCHOR, DEFAULT_PREFS, NOW);
    expect(out).toHaveLength(0);
  });

  it('respects the master switch', () => {
    expect(evaluateQuakes([quake()], ANCHOR, { ...DEFAULT_PREFS, quakesEnabled: false }, NOW)).toHaveLength(0);
  });
});

describe('evaluateIssPasses', () => {
  const pass = (over: Partial<Parameters<typeof evaluateIssPasses>[0][number]> = {}) => ({
    riseAt: new Date(NOW + 20 * 60_000).toISOString(),
    peakAt: new Date(NOW + 23 * 60_000).toISOString(),
    setAt: new Date(NOW + 26 * 60_000).toISOString(),
    peakElevationDeg: 42, visible: true, ...over,
  });

  it('alerts inside the lead window for a visible pass', () => {
    const out = evaluateIssPasses([pass()], ANCHOR, DEFAULT_PREFS, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].body).toContain('visible pass');
  });

  it('skips passes beyond the lead window and finished passes', () => {
    const out = evaluateIssPasses([
      pass({ riseAt: new Date(NOW + 90 * 60_000).toISOString(), setAt: new Date(NOW + 96 * 60_000).toISOString() }),
      pass({ riseAt: new Date(NOW - 20 * 60_000).toISOString(), setAt: new Date(NOW - 14 * 60_000).toISOString() }),
    ], ANCHOR, DEFAULT_PREFS, NOW);
    expect(out).toHaveLength(0);
  });

  it('visible-only default hides dark passes; turning it off labels them honestly', () => {
    const dark = pass({ visible: false });
    expect(evaluateIssPasses([dark], ANCHOR, DEFAULT_PREFS, NOW)).toHaveLength(0);
    const out = evaluateIssPasses([dark], ANCHOR, { ...DEFAULT_PREFS, issVisibleOnly: false }, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].body).toContain('not a visible pass');
  });
});

describe('evaluateLaunches', () => {
  const launch = (over: Partial<Parameters<typeof evaluateLaunches>[0][number]> = {}) => ({
    id: 'll2-1', name: 'Falcon 9 Block 5 | Starlink Group', status: 'Go for Launch',
    statusAbbrev: 'Go', net: new Date(NOW + 3 * 3_600_000).toISOString(),
    siteName: 'Kennedy Space Center, FL, USA', lat: 28.6, lng: -80.6, ...over,
  });

  it('alerts within the window with the feed status verbatim', () => {
    const out = evaluateLaunches([launch()], DEFAULT_PREFS, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].body).toContain('status: Go for Launch');
  });

  it('skips far-future, already-flown, and long-past launches', () => {
    const out = evaluateLaunches([
      launch({ id: 'a', net: new Date(NOW + 48 * 3_600_000).toISOString() }),
      launch({ id: 'b', statusAbbrev: 'Success' }),
      launch({ id: 'c', net: new Date(NOW - 2 * 3_600_000).toISOString() }),
    ], DEFAULT_PREFS, NOW);
    expect(out).toHaveLength(0);
  });
});

describe('record: dedupe, history, unread, storage', () => {
  const alert = (id: string, firedAt: number): SmartAlert => ({
    id, kind: 'quake', title: id, body: '', at: firedAt, firedAt,
  });

  it('newAlerts drops already-fired ids', () => {
    const record: SmartAlertsRecord = { prefs: DEFAULT_PREFS, fired: { 'quake:x': 1 }, history: [], lastSeenAt: 0 };
    expect(newAlerts([alert('quake:x', NOW), alert('quake:y', NOW)], record).map(a => a.id)).toEqual(['quake:y']);
  });

  it('applyFired records ids, prepends history, and unread counts unseen', () => {
    const base: SmartAlertsRecord = { prefs: DEFAULT_PREFS, fired: {}, history: [], lastSeenAt: 0 };
    const next = applyFired(base, [alert('quake:a', NOW), alert('iss:b', NOW + 1)], NOW + 1);
    expect(next.history.map(a => a.id)).toEqual(['iss:b', 'quake:a']);
    expect(unreadCount(next)).toBe(2);
    expect(unreadCount({ ...next, lastSeenAt: NOW + 1 })).toBe(0);
    expect(newAlerts([alert('quake:a', NOW + 9)], next)).toHaveLength(0);
  });

  it('prefs survive a storage round trip and bad data falls back to defaults', () => {
    const store = memoryStorage();
    const record: SmartAlertsRecord = {
      prefs: { ...DEFAULT_PREFS, quakeMinMagnitude: 5.5, notifications: true },
      fired: {}, history: [], lastSeenAt: 0,
    };
    saveSmartAlertsRecord(record, store);
    const loaded = loadSmartAlertsRecord(store);
    expect(loaded.prefs.quakeMinMagnitude).toBe(5.5);
    expect(loaded.prefs.notifications).toBe(true);

    store.setItem('osiris:smart-alerts', '{not json');
    expect(loadSmartAlertsRecord(store).prefs).toEqual(DEFAULT_PREFS);
  });
});
