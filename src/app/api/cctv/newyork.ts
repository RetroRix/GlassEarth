import type { CctvCamera } from './types';
import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — New York CCTV Cameras (NYSDOT / 511ny.org + NYC DOT)
 * Sources: https://www.511ny.org/configs/main.json — the CARS 511x platform,
 * and https://webcams.nyctmc.org/api/cameras/ — NYC DOT's own camera list
 * ~2,730 statewide cameras plus the city list — NO API KEY NEEDED.
 *
 * Like Minnesota, 511NY is the new 511x app, not Indiana's GraphQL site: its
 * config names the cameras layer (slug `normalCameras`) as
 * https://api-511x-nysdot.carsprogram.org/cameras, and the app reads the
 * whole state from `${api}/map-features` as GeoJSON. NYSDOT-owned features
 * are live video — an HLS playlist on a `*.nysdot.skyvdn.com` edge with a
 * `.flv.png` poster on public.carsprogram.org.
 *
 * 511NY also republishes NYC DOT's cameras (owner `NYC DOT`, stills at
 * nyctmc.org), and NYC DOT publishes the same cameras itself at
 * webcams.nyctmc.org. Both lists are merged here, so the two have to be
 * de-duplicated against each other: the shared camera UUID in each still's
 * URL is the join key (the hosts differ — nyctmc.org vs
 * webcams.nyctmc.org — the UUID does not). The direct list still earns its
 * place: it carries cameras 511NY has not picked up yet, and it is an
 * independent answer when one of the two sources is down. Each sub-source
 * is fetched in isolation, so one failing never takes the other with it.
 *
 * Four of 511NY's features carry coordinates that are not in New York at
 * all — three sit at [0, 0] and one portable camera has its longitude's
 * sign flipped (+73.2). The bounds check below is what drops them.
 */

const MAP_FEATURES = 'https://api-511x-nysdot.carsprogram.org/cameras/map-features';
const NYC_CAMERAS = 'https://webcams.nyctmc.org/api/cameras/';

/** New York bounding box — drops any stray/placeholder coordinates. */
const NY_BOUNDS = { minLat: 40.4, maxLat: 45.1, minLng: -79.8, maxLng: -71.8 };

function inBounds(lat: number, lng: number): boolean {
  return lat >= NY_BOUNDS.minLat && lat <= NY_BOUNDS.maxLat
    && lng >= NY_BOUNDS.minLng && lng <= NY_BOUNDS.maxLng;
}

/** One view of a 511NY camera — only the fields we consume. */
export interface Ny511View {
  name?: string | null;
  type?: string | null;
  url?: string | null;
  videoPreviewUrl?: string | null;
  broken?: boolean | null;
}

/** One feature from 511NY's /cameras/map-features — only the fields we consume. */
export interface Ny511Feature {
  type?: string | null;
  geometry?: { type?: string | null; coordinates?: [number, number] | null } | null;
  properties?: {
    type?: string | null;
    id?: number | null;
    name?: string | null;
    tooltip?: string | null;
    public?: boolean | null;
    route?: string | null;
    lastUpdated?: number | null;
    location?: {
      fips?: number | null;
      routeId?: string | null;
      linearReference?: number | null;
      localRoad?: boolean | null;
      cityReference?: string | null;
    } | null;
    icon?: string | null;
    iconColor?: string | null;
    cameraOwner?: string | null;
    views?: Ny511View[] | null;
  } | null;
}

/** One row from webcams.nyctmc.org/api/cameras/ — only the fields we consume. */
export interface NycDotCameraRecord {
  id?: string | null;
  name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  area?: string | null;
  /** The API spells this as the string "true"/"false", not a boolean. */
  isOnline?: string | boolean | null;
  imageUrl?: string | null;
}

/**
 * The caption under a camera's name. As in Minnesota, `cityReference` is a
 * phrase — "in Albany" / "near Rochester" name a place, "4 miles east of
 * the New York City area" does not — so only those two forms are used.
 */
function cityFromReference(ref?: string | null): string {
  const m = ref?.trim().match(/^(?:in|near)\s+(.+)$/i);
  return m ? m[1].trim() : 'New York';
}

/** Map one 511NY feature to a camera, or null if unusable. Exported for tests. */
export function mapFeature(f: Ny511Feature): CctvCamera | null {
  const props = f?.properties;
  if (!props || props.id == null) return null;

  const coords = f.geometry?.coordinates;
  if (!coords) return null;
  const [lng, lat] = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!inBounds(lat, lng)) return null;

  /* Broken views are the platform saying the feed is down; a camera whose
     every view is broken has nothing to show. */
  const views = (props.views || []).filter(v => v && !v.broken);
  if (!views.length) return null;

  const streamView = views.find(v => /\.m3u8(\?|$)/i.test(v.url || ''));
  const stillView = views.find(v => v.url && !/\.m3u8(\?|$)/i.test(v.url));
  const stream = streamView?.url || undefined;
  const feed = streamView?.videoPreviewUrl || stillView?.url || views[0]?.videoPreviewUrl || undefined;
  if (!stream && !feed) return null;

  const id = props.id;
  const source = props.cameraOwner?.trim() === 'NYC DOT' ? 'NYC DOT' : 'NYSDOT';
  return {
    id: `ny511-${id}`,
    lat,
    lng,
    name: props.name?.trim() || props.tooltip?.trim() || `${source} Camera ${id}`,
    city: cityFromReference(props.location?.cityReference),
    country: 'US',
    ...(feed ? { feed_url: feed } : {}),
    ...(stream ? { stream_url: stream, stream_type: 'hls' as const } : {}),
    external_url: `https://www.511ny.org/camera/${id}`,
    source,
  };
}

