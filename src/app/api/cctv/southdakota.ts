import type { CctvCamera } from './types';
import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — South Dakota CCTV Cameras (SDDOT / sd511.org)
 * Source: https://sd.cdn.iteris-atis.com/geojson/icons/metadata/icons.cameras.geojson
 * — the GeoJSON the SafeTravelUSA (Iteris) map at sd511.org loads its camera
 * layer from, named in the page's own inline config — NO API KEY NEEDED.
 * 40 camera sites publishing 173 directional stills.
 *
 * One feature is one site (Watertown North, Brookings South) whose
 * `cameras` array holds a still per direction, each a `latest.jpg` on the
 * same Iteris CDN that refreshes in place. Every view becomes its own
 * camera, keyed by the site id and the view's own id; the view's
 * `description` is the honest label — it names the road, the milepost and
 * the direction the camera looks.
 */

const CAMERAS_GEOJSON = 'https://sd.cdn.iteris-atis.com/geojson/icons/metadata/icons.cameras.geojson';

/** South Dakota bounding box — drops any stray/placeholder coordinates. */
const SD_BOUNDS = { minLat: 42.5, maxLat: 45.9, minLng: -104.1, maxLng: -96.4 };

export interface SddotView {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  image?: string | null;
  updateTime?: number | null;
}

export interface SddotFeature {
  id?: string | null;
  geometry?: { type?: string | null; coordinates?: [number, number] } | null;
  properties?: {
    name?: string | null;
    route?: string | null;
    mrm?: string | null;
    cameras?: SddotView[] | null;
  } | null;
}

/**
 * Map one site to its cameras — one per published view, possibly none.
 * Exported for tests.
 */
export function mapFeature(f: SddotFeature): CctvCamera[] {
  const p = f?.properties;
  if (!p || !f.id) return [];

  const coords = f.geometry?.coordinates;
  if (!coords) return [];
  const [lng, lat] = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  if (lat < SD_BOUNDS.minLat || lat > SD_BOUNDS.maxLat) return [];
  if (lng < SD_BOUNDS.minLng || lng > SD_BOUNDS.maxLng) return [];

  const site = p.name?.trim() || 'South Dakota';
  const cams: CctvCamera[] = [];
  for (const view of p.cameras || []) {
    const url = view.image?.trim();
    if (!url || !view.id) continue;
    cams.push({
      id: `sddot-${f.id}-${view.id}`,
      lat,
      lng,
      name: view.description?.trim() || (view.name ? `${site} — ${view.name}` : site),
      city: site,
      country: 'US',
      feed_url: url,
      source: 'SDDOT',
    });
  }
  return cams;
}

async function loadSouthDakotaCameras(): Promise<CctvCamera[]> {
  const res = await stealthFetch(CAMERAS_GEOJSON, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`SD511 HTTP ${res.status}`);

  const json = await res.json();
  const feats = json?.features;
  if (!Array.isArray(feats)) throw new Error('SD511 returned no features');

  const cams: CctvCamera[] = [];
  for (const f of feats) cams.push(...mapFeature(f));

  console.log(`[OSIRIS] South Dakota cameras — SDDOT: ${cams.length} views from ${feats.length} sites`);
  return cams;
}

export const fetchSouthDakotaCameras = cachedSource('southdakota', loadSouthDakotaCameras);
