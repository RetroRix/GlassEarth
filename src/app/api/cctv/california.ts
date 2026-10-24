import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';
import type { CctvCamera } from './types';

/**
 * OSIRIS — California CCTV Cameras (Caltrans / CHhighway CCTV)
 * Source: Caltrans ArcGIS FeatureServer
 *   https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/CCTV/FeatureServer/0/query
 * ~2,936 cameras statewide — NO API KEY NEEDED.
 *
 * Each row publishes BOTH a snapshot (`currentImageURL`) and, for ~2/3 of
 * rows, a live HLS stream (`streamingVideoURL`, wzmedia.dot.ca.gov). The
 * stream is wired when it is a usable https .m3u8 URL — the published field
 * is not clean: probed 2026-10-24, ~1 in 3 published stream URLs 404s
 * (stale stream names, per camera, not per district), and at least one row
 * carries an internal `rtsp://admin:…@10.x.x.x:554/` URL that must never be
 * handed to a browser. Rows whose stream is unusable keep their snapshot;
 * the player degrades a dead stream to that snapshot (see lib/camera-preview).
 *
 * The service caps a page at 2,000 rows (maxRecordCount), so the fetch
 * pages with resultOffset — the previous unpaged query silently dropped the
 * last ~936 cameras.
 */

const FEATURE_SERVER =
  'https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/CCTV/FeatureServer/0/query';

export interface CaltransFeature {
  attributes?: {
    OBJECTID?: number;
    locationName?: string;
    nearbyPlace?: string;
    county?: string;
    latitude?: number;
    longitude?: number;
    currentImageURL?: string;
    streamingVideoURL?: string;
  };
  geometry?: { x?: number; y?: number };
}

/** A published stream URL is only wired if a browser can play it: https + .m3u8. */
export function isPlayableStreamUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed.startsWith('https://')) return false;
  const path = trimmed.split(/[?#]/, 1)[0];
  return path.toLowerCase().endsWith('.m3u8');
}

/** Map one Caltrans feature to a camera, or null if unusable. Exported for tests. */
export function mapCaltransFeature(feature: CaltransFeature): CctvCamera | null {
  const a = feature?.attributes ?? {};
  const g = feature?.geometry ?? {};
  // The layer publishes latitude/longitude attributes as well as geometry;
  // either will do, attributes first (the previous fetcher read them).
  const lat = typeof a.latitude === 'number' ? a.latitude : typeof g.y === 'number' ? g.y : NaN;
  const lng = typeof a.longitude === 'number' ? a.longitude : typeof g.x === 'number' ? g.x : NaN;
  const feed = typeof a.currentImageURL === 'string' ? a.currentImageURL.trim() : '';
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < 32 || lat > 42.1 || lng < -124.5 || lng > -114) return null;
  if (!feed) return null;
  if (a.OBJECTID == null) return null;

  // Keep the old fetcher's naming and the old `cal-` id prefix: favorites and
  // shared-view links name cameras by id, and neither should silently break.
  const name = a.locationName || 'Caltrans Camera';
  const city = a.nearbyPlace || a.county || 'California';
  const cam: CctvCamera = {
    id: `cal-${a.OBJECTID}`,
    lat,
    lng,
    name: String(name),
    city: String(city),
    country: 'US',
    feed_url: feed,
    source: 'Caltrans',
  };
  if (isPlayableStreamUrl(a.streamingVideoURL)) {
    cam.stream_url = (a.streamingVideoURL as string).trim();
    cam.stream_type = 'hls';
  }
  return cam;
}

async function loadCaltransCameras(): Promise<CctvCamera[]> {
  const cams: CctvCamera[] = [];
  const seen = new Set<string>();
  // The service caps a page at 2,000 rows; page in 1,000s until a short page.
  for (let offset = 0; ; offset += 1000) {
    const url =
      `${FEATURE_SERVER}?where=1%3D1&outFields=OBJECTID,locationName,nearbyPlace,county,latitude,longitude,currentImageURL,streamingVideoURL` +
      `&returnGeometry=true&outSR=4326&f=json&resultOffset=${offset}&resultRecordCount=1000`;
    const res = await stealthFetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Caltrans HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json?.features)) throw new Error('Caltrans returned no feature array');
    for (const feature of json.features as CaltransFeature[]) {
      const cam = mapCaltransFeature(feature);
      if (!cam || seen.has(cam.id)) continue;
      seen.add(cam.id);
      cams.push(cam);
    }
    if (json.features.length < 1000) break;
  }
  return cams;
}

export const fetchCaltransCameras = cachedSource('caltrans', loadCaltransCameras);
