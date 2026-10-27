'use client';

import { useEffect, useRef, useState } from 'react';
import { Popup, type GeoJSONSource, type Map as MlMap, type MapLayerMouseEvent } from 'maplibre-gl';
import { escapeHtml } from '@/lib/cyclones';
import { categoryLabel } from '@/lib/fire-perimeters';

/**
 * OSIRIS — the Wildfire Perimeters layer: agency-mapped fire polygons
 * plus incident points for fires with no perimeter yet, from
 * /api/fire-perimeters (WFIGS / NIFC, merged server-side). Refreshed
 * every 15 minutes; the source itself updates on the order of hours.
 *
 * Perimeters are agency-reported snapshots, NOT live fire spread — the
 * popup carries the feed's own report date and says exactly that.
 * Styling is uniform on purpose: containment lives in the popup as a
 * number, never encoded into colour/opacity where it could be misread.
 */

const SOURCE = 'fire-perimeters';
const ATTRIBUTION = 'Wildfires © WFIGS / NIFC';
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const LAYERS = ['fire-perim-fill', 'fire-perim-line', 'fire-perim-label', 'fire-incident-points', 'fire-incident-label'] as const;
const CLICK_LAYERS = ['fire-perim-fill', 'fire-incident-points'] as const;

/** Under the place names, above the weather imagery. */
function beneath(map: MlMap): string | undefined {
  const firstLabel = map.getStyle().layers.find(l => l.type === 'symbol')?.id;
  return firstLabel && map.getLayer(firstLabel) ? firstLabel : undefined;
}

function fmtDate(iso: unknown): string {
  if (typeof iso !== 'string' || !iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function popupHtml(p: Record<string, unknown>): string {
  const name = escapeHtml(p.name ?? 'Unnamed fire');
  const kind = p.kind === 'perimeter' ? 'perimeter' : 'incident';
  const cat = escapeHtml(categoryLabel(p.category));
  const acres = Number(p.acres);
  const containment = p.containment === null || p.containment === undefined || p.containment === '' ? NaN : Number(p.containment);
  const reported = fmtDate(p.reportedAt);
  const discovered = fmtDate(p.discoveredAt);
  const rows = [
    Number.isFinite(acres) && acres > 0 ? `Size ${acres.toLocaleString('en-US', { maximumFractionDigits: 1 })} acres` : '',
    Number.isFinite(containment) && containment >= 0 ? `Containment ${Math.round(containment)}%` : '',
    p.agency ? `Agency ${escapeHtml(p.agency)}` : '',
    discovered ? `Discovered ${discovered}` : '',
    reported ? `${kind === 'perimeter' ? 'Perimeter reported' : 'Report updated'} ${reported}` : '',
  ].filter(Boolean).map(r => `<div style="opacity:.75;font-size:11px;margin-top:2px">${r}</div>`).join('');
  const note = kind === 'perimeter'
    ? 'Agency-reported perimeter — a snapshot, not live fire spread.'
    : 'Incident location — no perimeter mapped yet.';
  return `<div style="font-family:ui-monospace,monospace;color:#fff;min-width:170px;background:rgba(4,4,10,0.88);border:1px solid rgba(255,255,255,0.14);border-radius:8px;padding:8px 10px;backdrop-filter:blur(8px)">
    <div style="font-size:12px;font-weight:600;letter-spacing:.04em">🔥 ${name} · ${cat}</div>${rows}
    <div style="opacity:.55;font-size:10px;margin-top:4px">${note}</div>
    <div style="opacity:.45;font-size:10px;margin-top:2px">WFIGS / NIFC interagency report</div></div>`;
}

export default function FirePerimeterLayers({ mapRef, mapStyle }: {
  mapRef: React.RefObject<MlMap | null>;
  mapStyle?: string;
}) {
  const [fc, setFc] = useState<GeoJSON.FeatureCollection>(EMPTY);
  const popup = useRef<Popup | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => fetch('/api/fire-perimeters')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: GeoJSON.FeatureCollection) => { if (!cancelled && Array.isArray(body?.features)) setFc(body); })
      .catch(() => { /* keep the last good collection */ });
    load();
    const iv = setInterval(load, 15 * 60_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    void mapStyle;
    // Mounted only once the map style has loaded (mapReady upstream);
    // still, construction errors degrade to "no layer", never a dead map.
    try {
      if (!map.getSource(SOURCE)) {
        map.addSource(SOURCE, { type: 'geojson', data: fc, attribution: ATTRIBUTION });
      } else {
        (map.getSource(SOURCE) as GeoJSONSource).setData(fc);
      }
      const before = beneath(map);
      if (!map.getLayer('fire-perim-fill')) {
        map.addLayer({
          id: 'fire-perim-fill', type: 'fill', source: SOURCE, filter: ['==', ['get', 'kind'], 'perimeter'],
          paint: { 'fill-color': '#FF3D00', 'fill-opacity': 0.32 },
        }, before);
        map.addLayer({
          id: 'fire-perim-line', type: 'line', source: SOURCE, filter: ['==', ['get', 'kind'], 'perimeter'],
          paint: { 'line-color': '#FF7043', 'line-opacity': 0.9, 'line-width': 1.4 },
        }, before);
        map.addLayer({
          id: 'fire-incident-points', type: 'circle', source: SOURCE, filter: ['==', ['get', 'kind'], 'incident'],
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 3.5, 8, 6],
            'circle-color': '#FF9100', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.2,
          },
        }, before);
        map.addLayer({
          id: 'fire-perim-label', type: 'symbol', source: SOURCE, filter: ['==', ['get', 'kind'], 'perimeter'],
          layout: {
            'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 0.2], 'text-anchor': 'center',
            'text-font': ['Noto Sans Regular'], 'text-allow-overlap': false,
          },
          paint: { 'text-color': '#FFCCBC', 'text-halo-color': 'rgba(0,0,0,0.75)', 'text-halo-width': 1.2 },
        }, before);
        map.addLayer({
          id: 'fire-incident-label', type: 'symbol', source: SOURCE, filter: ['==', ['get', 'kind'], 'incident'],
          layout: {
            'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top',
            'text-font': ['Noto Sans Regular'], 'text-allow-overlap': false,
          },
          paint: { 'text-color': '#FFE0B2', 'text-halo-color': 'rgba(0,0,0,0.75)', 'text-halo-width': 1.2 },
        }, before);
      }
    } catch (e) {
      console.warn('[OSIRIS] fire-perimeters layer:', e);
      return;
    }
    const onClick = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      popup.current?.remove();
      popup.current = new Popup({ closeButton: true, closeOnClick: true, className: 'osiris-fire-popup' })
        .setLngLat(e.lngLat)
        .setHTML(popupHtml((f.properties ?? {}) as Record<string, unknown>))
        .addTo(map);
    };
    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; };
    for (const id of CLICK_LAYERS) {
      map.on('click', id, onClick);
      map.on('mouseenter', id, onEnter);
      map.on('mouseleave', id, onLeave);
    }
    return () => {
      for (const id of CLICK_LAYERS) {
        map.off('click', id, onClick);
        map.off('mouseenter', id, onEnter);
        map.off('mouseleave', id, onLeave);
      }
    };
  }, [mapRef, fc, mapStyle]);

  // Unmount: the layer comes off the map entirely.
  useEffect(() => {
    return () => {
      const map = mapRef.current;
      if (!map) return;
      try {
        popup.current?.remove();
        for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(SOURCE)) map.removeSource(SOURCE);
      } catch { /* map already gone */ }
    };
  }, [mapRef]);

  return null;
}
