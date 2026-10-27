/**
 * OSIRIS — street-level photos from Panoramax, the open street-photo
 * commons: a federation of public instances (IGN France, OpenStreetMap
 * France, MapComplete, …) behind one keyless meta-catalog STAC API at
 * api.panoramax.xyz. Every picture is crowd-sourced and carries its own
 * licence (CC BY-SA 4.0 on most instances, Etalab Licence Ouverte 2.0 on
 * IGN's), its capture datetime and its contributor — all three are
 * carried through verbatim and shown in the viewer; attribution is a
 * licence condition, not decoration.
 *
 * Honesty rules: `capturedAt` is the feed's own capture datetime, never
 * the upload date; a picture with no usable geometry or no image asset
 * is dropped, never placeholdered; an area with no coverage simply
 * returns no features.
 */

/** Pictures per bbox fetch — the meta-catalog honours much larger
 *  limits, but a street-zoom viewport never needs more dots than this. */
export const MAX_PHOTOS_PER_FETCH = 500;

/** Street-level imagery only makes sense zoomed in; below this the
 *  layer draws nothing (same gating idea as the camera populate zoom). */
export const STREET_PHOTO_MIN_ZOOM = 14;

export interface StreetPhotoProps {
  id: string;
  /** ISO capture datetime from the feed (`datetime` property). */
  capturedAt: string | null;
  /** Contributor name(s) as the feed credits them. */
  contributor: string | null;
  /** Raw licence id from the feed (e.g. "CC-BY-SA-4.0", "etalab-2.0"). */
  license: string | null;
  /** Human label for the licence id. */
  licenseLabel: string | null;
  /** Link to the licence text, from the item's own license link. */
  licenseUrl: string | null;
  /** Camera azimuth in degrees (feed `view:azimuth`); null when absent. */
  azimuth: number | null;
  /** Panoramax sequence (STAC collection) this picture belongs to. */
  collectionId: string | null;
  /** Previous picture in the sequence, when the feed links one. */
  prevId: string | null;
  prevCollection: string | null;
  /** Next picture in the sequence, when the feed links one. */
  nextId: string | null;
  nextCollection: string | null;
  /** Human page for this picture on the Panoramax meta-catalog viewer. */
  sourceUrl: string;
}

export interface StreetPhotoFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: StreetPhotoProps;
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/** Human label for a Panoramax licence id; unknown ids pass through raw. */
export function licenseLabel(id: unknown): string | null {
  if (typeof id !== 'string' || !id.trim()) return null;
  switch (id.trim()) {
    case 'CC-BY-SA-4.0': return 'CC BY-SA 4.0';
    case 'CC-BY-SA-3.0': return 'CC BY-SA 3.0';
    case 'CC-BY-4.0': return 'CC BY 4.0';
    case 'etalab-2.0': return 'Licence Ouverte / Open Licence 2.0';
    default: return id.trim();
  }
}

/** The meta-catalog serves every federated picture by id — one fixed
 *  upstream for the image proxy, whatever instance holds the original. */
export function panoramaxPictureUrl(id: string, size: 'hd' | 'sd' | 'thumb'): string {
  return `https://api.panoramax.xyz/api/pictures/${id}/${size}.jpg`;
}

/** Human viewer page for a picture on the meta-catalog. */
export function panoramaxViewerUrl(id: string): string {
  return `https://api.panoramax.xyz/#focus=pic&pic=${id}`;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

interface StacLink { rel?: unknown; href?: unknown; title?: unknown }

function linksOf(f: Record<string, unknown>): StacLink[] {
  return Array.isArray(f.links) ? (f.links as StacLink[]) : [];
}

function linkHref(f: Record<string, unknown>, rel: string): string | null {
  const l = linksOf(f).find(x => x.rel === rel);
  return str(l?.href);
}

/** Parse a STAC item href (…/collections/<cid>/items/<pid>) into its ids. */
export function parseItemHref(href: unknown): { collectionId: string; pictureId: string } | null {
  if (typeof href !== 'string') return null;
  const m = href.match(/\/collections\/([0-9a-fA-F-]{36})\/items\/([0-9a-fA-F-]{36})/);
  if (!m || !isUuid(m[1]) || !isUuid(m[2])) return null;
  return { collectionId: m[1], pictureId: m[2] };
}

function contributorOf(f: Record<string, unknown>, p: Record<string, unknown>): string | null {
  const providers = Array.isArray(f.providers) ? (f.providers as Record<string, unknown>[]) : [];
  const names: string[] = [];
  for (const prov of providers) {
    const name = str(prov?.name);
    if (name && !names.includes(name)) names.push(name);
  }
  if (names.length) return names.join(', ');
  return str(p['geovisio:producer']);
}

function hasImageAsset(f: Record<string, unknown>): boolean {
  const assets = (f.assets ?? {}) as Record<string, { href?: unknown }>;
  return Boolean(str(assets.sd?.href) ?? str(assets.hd?.href) ?? str(assets.thumb?.href));
}

/** Transform one Panoramax STAC item into a labelled map feature. */
export function transformPicture(f: unknown): StreetPhotoFeature | null {
  if (!f || typeof f !== 'object') return null;
  const feat = f as Record<string, unknown>;
  const id = feat.id;
  if (!isUuid(id)) return null;
  const geom = feat.geometry as { type?: unknown; coordinates?: unknown } | null;
  if (!geom || geom.type !== 'Point' || !Array.isArray(geom.coordinates)) return null;
  const [lng, lat] = geom.coordinates as [unknown, unknown];
  if (!Number.isFinite(Number(lng)) || !Number.isFinite(Number(lat))) return null;
  if (!hasImageAsset(feat)) return null;
  const p = (feat.properties ?? {}) as Record<string, unknown>;
  const license = str(p.license);
  const prev = parseItemHref(linkHref(feat, 'prev'));
  const next = parseItemHref(linkHref(feat, 'next'));
  const azimuthRaw = Number(p['view:azimuth']);
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [Number(lng), Number(lat)] },
    properties: {
      id,
      capturedAt: str(p.datetime),
      contributor: contributorOf(feat, p),
      license,
      licenseLabel: licenseLabel(license),
      licenseUrl: linkHref(feat, 'license'),
      azimuth: Number.isFinite(azimuthRaw) ? azimuthRaw : null,
      collectionId: str(feat.collection),
      prevId: prev?.pictureId ?? null,
      prevCollection: prev?.collectionId ?? null,
      nextId: next?.pictureId ?? null,
      nextCollection: next?.collectionId ?? null,
      sourceUrl: panoramaxViewerUrl(id),
    },
  };
}

/** Transform a Panoramax STAC search response into map features, capped. */
export function transformSearchResults(body: unknown, cap = MAX_PHOTOS_PER_FETCH): StreetPhotoFeature[] {
  const features = (body as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const out: StreetPhotoFeature[] = [];
  for (const f of features) {
    const t = transformPicture(f);
    if (t) out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}
