import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';
import type { CctvCamera } from './types';
import { mapIterisFeature, type IterisCameraFeature, type IterisSource } from './iteris';

/**
 * OSIRIS — Virginia CCTV Cameras (VDOT / 511.vdot.virginia.gov)
 * Source: https://511.vdot.virginia.gov/services/511/map/array/cameras
 * ~1,710 cameras statewide — NO API KEY NEEDED.
 *
 * Virginia has two 511 sites and only this one is fetchable. The legacy
 * 511va.org still runs the IBI stack, but every request is intercepted by a
 * JavaScript bot challenge (a token page that bounces the browser through a
 * rotating ww*.511va.org host), which a plain HTTP fetch cannot pass.
 * 511virginia.org now redirects here, to VDOT's current site — an Iteris
 * ATIS app whose map loads its camera array from the endpoint above, in the
 * same GeoJSON schema as South Carolina's (see ./iteris). The response is a
 * `{ success, data }` envelope; `data` is the feature array.
 *
 * Every camera is both a snapshot (320×240 PNGs from
 * snapshot.vdotcameras.com) and a live `rtplive` HLS stream. One published
 * row — I-66 @ VA-243 — carries a sign-flipped longitude (+77.2667), and the
 * bounds check drops it rather than draw a Fairfax camera in the Atlantic.
 */

const CAMERAS_URL = 'https://511.vdot.virginia.gov/services/511/map/array/cameras';

export const VDOT: IterisSource = {
  idPrefix: 'vdot',
  source: 'VDOT',
  state: 'Virginia',
  idField: 'id',
  bounds: { minLat: 36.5, maxLat: 39.5, minLng: -83.7, maxLng: -75.2 },
};

/** Map one VDOT feature to a camera, or null if unusable. Exported for tests. */
export function mapRecord(feature: IterisCameraFeature): CctvCamera | null {
  return mapIterisFeature(feature, VDOT);
}

async function loadVirginiaCameras(): Promise<CctvCamera[]> {
  const res = await stealthFetch(CAMERAS_URL, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`VDOT HTTP ${res.status}`);

  const json = await res.json();
  if (json?.success !== true || !Array.isArray(json?.data)) {
    throw new Error('VDOT returned no camera array');
  }

  const cams: CctvCamera[] = [];
  const seen = new Set<string>();
  for (const feature of json.data as IterisCameraFeature[]) {
    const cam = mapRecord(feature);
    if (!cam || seen.has(cam.id)) continue;
    seen.add(cam.id);
    cams.push(cam);
  }

  console.log(`[OSIRIS] Virginia cameras — VDOT: ${cams.length} of ${json.data.length}`);
  return cams;
}

export const fetchVirginiaCameras = cachedSource('virginia', loadVirginiaCameras);
