import type { CctvCamera } from './types';
import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — Iowa CCTV Cameras (Iowa DOT / 511ia.org)
 * Source: https://511ia.org/api/graphql — the same CARS 511 platform (and the
 * same MapFeatures query) as Indiana's 511in.org — NO API KEY NEEDED.
 * ~778 statewide cameras, of which ~773 carry a usable image.
 *
 * Unlike Indiana, Iowa publishes no HLS. Every view the API returns is a
 * direct JPEG snapshot on `atmsqf.iowadot.gov` (the DOT's ATMS image server),
 * refreshing in place — `VIDEO`-category cameras and `IMAGE`-category ones
 * alike, and asking for more views (limit: 5) still returns exactly one. So
 * these cameras are snapshot tiles, honestly labelled: no stream URL is
 * rebuilt or guessed at.
 *
 * About a fifth of the URLs arrive with a `?1792770360000`-style query. That
 * is the API's own cache-buster — the current epoch-millisecond floored to
 * the minute, regenerated on every response — not part of the address; the
 * same URL serves with or without it. It is kept verbatim anyway, as served.
 *
 * Down cameras mirror Indiana exactly: a null `url`, or the platform's
 * closed-camera icon in place of a feed. Requiring an absolute .jpg/.jpeg
 * URL drops both.
 */

const GRAPHQL = 'https://511ia.org/api/graphql';

/** Iowa bounding box — drops any stray/placeholder coordinates. */
const IA_BOUNDS = { minLat: 40.4, maxLat: 43.5, minLng: -96.6, maxLng: -91.0 };

/**
 * A view's `url` lives on CameraView, not on the interface `views` returns, so
 * it has to come through an inline fragment — same as 511in.org.
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

export interface IowaFeature {
  title?: string | null;
  uri?: string | null;
  features?: Array<{ geometry?: { coordinates?: [number, number] } | null }> | null;
  __typename?: string | null;
  active?: boolean | null;
  views?: Array<{ url?: string | null; category?: string | null }> | null;
}

/** A usable view is an absolute JPEG snapshot address; icons/nulls are not. */
const SNAPSHOT = /^https?:\/\/.+\.jpe?g(\?.*)?$/i;

/** Map one map feature to a camera, or null if unusable. Exported for tests. */
export function mapFeature(f: IowaFeature): CctvCamera | null {
  if (f?.__typename !== 'Camera' || f.active === false) return null;

  /* Cameras that are down come back with a null url or an icon, not a feed. */
  const url = f.views?.[0]?.url || '';
  if (!SNAPSHOT.test(url)) return null;

  const coords = f.features?.[0]?.geometry?.coordinates;
  if (!coords) return null;
  const [lng, lat] = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < IA_BOUNDS.minLat || lat > IA_BOUNDS.maxLat) return null;
  if (lng < IA_BOUNDS.minLng || lng > IA_BOUNDS.maxLng) return null;

  const id = f.uri?.match(/camera\/(\d+)/)?.[1];
  if (!id) return null;

  return {
    id: `iadot-${id}`,
    lat,
    lng,
    /* Iowa titles are already map-ready (`I-35: DM - I-35/80 @ MM 136.2
       (E 14th)`) — no internal asset number to strip, unlike Indiana's. */
    name: (f.title || '').replace(/\s+/g, ' ').trim() || `Iowa DOT Camera ${id}`,
    city: 'Iowa',
    country: 'US',
    feed_url: url,
    external_url: `https://511ia.org/@${lat},${lng},14?show=${encodeURIComponent(f.uri || '')}`,
    source: 'Iowa DOT',
  };
}

async function loadIowaCameras(): Promise<CctvCamera[]> {
  const res = await stealthFetch(GRAPHQL, {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Referer: 'https://511ia.org/' },
    body: JSON.stringify({
      query: QUERY,
      /* One query for the whole state. `zoom` is what decides clustering, so it
         has to be high enough that the server returns cameras and not clusters. */
      variables: {
        input: {
          north: IA_BOUNDS.maxLat,
          south: IA_BOUNDS.minLat,
          east: IA_BOUNDS.maxLng,
          west: IA_BOUNDS.minLng,
          zoom: 16,
          layerSlugs: ['normalCameras'],
          nonClusterableUris: null,
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`511ia HTTP ${res.status}`);

  const json = await res.json();
  const feats = json?.data?.mapFeaturesQuery?.mapFeatures;
  if (!Array.isArray(feats)) throw new Error('511ia returned no mapFeatures');

  const cams: CctvCamera[] = [];
  const seen = new Set<string>();
  for (const f of feats) {
    const cam = mapFeature(f);
    if (!cam || seen.has(cam.id)) continue;
    seen.add(cam.id);
    cams.push(cam);
  }
  if (cams.length === 0) throw new Error('511ia returned no usable cameras');

  console.log(`[OSIRIS] Iowa cameras — Iowa DOT: ${cams.length}`);
  return cams;
}

export const fetchIowaCameras = cachedSource('iowa', loadIowaCameras);
