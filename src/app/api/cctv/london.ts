import type { CctvCamera } from './types';
import { stealthFetch } from '@/lib/stealthFetch';

/**
 * OSIRIS — London traffic cameras (Transport for London JamCams)
 *
 * TfL's Unified API lists every JamCam in one keyless answer: about 890
 * cameras across Greater London, each with its place, a still picture and a
 * short MP4 clip, both on TfL's S3 bucket:
 *
 *   https://api.tfl.gov.uk/Place/Type/JamCam
 *
 * The list keeps cameras whose feed is down in it, flagged `available:
 * "false"` in additionalProperties (88 of 889 on 2026-11-20); those are left
 * out — a camera TfL itself says is off is not shown as if it were live.
 *
 * Data: TfL Open Data, free reuse with attribution ("Powered by TfL Open
 * Data"). The pictures and clips load straight from TfL's bucket, which
 * serves them to any page.
 */

const API = 'https://api.tfl.gov.uk/Place/Type/JamCam';
/** Greater London; a row outside it is mis-geocoded. */
const BOUNDS = { minLat: 51.2, maxLat: 51.75, minLng: -0.6, maxLng: 0.45 };
const STILL = /^https:\/\/s3-eu-west-1\.amazonaws\.com\/jamcams\.tfl\.gov\.uk\/[\w.-]+\.jpg$/;
const CLIP = /^https:\/\/s3-eu-west-1\.amazonaws\.com\/jamcams\.tfl\.gov\.uk\/[\w.-]+\.mp4$/;
const BUCKET = 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk';

/** One JamCam as the Unified API lists it (only the fields we read). */
export interface TfLPlace {
  id?: string | null;
  commonName?: string | null;
  lat?: number | null;
  lon?: number | null;
  additionalProperties?: { key?: string | null; value?: string | null }[] | null;
}

function property(place: TfLPlace, key: string): string | undefined {
  return place.additionalProperties?.find(p => p?.key === key)?.value ?? undefined;
}

/** Map one JamCam to a camera, or null when TfL says it is off or it has no place or picture. */
export function mapTfLCamera(place: TfLPlace): CctvCamera | null {
  if (!place?.id) return null;
  /* The feed's own availability flag: "false" is TfL saying the camera is down. */
  if ((property(place, 'available') ?? '').toLowerCase() === 'false') return null;
  const { lat, lon } = place;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (lat < BOUNDS.minLat || lat > BOUNDS.maxLat || lon < BOUNDS.minLng || lon > BOUNDS.maxLng) return null;

  const camId = place.id.replace(/^JamCams_/, '');
  const still = property(place, 'imageUrl');
  const feed_url = still && STILL.test(still) ? still : `${BUCKET}/${camId}.jpg`;
  if (!STILL.test(feed_url)) return null;
  const clip = property(place, 'videoUrl');

  return {
    id: `tfl-${place.id}`,
    lat,
    lng: lon,
    name: place.commonName?.trim() || 'London JamCam',
    city: 'London',
    country: 'UK',
    feed_url,
    ...(clip && CLIP.test(clip) ? { stream_url: clip, stream_type: 'mp4' as const } : {}),
    source: 'TfL',
  };
}

export async function fetchLondonCameras(): Promise<CctvCamera[]> {
  const res = await stealthFetch(API, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`TfL JamCams HTTP ${res.status}`);
  const data = (await res.json()) as TfLPlace[];
  if (!Array.isArray(data)) throw new Error('TfL JamCams returned a non-array payload');

  const byId = new Map<string, CctvCamera>();
  for (const place of data) {
    const cam = mapTfLCamera(place);
    if (cam) byId.set(cam.id, cam);
  }
  if (!byId.size) throw new Error('TfL JamCams returned no usable cameras');
  console.log(`[OSIRIS] London cameras — TfL: ${byId.size} of ${data.length} listed`);
  return [...byId.values()];
}
