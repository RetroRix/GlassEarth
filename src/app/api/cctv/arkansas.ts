import type { CctvCamera } from './types';
import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — Arkansas CCTV Cameras (ARDOT / idrivearkansas.com)
 * Source: https://layers.idrivearkansas.com/cameras.geojson — the GeoJSON
 * layer the IDrive Arkansas map itself loads (its base URL is published in
 * https://layers.idrivearkansas.com/staticapi.js)
 * 549 online cameras statewide — NO API KEY NEEDED.
 *
 * Each feature names its snapshot only indirectly: the site's player asks
 * `actis.idrivearkansas.com/index.php/api/cameras/image?camera={id}`, which
 * 302-redirects to `layers.idrivearkansas.com/cameras/{id}.jpg` — a live
 * 720×405 frame (PNG bytes under a .jpg name; browsers sniff it fine). The
 * redirect target is what gets stored, so tiles load in one hop.
 *
 * The HLS address in `hls_stream_protected` earns the name: the CDN answers
 * a CloudFront `MissingKey` error to anyone without the signed session the
 * site's stream-vending endpoint issues, so — like Florida's gated
 * playlists — these cameras show their snapshot and no stream.
 *
 * The feed also carries ARDOT's Memphis, Tennessee bridge cameras (I-40 /
 * I-55 at the river); the bounding box below is the state line the region
 * is registered with, and they fall east of it.
 */

const CAMERAS_URL = 'https://layers.idrivearkansas.com/cameras.geojson';
const SNAPSHOT_BASE = 'https://layers.idrivearkansas.com/cameras';

/** Arkansas bounding box — drops any stray/placeholder coordinates. */
const AR_BOUNDS = { minLat: 33.0, maxLat: 36.5, minLng: -94.6, maxLng: -90.1 };

/** One GeoJSON feature from cameras.geojson (only the fields we consume). */
export interface ArdotFeature {
  properties?: {
    id?: number | null;
    status?: string | null;
    name?: string | null;
  } | null;
  geometry?: { type?: string | null; coordinates?: [number, number] | null } | null;
}

/** Map one GeoJSON feature to a camera, or null if unusable. Exported for tests. */
export function mapFeature(f: ArdotFeature): CctvCamera | null {
  const p = f?.properties;
  if (!p || typeof p.id !== 'number') return null;
  if (p.status !== 'online') return null;
  if (f.geometry?.type !== 'Point' || !f.geometry.coordinates) return null;

  const [lng, lat] = f.geometry.coordinates;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < AR_BOUNDS.minLat || lat > AR_BOUNDS.maxLat) return null;
  if (lng < AR_BOUNDS.minLng || lng > AR_BOUNDS.maxLng) return null;

  return {
    id: `ardot-${p.id}`,
    lat,
    lng,
    name: p.name?.trim() || `ARDOT Camera ${p.id}`,
    city: 'Arkansas',
    country: 'US',
    feed_url: `${SNAPSHOT_BASE}/${p.id}.jpg`,
    source: 'ARDOT',
  };
}

async function loadArkansasCameras(): Promise<CctvCamera[]> {
  const res = await stealthFetch(CAMERAS_URL, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`ARDOT HTTP ${res.status}`);

  const data = await res.json();
  if (!Array.isArray(data?.features)) throw new Error('ARDOT returned no features');

  const cams: CctvCamera[] = [];
  const seen = new Set<string>();
  for (const f of data.features) {
    const cam = mapFeature(f);
    if (!cam || seen.has(cam.id)) continue;
    seen.add(cam.id);
    cams.push(cam);
  }

  console.log(`[OSIRIS] Arkansas cameras — ARDOT: ${cams.length} of ${data.features.length}`);
  return cams;
}

export const fetchArkansasCameras = cachedSource('arkansas', loadArkansasCameras);
