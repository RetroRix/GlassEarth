import type { CctvCamera } from './types';
import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — District of Columbia CCTV Cameras (DDOT)
 * Source: https://services.arcgis.com/neT9SoYxizqTHZPH/arcgis/rest/services/
 *   DDOT_CCTV_Location_Feeds/FeatureServer/0 — the camera layer DDOT itself
 *   publishes for its CCTV map
 * ~138 cameras across the District — NO API KEY NEEDED.
 *
 * Every row is video-only: an HLS playlist on DDOT's Skyvdn edge. The
 * layer's `image_url` column was never filled in — it points at a
 * placeholder on imageserver.example.com — so there is no poster frame to
 * publish, and these come up as video tiles rather than snapshots. The
 * human-readable caption lives in `description`; `name` is the stream
 * token, not a label anyone should be shown.
 */

const QUERY_URL =
  'https://services.arcgis.com/neT9SoYxizqTHZPH/arcgis/rest/services/DDOT_CCTV_Location_Feeds/FeatureServer/0/query';
const PAGE_SIZE = 1000; // the layer's maxRecordCount
const MAX_PAGES = 5; // safety bound so a bad flag can't fan out forever

/** District bounding box — drops any stray rows outside the District line. */
const DC_BOUNDS = { minLat: 38.79, maxLat: 39.0, minLng: -77.12, maxLng: -76.9 };

/** One feature from DDOT_CCTV_Location_Feeds (only the fields we consume). */
export interface DdotFeature {
  attributes?: {
    id?: number | null;
    description?: string | null;
    https_url?: string | null;
    active?: number | null;
    problem_stream?: number | null;
  } | null;
  geometry?: { x?: number | null; y?: number | null } | null;
}

/** Map one DDOT feature to a camera, or null if unusable. Exported for tests. */
export function mapFeature(f: DdotFeature): CctvCamera | null {
  const a = f?.attributes;
  if (!a || typeof a.id !== 'number') return null;
  if (a.active !== 1 || a.problem_stream === 1) return null;

  const lat = f.geometry?.y;
  const lng = f.geometry?.x;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < DC_BOUNDS.minLat || lat > DC_BOUNDS.maxLat) return null;
  if (lng < DC_BOUNDS.minLng || lng > DC_BOUNDS.maxLng) return null;

  const hls = a.https_url?.trim();
  if (!hls || !/\.m3u8(\?|$)/i.test(hls)) return null;

  return {
    id: `ddot-${a.id}`,
    lat,
    lng,
    name: a.description?.trim() || `DDOT Camera ${a.id}`,
    city: 'Washington',
    country: 'US',
    stream_url: hls,
    stream_type: 'hls',
    source: 'DDOT',
  };
}

async function fetchPage(offset: number): Promise<{ rows: DdotFeature[]; more: boolean }> {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: '*',
    outSR: '4326',
    f: 'json',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    orderByFields: 'ObjectId',
  });
  const res = await stealthFetch(`${QUERY_URL}?${params}`, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`DDOT ArcGIS HTTP ${res.status}`);
  const data = await res.json();
  /* ArcGIS reports a bad query as an `error` object on a 200, not a status. */
  if (data?.error) throw new Error(`DDOT ArcGIS error: ${data.error.message ?? 'unknown'}`);
  if (!Array.isArray(data?.features)) throw new Error('DDOT ArcGIS returned no features');
  return { rows: data.features, more: data.exceededTransferLimit === true };
}

async function loadDcCameras(): Promise<CctvCamera[]> {
  const cams: CctvCamera[] = [];
  const seen = new Set<string>();

  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { rows, more } = await fetchPage(offset);
    for (const feature of rows) {
      const cam = mapFeature(feature);
      if (!cam || seen.has(cam.id)) continue;
      seen.add(cam.id);
      cams.push(cam);
    }
    if (!more || rows.length === 0) break;
    offset += rows.length;
  }

  console.log(`[OSIRIS] DC cameras — DDOT: ${cams.length}`);
  return cams;
}

export const fetchDcCameras = cachedSource('dc', loadDcCameras);
