/**
 * Glass Earth — the camera theater wall's working parts.
 *
 * The wall itself is a component; everything it *decides* lives here so the
 * decisions are testable without a DOM full of video elements: which cameras
 * can play in a tile at all, what the Texas / El Paso preset is, which cameras
 * count as scenery for Ambient TV, how rotation pages through a pool, and how
 * the operator's favourites and tile assignments persist.
 *
 * Persistence is localStorage, like the rest of the app's per-viewer state.
 * Every read and write is guarded: storage can be absent (server render,
 * private mode quotas) and a wall that cannot remember is still a wall.
 */

import { previewMedia, type PreviewKind } from './camera-preview';

/** The fields of a catalogue record the wall reads. Matches CctvCamera. */
export interface WallCamera {
  id: string | number;
  name?: string;
  city?: string;
  country?: string;
  source?: string;
  stream_type?: string;
  feed_url?: string;
  stream_url?: string;
  external_url?: string;
  lat?: number;
  lng?: number;
  [key: string]: unknown;
}

export const WALL_LAYOUTS = [2, 3, 4] as const;
export type WallLayout = (typeof WALL_LAYOUTS)[number];

export const FAVORITES_KEY = 'glassearth.wall.favorites';
export const ASSIGNMENTS_KEY = 'glassearth.wall.assignments';
export const LAYOUT_KEY = 'glassearth.wall.layout';

/**
 * How many video tiles may decode at once on the wall.
 *
 * A snapshot tile costs one small request per refresh; a video tile costs a
 * decoder, forever. Sixteen HLS/YouTube tiles would take the frame budget of
 * the whole app, so past this many the wall holds extra video cameras as
 * snapshots (or a labelled still) until one is focused — the same rationing
 * the map previews apply, at wall scale.
 */
export const MAX_PLAYING_VIDEO_TILES = 8;

export function cameraKey(cam: WallCamera): string {
  return String(cam.id);
}

export type WallMediaKind = PreviewKind | 'iframe';

/**
 * What a wall tile can render for this camera, or null.
 *
 * Snapshot/HLS/MP4/MJPEG come from the map previews' own rules
 * (`previewMedia`). One kind is added here that the map tiles refuse: direct
 * iframe embeds. Eight iframes over the map is a frame-budget problem; a
 * dedicated wall is exactly the place they belong. Cameras that would need
 * the server resolver (Skyline wrapper pages and the like) stay out — the
 * wall does not do per-tile resolution round-trips; those cameras open in
 * the full viewer instead.
 */
export function wallMedia(cam: WallCamera): { kind: WallMediaKind; url: string } | null {
  const media = previewMedia(cam);
  if (media) return media;
  if ((cam.stream_type ?? '').toLowerCase() === 'iframe' && cam.stream_url?.trim()) {
    return { kind: 'iframe', url: cam.stream_url.trim() };
  }
  return null;
}

export function isWallPlayable(cam: WallCamera): boolean {
  return wallMedia(cam) !== null;
}

export function isVideoWallCamera(cam: WallCamera): boolean {
  const kind = wallMedia(cam)?.kind;
  return kind === 'mp4' || kind === 'hls' || kind === 'iframe';
}

/**
 * The wall's opening preset: Texas DOT cameras, El Paso district first.
 *
 * TxDOT records carry `source: 'TxDOT'` and the district's city as `city`
 * ('El Paso', 'Dallas', …) — see src/app/api/cctv/texas.ts. El Paso is home
 * base, so its cameras lead; the rest of Texas follows in catalogue order.
 */
export function texasPreset(cameras: WallCamera[]): WallCamera[] {
  const playable = cameras.filter(c => c.source === 'TxDOT' && isWallPlayable(c));
  const elPaso = playable.filter(c => (c.city ?? '') === 'El Paso');
  const rest = playable.filter(c => (c.city ?? '') !== 'El Paso');
  return [...elPaso, ...rest];
}

const SCENIC_WORDS = [
  'beach', 'harbour', 'harbor', 'marina', 'bay', 'falls', 'waterfall',
  'volcano', 'mountain', 'aurora', 'northern lights', 'glacier', 'lake',
  'river', 'island', 'reef', 'savanna', 'safari', 'lighthouse', 'old town',
  'skyline', 'coast', 'cliff', 'canyon', 'desert', 'lagoon', 'pier',
  'boardwalk', 'castle', 'fjord', 'vineyard', 'santorini', 'venice',
];

