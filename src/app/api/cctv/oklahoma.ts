import type { CctvCamera } from './types';
import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — Oklahoma CCTV Cameras (ODOT / oktraffic.org)
 * Source: https://oktraffic.org/api/MapCameras — the LoopBack API behind
 * ODOT's Drive Oklahoma map (built with the University of Oklahoma's Center
 * for Intelligent Transportation Systems) — NO API KEY NEEDED.
 * ~467 public cameras, all live HLS — concentrated in the Oklahoma City and
 * Tulsa metros, with Lawton and the ports of entry beyond them.
 *
 * The site's own public query is what this mirrors: its camera service asks
 * CameraPoles for mapCameras `where: { status: { neq: 'Out Of Service' },
 * type: 'Web', blockAtis: { neq: '1' } }`, with each camera's hasOne
 * `streamDictionary` included. Asked of MapCameras directly, the same filter
 * returns every public camera in one response, each carrying the Wowza
 * playlist the site plays:
 * `https://stream.oktraffic.org/delay-stream/{hash}.stream/playlist.m3u8`.
 *
 * The unfiltered model holds 899 rows — CCTV and Security types, blocked and
 * out-of-service units among them — which are operations cameras, not public
 * ones. The mapper re-applies the public filter row by row, so nothing the
 * site itself withholds can leak in if the query is ever loosened.
 */

const API = 'https://oktraffic.org/api/MapCameras';

/** Oklahoma bounding box — drops any stray/placeholder coordinates. */
const OK_BOUNDS = { minLat: 33.6, maxLat: 37.0, minLng: -103.0, maxLng: -94.4 };

/** One row from /api/MapCameras — only the fields we consume. */
export interface OklahomaCameraRecord {
  id: number;
  latitude?: string | null;
  longitude?: string | null;
  location?: string | null;
  city?: string | null;
  status?: string | null;
  type?: string | null;
  blockAtis?: string | null;
  streamDictionary?: { streamSrc?: string | null } | null;
}

/** Map a raw record to a camera, or null if it should be skipped. */
export function mapRecord(rec: OklahomaCameraRecord): CctvCamera | null {
  if (!rec || typeof rec.id !== 'number') return null;

  /* ODOT's own public filter, re-applied: no out-of-service units, no
     operations-only CCTV/Security types, nothing ATIS-blocked. */
  if (rec.status === 'Out Of Service') return null;
  if (rec.type !== 'Web') return null;
  if (rec.blockAtis === '1') return null;

  const stream = rec.streamDictionary?.streamSrc?.trim();
  if (!stream || !/\.m3u8(\?|$)/i.test(stream)) return null;

  const lat = parseFloat(rec.latitude ?? '');
  const lng = parseFloat(rec.longitude ?? '');
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < OK_BOUNDS.minLat || lat > OK_BOUNDS.maxLat) return null;
  if (lng < OK_BOUNDS.minLng || lng > OK_BOUNDS.maxLng) return null;

  return {
    id: `odot-${rec.id}`,
    lat,
    lng,
    name: rec.location?.trim() || `ODOT Camera ${rec.id}`,
    city: rec.city?.trim() || 'Oklahoma',
    country: 'US',
    stream_url: stream,
    stream_type: 'hls',
    source: 'ODOT',
  };
}

async function loadOklahomaCameras(): Promise<CctvCamera[]> {
  /* The site's public filter, verbatim, with the stream relation included. */
  const filter = {
    where: { status: { neq: 'Out Of Service' }, type: 'Web', blockAtis: { neq: '1' } },
    include: 'streamDictionary',
  };
  const url = `${API}?filter=${encodeURIComponent(JSON.stringify(filter))}`;
  const res = await stealthFetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json', Referer: 'https://oktraffic.org/' },
  });
  if (!res.ok) throw new Error(`ODOT HTTP ${res.status}`);

  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('ODOT returned no camera array');

  const cams: CctvCamera[] = [];
  const seen = new Set<string>();
  for (const rec of rows) {
    const cam = mapRecord(rec);
    if (!cam || seen.has(cam.id)) continue;
    seen.add(cam.id);
    cams.push(cam);
  }
  if (cams.length === 0) throw new Error('ODOT returned no usable cameras');

  console.log(`[OSIRIS] Oklahoma cameras — ODOT: ${cams.length}`);
  return cams;
}

export const fetchOklahomaCameras = cachedSource('oklahoma', loadOklahomaCameras);
