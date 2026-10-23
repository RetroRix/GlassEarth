import type { CctvCamera } from './types';
import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — Nebraska CCTV Cameras (NDOT / 511.nebraska.gov)
 * Source: https://511.nebraska.gov/api/graphql — the CARS 511 platform's map query
 * ~340 statewide cameras — NO API KEY NEEDED.
 *
 * Nebraska 511 is the same CARS platform as Indiana and Kansas, and answers
 * the same MapFeatures GraphQL query (the site itself is a config-driven SPA
 * shell; the API is the only way in). Every camera here is a still: views
 * come back category `IMAGE` with a JPEG on dot511.nebraska.gov. One camera
 * of the 340 publishes no view at all and drops out in the mapper.
 *
 * The image URLs carry a per-request `?1792771320000` cache-buster. The
 * images serve fine without it (verified), so it is stripped to keep
 * feed_url stable across refreshes.
 */

const GRAPHQL = 'https://511.nebraska.gov/api/graphql';

/** Nebraska bounding box — drops any stray/placeholder coordinates. */
const NE_BOUNDS = { minLat: 40.0, maxLat: 43.0, minLng: -104.1, maxLng: -95.3 };

const QUERY = `query MapFeatures($input: MapFeaturesArgs!) {
  mapFeaturesQuery(input: $input) {
    mapFeatures {
      title
      uri
      features { geometry }
      __typename
      ... on Camera { active views(limit: 1) { category ... on CameraView { url } } }
    }
    error { message }
  }
}`;

export interface NdotFeature {
  title?: string | null;
  uri?: string | null;
  features?: Array<{ geometry?: { type?: string | null; coordinates?: [number, number] } | null }> | null;
  __typename?: string | null;
  active?: boolean | null;
  views?: Array<{ url?: string | null; category?: string | null }> | null;
}

/** Map one map feature to a camera, or null if unusable. Exported for tests. */
export function mapFeature(f: NdotFeature): CctvCamera | null {
  if (f?.__typename !== 'Camera' || f.active === false) return null;

  const rawUrl = f.views?.[0]?.url?.trim();
  if (!rawUrl) return null;
  const url = rawUrl.split('?')[0];
  /* Kansas's deployment of this same platform intermittently returns only
     the cache-buster (`?1792771620000`) for a URL; anything that is not an
     absolute address after the strip is not a feed. */
  if (!/^https?:\/\//i.test(url)) return null;

  const coords = f.features?.[0]?.geometry?.coordinates;
  if (!coords) return null;
  const [lng, lat] = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < NE_BOUNDS.minLat || lat > NE_BOUNDS.maxLat) return null;
  if (lng < NE_BOUNDS.minLng || lng > NE_BOUNDS.maxLng) return null;

  const id = f.uri?.match(/camera\/(\d+)/)?.[1];
  if (!id) return null;

  /* Every view Nebraska publishes today is a still. A playlist URL, if one
     ever appears, is the only thing that should reach the HLS player. */
  const isStream = /\.m3u8(\?|$)/i.test(url);

  return {
    id: `ndot-${id}`,
    lat,
    lng,
    name: f.title?.trim() || `NDOT Camera ${id}`,
    city: 'Nebraska',
    country: 'US',
    ...(isStream
      ? { stream_url: url, stream_type: 'hls' as const }
      : { feed_url: url }),
    external_url: `https://511.nebraska.gov/@${lat},${lng},14?show=${encodeURIComponent(f.uri || '')}`,
    source: 'NDOT',
  };
}

async function loadNebraskaCameras(): Promise<CctvCamera[]> {
  const res = await stealthFetch(GRAPHQL, {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Referer: 'https://511.nebraska.gov/' },
    body: JSON.stringify({
      query: QUERY,
      variables: {
        input: {
          north: NE_BOUNDS.maxLat,
          south: NE_BOUNDS.minLat,
          east: NE_BOUNDS.maxLng,
          west: NE_BOUNDS.minLng,
          zoom: 16,
          layerSlugs: ['normalCameras'],
          nonClusterableUris: null,
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`Nebraska 511 HTTP ${res.status}`);

  const json = await res.json();
  const feats = json?.data?.mapFeaturesQuery?.mapFeatures;
  if (!Array.isArray(feats)) throw new Error('Nebraska 511 returned no mapFeatures');

  const cams: CctvCamera[] = [];
  const seen = new Set<string>();
  for (const f of feats) {
    const cam = mapFeature(f);
    if (!cam || seen.has(cam.id)) continue;
    seen.add(cam.id);
    cams.push(cam);
  }

  console.log(`[OSIRIS] Nebraska cameras — NDOT: ${cams.length} of ${feats.length}`);
  return cams;
}

export const fetchNebraskaCameras = cachedSource('nebraska', loadNebraskaCameras);
