import type { CctvCamera } from './types';
import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — Colorado CCTV Cameras (CDOT / cotrip.org)
 * Source: https://api-511x-co.carsprogram.org/cameras/map-features — the
 * GeoJSON layer feed COtrip's own map reads; COtrip's published config
 * (511.cotrip.org/configs/main.json) names this as the cameras layer `api`,
 * and the app fetches `{api}/map-features` — NO API KEY NEEDED.
 * ~870 statewide cameras.
 *
 * Two view shapes. 826 cameras carry a `WMP` view: an HLS playlist on
 * publicstreamer{1-4}.cotrip.org (verified live) plus a poster frame in
 * `videoPreviewUrl` on cocam.carsprogram.org — served as image/jpeg despite
 * the `.flv.png` name. The other 47 are `STILL_IMAGE`: the view URL itself
 * is that same poster snapshot and there is no stream.
 *
 * COtrip's GraphQL hosts do not answer (511.cotrip.org refuses, the
 * carsprogram API host returns a health stub) — this layer feed is the
 * endpoint the production app actually uses.
 */

const MAP_FEATURES = 'https://api-511x-co.carsprogram.org/cameras/map-features';

/** Colorado bounding box — drops any stray/placeholder coordinates. */
const CO_BOUNDS = { minLat: 36.9, maxLat: 41.0, minLng: -109.1, maxLng: -102.0 };

export interface CotripView {
  name?: string | null;
  type?: string | null;
  url?: string | null;
  videoPreviewUrl?: string | null;
  broken?: boolean | null;
}

export interface CotripFeature {
  type?: string | null;
  geometry?: { type?: string | null; coordinates?: [number, number] } | null;
  properties?: {
    id?: number | null;
    name?: string | null;
    public?: boolean | null;
    location?: { cityReference?: string | null } | null;
    views?: CotripView[] | null;
  } | null;
}

/** The caption city: the feed writes `in Denver`, `in Idaho Springs`. */
export function cityName(cityReference?: string | null): string {
  const city = cityReference?.trim().replace(/^in\s+/i, '');
  return city || 'Colorado';
}

/** Map one GeoJSON feature to a camera, or null if unusable. Exported for tests. */
export function mapFeature(f: CotripFeature): CctvCamera | null {
  const p = f?.properties;
  if (!p || typeof p.id !== 'number' || p.public === false) return null;

  /* A view the operator has flagged broken serves a placeholder, not a
     picture; COtrip's own config hides those cameras outright. */
  const view = p.views?.[0];
  if (!view || view.broken) return null;

  const coords = f.geometry?.coordinates;
  if (!coords) return null;
  const [lng, lat] = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < CO_BOUNDS.minLat || lat > CO_BOUNDS.maxLat) return null;
  if (lng < CO_BOUNDS.minLng || lng > CO_BOUNDS.maxLng) return null;

  const url = view.url?.trim();
  if (!url) return null;

  const isStream = view.type !== 'STILL_IMAGE' && /\.m3u8(\?|$)/i.test(url);
  const snapshot = view.type === 'STILL_IMAGE' ? url : view.videoPreviewUrl?.trim() || undefined;
  if (!isStream && !snapshot) return null;

  return {
    id: `cdot-${p.id}`,
    lat,
    lng,
    name: p.name?.trim() || view.name?.trim() || `CDOT Camera ${p.id}`,
    city: cityName(p.location?.cityReference),
    country: 'US',
    ...(snapshot ? { feed_url: snapshot } : {}),
    ...(isStream ? { stream_url: url, stream_type: 'hls' as const } : {}),
    source: 'CDOT',
  };
}

async function loadColoradoCameras(): Promise<CctvCamera[]> {
  const res = await stealthFetch(MAP_FEATURES, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json', 'content-language': 'en' },
  });
  if (!res.ok) throw new Error(`COtrip HTTP ${res.status}`);

  const json = await res.json();
  const feats = json?.features;
  if (!Array.isArray(feats)) throw new Error('COtrip returned no features');

  const cams: CctvCamera[] = [];
  const seen = new Set<string>();
  for (const f of feats) {
    const cam = mapFeature(f);
    if (!cam || seen.has(cam.id)) continue;
    seen.add(cam.id);
    cams.push(cam);
  }

  console.log(`[OSIRIS] Colorado cameras — CDOT: ${cams.length} of ${feats.length}`);
  return cams;
}

export const fetchColoradoCameras = cachedSource('colorado', loadColoradoCameras);
