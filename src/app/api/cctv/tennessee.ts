import type { CctvCamera } from './types';
import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — Tennessee CCTV Cameras (TDOT SmartWay / smartway.tn.gov)
 * Source: https://www.tdot.tn.gov/opendata/api/public/RoadwayCameras
 * 669 statewide traffic cameras.
 *
 * SmartWay is an Angular app whose data API wants an `ApiKey` header. That
 * is not a credential anyone signs up for: TDOT publishes the key itself,
 * unauthenticated, in the site's own config file
 * (https://smartway.tn.gov/config/config.prod.json) and ships it to every
 * browser that opens the map. This loader follows the site's own flow —
 * read the public config for the current key and base URL, then call the
 * cameras endpoint with it — so a key rotation on their side heals itself
 * here instead of silently breaking the layer.
 *
 * Every row is video: an HLS playlist on a Skyvdn edge plus a poster frame
 * on tnsnapshots.com (whose /thumbs/ address 301-redirects to the real PNG,
 * which a browser follows on its own). The map filters to active cameras
 * the same way SmartWay does — `active === "true"`.
 */

const CONFIG_URL = 'https://smartway.tn.gov/config/config.prod.json';

/** Tennessee bounding box — drops any stray/placeholder coordinates. */
const TN_BOUNDS = { minLat: 34.9, maxLat: 36.7, minLng: -90.3, maxLng: -81.6 };

/** One row from RoadwayCameras (only the fields we consume). */
export interface TdotCameraRecord {
  id: number;
  title?: string | null;
  description?: string | null;
  thumbnailUrl?: string | null;
  httpsVideoUrl?: string | null;
  active?: string | null;
  jurisdiction?: string | null;
  county?: string | null;
  lat?: number | null;
  lng?: number | null;
}

/** Map one SmartWay record to a camera, or null if unusable. Exported for tests. */
export function mapRecord(rec: TdotCameraRecord): CctvCamera | null {
  if (!rec || typeof rec.id !== 'number') return null;
  if ((rec.active ?? '').toLowerCase() !== 'true') return null;

  const { lat, lng } = rec;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < TN_BOUNDS.minLat || lat > TN_BOUNDS.maxLat) return null;
  if (lng < TN_BOUNDS.minLng || lng > TN_BOUNDS.maxLng) return null;

  const snapshot = rec.thumbnailUrl?.trim() || undefined;
  const hls = rec.httpsVideoUrl?.trim();
  const video = hls && /\.m3u8(\?|$)/i.test(hls) ? hls : undefined;
  if (!snapshot && !video) return null;

  const name = rec.title?.trim() || rec.description?.trim();
  const city = rec.jurisdiction?.trim() || rec.county?.trim() || 'Tennessee';

  return {
    id: `tdot-${rec.id}`,
    lat,
    lng,
    name: name || `TDOT Camera ${rec.id}`,
    city,
    country: 'US',
    ...(snapshot ? { feed_url: snapshot } : {}),
    ...(video ? { stream_url: video, stream_type: 'hls' as const } : {}),
    source: 'TDOT',
  };
}

interface SmartwayConfig {
  apiBaseUrl?: string;
  apiKey?: string;
  cameras?: string;
}

async function loadTennesseeCameras(): Promise<CctvCamera[]> {
  /* The site's own bootstrap: fetch the public config, then call the data
     API under its base URL with its published key as a header. */
  const cfgRes = await stealthFetch(CONFIG_URL, {
    signal: AbortSignal.timeout(15000),
    headers: { Accept: 'application/json' },
  });
  if (!cfgRes.ok) throw new Error(`TDOT config HTTP ${cfgRes.status}`);
  const cfg = (await cfgRes.json()) as SmartwayConfig;
  if (!cfg.apiBaseUrl || !cfg.apiKey || !cfg.cameras) {
    throw new Error('TDOT config is missing apiBaseUrl/apiKey/cameras');
  }

  const res = await stealthFetch(`${cfg.apiBaseUrl}${cfg.cameras}`, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json', ApiKey: cfg.apiKey },
  });
  if (!res.ok) throw new Error(`TDOT HTTP ${res.status}`);

  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('TDOT returned a non-array payload');

  const cams: CctvCamera[] = [];
  const seen = new Set<string>();
  for (const rec of data) {
    const cam = mapRecord(rec);
    if (!cam || seen.has(cam.id)) continue;
    seen.add(cam.id);
    cams.push(cam);
  }

  console.log(`[OSIRIS] Tennessee cameras — TDOT SmartWay: ${cams.length} of ${data.length}`);
  return cams;
}

export const fetchTennesseeCameras = cachedSource('tennessee', loadTennesseeCameras);
