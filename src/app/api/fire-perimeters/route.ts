import { NextResponse } from 'next/server';
import { transformIncidents, transformPerimeters } from '@/lib/fire-perimeters';

export const dynamic = 'force-dynamic';

/**
 * OSIRIS — active wildfire perimeters + incident locations from WFIGS
 * (Wildland Fire Interagency Geospatial Services, NIFC ArcGIS):
 *  - WFIGS_Interagency_Perimeters_Current: agency-mapped fire polygons
 *    with containment / acres / report date joined from the incident.
 *  - WFIGS_Incident_Locations_Current: incident points; the ones that
 *    already have a perimeter are dropped (the polygon draws the fire).
 * Perimeters are agency snapshots updated on the order of hours, so the
 * merged collection is cached ~12 minutes server-side; the browser
 * never calls the source directly. Public service, no key.
 */

const HOST = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services';
const PERIMETER_FIELDS = [
  'poly_IncidentName', 'poly_GISAcres', 'poly_DateCurrent', 'poly_PolygonDateTime',
  'attr_IncidentName', 'attr_PercentContained', 'attr_IncidentSize',
  'attr_POOProtectingAgency', 'attr_POOJurisdictionalAgency',
  'attr_IncidentTypeCategory', 'attr_FireDiscoveryDateTime', 'attr_IrwinID',
].join(',');
const INCIDENT_FIELDS = [
  'IncidentName', 'IncidentSize', 'DiscoveryAcres', 'PercentContained',
  'POOProtectingAgency', 'POOJurisdictionalAgency', 'IncidentTypeCategory',
  'ModifiedOnDateTime_dt', 'FireDiscoveryDateTime', 'IrwinID',
  'InitialLatitude', 'InitialLongitude',
].join(',');
const TTL_MS = 12 * 60 * 1000;

let cached: { body: unknown; expiresAt: number } | null = null;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000), cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function queryUrl(service: string, fields: string): string {
  const q = new URLSearchParams({
    where: '1=1', outFields: fields, returnGeometry: 'true',
    outSR: '4326', geometryPrecision: '5', f: 'geojson',
  });
  return `${HOST}/${service}/FeatureServer/0/query?${q}`;
}

export async function GET() {
  if (!cached || Date.now() > cached.expiresAt) {
    try {
      const [perimFc, incFc] = await Promise.all([
        getJson(queryUrl('WFIGS_Interagency_Perimeters_Current', PERIMETER_FIELDS)).catch(() => null),
        getJson(queryUrl('WFIGS_Incident_Locations_Current', INCIDENT_FIELDS)).catch(() => null),
      ]);
      if (perimFc === null && incFc === null) throw new Error('WFIGS: both services unreachable');
      const perimeters = transformPerimeters(perimFc);
      const ids = new Set(perimeters.map(f => f.properties.irwinId).filter(Boolean));
      const incidents = transformIncidents(incFc, ids);
      cached = {
        body: {
          type: 'FeatureCollection',
          features: [...perimeters, ...incidents],
          counts: { perimeters: perimeters.length, incidents: incidents.length },
          generatedAt: new Date().toISOString(),
        },
        expiresAt: Date.now() + TTL_MS,
      };
    } catch (e) {
      console.warn('[OSIRIS] fire-perimeters:', e);
      if (!cached) return NextResponse.json({ error: 'Wildfire data unavailable' }, { status: 502 });
    }
  }
  return NextResponse.json(cached.body, { headers: { 'Cache-Control': 'public, max-age=120' } });
}
