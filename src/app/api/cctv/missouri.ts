import type { CctvCamera } from './types';
import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';

/**
 * OSIRIS — Missouri CCTV Cameras (MoDOT Traveler Information Map)
 * Sources: the two JSON feeds the map at traveler.modot.org/map reads —
 *   Streaming: /timconfig/feed/desktop/StreamingCams2.json (880 HLS cameras)
 *   Snapshot:  /map/js/snapshot.json (12 rural snapshot cameras)
 * ~892 cameras statewide — NO API KEY NEEDED.
 *
 * The task brief expected an ArcGIS FeatureServer behind the map; the
 * current map is an ArcGIS JS app, but its camera layers are GraphicsLayers
 * fed by these two plain JSON files, not a queryable service — no camera
 * FeatureServer for MoDOT exists on ArcGIS Online either. The streaming
 * file's rows are `{location, x, y, html}` and the map hands every `html`
 * address to its video.js player as `application/x-mpegURL`. Three shapes
 * occur: MoDOT's own Wowza edges (`sfs0*-traveler.modot.mo.gov/rtplive/
 * MODOT_CAM_*`, 390), the Kansas City Scout stream proxy on the same host
 * (`/tisvc/api/Tms/CameraStream/M…-LQ`, 322), and Springfield's Ozarks
 * Traffic Wowza (`s2.ozarkstrafficoneview.com/rtplive/CAM*`, 168) — the
 * first and third were verified as live master playlists. The records
 * carry no id, so the camera token is pulled out of the stream address,
 * which is also the de-duplication key — four rows repeat an address
 * under a second location string.
 *
 * One operational note: traveler.modot.org sits behind Incapsula and
 * intermittently answers this network with a 503 bot wall for minutes at
 * a time before serving normally again. A walled refresh throws, and the
 * source cache keeps serving the last good index — the right trade, since
 * the wall always lifted in testing.
 */

const STREAMING_URL = 'https://traveler.modot.org/timconfig/feed/desktop/StreamingCams2.json';
const SNAPSHOT_URL = 'https://traveler.modot.org/map/js/snapshot.json';
const SNAPSHOT_BASE = 'https://traveler.modot.org';

/** Missouri bounding box — drops any stray/placeholder coordinates. */
const MO_BOUNDS = { minLat: 36.0, maxLat: 40.6, minLng: -95.8, maxLng: -89.1 };

function inBounds(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= MO_BOUNDS.minLat && lat <= MO_BOUNDS.maxLat &&
    lng >= MO_BOUNDS.minLng && lng <= MO_BOUNDS.maxLng
  );
}

/** One row from StreamingCams2.json (only the fields we consume). */
export interface ModotStreamRecord {
  location?: string | null;
  x?: number | null;
  y?: number | null;
  html?: string | null;
}

/**
 * The camera token inside a stream address: the segment before
 * `playlist.m3u8` on a Wowza edge (`MODOT_CAM_209`, `CAM1045`), or the
 * camera code at the end of a KC Scout proxy address (`M029NBC-07-LQ`).
 */
const STREAM_TOKEN = /\/rtplive\/([A-Za-z0-9_-]+)\/playlist\.m3u8$|\/tisvc\/api\/Tms\/CameraStream\/([A-Za-z0-9-]+)$/i;

/** Map one streaming record to a camera, or null. Exported for tests. */
export function mapStreamRecord(rec: ModotStreamRecord): CctvCamera | null {
  const url = rec?.html?.trim();
  const m = url?.match(STREAM_TOKEN);
  const token = m?.[1] ?? m?.[2];
  if (!url || !token) return null;

  const lat = rec.y;
  const lng = rec.x;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !inBounds(lat, lng)) return null;

  return {
    id: `modot-${token.toLowerCase().replace(/_/g, '-')}`,
    lat,
    lng,
    name: rec.location?.trim() || `MoDOT Camera ${token}`,
    city: 'Missouri',
    country: 'US',
    stream_url: url,
    stream_type: 'hls',
    source: 'MoDOT',
  };
}

/** One camera from snapshot.json (only the fields we consume). */
export interface ModotSnapshotRecord {
  id?: number | null;
  caption?: string | null;
  url?: string | null;
  location?: { x?: number | null; y?: number | null } | null;
}

/** Map one snapshot record to a camera, or null. Exported for tests. */
export function mapSnapshotRecord(rec: ModotSnapshotRecord): CctvCamera | null {
  if (!rec || typeof rec.id !== 'number') return null;

  const lat = rec.location?.y;
  const lng = rec.location?.x;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !inBounds(lat, lng)) return null;

  const path = rec.url?.trim();
  if (!path) return null;

  return {
    id: `modot-snap-${rec.id}`,
    lat,
    lng,
    name: rec.caption?.trim() || `MoDOT Camera ${rec.id}`,
    city: 'Missouri',
    country: 'US',
    feed_url: `${SNAPSHOT_BASE}${path}`,
    source: 'MoDOT',
  };
}

async function loadMissouriCameras(): Promise<CctvCamera[]> {
  /* Sequential, not parallel: Incapsula answers a two-request burst from
     this network with connection resets noticeably more often than it
     answers single requests. */
  const streamRes = await stealthFetch(STREAMING_URL, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json' },
  });
  const snapRes = await stealthFetch(SNAPSHOT_URL, {
    signal: AbortSignal.timeout(15000),
    headers: { Accept: 'application/json' },
  });
  if (!streamRes.ok) throw new Error(`MoDOT streaming HTTP ${streamRes.status}`);
  if (!snapRes.ok) throw new Error(`MoDOT snapshot HTTP ${snapRes.status}`);

  const streamData = await streamRes.json();
  if (!Array.isArray(streamData)) throw new Error('MoDOT streaming returned a non-array payload');
  const snapData = await snapRes.json();
  if (!Array.isArray(snapData?.cameras)) throw new Error('MoDOT snapshot returned no cameras');

  const cams: CctvCamera[] = [];
  const seen = new Set<string>();
  for (const rec of streamData) {
    const cam = mapStreamRecord(rec);
    if (cam && !seen.has(cam.id)) { seen.add(cam.id); cams.push(cam); }
  }
  for (const rec of snapData.cameras) {
    const cam = mapSnapshotRecord(rec);
    if (cam && !seen.has(cam.id)) { seen.add(cam.id); cams.push(cam); }
  }

  console.log(`[OSIRIS] Missouri cameras — MoDOT: ${cams.length} of ${streamData.length + snapData.cameras.length}`);
  return cams;
}

export const fetchMissouriCameras = cachedSource('missouri', loadMissouriCameras);