/** How scenic a camera reads, for Ambient TV's rotation pool. */
export function scenicScore(cam: WallCamera): number {
  let score = 0;
  /* The curated public-webcam catalogue is the scenic backbone. */
  if (cam.source === 'Public Webcam') score += 3;
  const hay = `${cam.name ?? ''} ${cam.city ?? ''} ${cam.country ?? ''}`.toLowerCase();
  for (const word of SCENIC_WORDS) if (hay.includes(word)) score += 2;
  /* Moving pictures beat stills on a television. */
  const kind = wallMedia(cam)?.kind;
  if (kind === 'hls' || kind === 'iframe') score += 2;
  else if (kind === 'mp4') score += 1;
  return score;
}

/**
 * The scenic ranking both pools draw from: playable cameras with a scenery
 * score, best first — or, when nothing scores at all, every playable camera
 * in catalogue order. A quiet highway interchange is still a better
 * screensaver than an error message.
 */
function scenicRanked(cameras: WallCamera[]): WallCamera[] {
  const playable = cameras.filter(isWallPlayable);
  const scored = playable
    .map(c => ({ c, s: scenicScore(c) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map(x => x.c);
  return scored.length ? scored : playable;
}

/**
 * The scenic pool in pure score order — the wall's ordering, unchanged.
 *
 * Falls back to every playable camera when nothing scores at all.
 */
export function scenicPool(cameras: WallCamera[], limit = 48): WallCamera[] {
  return scenicRanked(cameras).slice(0, limit);
}

/**
 * Media kinds that move on their own: a stream, not a still that has to be
 * re-fetched to look alive. Iframe embeds are deliberately NOT here — an
 * embed paints its own player chrome (branding, spinners, end screens),
 * which is exactly what a screensaver is trying to get away from.
 */
const AMBIENT_MOTION_KINDS: ReadonlySet<WallMediaKind> = new Set(['hls', 'mp4', 'mjpeg']);

/** Whether Ambient TV can show this camera as continuous motion. */
export function isAmbientMotionCamera(cam: WallCamera): boolean {
  const kind = wallMedia(cam)?.kind;
  return kind !== undefined && AMBIENT_MOTION_KINDS.has(kind);
}

/**
 * Ambient TV's pool: the scenic ranking, re-ordered so continuous-motion
 * cameras lead and snapshots only fill the slots the streams cannot.
 *
 * Within each group the scenic-score order is untouched — the most scenic
 * beach stream still opens the show, and the most scenic still is the first
 * fallback. The partition runs over the full ranking before the limit is
 * applied, so a stream ranked below the cut on scenery alone is pulled in
 * ahead of a higher-scored still rather than left out entirely.
 */
export function ambientPool(cameras: WallCamera[], limit = 48): WallCamera[] {
  const ranked = scenicRanked(cameras);
  const motion = ranked.filter(isAmbientMotionCamera);
  const rest = ranked.filter(c => !isAmbientMotionCamera(c));
  return [...motion, ...rest].slice(0, limit);
}

/**
 * The slice of `pool` showing at rotation step `tick`: whole pages, wrapping
 * around the end. With a pool no bigger than the page this is just the pool.
 */
export function rotateWindow<T>(pool: T[], size: number, tick: number): T[] {
  if (!pool.length || size <= 0) return [];
  const start = (tick * size) % pool.length;
  const out: T[] = [];
  for (let i = 0; i < size; i++) out.push(pool[(start + i) % pool.length]);
  return out;
}

// ── Persistence ─────────────────────────────────────────────────────────────

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function readJson<T>(key: string): T | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    /* Quota or privacy mode: the wall simply forgets. */
  }
}

export function loadFavorites(): string[] {
  const value = readJson<unknown>(FAVORITES_KEY);
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}

export function saveFavorites(ids: string[]): void {
  writeJson(FAVORITES_KEY, ids);
}

export function loadAssignments(): (string | null)[] | null {
  const value = readJson<unknown>(ASSIGNMENTS_KEY);
  if (!Array.isArray(value)) return null;
  return value.map(x => (typeof x === 'string' ? x : null));
}

export function saveAssignments(ids: (string | null)[]): void {
  writeJson(ASSIGNMENTS_KEY, ids);
}

export function loadLayout(): WallLayout {
  const value = readJson<unknown>(LAYOUT_KEY);
  return (WALL_LAYOUTS as readonly number[]).includes(value as number) ? (value as WallLayout) : 3;
}

export function saveLayout(layout: WallLayout): void {
  writeJson(LAYOUT_KEY, layout);
}
