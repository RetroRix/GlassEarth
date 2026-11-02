/**
 * Glass Earth — Smart alerts (pipeline #5, picked by Rick 2026-11-02).
 *
 * A personal alert engine over feeds the app already carries — nothing new
 * is fetched from anywhere new:
 *   • earthquakes from /api/earthquakes (USGS M2.5+ last 24 h),
 *   • ISS passes from /api/satellites/passes (the Look Up! route; the SGP4
 *     math stays server-side, this module only reads finished pass times),
 *   • launches from /api/launches (Launch Library 2, NET + verbatim status).
 *
 * This module is deliberately pure: preferences, the stored record
 * (fired-id dedupe + alert history), and the three rule evaluations. The
 * page-level engine polls the feeds and calls in here; the panel renders
 * what comes back. An alert is produced only from real feed fields — a
 * quake's own magnitude and place, a pass's own rise time and visibility
 * flag, a launch's own NET and status string. Nothing is estimated.
 *
 * Honest limits, stated in the panel too: checks run while this tab is
 * open (there is no server push), and "near you" means near the anchor
 * the app is using — your located position when available, otherwise the
 * map centre.
 */

export const SMART_ALERTS_STORAGE_KEY = 'osiris:smart-alerts';

export interface SmartAlertPrefs {
  quakesEnabled: boolean;
  /** Minimum USGS magnitude that alerts. */
  quakeMinMagnitude: number;
  /** Alert radius around the anchor, km. */
  quakeRadiusKm: number;
  issEnabled: boolean;
  /** Alert when a pass rises within this many minutes. */
  issLeadMinutes: number;
  /** Only alert for passes the feed itself marks visible. */
  issVisibleOnly: boolean;
  launchesEnabled: boolean;
  /** Alert when a launch NET falls within this many hours. */
  launchWithinHours: number;
  /** Alert when a watchlist aircraft (lib/notable-aircraft) is spotted
      airborne on the flights feed. */
  aircraftEnabled: boolean;
  /** Opt-in browser notifications for new alerts (permission asked separately). */
  notifications: boolean;
}

export const DEFAULT_PREFS: SmartAlertPrefs = {
  quakesEnabled: true,
  quakeMinMagnitude: 4.5,
  quakeRadiusKm: 250,
  issEnabled: true,
  issLeadMinutes: 30,
  issVisibleOnly: true,
  launchesEnabled: true,
  launchWithinHours: 24,
  aircraftEnabled: true,
  notifications: false,
};

export type SmartAlertKind = 'quake' | 'iss' | 'launch' | 'aircraft';

export interface SmartAlert {
  id: string;
  kind: SmartAlertKind;
  title: string;
  body: string;
  /** The event's own time (quake origin, pass rise, launch NET), ms epoch. */
  at: number;
  /** When the engine produced this alert, ms epoch. */
  firedAt: number;
  lat?: number;
  lng?: number;
  url?: string;
}

export interface SmartAlertsRecord {
  prefs: SmartAlertPrefs;
  /** Alert id → firedAt. The dedupe memory: an event alerts once, ever. */
  fired: Record<string, number>;
  /** Newest first, capped. */
  history: SmartAlert[];
  /** Alerts fired after this are "unread" for the badge. */
  lastSeenAt: number;
}

export const DEFAULT_RECORD: SmartAlertsRecord = {
  prefs: DEFAULT_PREFS,
  fired: {},
  history: [],
  lastSeenAt: 0,
};

const HISTORY_CAP = 30;
const FIRED_PRUNE_MS = 7 * 24 * 60 * 60 * 1000;

