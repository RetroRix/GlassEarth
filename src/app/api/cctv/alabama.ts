import type { CctvCamera } from './types';
import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — Alabama CCTV Cameras (ALDOT / algotraffic.com)
 * Source: https://api.algotraffic.com/v4.0/Cameras — the JSON the ALGO
 * Traffic map itself calls
 * 638 public cameras statewide — NO API KEY NEEDED.
 *
 * The v3.0 API the site used to call now 404s, and the snapshot URLs it
 * published with it 404 too. v4.0 is the live one: it answers anonymously
 * (the OIDC login on the site is only for privileged feeds), carries its
 * own `snapshotImageUrl` on the v4 path, and nests the HLS playlist under
 * `playbackUrls`. The same response also lists a handful of ALDOT-only,
 * FirstResponder and Hidden cameras — those are not the public's to draw,
 * so only `accessLevel: "Public"` rows are mapped.
 *
 * Every public row has both a JPEG snapshot and a Wowza HLS playlist, and
 * both were verified live: the snapshot serves a 1920×1080 JPEG and the
 * playlist is a real master playlist.
 */

const CAMERAS_URL = 'https://api.algotraffic.com/v4.0/Cameras';

/** Alabama bounding box — drops any stray/placeholder coordinates. */
const AL_BOUNDS = { minLat: 30.1, maxLat: 35.1, minLng: -88.5, maxLng: -84.9 };

/** One row from /v4.0/Cameras (only the fields we consume). */
export interface AlgoCameraRecord {
  id: number;
  location?: {
    latitude?: number | null;
    longitude?: number | null;
    city?: string | null;
    county?: string | null;
    displayRouteDesignator?: string | null;
    displayCrossStreet?: string | null;
    direction?: string | null;
  } | null;
  playbackUrls?: { hls?: string | null } | null;
  accessLevel?: string | null;
  snapshotImageUrl?: string | null;
  permLink?: string | null;
}

/** Map one ALGO record to a camera, or null if unusable. Exported for tests. */
export function mapRecord(rec: AlgoCameraRecord): CctvCamera | null {
  if (!rec || typeof rec.id !== 'number') return null;
  /* The feed mixes public cameras with ALDOT-only, FirstResponder and
     Hidden ones. Only the public set is published for the map. */
  if (rec.accessLevel !== 'Public') return null;

  const loc = rec.location;
  const lat = loc?.latitude;
  const lng = loc?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < AL_BOUNDS.minLat || lat > AL_BOUNDS.maxLat) return null;
  if (lng < AL_BOUNDS.minLng || lng > AL_BOUNDS.maxLng) return null;

  const snapshot = rec.snapshotImageUrl?.trim() || undefined;
  const hls = rec.playbackUrls?.hls?.trim();
  const video = hls && /\.m3u8(\?|$)/i.test(hls) ? hls : undefined;
  if (!snapshot && !video) return null;

  /* `displayCrossStreet` is the readable cross-street even when the raw
     `crossStreet` field says "Unknown" (I-10 in Mobile: display McDonald Rd,
     raw Unknown) — so the display pair is what the name is built from. One
     public camera has no cross-street at all and falls back to the road and
     the direction it faces. */
  const route = loc?.displayRouteDesignator?.trim();
  const cross = loc?.displayCrossStreet?.trim();
  const name = route && cross && cross !== 'Unknown'
    ? `${route} @ ${cross}`
    : route && loc?.direction?.trim()
      ? `${route} ${loc.direction.trim()}`
      : route || undefined;

  const city = loc?.city?.trim() || (loc?.county?.trim() ? `${loc.county.trim()} County` : 'Alabama');

  return {
    id: `aldot-${rec.id}`,
    lat,
    lng,
    name: name || `ALDOT Camera ${rec.id}`,
    city,
    country: 'US',
    ...(snapshot ? { feed_url: snapshot } : {}),
    ...(video ? { stream_url: video, stream_type: 'hls' as const } : {}),
    ...(rec.permLink ? { external_url: rec.permLink } : {}),
    source: 'ALDOT',
  };
}

async function loadAlabamaCameras(): Promise<CctvCamera[]> {
  const res = await stealthFetch(CAMERAS_URL, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`ALDOT HTTP ${res.status}`);

  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('ALDOT returned a non-array payload');

  const cams: CctvCamera[] = [];
  const seen = new Set<string>();
  for (const rec of data) {
    const cam = mapRecord(rec);
    if (!cam || seen.has(cam.id)) continue;
    seen.add(cam.id);
    cams.push(cam);
  }

  console.log(`[OSIRIS] Alabama cameras — ALDOT: ${cams.length} of ${data.length}`);
  return cams;
}

export const fetchAlabamaCameras = cachedSource('alabama', loadAlabamaCameras);
