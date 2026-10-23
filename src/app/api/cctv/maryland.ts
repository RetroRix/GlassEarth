import type { CctvCamera } from './types';
import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — Maryland CCTV Cameras (MDOT CHART / chart.maryland.gov)
 * Source: https://chartexp1.sha.maryland.gov/CHARTExportClientService/getCameraMapDataJSON.do
 * ~550 statewide traffic cameras — NO API KEY NEEDED.
 *
 * The JSON the CHART live-camera page itself loads. Every record carries its
 * position, the streaming host (`cctvIp`) and the id the HLS playlist is keyed
 * by; the playlist address itself is never published, which is what
 * `streamUrl` rebuilds — the CHART video page builds the same
 * `https://{cctvIp}/rtplive/{id}/playlist.m3u8` for its player. The page's
 * poster thumbnails are pushed over a SignalR hub and have no stable URL, so
 * these come up as video tiles with no snapshot behind them.
 *
 * Half the records put a bare asset number in `name` (`710002`) and the real
 * place in `description`, so the description is the label and the name is
 * only the fallback.
 *
 * `opStatus` is a momentary health reading (OK / COMM_MARGINAL /
 * COMM_FAILURE), not a publication flag — a COMM_FAILURE camera's playlist
 * can still answer — so it does not drop a camera; only structural problems
 * (no id, no streaming host, unusable or out-of-state coordinates) do.
 */

const FEED = 'https://chartexp1.sha.maryland.gov/CHARTExportClientService/getCameraMapDataJSON.do';

/** Maryland bounding box — drops any stray/placeholder coordinates. */
const MD_BOUNDS = { minLat: 37.9, maxLat: 39.7, minLng: -79.5, maxLng: -75.0 };

/** One record from getCameraMapDataJSON.do — only the fields we consume. */
export interface ChartCameraRecord {
  id?: string | null;
  description?: string | null;
  name?: string | null;
  lat?: number | null;
  lon?: number | null;
  cctvIp?: string | null;
  publicVideoURL?: string | null;
  cameraCategories?: string[] | null;
}

/** The HLS playlist for a camera. Exported for tests. */
export function streamUrl(cctvIp: string, id: string): string {
  return `https://${cctvIp}/rtplive/${id}/playlist.m3u8`;
}

/** Map one CHART record to a camera, or null if unusable. Exported for tests. */
export function mapRecord(rec: ChartCameraRecord): CctvCamera | null {
  if (!rec) return null;

  const id = rec.id?.trim();
  if (!id) return null;

  /* The playlist is keyed by the streaming host, so a record without one
     names a camera we cannot play. The host is interpolated into a URL, so
     it has to be a bare hostname. */
  const host = rec.cctvIp?.trim();
  if (!host || !/^[a-z0-9.-]+$/i.test(host)) return null;

  const lat = rec.lat;
  const lng = rec.lon;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < MD_BOUNDS.minLat || lat > MD_BOUNDS.maxLat) return null;
  if (lng < MD_BOUNDS.minLng || lng > MD_BOUNDS.maxLng) return null;

  const name = rec.description?.trim() || rec.name?.trim();

  return {
    id: `mdot-${id}`,
    lat,
    lng,
    name: name || `MDOT CHART Camera ${id}`,
    city: rec.cameraCategories?.[0]?.trim() || 'Maryland',
    country: 'US',
    stream_url: streamUrl(host, id),
    stream_type: 'hls',
    ...(rec.publicVideoURL ? { external_url: rec.publicVideoURL } : {}),
    source: 'MDOT CHART',
  };
}

async function loadMarylandCameras(): Promise<CctvCamera[]> {
  const res = await stealthFetch(FEED, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`MDOT CHART HTTP ${res.status}`);

  const json = await res.json();
  const rows = json?.data;
  if (!Array.isArray(rows)) throw new Error('MDOT CHART returned no camera data');

  const cams: CctvCamera[] = [];
  const seen = new Set<string>();
  for (const rec of rows) {
    const cam = mapRecord(rec);
    if (!cam || seen.has(cam.id)) continue;
    seen.add(cam.id);
    cams.push(cam);
  }

  console.log(`[OSIRIS] Maryland cameras — MDOT CHART: ${cams.length}`);
  return cams;
}

export const fetchMarylandCameras = cachedSource('maryland', loadMarylandCameras);