/** Map one NYC DOT record to a camera, or null if unusable. Exported for tests. */
export function mapRecord(rec: NycDotCameraRecord): CctvCamera | null {
  if (!rec || !rec.id || !rec.imageUrl) return null;
  /* The list keeps offline cameras in it, flagged rather than removed. */
  if (rec.isOnline === false || rec.isOnline === 'false') return null;

  const lat = rec.latitude;
  const lng = rec.longitude;
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!inBounds(lat, lng)) return null;

  return {
    id: `nycdot-${rec.id}`,
    lat,
    lng,
    name: rec.name?.trim() || `NYC DOT Camera ${rec.id}`,
    city: rec.area?.trim() || 'New York City',
    country: 'US',
    feed_url: rec.imageUrl,
    source: 'NYC DOT',
  };
}

/** The NYC DOT camera UUID a still URL carries, whichever host served it. */
const CAMERA_UUID = /\/cameras\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i;

/**
 * The de-duplication key for a merged camera. NYC DOT stills are keyed by
 * their camera UUID, so the 511NY copy and the direct copy of the same
 * camera collide however the hosts are spelled. Everything else is keyed
 * by its own feed address — two distinct NYSDOT cameras really can share
 * a name and a location ("Stormville Rest Area" is two streams, R8_006 and
 * R8_086, at one rest area), so place-plus-name would drop a real camera.
 * Exported for tests.
 */
export function dedupeKey(cam: CctvCamera): string {
  const uuid = (cam.feed_url || cam.stream_url || '').match(CAMERA_UUID)?.[1]?.toLowerCase();
  if (uuid) return `uuid:${uuid}`;
  const url = cam.stream_url || cam.feed_url;
  if (url) return `url:${url.toLowerCase()}`;
  return `geo:${cam.lat.toFixed(5)},${cam.lng.toFixed(5)}:${cam.name.trim().toLowerCase()}`;
}

/** Merge camera lists, first list wins, dropping ids and cameras already seen. Exported for tests. */
export function mergeNewYorkCameras(...lists: CctvCamera[][]): CctvCamera[] {
  const merged: CctvCamera[] = [];
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  for (const list of lists) {
    for (const cam of list) {
      const key = dedupeKey(cam);
      if (seenIds.has(cam.id) || seenKeys.has(key)) continue;
      seenIds.add(cam.id);
      seenKeys.add(key);
      merged.push(cam);
    }
  }
  return merged;
}

async function load511NyCameras(): Promise<CctvCamera[]> {
  const res = await stealthFetch(MAP_FEATURES, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json', Referer: 'https://www.511ny.org/' },
  });
  if (!res.ok) throw new Error(`511NY HTTP ${res.status}`);

  const json = await res.json();
  const feats = json?.features;
  if (!Array.isArray(feats)) throw new Error('511NY returned no features');

  const cams: CctvCamera[] = [];
  for (const f of feats) {
    const cam = mapFeature(f);
    if (cam) cams.push(cam);
  }
  if (!cams.length) throw new Error('511NY returned no usable cameras');
  return cams;
}

async function loadNycDotCameras(): Promise<CctvCamera[]> {
  const res = await stealthFetch(NYC_CAMERAS, {
    signal: AbortSignal.timeout(15000),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`NYC DOT HTTP ${res.status}`);

  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('NYC DOT returned a non-array payload');

  const cams: CctvCamera[] = [];
  for (const rec of data) {
    const cam = mapRecord(rec);
    if (cam) cams.push(cam);
  }
  if (!cams.length) throw new Error('NYC DOT returned no usable cameras');
  return cams;
}

async function loadNewYorkCameras(): Promise<CctvCamera[]> {
  /* Each sub-source is isolated: one failing must not kill the other, and a
     failure is logged rather than swallowed (the route.ts subSource rule). */
  const [statewide, nyc] = await Promise.allSettled([load511NyCameras(), loadNycDotCameras()]);
  if (statewide.status === 'rejected') {
    console.warn('[OSIRIS] NYSDOT (511NY) failed — absent from this refresh:', statewide.reason instanceof Error ? statewide.reason.message : statewide.reason);
  }
  if (nyc.status === 'rejected') {
    console.warn('[OSIRIS] NYC DOT failed — absent from this refresh:', nyc.reason instanceof Error ? nyc.reason.message : nyc.reason);
  }
  if (statewide.status === 'rejected' && nyc.status === 'rejected') {
    throw new Error('New York: both NYSDOT (511NY) and NYC DOT failed');
  }

  const merged = mergeNewYorkCameras(
    statewide.status === 'fulfilled' ? statewide.value : [],
    nyc.status === 'fulfilled' ? nyc.value : [],
  );
  if (!merged.length) throw new Error('New York returned no usable cameras');

  const nysdot = merged.filter(c => c.source === 'NYSDOT').length;
  const nycDot = merged.filter(c => c.source === 'NYC DOT').length;
  console.log(`[OSIRIS] New York cameras — NYSDOT: ${nysdot}, NYC DOT: ${nycDot}, total: ${merged.length}`);
  return merged;
}

export const fetchNewYorkCameras = cachedSource('newyork', loadNewYorkCameras);
