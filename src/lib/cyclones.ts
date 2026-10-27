/**
 * OSIRIS — tropical cyclones from the National Hurricane Center's GIS
 * service: for every active basin slot (AT/EP/CP 1–5) the forecast cone,
 * forecast track line and forecast points, as one GeoJSON collection.
 *
 * The service lays its layers out per basin slot with names like
 * "EP2 Forecast Cone"; which slots are live follows NHC's own
 * CurrentStorms list (bin numbers — AL there is AT here). Only NHC/CPHC
 * basins exist in this service (Atlantic, East & Central Pacific);
 * nothing is invented for other oceans.
 */

export type CycloneKind = 'cone' | 'track' | 'points';

export interface CycloneLayerRef {
  id: number;
  kind: CycloneKind;
  /** Basin slot, e.g. "EP2". */
  slot: string;
}

const NAME = /^((?:AT|EP|CP)\d+) Forecast (Cone|Track|Points)$/;

/** The cone/track/points layers in an NHC service metadata document. */
export function cycloneLayersFromMetadata(meta: unknown): CycloneLayerRef[] {
  const layers = (meta as { layers?: unknown })?.layers;
  if (!Array.isArray(layers)) return [];
  const out: CycloneLayerRef[] = [];
  for (const l of layers) {
    const id = (l as { id?: unknown })?.id;
    const name = (l as { name?: unknown })?.name;
    if (typeof id !== 'number' || typeof name !== 'string') continue;
    const m = NAME.exec(name);
    if (!m) continue;
    out.push({ id, slot: m[1], kind: m[2].toLowerCase() as CycloneKind });
  }
  return out;
}

/** NHC bin numbers (CurrentStorms.json) for a MapServer basin slot. */
export function binForSlot(slot: string): string {
  return slot.startsWith('AT') ? `AL${slot.slice(2)}` : slot;
}

/** Tag a layer's GeoJSON features with their kind + slot, dropping geometry-less rows. */
export function tagCycloneFeatures(fc: unknown, ref: CycloneLayerRef): Record<string, unknown>[] {
  const features = (fc as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const out: Record<string, unknown>[] = [];
  for (const f of features) {
    const feat = f as { geometry?: unknown; properties?: Record<string, unknown> };
    if (!feat?.geometry) continue;
    out.push({
      type: 'Feature',
      geometry: feat.geometry,
      properties: { ...(feat.properties ?? {}), kind: ref.kind, slot: ref.slot },
    });
  }
  return out;
}

/** Escape a feed string for the cyclone popup's HTML. */
export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