function parsePrefs(raw: unknown): SmartAlertPrefs {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFS };
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  return {
    quakesEnabled: bool(r.quakesEnabled, DEFAULT_PREFS.quakesEnabled),
    quakeMinMagnitude: num(r.quakeMinMagnitude, DEFAULT_PREFS.quakeMinMagnitude, 2.5, 10),
    quakeRadiusKm: num(r.quakeRadiusKm, DEFAULT_PREFS.quakeRadiusKm, 25, 5000),
    issEnabled: bool(r.issEnabled, DEFAULT_PREFS.issEnabled),
    issLeadMinutes: num(r.issLeadMinutes, DEFAULT_PREFS.issLeadMinutes, 5, 240),
    issVisibleOnly: bool(r.issVisibleOnly, DEFAULT_PREFS.issVisibleOnly),
    launchesEnabled: bool(r.launchesEnabled, DEFAULT_PREFS.launchesEnabled),
    launchWithinHours: num(r.launchWithinHours, DEFAULT_PREFS.launchWithinHours, 1, 72),
    aircraftEnabled: bool(r.aircraftEnabled, DEFAULT_PREFS.aircraftEnabled),
    notifications: bool(r.notifications, DEFAULT_PREFS.notifications),
  };
}

/** Load the stored record; anything unreadable becomes the defaults. */
export function loadSmartAlertsRecord(storage?: Storage | null): SmartAlertsRecord {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!store) return { ...DEFAULT_RECORD, prefs: { ...DEFAULT_PREFS } };
    const raw = store.getItem(SMART_ALERTS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_RECORD, prefs: { ...DEFAULT_PREFS } };
    const parsed = JSON.parse(raw) as Partial<SmartAlertsRecord>;
    return {
      prefs: parsePrefs(parsed.prefs),
      fired: parsed.fired && typeof parsed.fired === 'object' ? parsed.fired : {},
      history: Array.isArray(parsed.history) ? parsed.history.slice(0, HISTORY_CAP) : [],
      lastSeenAt: typeof parsed.lastSeenAt === 'number' ? parsed.lastSeenAt : 0,
    };
  } catch {
    return { ...DEFAULT_RECORD, prefs: { ...DEFAULT_PREFS } };
  }
}

export function saveSmartAlertsRecord(record: SmartAlertsRecord, storage?: Storage | null): void {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    store?.setItem(SMART_ALERTS_STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* storage unavailable (private mode, quota): alerts still work in-session */
  }
}

/** Great-circle distance in kilometres. */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export interface QuakeLike {
  id: string;
  lat: number;
  lng: number;
  magnitude: number | null;
  place: string;
  time: number;
  depth?: number;
  url?: string;
}

export interface Anchor {
  lat: number;
  lng: number;
  /** Plain words for where "near" is measured from, e.g. "your area". */
  label: string;
}

export function evaluateQuakes(
  quakes: QuakeLike[],
  anchor: Anchor,
  prefs: SmartAlertPrefs,
  now: number,
): SmartAlert[] {
  if (!prefs.quakesEnabled) return [];
  const out: SmartAlert[] = [];
  for (const q of quakes) {
    if (q.magnitude === null || !Number.isFinite(q.magnitude)) continue;
    if (q.magnitude < prefs.quakeMinMagnitude) continue;
    if (!Number.isFinite(q.lat) || !Number.isFinite(q.lng) || !Number.isFinite(q.time)) continue;
    if (q.time > now) continue; // a future origin time is a feed error, not an alert
    const dist = distanceKm(anchor.lat, anchor.lng, q.lat, q.lng);
    if (dist > prefs.quakeRadiusKm) continue;
    out.push({
      id: `quake:${q.id}`,
      kind: 'quake',
      title: `M${q.magnitude.toFixed(1)} earthquake — ${q.place}`,
      body: `${Math.round(dist)} km from ${anchor.label}`
        + (typeof q.depth === 'number' && Number.isFinite(q.depth) ? ` · depth ${Math.round(q.depth)} km` : '')
        + ` · ${new Date(q.time).toUTCString()}`,
      at: q.time,
      firedAt: now,
      lat: q.lat,
      lng: q.lng,
      url: q.url,
    });
  }
  return out;
}

export interface IssPassLike {
  riseAt: string;
  peakAt: string;
  setAt: string;
  peakElevationDeg: number;
  visible: boolean;
}

