import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';
import type { CctvCamera } from './types';

/**
 * OSIRIS — West Virginia CCTV Cameras (WVDOH / wv511.org)
 * Source: https://wv511.org/wsvc/gmap.asmx/buildCamerasJSONKeyedSerialized
 * ~130 cameras statewide — NO API KEY NEEDED.
 *
 * wv511.org is a classic ASP.NET WebForms site (its /List/GetData/Cameras
 * is just the site's own 404 page — WV is not on the IBI stack). The map is
 * an iframe (webmapi.aspx) whose data comes from a web service on the same
 * host, and this operation returns the whole camera index as a JSON array:
 * route, a label buried in an HTML `description`, and the position as
 * string coordinates. (Its non-"Serialized" twin operation emits the same
 * rows with the descriptions' quotes unescaped — not parseable JSON.)
 *
 * The index alone cannot be drawn, though. The snapshot address inside each
 * record is the site's `cam_unavailable.jpg` placeholder for every camera —
 * these are streaming-only. The one view is a player page,
 * /flowplayeri.aspx?CAMID=<md5>, which is served with
 * `X-Frame-Options: SAMEORIGIN`, so it cannot be embedded either. What the
 * player page does is load an HLS playlist from a per-camera streaming
 * edge (`vtcN.roadsummary.com/rtplive/<md5>/playlist.m3u8`), and the edges
 * are sticky: asking the wrong host for a camera answers 204 with an empty
 * body. So the loader reads each camera's own player page once and takes
 * the playlist it names. That is ~130 small page fetches at a concurrency
 * of ten — a cold load takes a minute or two, which the source cache and
 * the route's background fill absorb; refreshes serve stale meanwhile.
 *
 * Two real Jefferson County cameras (CAM099, CAM105) publish longitudes a
 * few hundredths of a degree east of the -77.8 bounds line and are dropped
 * by it, with everything else in the state inside.
 */

const INDEX_URL = 'https://wv511.org/wsvc/gmap.asmx/buildCamerasJSONKeyedSerialized';
const PLAYER_BASE = 'https://wv511.org/flowplayeri.aspx';

/** West Virginia bounding box — drops any stray/placeholder coordinates. */
const WV_BOUNDS = { minLat: 37.2, maxLat: 40.6, minLng: -82.7, maxLng: -77.8 };

/** Player pages resolved in parallel while a cold load fills the cache. */
const CONCURRENCY = 10;

/** One row from buildCamerasJSONKeyedSerialized — only the fields we consume. */
export interface WvCameraRecord {
  origin?: string | null;
  md5?: string | null;
  title?: string | null;
  description?: string | null;
  start_lat?: string | null;
  start_lng?: string | null;
  icon?: string | null;
}

/**
 * The display label is the text of the description's first div —
 * `[BER]I-81 @ 0.5` — where the bracketed prefix is a county code, not part
 * of the place name. Stripped here; the route (`title`) is the fallback.
 */
export function cameraName(rec: WvCameraRecord): string | null {
  const label = rec.description?.match(/camDescription">([^<]+)</)?.[1]
    ?.replace(/^\[[A-Z]{2,4}\]\s*/, '')
    .trim();
  if (label) return label;
  const route = rec.title?.trim();
  return route || null;
}

/** The playlist a camera's player page loads, or null if it names none. Exported for tests. */
export function streamUrlFromPlayerPage(html: string, md5: string): string | null {
  const m = html.match(new RegExp(`https://[a-z0-9-]+\\.roadsummary\\.com/rtplive/${md5}/playlist\\.m3u8`, 'i'));
  return m ? m[0] : null;
}

/** Map one index row plus its resolved stream to a camera, or null if unusable. Exported for tests. */
export function mapRecord(rec: WvCameraRecord, streamUrl?: string | null): CctvCamera | null {
  const md5 = rec?.md5?.trim();
  if (!md5 || !streamUrl) return null;

  const lat = parseFloat(rec.start_lat ?? '');
  const lng = parseFloat(rec.start_lng ?? '');
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < WV_BOUNDS.minLat || lat > WV_BOUNDS.maxLat) return null;
  if (lng < WV_BOUNDS.minLng || lng > WV_BOUNDS.maxLng) return null;

  return {
    id: `wvdoh-${md5}`,
    lat,
    lng,
    name: cameraName(rec) || `WVDOH Camera ${md5}`,
    city: 'West Virginia',
    country: 'US',
    stream_url: streamUrl,
    stream_type: 'hls',
    external_url: `${PLAYER_BASE}?CAMID=${md5}`,
    source: 'WVDOH',
  };
}

/** Ask one camera's player page which streaming edge serves it. */
async function resolveStreamUrl(md5: string): Promise<string | null> {
  const res = await stealthFetch(`${PLAYER_BASE}?CAMID=${encodeURIComponent(md5)}`, {
    signal: AbortSignal.timeout(15000),
    headers: { Accept: 'text/html' },
  });
  if (!res.ok) return null;
  return streamUrlFromPlayerPage(await res.text(), md5);
}

async function loadWestVirginiaCameras(): Promise<CctvCamera[]> {
  const res = await stealthFetch(INDEX_URL, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`WV511 HTTP ${res.status}`);

  const json = await res.json();
  const rows: WvCameraRecord[] = Array.isArray(json) ? json : [];
  if (!rows.length) throw new Error('WV511 returned no camera index');

  // Bounds and identity first, so player pages are only fetched for rows
  // that could actually be drawn.
  const candidates = rows.filter(rec => mapRecord(rec, 'pending') !== null);

  const cams: CctvCamera[] = [];
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    const resolved = await Promise.allSettled(batch.map(rec => resolveStreamUrl(rec.md5!.trim())));
    resolved.forEach((r, j) => {
      const cam = r.status === 'fulfilled' ? mapRecord(batch[j], r.value) : null;
      if (cam) cams.push(cam);
    });
  }

  // A load that resolved nothing is an upstream failure, not a smaller state.
  if (!cams.length) throw new Error('WV511: no camera streams resolved');

  console.log(`[OSIRIS] West Virginia cameras — WVDOH: ${cams.length} of ${rows.length}`);
  return cams;
}

export const fetchWestVirginiaCameras = cachedSource('westvirginia', loadWestVirginiaCameras);
