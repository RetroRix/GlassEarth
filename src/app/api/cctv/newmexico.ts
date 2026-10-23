import type { CctvCamera } from './types';
import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — New Mexico CCTV Cameras (NMDOT / nmroads.com)
 * Source: https://servicev5.nmroads.com/RealMapWAR/GetCameraInfo — the
 * camera index NMRoads' own map loads (its js/common.js calls exactly this
 * on the v5 service) — NO API KEY NEEDED.
 * ~185 statewide cameras, every one enabled and publishing a snapshot.
 *
 * The records are flat: `title`, `lat`/`lon`, a `grouping` (Santa Fe Area,
 * Albuquerque Area, …) that serves as the caption, and `snapshotFile`.
 * The cameras also advertise an RTMP stream (`videoServer` +
 * `sdpFileHighRes`), which no browser here can play, so only the still is
 * taken. The stills are served over plain http from ss.nmroads.com — that
 * host has no working TLS — so they rely on the same image-proxy path as
 * the other http-only sources in ./types.
 */

const CAMERA_INFO = 'https://servicev5.nmroads.com/RealMapWAR/GetCameraInfo';

/** New Mexico bounding box — drops any stray/placeholder coordinates. */
const NM_BOUNDS = { minLat: 31.3, maxLat: 37.0, minLng: -109.1, maxLng: -103.0 };

/** One row from GetCameraInfo — only the fields we consume. */
export interface NmdotCameraRecord {
  name?: string | null;
  title?: string | null;
  lat?: number | null;
  lon?: number | null;
  grouping?: string | null;
  snapshotFile?: string | null;
  enabled?: boolean | null;
}

/** `I-25@La_Bajada_Lower` → `i-25-la-bajada-lower`, for the camera id. */
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Map a raw record to a CctvCamera, or null if it should be skipped. Exported for tests. */
export function mapRecord(rec: NmdotCameraRecord): CctvCamera | null {
  if (!rec || rec.enabled === false) return null;

  const snapshot = rec.snapshotFile?.trim();
  if (!snapshot) return null;

  const lat = rec.lat;
  const lng = rec.lon;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < NM_BOUNDS.minLat || lat > NM_BOUNDS.maxLat) return null;
  if (lng < NM_BOUNDS.minLng || lng > NM_BOUNDS.maxLng) return null;

  const name = rec.name?.trim();
  if (!name) return null;

  return {
    id: `nmdot-${slugify(name)}`,
    lat,
    lng,
    name: rec.title?.trim() || name,
    city: rec.grouping?.trim() || 'New Mexico',
    country: 'US',
    feed_url: snapshot,
    source: 'NMDOT',
  };
}

async function loadNewMexicoCameras(): Promise<CctvCamera[]> {
  const res = await stealthFetch(CAMERA_INFO, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json', Referer: 'https://nmroads.com/default.html' },
  });
  if (!res.ok) throw new Error(`NMRoads HTTP ${res.status}`);

  const json = await res.json();
  const records = json?.cameraInfo;
  if (!Array.isArray(records)) throw new Error('NMRoads returned no cameraInfo');

  const cams: CctvCamera[] = [];
  const seen = new Set<string>();
  for (const rec of records) {
    const cam = mapRecord(rec);
    if (!cam || seen.has(cam.id)) continue;
    seen.add(cam.id);
    cams.push(cam);
  }

  console.log(`[OSIRIS] New Mexico cameras — NMDOT: ${cams.length} of ${records.length}`);
  return cams;
}

export const fetchNewMexicoCameras = cachedSource('newmexico', loadNewMexicoCameras);
