import type { CctvCamera } from './types';
import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — Kansas CCTV Cameras (KDOT / kandrive.gov)
 * Source: https://www.kandrive.gov/api/graphql — the CARS 511 platform's map query
 * ~455 statewide cameras, 414 of them publishing an image — NO API KEY NEEDED.
 *
 * KanDrive moved from kandrive.org to kandrive.gov, and the new site is the
 * same CARS platform Indiana runs (see ./indiana): one GraphQL MapFeatures
 * query for the whole state. What differs is the views. Indiana's are video
 * posters; Kansas's are stills on every row — the 202 views labelled `VIDEO`
 * point at `.jpeg` snapshots on kscam.carsprogram.org, not playlists, and the
 * Kansas City metro rows are KC Scout snapshots on www.kcscout.net.
 *
 * Two quirks shape the mapper. Forty-one cameras publish a view whose `url`
 * is null — the API offers no image address for them at all, so they drop.
 * And the still URLs carry a per-request `?1792771320000` cache-buster; the
 * images serve fine without it (verified on all three hosts), so it is
 * stripped to keep feed_url stable across refreshes.
 */

const GRAPHQL = 'https://www.kandrive.gov/api/graphql';

/** Kansas bounding box — drops any stray/placeholder coordinates. */
const KS_BOUNDS = { minLat: 36.9, maxLat: 40.1, minLng: -102.1, maxLng: -94.6 };

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

export interface KdotFeature {
  title?: string | null;
  uri?: string | null;
  features?: Array<{ geometry?: { type?: string | null; coordinates?: [number, number] } | null }> | null;
  __typename?: string | null;
  active?: boolean | null;
  views?: Array<{ url?: string | null; category?: string | null }> | null;
}

/** Map one map feature to a camera, or null if unusable. Exported for tests. */
export function mapFeature(f: KdotFeature): CctvCamera | null {
  if (f?.__typename !== 'Camera' || f.active === false) return null;

  /* A view with no URL is a camera the API lists but cannot show — 41 of the
     455 rows are exactly that, at any views limit. */
  const rawUrl = f.views?.[0]?.url?.trim();
  if (!rawUrl) return null;
  const url = rawUrl.split('?')[0];
  /* The Wichita cameras intermittently come back with only the cache-buster
     (`?1792771620000`) where the address should be — the API staples the
     stamp onto a base URL it sometimes fails to fill in. There is no honest
     way to reconstruct the missing half, so those rows drop for that
     refresh rather than publish a feed_url of nothing. */
  if (!/^https?:\/\//i.test(url)) return null;

  const coords = f.features?.[0]?.geometry?.coordinates;
  if (!coords) return null;
  const [lng, lat] = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < KS_BOUNDS.minLat || lat > KS_BOUNDS.maxLat) return null;
  if (lng < KS_BOUNDS.minLng || lng > KS_BOUNDS.maxLng) return null;

  const id = f.uri?.match(/camera\/(\d+)/)?.[1];
  if (!id) return null;

  /* Every view Kansas publishes today is a still, whatever its category
     says. A playlist URL, if one ever appears, is the only thing that
     should reach the HLS player. */
  const isStream = /\.m3u8(\?|$)/i.test(url);

  return {
    id: `kdot-${id}`,
    lat,
    lng,
    name: f.title?.trim() || `KDOT Camera ${id}`,
    city: 'Kansas',
    country: 'US',
    ...(isStream
      ? { stream_url: url, stream_type: 'hls' as const }
      : { feed_url: url }),
    external_url: `https://www.kandrive.gov/@${lat},${lng},14?show=${encodeURIComponent(f.uri || '')}`,
    source: 'KDOT',
  };
}

async function loadKansasCameras(): Promise<CctvCamera[]> {
  const res = await stealthFetch(GRAPHQL, {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Referer: 'https://www.kandrive.gov/' },
    body: JSON.stringify({
      query: QUERY,
      variables: {
        input: {
          north: KS_BOUNDS.maxLat,
          south: KS_BOUNDS.minLat,
          east: KS_BOUNDS.maxLng,
          west: KS_BOUNDS.minLng,
          zoom: 16,
          layerSlugs: ['normalCameras'],
          nonClusterableUris: null,
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`KanDrive HTTP ${res.status}`);

  const json = await res.json();
  const feats = json?.data?.mapFeaturesQuery?.mapFeatures;
  if (!Array.isArray(feats)) throw new Error('KanDrive returned no mapFeatures');

  const cams: CctvCamera[] = [];
  const seen = new Set<string>();
  for (const f of feats) {
    const cam = mapFeature(f);
    if (!cam || seen.has(cam.id)) continue;
    seen.add(cam.id);
    cams.push(cam);
  }

  console.log(`[OSIRIS] Kansas cameras — KDOT: ${cams.length} of ${feats.length}`);
  return cams;
}

export const fetchKansasCameras = cachedSource('kansas', loadKansasCameras);
