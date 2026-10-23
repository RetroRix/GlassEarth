import type { CctvCamera } from './types';

/**
 * OSIRIS — helpers for the Iteris ATIS traveler-information platform.
 *
 * South Carolina (511sc.org, "SafeTravel") and Virginia's current 511 site
 * (511.vdot.virginia.gov, "TTRIP") run the same vendor stack, and both
 * publish their cameras as GeoJSON point features with an identical
 * `properties` block: a `description` label, a `jurisdiction`, a snapshot
 * `image_url` and an `https_url` HLS playlist on the vendor's streaming
 * edges (skyvdn.com for SC, vdotcameras.com for VA). The two loaders differ
 * only in where the features come from — a bare FeatureCollection on the
 * Iteris CDN for SC, a `{ success, data }` envelope from VDOT's own
 * services host for VA — so the mapping lives here, once.
 *
 * The `preroll_url` in every record is *not* used: as Indiana's INDOT feed
 * established, a preroll playlist is a filler loop served while the real
 * encoder spins up. The `https_url` (`rtplive`) playlists were verified to
 * carry real, advancing media segments for both states.
 */

/** One GeoJSON feature from an Iteris ATIS deployment — only the fields we consume. */
export interface IterisCameraFeature {
  type?: string;
  geometry?: { type?: string; coordinates?: [number, number] } | null;
  properties?: {
    /** VA: the numeric camera id. SC: a UUID — SC keys cameras by `name` instead. */
    id?: string | null;
    /** SC: the camera number (`50001`). VA: the stream token. */
    name?: string | null;
    description?: string | null;
    jurisdiction?: string | null;
    route?: string | null;
    /** Present on VA rows (usually empty) — published, not consumed. */
    direction?: string | null;
    image_url?: string | null;
    https_url?: string | null;
    /** The filler-loop playlist — published on every row, never consumed. */
    preroll_url?: string | null;
    active?: boolean | null;
    problem_stream?: boolean | null;
  } | null;
}

/** What separates one state's deployment from another's. */
export interface IterisSource {
  /** Prefixes every camera id, so two states can't collide. */
  idPrefix: string;
  /** The agency shown on the camera card. */
  source: string;
  /** Caption of last resort, when a feature names no jurisdiction. */
  state: string;
  /** Which property keys the camera id: VA uses `id`, SC uses `name`. */
  idField: 'id' | 'name';
  /** Drops mis-geocoded rows — every one of these feeds has a few. */
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
}

/** Map a raw feature to a camera, or null if it should be skipped. Exported for tests. */
export function mapIterisFeature(feature: IterisCameraFeature, cfg: IterisSource): CctvCamera | null {
  const p = feature?.properties;
  if (!p || p.active === false) return null;

  const rawId = cfg.idField === 'name' ? p.name : p.id;
  const id = typeof rawId === 'string' ? rawId.trim() : '';
  if (!id) return null;

  const coords = feature.geometry?.coordinates;
  if (!coords) return null;
  const [lng, lat] = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const b = cfg.bounds;
  if (lat < b.minLat || lat > b.maxLat || lng < b.minLng || lng > b.maxLng) return null;

  const snapshot = p.image_url?.trim() || undefined;
  /* A row that flags its own stream as broken keeps its snapshot; the
     playlist it advertises would only hand the player a dead feed. */
  const httpsUrl = p.https_url?.trim();
  const video = !p.problem_stream && httpsUrl && /\.m3u8(\?|$)/i.test(httpsUrl) ? httpsUrl : undefined;
  if (!snapshot && !video) return null;

  return {
    id: `${cfg.idPrefix}-${id}`,
    lat,
    lng,
    name: p.description?.trim() || p.route?.trim() || `${cfg.source} Camera ${id}`,
    city: p.jurisdiction?.trim() || cfg.state,
    country: 'US',
    ...(snapshot ? { feed_url: snapshot } : {}),
    ...(video ? { stream_url: video, stream_type: 'hls' as const } : {}),
    source: cfg.source,
  };
}
