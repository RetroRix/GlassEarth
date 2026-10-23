/**
 * Glass Earth — TV & radio stations: the shared data layer.
 *
 * Two open directories, neither of them scraped from an aggregator site:
 *
 *  · TV — the IPTV-org community playlists (iptv-org.github.io/iptv). They
 *    are published as M3U slices per country and per category; the API route
 *    fetches one slice at a time and this module parses it into channels.
 *    Famelack's TV directory is built on the same source — we go to the
 *    source, not to the middleman.
 *  · Radio — the Radio Browser community database (radio-browser.info),
 *    free and keyless. Its radio listings are the open equivalent of what
 *    aggregator sites curate in-house.
 *
 * Everything here is pure or storage-guarded so it can be unit-tested in
 * node, following lib/theater-wall's example.
 */

// ── TV ──────────────────────────────────────────────────────────────────────

export interface TvChannel {
  /** tvg-id when the playlist carries one, else a slug of name + stream. */
  id: string;
  name: string;
  /** ISO country code of the slice the channel came from, when known. */
  country: string;
  /** The M3U group-title, e.g. "News" — IPTV-org's category for the entry. */
  category: string;
  logo: string;
  url: string;
  /** #EXTVLCOPT:http-referrer — recorded for honesty, never proxied around. */
  referer?: string;
  /** #EXTVLCOPT:http-user-agent, when the playlist declares one. */
  userAgent?: string;
}

/** Categories IPTV-org publishes slices for — the exact slug list from
    their PLAYLISTS.md (adult's `xxx` slug is deliberately absent, and the
    parser drops adult groups regardless). */
export const TV_CATEGORIES = [
  'news', 'sports', 'movies', 'series', 'music', 'entertainment', 'kids',
  'documentary', 'animation', 'auto', 'business', 'classic', 'comedy',
  'cooking', 'culture', 'education', 'family', 'general', 'legislative',
  'lifestyle', 'outdoor', 'relax', 'religious', 'science', 'shop',
  'travel', 'weather', 'undefined',
] as const;

/** Groups whose channels never enter the app, whatever slice they ride in on. */
const BLOCKED_GROUP = /adult|xxx|porn/i;

/** Countries IPTV-org publishes slices for — the picker's working set. */
export const TV_COUNTRIES: { code: string; name: string }[] = [
  { code: 'US', name: 'United States' }, { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' }, { code: 'MX', name: 'Mexico' },
  { code: 'DE', name: 'Germany' }, { code: 'FR', name: 'France' },
  { code: 'ES', name: 'Spain' }, { code: 'IT', name: 'Italy' },
  { code: 'PT', name: 'Portugal' }, { code: 'NL', name: 'Netherlands' },
  { code: 'BE', name: 'Belgium' }, { code: 'CH', name: 'Switzerland' },
  { code: 'AT', name: 'Austria' }, { code: 'PL', name: 'Poland' },
  { code: 'SE', name: 'Sweden' }, { code: 'NO', name: 'Norway' },
  { code: 'DK', name: 'Denmark' }, { code: 'FI', name: 'Finland' },
  { code: 'IE', name: 'Ireland' }, { code: 'GR', name: 'Greece' },
  { code: 'TR', name: 'Türkiye' }, { code: 'RU', name: 'Russia' },
  { code: 'UA', name: 'Ukraine' }, { code: 'CZ', name: 'Czechia' },
  { code: 'HU', name: 'Hungary' }, { code: 'RO', name: 'Romania' },
  { code: 'BG', name: 'Bulgaria' }, { code: 'HR', name: 'Croatia' },
  { code: 'RS', name: 'Serbia' }, { code: 'IL', name: 'Israel' },
  { code: 'AE', name: 'UAE' }, { code: 'SA', name: 'Saudi Arabia' },
  { code: 'EG', name: 'Egypt' }, { code: 'NG', name: 'Nigeria' },
  { code: 'ZA', name: 'South Africa' }, { code: 'KE', name: 'Kenya' },
  { code: 'IN', name: 'India' }, { code: 'PK', name: 'Pakistan' },
  { code: 'BD', name: 'Bangladesh' }, { code: 'CN', name: 'China' },
  { code: 'HK', name: 'Hong Kong' }, { code: 'TW', name: 'Taiwan' },
  { code: 'JP', name: 'Japan' }, { code: 'KR', name: 'South Korea' },
  { code: 'ID', name: 'Indonesia' }, { code: 'MY', name: 'Malaysia' },
  { code: 'PH', name: 'Philippines' }, { code: 'TH', name: 'Thailand' },
  { code: 'VN', name: 'Vietnam' }, { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' }, { code: 'BR', name: 'Brazil' },
  { code: 'AR', name: 'Argentina' }, { code: 'CL', name: 'Chile' },
  { code: 'CO', name: 'Colombia' }, { code: 'PE', name: 'Peru' },
  { code: 'VE', name: 'Venezuela' }, { code: 'CU', name: 'Cuba' },
];

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

function attr(line: string, key: string): string {
  const m = line.match(new RegExp(`${key}="([^"]*)"`));
  return m ? m[1].trim() : '';
}

/**
 * Parse one IPTV-org M3U slice into channels.
 *
 * Entries are `#EXTINF` attribute lines followed (after any #EXTVLCOPT
 * option lines) by the stream URL. A slice is country- or category-shaped;
 * the caller passes whichever it knows so every channel carries both fields
 * where the data allows. Adult-group entries are dropped here, at the
 * parser, so no slice can smuggle them into the UI.
 */
export function parseM3u(text: string, slice: { country?: string; category?: string } = {}): TvChannel[] {
  const out: TvChannel[] = [];
  const seen = new Set<string>();
  let pending: Omit<TvChannel, 'url'> | null = null;
  let referer: string | undefined;
  let userAgent: string | undefined;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const comma = line.lastIndexOf(',');
      const group = attr(line, 'group-title');
      pending = {
        id: attr(line, 'tvg-id'),
        name: comma >= 0 ? line.slice(comma + 1).trim() : attr(line, 'tvg-name'),
        country: slice.country ?? '',
        category: group || slice.category || '',
        logo: attr(line, 'tvg-logo'),
      };
      /* The hints also appear as attributes on the EXTINF line itself in
         the published files; #EXTVLCOPT lines (handled below) override. */
      referer = attr(line, 'http-referrer') || undefined;
      userAgent = attr(line, 'http-user-agent') || undefined;
      continue;
    }
    if (line.startsWith('#EXTVLCOPT:')) {
      const opt = line.slice('#EXTVLCOPT:'.length);
      if (opt.startsWith('http-referrer=')) referer = opt.slice('http-referrer='.length).trim();
      if (opt.startsWith('http-user-agent=')) userAgent = opt.slice('http-user-agent='.length).trim();
      continue;
    }
    if (line.startsWith('#')) continue;
    /* First non-directive line after an EXTINF is its stream URL. */
    if (pending && /^https?:\/\//i.test(line)) {
      const group = pending.category;
      if (!BLOCKED_GROUP.test(group) && !BLOCKED_GROUP.test(pending.name)) {
        const id = pending.id || `${slug(pending.name)}-${slug(line)}`;
        if (pending.name && !seen.has(id)) {
          seen.add(id);
          out.push({
            ...pending,
            id,
            country: pending.country || slice.country || '',
            category: pending.category || slice.category || '',
            url: line,
            ...(referer ? { referer } : {}),
            ...(userAgent ? { userAgent } : {}),
          });
        }
      }
    }
    pending = null;
    referer = undefined;
    userAgent = undefined;
  }
  return out;
}

