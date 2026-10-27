import { NextResponse } from 'next/server';
import { binForSlot, cycloneLayersFromMetadata, tagCycloneFeatures, type CycloneLayerRef } from '@/lib/cyclones';

export const dynamic = 'force-dynamic';

/**
 * OSIRIS — active tropical cyclones: forecast cone + track + points from
 * the NHC's public GIS service, merged into one GeoJSON collection.
 * Which basin slots to read follows NHC's CurrentStorms list; if that
 * list cannot be read, every slot is read (empty slots answer empty).
 *
 * Source: NOAA/NHC mapservices — public, no key.
 */

const SERVICE = 'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer';
const TTL_MS = 5 * 60 * 1000;

let cached: { body: unknown; expiresAt: number } | null = null;
let layerRefs: CycloneLayerRef[] | null = null;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

export async function GET() {
  if (!cached || Date.now() > cached.expiresAt) {
    try {
      if (!layerRefs) layerRefs = cycloneLayersFromMetadata(await getJson(`${SERVICE}?f=json`));
      if (!layerRefs.length) throw new Error('NHC: no cyclone layers in service metadata');

      let refs = layerRefs;
      try {
        const storms = await getJson('https://www.nhc.noaa.gov/CurrentStorms.json') as { activeStorms?: { binNumber?: unknown }[] };
        const bins = new Set((storms.activeStorms ?? []).map(s => String(s.binNumber ?? '')));
        if (bins.size) refs = layerRefs.filter(r => bins.has(binForSlot(r.slot)));
      } catch { /* the storm list is an optimisation; the slots answer for themselves */ }

      const parts = await Promise.all(refs.map(async ref => {
        try {
          const fc = await getJson(`${SERVICE}/${ref.id}/query?where=1%3D1&outFields=*&returnGeometry=true&f=geojson`);
          return tagCycloneFeatures(fc, ref);
        } catch { return []; }
      }));
      const features = parts.flat();
      cached = {
        body: { type: 'FeatureCollection', features, storms: new Set(features.map(f => (f.properties as { slot?: string })?.slot)).size },
        expiresAt: Date.now() + TTL_MS,
      };
    } catch (e) {
      console.warn('[OSIRIS] cyclones:', e);
      if (!cached) return NextResponse.json({ error: 'Cyclone data unavailable' }, { status: 502 });
    }
  }
  return NextResponse.json(cached.body, { headers: { 'Cache-Control': 'public, max-age=120' } });
}
