'use client';

import { useEffect, useRef, useState } from 'react';
import { Popup, type GeoJSONSource, type Map as MlMap, type MapLayerMouseEvent } from 'maplibre-gl';
import { escapeHtml } from '@/lib/cyclones';

/**
 * OSIRIS — the Tropical Cyclones layer: NHC/CPHC forecast cone, track and
 * points for every active storm, from /api/cyclones (the NHC's public GIS
 * service, merged server-side). Refreshed every 15 minutes; NHC issues
 * advisories every 6 hours. When no storm is active the layer is simply
 * empty — nothing is drawn, and nothing is invented to fill it.
 */

const SOURCE = 'cyclones';
const ATTRIBUTION = 'Cyclones © NOAA/NHC';
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const LAYERS = ['cyclone-cone', 'cyclone-cone-line', 'cyclone-track', 'cyclone-points', 'cyclone-label'] as const;

/** Under the place names, above the weather imagery. */
function beneath(map: MlMap): string | undefined {
  const firstLabel = map.getStyle().layers.find(l => l.type === 'symbol')?.id;
  return firstLabel && map.getLayer(firstLabel) ? firstLabel : undefined;
}

function popupHtml(p: Record<string, unknown>): string {
  const name = escapeHtml(p.stormname ?? 'Tropical cyclone');
  const type = escapeHtml(p.stormtype ?? '');
  const wind = Number(p.maxwind);
  const gust = Number(p.gust);
  const mslp = Number(p.mslp);
  const when = escapeHtml(p.datelbl ?? '');
  const rows = [
    Number.isFinite(wind) && wind > 0 ? `Winds ${wind} kt${Number.isFinite(gust) && gust > 0 ? ` · gusts ${gust} kt` : ''}` : '',
    Number.isFinite(mslp) && mslp > 0 ? `Pressure ${mslp} mb` : '',
    when ? `Forecast valid ${when}` : '',
  ].filter(Boolean).map(r => `<div style="opacity:.75;font-size:11px;margin-top:2px">${r}</div>`).join('');
  return `<div style="font-family:ui-monospace,monospace;color:#fff;min-width:150px;background:rgba(4,4,10,0.88);border:1px solid rgba(255,255,255,0.14);border-radius:8px;padding:8px 10px;backdrop-filter:blur(8px)">
    <div style="font-size:12px;font-weight:600;letter-spacing:.04em">🌀 ${name}${type ? ` · ${type}` : ''}</div>${rows}
    <div style="opacity:.45;font-size:10px;margin-top:4px">NOAA / National Hurricane Center</div></div>`;
}

export default function CycloneLayers({ mapRef, mapStyle }: {
  mapRef: React.RefObject<MlMap | null>;
  mapStyle?: string;
}) {
  const [fc, setFc] = useState<GeoJSON.FeatureCollection>(EMPTY);
  const popup = useRef<Popup | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => fetch('/api/cyclones')
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
    if (!map.getSource(SOURCE)) {
      map.addSource(SOURCE, { type: 'geojson', data: fc, attribution: ATTRIBUTION });
    } else {
      (map.getSource(SOURCE) as GeoJSONSource).setData(fc);
    }
    const before = beneath(map);
    if (!map.getLayer('cyclone-cone')) {
      map.addLayer({
        id: 'cyclone-cone', type: 'fill', source: SOURCE, filter: ['==', ['get', 'kind'], 'cone'],
        paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.13 },
      }, before);
      map.addLayer({
        id: 'cyclone-cone-line', type: 'line', source: SOURCE, filter: ['==', ['get', 'kind'], 'cone'],
        paint: { 'line-color': '#ffffff', 'line-opacity': 0.45, 'line-width': 1 },
      }, before);
      map.addLayer({
        id: 'cyclone-track', type: 'line', source: SOURCE, filter: ['==', ['get', 'kind'], 'track'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#FFD54F', 'line-width': 2, 'line-dasharray': [2, 1.5] },
      }, before);
      map.addLayer({
        id: 'cyclone-points', type: 'circle', source: SOURCE, filter: ['==', ['get', 'kind'], 'points'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 3, 8, 6],
          'circle-color': '#FF7043', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.2,
        },
      }, before);
      map.addLayer({
        id: 'cyclone-label', type: 'symbol', source: SOURCE, filter: ['==', ['get', 'kind'], 'points'],
        layout: {
          'text-field': ['concat', ['get', 'stormname'], ' · ', ['to-string', ['get', 'maxwind']], ' kt'],
          'text-size': 11, 'text-offset': [0, 1.4], 'text-anchor': 'top',
          'text-font': ['Noto Sans Regular'], 'text-allow-overlap': false,
        },
        paint: { 'text-color': '#FFE0B2', 'text-halo-color': 'rgba(0,0,0,0.75)', 'text-halo-width': 1.2 },
      }, before);
    }
    const onClick = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      popup.current?.remove();
      popup.current = new Popup({ closeButton: true, closeOnClick: true, className: 'osiris-cyclone-popup' })
        .setLngLat(e.lngLat)
        .setHTML(popupHtml((f.properties ?? {}) as Record<string, unknown>))
        .addTo(map);
    };
    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; };
    map.on('click', 'cyclone-points', onClick);
    map.on('mouseenter', 'cyclone-points', onEnter);
    map.on('mouseleave', 'cyclone-points', onLeave);
    return () => {
      map.off('click', 'cyclone-points', onClick);
      map.off('mouseenter', 'cyclone-points', onEnter);
      map.off('mouseleave', 'cyclone-points', onLeave);
    };
  }, [mapRef, fc, mapStyle]);

  // Unmount: the layer comes off the map entirely.
  useEffect(() => {
    return () => {
      const map = mapRef.current;
      if (!map) return;
      popup.current?.remove();
      for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    };
  }, [mapRef]);

  return null;
}
