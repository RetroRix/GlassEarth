import type { CctvCamera } from './types';
import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — Delaware CCTV Cameras (DelDOT / tmc.deldot.gov)
 * Source: https://tmc.deldot.gov/json/videocamera.json
 * ~365 statewide traffic cameras — NO API KEY NEEDED.
 *
 * The JSON the DelDOT interactive travel map (deldot.gov/map) itself loads
 * for its Traffic Cameras layer. Every record carries its position, county
 * and a set of stream URLs on video.deldot.gov; of those only `m3u8s` is the
 * HTTPS HLS playlist, which is what these cameras play — the plain `m3u8`
 * twin is http and a browser on an https page would block it as mixed
 * content.
 *
 * `enabled` is the publication flag and drops a camera; `status` is a
 * momentary health reading (Active / Unavailable) and does not — a camera
 * the TMC marks Unavailable still has a live playlist address.
 */

const FEED = 'https://tmc.deldot.gov/json/videocamera.json';

/** Delaware bounding box — drops any stray/placeholder coordinates. */
const DE_BOUNDS = { minLat: 38.4, maxLat: 39.9, minLng: -75.8, maxLng: -75.0 };

/** One record from videocamera.json — only the fields we consume. */
export interface DelDotCameraRecord {
  id?: string | null;
  title?: string | null;
  county?: string | null;
  lat?: number | null;
  lon?: number | null;
  enabled?: boolean | null;
  urls?: { m3u8s?: string | null } | null;
}

/** Map one DelDOT record to a camera, or null if unusable. Exported for tests. */
export function mapRecord(rec: DelDotCameraRecord): CctvCamera | null {
  if (!rec || rec.enabled === false) return null;

  const id = rec.id?.trim();
  if (!id) return null;

  const stream = rec.urls?.m3u8s?.trim();
  if (!stream || !/\.m3u8(\?|$)/i.test(stream)) return null;

  const lat = rec.lat;
  const lng = rec.lon;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < DE_BOUNDS.minLat || lat > DE_BOUNDS.maxLat) return null;
  if (lng < DE_BOUNDS.minLng || lng > DE_BOUNDS.maxLng) return null;

  const county = rec.county?.trim();

  return {
    id: `deldot-${id}`,
    lat,
    lng,
    name: rec.title?.trim() || `DelDOT Camera ${id}`,
    city: county ? `${county} County` : 'Delaware',
    country: 'US',
    stream_url: stream,
    stream_type: 'hls',
    source: 'DelDOT',
  };
}

async function loadDelawareCameras(): Promise<CctvCamera[]> {
  const res = await stealthFetch(FEED, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`DelDOT HTTP ${res.status}`);

  const json = await res.json();
  const rows = json?.videoCameras;
  if (!Array.isArray(rows)) throw new Error('DelDOT returned no videoCameras');

  const cams: CctvCamera[] = [];
  const seen = new Set<string>();
  for (const rec of rows) {
    const cam = mapRecord(rec);
    if (!cam || seen.has(cam.id)) continue;
    seen.add(cam.id);
    cams.push(cam);
  }

  console.log(`[OSIRIS] Delaware cameras — DelDOT: ${cams.length}`);
  return cams;
}

export const fetchDelawareCameras = cachedSource('delaware', loadDelawareCameras);
