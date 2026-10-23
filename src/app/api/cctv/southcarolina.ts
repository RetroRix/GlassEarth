import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';
import type { CctvCamera } from './types';
import { mapIterisFeature, type IterisCameraFeature, type IterisSource } from './iteris';

/**
 * OSIRIS — South Carolina CCTV Cameras (SCDOT / 511sc.org)
 * Source: https://sc.cdn.iteris-atis.com/geojson/icons/metadata/icons.cameras.geojson
 * ~790 cameras statewide — NO API KEY NEEDED.
 *
 * 511sc.org itself is not the IBI stack (its /List/GetData/Cameras is a 404
 * on a legacy Apache host) — the site is Iteris' ATIS "SafeTravel" app, and
 * this GeoJSON file, named in the page's own markup, is what its map loads
 * for the camera layer. The feature schema is the same one Virginia's
 * Iteris deployment publishes (see ./iteris); here the stable camera key is
 * the camera number in `name` (`50001`), since `id` is a bare UUID.
 *
 * Every camera is both a snapshot and a live `rtplive` HLS stream. The
 * snapshot address is the thumbs URL the app itself uses — it answers with
 * a 301 to the camera's PNG, which browsers follow.
 */

const CAMERAS_URL = 'https://sc.cdn.iteris-atis.com/geojson/icons/metadata/icons.cameras.geojson';

export const SCDOT: IterisSource = {
  idPrefix: 'scdot',
  source: 'SCDOT',
  state: 'South Carolina',
  idField: 'name',
  bounds: { minLat: 32.0, maxLat: 35.2, minLng: -83.4, maxLng: -78.5 },
};

/** Map one SCDOT feature to a camera, or null if unusable. Exported for tests. */
export function mapRecord(feature: IterisCameraFeature): CctvCamera | null {
  return mapIterisFeature(feature, SCDOT);
}

async function loadSouthCarolinaCameras(): Promise<CctvCamera[]> {
  const res = await stealthFetch(CAMERAS_URL, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`SCDOT HTTP ${res.status}`);

  const json = await res.json();
  const features = json?.features;
  if (!Array.isArray(features)) throw new Error('SCDOT returned no features');

  const cams: CctvCamera[] = [];
  const seen = new Set<string>();
  for (const feature of features as IterisCameraFeature[]) {
    const cam = mapRecord(feature);
    if (!cam || seen.has(cam.id)) continue;
    seen.add(cam.id);
    cams.push(cam);
  }

  console.log(`[OSIRIS] South Carolina cameras — SCDOT: ${cams.length} of ${features.length}`);
  return cams;
}

export const fetchSouthCarolinaCameras = cachedSource('southcarolina', loadSouthCarolinaCameras);
