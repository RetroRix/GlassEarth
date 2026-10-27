/**
 * OSIRIS — rocket launches from Launch Library 2 (The Space Devs):
 * the upcoming list (soonest first) and the previous list (most recent
 * first), merged into one window — next ~30 days plus the last ~7 days.
 *
 * Honesty rules: the feed's NET is "No Earlier Than", never a promise.
 * Every countdown derived here is labelled NET by the UI, statuses are
 * carried VERBATIM from the feed (name + abbreviation, unedited), and a
 * TBC/TBD status marks the countdown provisional. Nothing is predicted,
 * rounded into false precision, or filled in: a field the feed doesn't
 * carry stays null and the UI omits it.
 */

export interface LaunchRecord {
  id: string;
  name: string;
  /** Feed status name, verbatim (e.g. "Go for Launch", "To Be Confirmed"). */
  status: string;
  /** Feed status abbreviation, verbatim (e.g. "Go", "TBC", "TBD", "Hold"). */
  statusAbbrev: string;
  /** NET (No Earlier Than) as an ISO timestamp, straight from the feed. */
  net: string;
  provider: string | null;
  /** Rocket configuration full name (e.g. "Falcon 9 Block 5"). */
  vehicle: string | null;
  padName: string | null;
  /** Launch location name (e.g. "Vandenberg SFB, CA, USA"). */
  siteName: string | null;
  lat: number;
  lng: number;
  missionName: string | null;
  missionDescription: string | null;
  /** First webcast URL the feed carries; null when it carries none. */
  webcastUrl: string | null;
  /** The feed's hold reason, when it carries one (status Hold). */
  holdReason: string | null;
}

export interface LaunchSite {
  key: string;
  padName: string | null;
  siteName: string | null;
  lat: number;
  lng: number;
  launches: LaunchRecord[];
}

export const UPCOMING_WINDOW_DAYS = 30;
export const RECENT_WINDOW_DAYS = 7;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function coord(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoTime(v: unknown): number | null {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

function resultsOf(body: unknown): Record<string, unknown>[] {
  const results = (body as { results?: unknown })?.results;
  return Array.isArray(results) ? (results as Record<string, unknown>[]) : [];
}

function oneLaunch(raw: Record<string, unknown>): LaunchRecord | null {
  const id = str(raw.id);
  const name = str(raw.name);
  const netMs = isoTime(raw.net);
  if (!id || !name || netMs === null) return null;
  const pad = (raw.pad ?? {}) as Record<string, unknown>;
  const lat = coord(pad.latitude);
  const lng = coord(pad.longitude);
  if (lat === null || lng === null) return null; // unmappable — no site, no listing
  const status = (raw.status ?? {}) as Record<string, unknown>;
  const lsp = (raw.launch_service_provider ?? {}) as Record<string, unknown>;
  const rocket = (raw.rocket ?? {}) as Record<string, unknown>;
  const config = (rocket.configuration ?? {}) as Record<string, unknown>;
  const mission = (raw.mission ?? {}) as Record<string, unknown>;
  const location = (pad.location ?? {}) as Record<string, unknown>;
  const vidURLs = Array.isArray(raw.vidURLs) ? (raw.vidURLs as Record<string, unknown>[]) : [];
  const webcast = vidURLs.map(v => str(v?.url)).find(Boolean) ?? null;
  return {
    id,
    name,
    status: str(status.name) ?? 'Unknown',
    statusAbbrev: str(status.abbrev) ?? '',
    net: new Date(netMs).toISOString(),
    provider: str(lsp.name),
    vehicle: str(config.full_name) ?? str(config.name),
    padName: str(pad.name),
    siteName: str(location.name),
    lat,
    lng,
    missionName: str(mission.name),
    missionDescription: str(mission.description),
    webcastUrl: webcast,
    holdReason: str(raw.holdreason),
  };
}

/**
 * Merge the upcoming + previous LL2 list responses into the display
 * window: NET within [now − 7 days, now + 30 days], de-duplicated by
 * launch id (the upcoming copy wins — it is the fresher record),
 * sorted soonest first.
 */
export function transformLaunches(upcomingBody: unknown, previousBody: unknown, nowMs: number): LaunchRecord[] {
  const lo = nowMs - RECENT_WINDOW_DAYS * 86_400_000;
  const hi = nowMs + UPCOMING_WINDOW_DAYS * 86_400_000;
  const byId = new Map<string, LaunchRecord>();
  for (const raw of resultsOf(previousBody)) {
    const l = oneLaunch(raw);
    if (l) byId.set(l.id, l);
  }
  for (const raw of resultsOf(upcomingBody)) {
    const l = oneLaunch(raw);
    if (l) byId.set(l.id, l);
  }
  return [...byId.values()]
    .filter(l => {
      const t = Date.parse(l.net);
      return t >= lo && t <= hi;
    })
    .sort((a, b) => Date.parse(a.net) - Date.parse(b.net));
}

/** Group launches into launch sites for the map markers. */
export function groupSites(launches: LaunchRecord[]): LaunchSite[] {
  const byKey = new Map<string, LaunchSite>();
  for (const l of launches) {
    const key = `${l.padName ?? l.siteName ?? 'site'}@${l.lat.toFixed(3)},${l.lng.toFixed(3)}`;
    let site = byKey.get(key);
    if (!site) {
      site = { key, padName: l.padName, siteName: l.siteName, lat: l.lat, lng: l.lng, launches: [] };
      byKey.set(key, site);
    }
    site.launches.push(l);
  }
  return [...byKey.values()].sort((a, b) => a.launches.length - b.launches.length).reverse();
}

/** Sites as a GeoJSON collection for the map source. */
export function sitesToGeoJson(sites: LaunchSite[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: sites.map(s => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      properties: {
        siteKey: s.key,
        padName: s.padName ?? '',
        siteName: s.siteName ?? '',
        count: s.launches.length,
        nextName: s.launches[0]?.name ?? '',
        nextNet: s.launches[0]?.net ?? '',
        nextStatus: s.launches[0]?.statusAbbrev ?? '',
        launchesJson: JSON.stringify(s.launches.map(l => ({ name: l.name, net: l.net, status: l.status, statusAbbrev: l.statusAbbrev }))),
      },
    })),
  };
}

/** TBC / TBD — the feed itself says this time is not yet confirmed. */
export function isProvisional(statusAbbrev: string): boolean {
  const a = statusAbbrev.trim().toUpperCase();
  return a === 'TBC' || a === 'TBD';
}

export interface Countdown {
  /** True once NET has passed (T+), false while counting down (T−). */
  past: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalSeconds: number;
}

/** Signed countdown from `nowMs` to a NET instant; null on a bad date. */
export function countdownTo(netIso: string, nowMs: number): Countdown | null {
  const t = Date.parse(netIso);
  if (Number.isNaN(t)) return null;
  const diff = t - nowMs;
  const totalSeconds = Math.floor(Math.abs(diff) / 1000);
  return {
    past: diff < 0,
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    totalSeconds,
  };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "T−2d 04:13:22" / "T+00:12:33" — the caller adds the NET label. */
export function formatCountdown(c: Countdown): string {
  const sign = c.past ? 'T+' : 'T−';
  const d = c.days > 0 ? `${c.days}d ` : '';
  return `${sign}${d}${pad2(c.hours)}:${pad2(c.minutes)}:${pad2(c.seconds)}`;
}