export function evaluateIssPasses(
  passes: IssPassLike[],
  anchor: Anchor,
  prefs: SmartAlertPrefs,
  now: number,
): SmartAlert[] {
  if (!prefs.issEnabled) return [];
  const out: SmartAlert[] = [];
  for (const p of passes) {
    const rise = Date.parse(p.riseAt);
    const set = Date.parse(p.setAt);
    if (!Number.isFinite(rise) || !Number.isFinite(set)) continue;
    if (set < now) continue; // already over
    if (rise - now > prefs.issLeadMinutes * 60_000) continue; // not yet in the lead window
    if (prefs.issVisibleOnly && !p.visible) continue;
    const mins = Math.max(0, Math.round((rise - now) / 60_000));
    out.push({
      id: `iss:${p.riseAt}`,
      kind: 'iss',
      title: mins <= 1 ? 'ISS pass starting now' : `ISS pass in ~${mins} min`,
      body: `Over ${anchor.label} · peaks at ${Math.round(p.peakElevationDeg)}°`
        + (p.visible ? ' · visible pass' : ' · passes overhead (not a visible pass)')
        + ` · rises ${new Date(rise).toUTCString()}`,
      at: rise,
      firedAt: now,
      lat: anchor.lat,
      lng: anchor.lng,
    });
  }
  return out;
}

export interface LaunchLike {
  id: string;
  name: string;
  status: string;
  statusAbbrev: string;
  net: string;
  siteName: string | null;
  lat: number;
  lng: number;
}

/** Statuses after which a launch is history, not an upcoming event. */
const FLOWN_ABBREVS = new Set(['Success', 'Failure', 'Partial Failure']);

export function evaluateLaunches(
  launches: LaunchLike[],
  prefs: SmartAlertPrefs,
  now: number,
): SmartAlert[] {
  if (!prefs.launchesEnabled) return [];
  const out: SmartAlert[] = [];
  for (const l of launches) {
    const net = Date.parse(l.net);
    if (!Number.isFinite(net)) continue;
    if (FLOWN_ABBREVS.has(l.statusAbbrev)) continue;
    if (net < now - 5 * 60_000) continue; // NET already passed; not an upcoming alert
    if (net - now > prefs.launchWithinHours * 3_600_000) continue;
    const hrs = (net - now) / 3_600_000;
    const when = hrs < 1 ? `in ~${Math.max(1, Math.round(hrs * 60))} min` : `in ~${Math.round(hrs)} h`;
    out.push({
      id: `launch:${l.id}`,
      kind: 'launch',
      title: `Launch ${when} — ${l.name}`,
      body: `NET ${new Date(net).toUTCString()} · status: ${l.status}`
        + (l.siteName ? ` · ${l.siteName}` : ''),
      at: net,
      firedAt: now,
      lat: l.lat,
      lng: l.lng,
    });
  }
  return out;
}

/** The candidates this record has never fired, oldest event first. */
export function newAlerts(candidates: SmartAlert[], record: SmartAlertsRecord): SmartAlert[] {
  return candidates
    .filter(a => !(a.id in record.fired))
    .sort((a, b) => a.at - b.at);
}

/** Fold freshly fired alerts into the record (dedupe memory + history). */
export function applyFired(record: SmartAlertsRecord, alerts: SmartAlert[], now: number): SmartAlertsRecord {
  if (!alerts.length) return record;
  const fired: Record<string, number> = {};
  for (const [id, at] of Object.entries(record.fired)) {
    if (now - at < FIRED_PRUNE_MS) fired[id] = at;
  }
  for (const a of alerts) fired[a.id] = a.firedAt;
  return {
    ...record,
    fired,
    history: [...alerts].reverse().concat(record.history).slice(0, HISTORY_CAP),
  };
}

/** How many history entries the visitor hasn't seen yet (the badge count). */
export function unreadCount(record: SmartAlertsRecord): number {
  return record.history.filter(a => a.firedAt > record.lastSeenAt).length;
}
