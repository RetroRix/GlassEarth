/**
 * OSIRIS — active wildfire perimeters + incident locations from WFIGS
 * (Wildland Fire Interagency Geospatial Services, hosted by NIFC): the
 * Interagency Perimeters — Current view (agency-mapped fire polygons)
 * and the Incident Locations — Current view (incident points). Fires
 * that already have a perimeter are drawn by the polygon, so incident
 * points are kept only for fires with no perimeter yet.
 *
 * Honesty rules: every property shipped is a field the feed actually
 * carries, carried under its own label. `reportedAt` is the feed's own
 * timestamp (perimeter date / report-modified date) — perimeters are
 * agency snapshots, NOT live fire spread, and the popup says so.
 */

export type FireFeatureKind = 'perimeter' | 'incident';

export interface FireFeatureProps {
  kind: FireFeatureKind;
  name: string;
  /** Acres as reported (GIS acres for perimeters, incident size for points); null when the feed carries none. */
  acres: number | null;
  /** Percent contained 0–100; null when the feed carries none (never invented). */
  containment: number | null;
  /** Protecting agency code as reported (e.g. "USFS", "BLM"); null when absent. */
  agency: string | null;
  /** Raw WFIGS incident type category: WF / RX / CX / … */
  category: string;
  /** ISO timestamp of the feed's own report date for this feature. */
  reportedAt: string | null;
  /** Incidents only: ISO discovery timestamp, when the feed carries one. */
  discoveredAt: string | null;
  /** Normalised IRWIN id, used to match incidents to perimeters. */
  irwinId: string;
}

export interface FireFeature {
  type: 'Feature';
  geometry: unknown;
  properties: FireFeatureProps;
}

/** IRWIN ids arrive braced in one feed and bare in the other; normalise for matching. */
export function normalizeIrwinId(v: unknown): string {
  return typeof v === 'string' ? v.replace(/[{}]/g, '').trim().toUpperCase() : '';
}

/** Human label for a WFIGS incident type category code. */
export function categoryLabel(cat: unknown): string {
  switch (String(cat ?? '').trim().toUpperCase()) {
    case 'WF': return 'Wildfire';
    case 'RX': return 'Prescribed fire';
    case 'CX': return 'Fire complex';
    default: return 'Fire incident';
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function posNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Containment is honestly 0 sometimes — 0 is data, absence is not. */
function containmentNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

function iso(v: unknown): string | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function featuresOf(fc: unknown): Record<string, unknown>[] {
  const features = (fc as { features?: unknown })?.features;
  return Array.isArray(features) ? (features as Record<string, unknown>[]) : [];
}

function propsOf(f: Record<string, unknown>): Record<string, unknown> {
  return (f.properties ?? {}) as Record<string, unknown>;
}

/** Transform the WFIGS perimeters GeoJSON into labelled map features. */
export function transformPerimeters(fc: unknown): FireFeature[] {
  const out: FireFeature[] = [];
  for (const f of featuresOf(fc)) {
    const geom = f.geometry as { type?: unknown } | null;
    if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue;
    const p = propsOf(f);
    out.push({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        kind: 'perimeter',
        name: str(p.poly_IncidentName) ?? str(p.attr_IncidentName) ?? 'Unnamed fire',
        acres: posNum(p.poly_GISAcres) ?? posNum(p.attr_IncidentSize),
        containment: containmentNum(p.attr_PercentContained),
        agency: str(p.attr_POOProtectingAgency) ?? str(p.attr_POOJurisdictionalAgency),
        category: String(p.attr_IncidentTypeCategory ?? '').trim().toUpperCase(),
        reportedAt: iso(p.poly_DateCurrent) ?? iso(p.poly_PolygonDateTime),
        discoveredAt: iso(p.attr_FireDiscoveryDateTime),
        irwinId: normalizeIrwinId(p.attr_IrwinID),
      },
    });
  }
  return out;
}

/**
 * Transform the WFIGS incident-locations GeoJSON into point features,
 * dropping incidents that already have a perimeter (matched by IRWIN id)
 * and de-duplicating repeat reports of the same incident.
 */
export function transformIncidents(fc: unknown, perimeterIrwinIds: ReadonlySet<string>): FireFeature[] {
  const out: FireFeature[] = [];
  const seen = new Set<string>();
  for (const f of featuresOf(fc)) {
    const p = propsOf(f);
    const irwinId = normalizeIrwinId(p.IrwinID);
    if (irwinId && perimeterIrwinIds.has(irwinId)) continue;
    if (irwinId && seen.has(irwinId)) continue;
    let geometry: unknown = f.geometry;
    const geomType = (geometry as { type?: unknown } | null)?.type;
    if (!geometry || geomType !== 'Point') {
      // Fall back to the incident's own reported initial location.
      const lat = Number(p.InitialLatitude);
      const lng = Number(p.InitialLongitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      geometry = { type: 'Point', coordinates: [lng, lat] };
    }
    if (irwinId) seen.add(irwinId);
    out.push({
      type: 'Feature',
      geometry,
      properties: {
        kind: 'incident',
        name: str(p.IncidentName) ?? 'Unnamed fire',
        acres: posNum(p.IncidentSize) ?? posNum(p.DiscoveryAcres),
        containment: containmentNum(p.PercentContained),
        agency: str(p.POOProtectingAgency) ?? str(p.POOJurisdictionalAgency),
        category: String(p.IncidentTypeCategory ?? '').trim().toUpperCase(),
        reportedAt: iso(p.ModifiedOnDateTime_dt),
        discoveredAt: iso(p.FireDiscoveryDateTime),
        irwinId,
      },
    });
  }
  return out;
}
