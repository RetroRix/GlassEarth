/**
 * Glass Earth — first-run missions (wave item 11).
 *
 * Five short, hands-on introductions built only from things the app
 * already does. This module is deliberately pure: it owns the mission
 * definitions, the translation from real app events to a completed
 * mission, and the localStorage record. The card renders the definitions;
 * the page supplies the events. Nothing completes here merely because a
 * visitor opened the card or tapped a mission's “Take me there” button —
 * those are navigation, not the thing itself.
 *
 * Persistence follows the app's other per-visitor keys (`osiris:theme`,
 * `osiris:last-view`, `osiris:sensor-look`). One key stores whether the
 * first-run card has been dismissed and which missions have genuinely
 * completed. A returning visitor who dismissed it is never ambushed by
 * it again; the permanent Missions entry can still reopen it by choice.
 */

export const MISSIONS_STORAGE_KEY = 'osiris:missions';

export type MissionId = 'cockpit' | 'camera' | 'radio' | 'compare' | 'track';

export interface MissionDefinition {
  id: MissionId;
  title: string;
  /** One plain line saying why this is worth doing. */
  why: string;
  /** The label on the row's real navigation action. */
  actionLabel: string;
  /** Short guidance shown after the action has taken the visitor there. */
  guide: string;
}

export const MISSIONS: readonly MissionDefinition[] = [
  {
    id: 'cockpit',
    title: 'Ride in the cockpit',
    why: 'Sit with a live flight and watch the ground move below it.',
    actionLabel: 'Take me to flights',
    guide: 'Tap a plane on the map, then choose “Ride in the Cockpit.”',
  },
  {
    id: 'camera',
    title: 'Watch a live camera',
    why: 'Open a camera that is sending moving pictures, not just a snapshot.',
    actionLabel: 'Find a live camera',
    guide: 'Stay with the camera until its badge says LIVE VIDEO.',
  },
  {
    id: 'radio',
    title: 'Cross the planet by radio',
    why: 'Use the tuner dial to land on a broadcaster somewhere else in the world.',
    actionLabel: 'Open the tuner',
    guide: 'Drag or step the dial, then release to land on a station and listen.',
  },
  {
    id: 'compare',
    title: 'See a place change',
    why: 'Compare recent satellite pictures of the same place on two dates.',
    actionLabel: 'Open Date Compare',
    guide: 'Drag the white divider across Elephant Butte Reservoir to compare the two dates.',
  },
  {
    id: 'track',
    title: 'Track a flight live',
    why: 'Follow one aircraft while its position and flight details update.',
    actionLabel: 'Take me to flights',
    guide: 'Tap a plane on the map, then choose “+ Watch This Aircraft.”',
  },
] as const;

const MISSION_IDS = new Set<MissionId>(MISSIONS.map(m => m.id));

export interface MissionsState {
  /** The first-run card was explicitly dismissed (Skip or its close button). */
  dismissed: boolean;
  /** Missions completed by their real events, in mission order. */
  completed: MissionId[];
  /** When the fifth mission completed; absent until then. */
  completedAt?: string;
}

export const EMPTY_MISSIONS_STATE: MissionsState = {
  dismissed: false,
  completed: [],
};

export interface StoredMissionsState {
  state: MissionsState;
  /** A value existed under the key, even if it was corrupt. Only a visitor
   *  with no stored record at all is treated as a genuine first run. */
  stored: boolean;
}

function orderedCompleted(ids: Iterable<unknown>): MissionId[] {
  const found = new Set<MissionId>();
  for (const id of ids) {
    if (typeof id === 'string' && MISSION_IDS.has(id as MissionId)) {
      found.add(id as MissionId);
    }
  }
  return MISSIONS.map(m => m.id).filter(id => found.has(id));
}

