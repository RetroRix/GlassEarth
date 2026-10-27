import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MISSIONS,
  MISSIONS_STORAGE_KEY,
  applyMissionEvent,
  completeMission,
  dismissMissions,
  missionIdForEvent,
  missionProgress,
  parseMissionsState,
  readMissionsState,
  serializeMissionsState,
  shouldAutoOpenMissions,
  writeMissionsState,
  type MissionEvent,
  type MissionsState,
} from './missions';

afterEach(() => {
  vi.unstubAllGlobals();
});

const memoryStore = () => {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  });
  return map;
};

describe('mission definitions', () => {
  it('has exactly the five hands-on missions, each with a real next step', () => {
    expect(MISSIONS.map(m => m.id)).toEqual(['cockpit', 'camera', 'radio', 'compare', 'track']);
    for (const mission of MISSIONS) {
      expect(mission.title.length).toBeGreaterThan(3);
      expect(mission.why.length).toBeGreaterThan(10);
      expect(mission.actionLabel.length).toBeGreaterThan(3);
      expect(mission.guide.length).toBeGreaterThan(10);
    }
  });

  it('keeps the copy plain — no spy-thriller dressing', () => {
    const copy = MISSIONS.map(m => `${m.title} ${m.why} ${m.actionLabel} ${m.guide}`).join(' ');
    expect(copy).not.toMatch(/operative|mission control|covert|recon/i);
  });
});

describe('missions persistence', () => {
  it('reads an absent record as a genuine first run', () => {
    memoryStore();
    const record = readMissionsState();
    expect(record).toEqual({
      stored: false,
      state: { dismissed: false, completed: [] },
    });
    expect(shouldAutoOpenMissions(record)).toBe(true);
  });

  it('round-trips dismissed and completed state under osiris:missions', () => {
    const store = memoryStore();
    const state: MissionsState = {
      dismissed: true,
      completed: ['track', 'cockpit'],
    };
    writeMissionsState(state);
    expect(store.get(MISSIONS_STORAGE_KEY)).toBe('{"dismissed":true,"completed":["cockpit","track"]}');
    expect(readMissionsState()).toEqual({
      stored: true,
      state: { dismissed: true, completed: ['cockpit', 'track'] },
    });
  });

  it('a stored dismissal never auto-opens again', () => {
    memoryStore();
    writeMissionsState(dismissMissions({ dismissed: false, completed: [] }));
    expect(shouldAutoOpenMissions(readMissionsState())).toBe(false);
  });

  it('sanitises unknown and duplicate mission ids from storage', () => {
    expect(parseMissionsState('{"dismissed":false,"completed":["radio","nope","radio","cockpit"]}')).toEqual({
      dismissed: false,
      completed: ['cockpit', 'radio'],
    });
  });

  it('treats corrupt storage as an empty record rather than throwing', () => {
    expect(parseMissionsState('{not json')).toEqual({ dismissed: false, completed: [] });
    expect(parseMissionsState('[]')).toEqual({ dismissed: false, completed: [] });
    expect(parseMissionsState('42')).toEqual({ dismissed: false, completed: [] });
  });

  it('keeps completedAt only for a genuinely complete set', () => {
    const partial = parseMissionsState('{"completed":["cockpit"],"completedAt":"2026-10-27T00:00:00.000Z"}');
    expect(partial.completedAt).toBeUndefined();
    const full = parseMissionsState('{"completed":["cockpit","camera","radio","compare","track"],"completedAt":"2026-10-27T00:00:00.000Z"}');
    expect(full.completedAt).toBe('2026-10-27T00:00:00.000Z');
  });

  it('serialises a complete set with its completion time', () => {
    expect(serializeMissionsState({
      dismissed: true,
      completed: ['cockpit', 'camera', 'radio', 'compare', 'track'],
      completedAt: '2026-10-27T12:00:00.000Z',
    })).toBe('{"dismissed":true,"completed":["cockpit","camera","radio","compare","track"],"completedAt":"2026-10-27T12:00:00.000Z"}');
  });

  it('survives storage that throws, as private mode can', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => {},
    });
    expect(() => writeMissionsState({ dismissed: true, completed: [] })).not.toThrow();
    expect(readMissionsState()).toEqual({
      stored: false,
      state: { dismissed: false, completed: [] },
    });
  });
});

describe('completion detection', () => {
  const fixedNow = new Date('2026-10-27T12:34:56.000Z');

  it('maps each real app event to its mission', () => {
    const cases: Array<[MissionEvent, string]> = [
      [{ type: 'cockpit-started' }, 'cockpit'],
      [{ type: 'live-video-camera' }, 'camera'],
      [{ type: 'radio-playing', source: 'tuner' }, 'radio'],
      [{ type: 'date-compare-swiped' }, 'compare'],
      [{ type: 'flight-watch-started' }, 'track'],
    ];
    for (const [event, id] of cases) expect(missionIdForEvent(event)).toBe(id);
  });

  it('does not complete the tuner mission for a Stations-panel pick or an unknown source', () => {
    expect(missionIdForEvent({ type: 'radio-playing', source: 'stations' })).toBeNull();
    expect(missionIdForEvent({ type: 'radio-playing', source: null })).toBeNull();
  });

  it('completing a mission is idempotent, ordered, and does not mutate the old state', () => {
    const start: MissionsState = { dismissed: false, completed: ['track'] };
    const once = completeMission(start, 'cockpit', fixedNow);
    const twice = completeMission(once, 'cockpit', fixedNow);
    expect(start.completed).toEqual(['track']);
    expect(once.completed).toEqual(['cockpit', 'track']);
    expect(twice).toBe(once);
  });

  it('applying a non-event leaves the state object untouched', () => {
    const start: MissionsState = { dismissed: false, completed: [] };
    expect(applyMissionEvent(start, { type: 'radio-playing', source: 'stations' })).toBe(start);
  });

  it('records completedAt exactly when the fifth distinct mission lands', () => {
    let state: MissionsState = { dismissed: false, completed: [] };
    for (const event of [
      { type: 'cockpit-started' },
      { type: 'live-video-camera' },
      { type: 'radio-playing', source: 'tuner' },
      { type: 'date-compare-swiped' },
    ] as MissionEvent[]) {
      state = applyMissionEvent(state, event, fixedNow);
      expect(state.completedAt).toBeUndefined();
    }
    state = applyMissionEvent(state, { type: 'flight-watch-started' }, fixedNow);
    expect(missionProgress(state)).toEqual({ done: 5, total: 5, allComplete: true });
    expect(state.completedAt).toBe('2026-10-27T12:34:56.000Z');
    expect(shouldAutoOpenMissions({ state, stored: true })).toBe(false);
  });
});
