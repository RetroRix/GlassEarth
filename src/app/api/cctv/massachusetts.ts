import type { CctvCamera } from './types';
import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — Massachusetts CCTV Cameras (MassDOT / mass511.com)
 * Source: https://mass511.com/api/graphql — the CARS 511 platform's map query
 * ~310 statewide traffic cameras — NO API KEY NEEDED.
 *
 * The same GraphQL map query Indiana's 511in.org answers, on the same
 * platform. Where Indiana's views rebuild into HLS playlists, every
 * Massachusetts view is a public JPEG on the CARS program host
 * (`public.carsprogram.org/cameras/MA/{asset}-fullJpeg.jpg`) — even the ones
 * categorised VIDEO — so these come up as snapshot cameras.
 *
 * A quarter of the view URLs arrive with a millisecond timestamp query
 * (`…-fullJpeg.jpg?1792770780000`) — the map's cache-buster, not part of the
 * address; the bare JPEG serves fine, so the query comes off. Cameras that
 * are down point their view at a shared `ma-unavailable.png` placeholder
 * instead, and the JPEG check drops those.
 *
 * MassDOT's own developer page routes third-party camera access through
 * TrafficLand by email; this is not that API — it is the unauthenticated
 * query the public Mass511 map itself makes.
 */

const GRAPHQL = 'https://mass511.com/api/graphql';

/** Massachusetts bounding box — drops any stray/placeholder coordinates. */
const MA_BOUNDS = { minLat: 41.2, maxLat: 42.9, minLng: -73.5, maxLng: -69.9 };

/**
 * A view's `url` lives on CameraView, not on the interface `views` returns, so
 * it has to come through an inline fragment. Selecting it bare validates as an
 * error and the server answers those with a 400, not a message.
 */
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

export interface MassCameraFeature {
  title?: string | null;
  uri?: string | null;
  features?: Array<{ geometry?: { coordinates?: [number, number] } | null }> | null;
  __typename?: string | null;
  active?: boolean | null;
  views?: Array<{ url?: string | null; category?: string | null }> | null;
}

/** Map one map feature to a camera, or null if unusable. Exported for tests. */
export function mapFeature(f: MassCameraFeature): CctvCamera | null {
  if (f?.__typename !== 'Camera' || f.active === false) return null;

  const url = f.views?.[0]?.url?.trim();
  if (!url) return null;
  /* Strip the timestamp cache-buster some views carry; what is left has to
     be the JPEG itself, not a playlist or a player page. */
  const feed = url.split('?')[0];
  if (!/\.jpe?g$/i.test(feed)) return null;

  const coords = f.features?.[0]?.geometry?.coordinates;
  if (!coords) return null;
  const [lng, lat] = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < MA_BOUNDS.minLat || lat > MA_BOUNDS.maxLat) return null;
  if (lng < MA_BOUNDS.minLng || lng > MA_BOUNDS.maxLng) return null;

  const id = f.uri?.match(/camera\/(\d+)/)?.[1];
  if (!id) return null;

  return {
    id: `massdot-${id}`,
    lat,
    lng,
    name: f.title?.trim() || `MassDOT Camera ${id}`,
    city: 'Massachusetts',
    country: 'US',
    feed_url: feed,
    source: 'MassDOT',
  };
}

async function loadMassachusettsCameras(): Promise<CctvCamera[]> {
  const res = await stealthFetch(GRAPHQL, {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Referer: 'https://mass511.com/' },
    body: JSON.stringify({
      query: QUERY,
      /* One query for the whole state. `zoom` is what decides clustering, so it
         has to be high enough that the server returns cameras and not clusters. */
      variables: {
        input: {
          north: MA_BOUNDS.maxLat,
          south: MA_BOUNDS.minLat,
          east: MA_BOUNDS.maxLng,
          west: MA_BOUNDS.minLng,
          zoom: 16,
          layerSlugs: ['normalCameras'],
          nonClusterableUris: null,
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`Mass511 HTTP ${res.status}`);

  const json = await res.json();
  const feats = json?.data?.mapFeaturesQuery?.mapFeatures;
  if (!Array.isArray(feats)) throw new Error('Mass511 returned no mapFeatures');

  const cams: CctvCamera[] = [];
  const seen = new Set<string>();
  for (const f of feats) {
    const cam = mapFeature(f);
    if (!cam || seen.has(cam.id)) continue;
    seen.add(cam.id);
    cams.push(cam);
  }

  console.log(`[OSIRIS] Massachusetts cameras — MassDOT: ${cams.length}`);
  return cams;
}

export const fetchMassachusettsCameras = cachedSource('massachusetts', loadMassachusettsCameras);