export function parseMissionsState(raw: string | null): MissionsState {
  if (!raw) return { ...EMPTY_MISSIONS_STATE, completed: [] };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ...EMPTY_MISSIONS_STATE, completed: [] };
    }
    const record = value as Record<string, unknown>;
    const completed = orderedCompleted(Array.isArray(record.completed) ? record.completed : []);
    const allComplete = completed.length === MISSIONS.length;
    return {
      dismissed: record.dismissed === true,
      completed,
      ...(allComplete && typeof record.completedAt === 'string' && record.completedAt
        ? { completedAt: record.completedAt }
        : {}),
    };
  } catch {
    /* A corrupt value is an empty record, never a crash. */
    return { ...EMPTY_MISSIONS_STATE, completed: [] };
  }
}

export function readMissionsState(): StoredMissionsState {
  try {
    const raw = localStorage.getItem(MISSIONS_STORAGE_KEY);
    return { state: parseMissionsState(raw), stored: raw !== null };
  } catch {
    return { state: { ...EMPTY_MISSIONS_STATE, completed: [] }, stored: false };
  }
}

export function serializeMissionsState(state: MissionsState): string {
  return JSON.stringify({
    dismissed: state.dismissed,
    completed: orderedCompleted(state.completed),
    ...(state.completed.length === MISSIONS.length && state.completedAt
      ? { completedAt: state.completedAt }
      : {}),
  });
}

export function writeMissionsState(state: MissionsState): void {
  try {
    localStorage.setItem(MISSIONS_STORAGE_KEY, serializeMissionsState(state));
  } catch {
    /* Private mode: progress still lasts for this session. */
  }
}

/** The card may introduce itself only to a genuine first visit: nobody has
 *  stored a record, dismissed it, or already finished the set. */
export function shouldAutoOpenMissions(record: StoredMissionsState): boolean {
  return (
    !record.stored &&
    !record.state.dismissed &&
    record.state.completed.length < MISSIONS.length
  );
}

export function missionProgress(state: MissionsState): {
  done: number;
  total: number;
  allComplete: boolean;
} {
  const done = orderedCompleted(state.completed).length;
  return { done, total: MISSIONS.length, allComplete: done === MISSIONS.length };
}

export function isMissionComplete(state: MissionsState, id: MissionId): boolean {
  return state.completed.includes(id);
}

export function dismissMissions(state: MissionsState): MissionsState {
  return state.dismissed ? state : { ...state, dismissed: true };
}

export function completeMission(
  state: MissionsState,
  id: MissionId,
  now: Date = new Date(),
): MissionsState {
  if (!MISSION_IDS.has(id) || state.completed.includes(id)) return state;
  const completed = orderedCompleted([...state.completed, id]);
  return {
    ...state,
    completed,
    ...(completed.length === MISSIONS.length
      ? { completedAt: state.completedAt ?? now.toISOString() }
      : {}),
  };
}

/**
 * Real app events that can complete a mission. The names deliberately say
 * what happened, not where the visitor clicked:
 *
 * - `cockpit-started`: page state entered a ride.
 * - `live-video-camera`: the camera viewer's own badge became LIVE VIDEO.
 * - `radio-playing`: the app's one audio element actually started playing.
 *   The source matters — a Stations-panel pick is a fine thing to hear,
 *   but it is not landing a station on the tuner dial.
 * - `date-compare-swiped`: the divider moved under the visitor's hand.
 * - `flight-watch-started`: a flight entered the page's watched list.
 */
export type MissionEvent =
  | { type: 'cockpit-started' }
  | { type: 'live-video-camera' }
  | { type: 'radio-playing'; source: 'tuner' | 'stations' | null }
  | { type: 'date-compare-swiped' }
  | { type: 'flight-watch-started' };

export function missionIdForEvent(event: MissionEvent): MissionId | null {
  switch (event.type) {
    case 'cockpit-started':
      return 'cockpit';
    case 'live-video-camera':
      return 'camera';
    case 'radio-playing':
      return event.source === 'tuner' ? 'radio' : null;
    case 'date-compare-swiped':
      return 'compare';
    case 'flight-watch-started':
      return 'track';
    default:
      return null;
  }
}

export function applyMissionEvent(
  state: MissionsState,
  event: MissionEvent,
  now: Date = new Date(),
): MissionsState {
  const id = missionIdForEvent(event);
  return id ? completeMission(state, id, now) : state;
}
