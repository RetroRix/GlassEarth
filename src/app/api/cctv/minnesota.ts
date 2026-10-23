import type { CctvCamera } from './types';
import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — Minnesota CCTV Cameras (MnDOT / new.511mn.org)
 * Source: https://new.511mn.org/configs/main.json — the CARS 511x platform
 * ~1,540 statewide traffic cameras — NO API KEY NEEDED.
 *
 * This is the same vendor family as Indiana, but not the same API. The new
 * 511x sites do not serve Indiana's GraphQL MapFeatures query; the app's own
 * bundle reads its layer index from `${api}/map-features`, where the config
 * names `api` as https://api-511x-mn.carsprogram.org/cameras for the layer
 * whose slug is `normalCameras`. That endpoint hands back the whole state at
 * once as GeoJSON — no paging, no clustering, no key.
 *
 * A feature's views decide what it shows. A `WMP` view is live video: its
 * `url` is an HLS playlist on MnDOT's own edge
 * (`video.dot.state.mn.us/public/<cam>.stream/playlist.m3u8`) and its
 * `videoPreviewUrl` is the matching JPEG poster on public.carsprogram.org.
 * A `STILL_IMAGE` view's `url` is the JPEG itself; the rural cameras that use
 * them carry several views (several fixed angles) rather than a stream, and
 * the first is the one the map shows.
 */

const MAP_FEATURES = 'https://api-511x-mn.carsprogram.org/cameras/map-features';

/** Minnesota bounding box — drops any stray/placeholder coordinates. */
const MN_BOUNDS = { minLat: 43.4, maxLat: 49.4, minLng: -97.3, maxLng: -89.4 };

/** One view of a camera — only the fields we consume. */
export interface MnDotView {
  name?: string | null;
  type?: string | null;
  url?: string | null;
  videoPreviewUrl?: string | null;
  broken?: boolean | null;
}

/** One feature from /cameras/map-features — only the fields we consume. */
export interface MnDotFeature {
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
    views?: MnDotView[] | null;
  } | null;
}

/**
 * The caption under a camera's name. `cityReference` is a phrase, not a
 * place: "in Eagan" and "near Rochester" name one, while "12 miles south of
 * Spring Valley" describes a distance from one. Only the first two forms are
 * used; anything else falls back to the state rather than put a mileage on
 * the map as if it were a town.
 */
function cityFromReference(ref?: string | null): string {
  const m = ref?.trim().match(/^(?:in|near)\s+(.+)$/i);
  return m ? m[1].trim() : 'Minnesota';
}

/** Map one map feature to a camera, or null if unusable. Exported for tests. */
export function mapFeature(f: MnDotFeature): CctvCamera | null {
  const props = f?.properties;
  if (!props || props.id == null) return null;

  const coords = f.geometry?.coordinates;
  if (!coords) return null;
  const [lng, lat] = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < MN_BOUNDS.minLat || lat > MN_BOUNDS.maxLat) return null;
  if (lng < MN_BOUNDS.minLng || lng > MN_BOUNDS.maxLng) return null;

  /* Broken views are the platform saying the feed is down. A camera whose
     every view is broken has nothing to show, so it drops out entirely. */
  const views = (props.views || []).filter(v => v && !v.broken);
  if (!views.length) return null;

  const streamView = views.find(v => /\.m3u8(\?|$)/i.test(v.url || ''));
  const stillView = views.find(v => v.url && !/\.m3u8(\?|$)/i.test(v.url));
  const stream = streamView?.url || undefined;
  const feed = streamView?.videoPreviewUrl || stillView?.url || views[0]?.videoPreviewUrl || undefined;
  if (!stream && !feed) return null;

  const id = props.id;
  return {
    id: `mndot-${id}`,
    lat,
    lng,
    name: props.name?.trim() || props.tooltip?.trim() || `MnDOT Camera ${id}`,
    city: cityFromReference(props.location?.cityReference),
    country: 'US',
    ...(feed ? { feed_url: feed } : {}),
    ...(stream ? { stream_url: stream, stream_type: 'hls' as const } : {}),
    external_url: `https://new.511mn.org/camera/${id}`,
    source: 'MnDOT',
  };
}

async function loadMinnesotaCameras(): Promise<CctvCamera[]> {
  const res = await stealthFetch(MAP_FEATURES, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json', Referer: 'https://new.511mn.org/' },
  });
  if (!res.ok) throw new Error(`MnDOT HTTP ${res.status}`);

  const json = await res.json();
  const feats = json?.features;
  if (!Array.isArray(feats)) throw new Error('MnDOT returned no features');

  const cams: CctvCamera[] = [];
  const seen = new Set<string>();
  for (const f of feats) {
    const cam = mapFeature(f);
    if (!cam || seen.has(cam.id)) continue;
    seen.add(cam.id);
    cams.push(cam);
  }
  if (!cams.length) throw new Error('MnDOT returned no usable cameras');

  console.log(`[OSIRIS] Minnesota cameras — MnDOT: ${cams.length}`);
  return cams;
}

export const fetchMinnesotaCameras = cachedSource('minnesota', loadMinnesotaCameras);