/** The TV wall's opening pool: news channels first, in slice order. */
export function newsFirst(channels: TvChannel[]): TvChannel[] {
  const news = channels.filter(c => /news/i.test(c.category));
  const rest = channels.filter(c => !/news/i.test(c.category));
  return [...news, ...rest];
}

// ── Radio ───────────────────────────────────────────────────────────────────

export interface RadioStation {
  uuid: string;
  name: string;
  country: string;
  state: string;
  tags: string;
  bitrate: number;
  codec: string;
  favicon: string;
  url: string;
  votes: number;
}

/** Radio Browser's raw station shape — only the fields we read. */
interface RadioBrowserStation {
  stationuuid?: string;
  name?: string;
  country?: string;
  countrycode?: string;
  state?: string;
  tags?: string;
  bitrate?: number;
  codec?: string;
  favicon?: string;
  url_resolved?: string;
  url?: string;
  votes?: number;
}

/** Normalize one Radio Browser record; null when it has nothing playable. */
export function normalizeRadioStation(raw: RadioBrowserStation): RadioStation | null {
  const url = (raw.url_resolved || raw.url || '').trim();
  if (!url || !raw.stationuuid) return null;
  return {
    uuid: raw.stationuuid,
    name: (raw.name || 'Unknown station').trim(),
    /* Radio Browser deprecates the free-text country field in favour of
       the ISO code; prefer the name while it exists, fall back to code. */
    country: raw.country || raw.countrycode || '',
    state: raw.state ?? '',
    tags: raw.tags ?? '',
    bitrate: raw.bitrate ?? 0,
    codec: raw.codec ?? '',
    favicon: raw.favicon ?? '',
    url,
    votes: raw.votes ?? 0,
  };
}

export function normalizeRadioStations(raw: unknown): RadioStation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(r => normalizeRadioStation(r as RadioBrowserStation))
    .filter((s): s is RadioStation => s !== null);
}

/** Tags the radio tab offers as one-tap genres. */
export const RADIO_TAGS = [
  'news', 'talk', 'pop', 'rock', 'country', 'jazz', 'classical', 'electronic',
  'hip-hop', 'latin', 'oldies', 'sports', 'weather', 'christian', 'public radio',
] as const;

/** Radio Browser's streams are http on many smaller stations; on the https
    app those are mixed content and the browser will refuse them outright. */
export function isMixedContent(url: string): boolean {
  return /^http:\/\//i.test(url);
}

// ── TV wall ─────────────────────────────────────────────────────────────────

/**
 * How many TV tiles may decode at once on the wall. TV streams are heavier
 * than camera snapshots; the camera wall's cap is the precedent, and past
 * it a tile holds its channel logo until focused.
 */
export const MAX_TV_WALL_PLAYING = 8;

// ── Favourites (localStorage, theater-wall pattern) ─────────────────────────

export const TV_FAVORITES_KEY = 'glassearth.stations.tvFavorites';
export const RADIO_FAVORITES_KEY = 'glassearth.stations.radioFavorites';
const FAVORITES_CAP = 120;

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function loadList<T>(key: string): T[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(key);
    const value = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

function saveList<T>(key: string, list: T[]): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(list.slice(0, FAVORITES_CAP)));
  } catch {
    /* Quota or privacy mode: favourites simply don't persist. */
  }
}

export function loadTvFavorites(): TvChannel[] {
  return loadList<TvChannel>(TV_FAVORITES_KEY).filter(c => c && typeof c.url === 'string');
}
export function saveTvFavorites(list: TvChannel[]): void {
  saveList(TV_FAVORITES_KEY, list);
}
export function loadRadioFavorites(): RadioStation[] {
  return loadList<RadioStation>(RADIO_FAVORITES_KEY).filter(s => s && typeof s.url === 'string');
}
export function saveRadioFavorites(list: RadioStation[]): void {
  saveList(RADIO_FAVORITES_KEY, list);
}
