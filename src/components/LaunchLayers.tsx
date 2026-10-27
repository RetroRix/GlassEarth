'use client';

import { useEffect, useRef, useState } from 'react';
import { Popup, type GeoJSONSource, type Map as MlMap, type MapLayerMouseEvent } from 'maplibre-gl';
import { escapeHtml } from '@/lib/cyclones';
import { groupSites, isProvisional, sitesToGeoJson, type LaunchRecord, type LaunchSite } from '@/lib/launches';

/**
 * OSIRIS — the Rocket Launches layer: one marker per launch site with
 * launches in the window (next ~30 days + recent ~7 days), from
 * /api/launches (Launch Library 2, polled server-side). Refreshed
 * every 15 minutes — the route's own cache is 45 minutes, so this is
 * mostly a cheap freshness nudge.
 *
 * Honesty: NET means No Earlier Than. The popup shows each launch's
 * feed status verbatim and its NET time labelled NET; nothing here
 * predicts or sharpens a time the feed left provisional.
 */

const SOURCE = 'launches';
const ATTRIBUTION = 'Launches © The Space Devs (Launch Library 2)';
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const LAYERS = ['launch-site-points', 'launch-site-count', 'launch-site-label'] as const;

function fmtNet(iso: unknown): string {
  if (typeof iso !== 'string' || !iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

interface SiteLaunch { name: string; net: string; status: string; statusAbbrev: string }

function popupHtml(p: Record<string, unknown>): string {
  const pad = escapeHtml(p.padName ?? '');
  const site = escapeHtml(p.siteName ?? '');
  let list: SiteLaunch[] = [];
  try { list = JSON.parse(String(p.launchesJson ?? '[]')) as SiteLaunch[]; } catch { list = []; }
  const rows = list.slice(0, 6).map(l => {
    const prov = isProvisional(l.statusAbbrev) ? ' · provisional' : '';
    return `<div style="margin-top:5px">
      <div style="font-size:11px;font-weight:600">${escapeHtml(l.name)}</div>
      <div style="opacity:.75;font-size:11px">NET ${escapeHtml(fmtNet(l.net))} · ${escapeHtml(l.status)}${prov}</div>
    </div>`;
  }).join('');
  const more = list.length > 6 ? `<div style="opacity:.55;font-size:10px;margin-top:4px">+ ${list.length - 6} more in the Launches panel</div>` : '';
  return `<div style="font-family:ui-monospace,monospace;color:#fff;min-width:210px;max-width:280px;background:rgba(4,4,10,0.88);border:1px solid rgba(255,255,255,0.14);border-radius:8px;padding:8px 10px;backdrop-filter:blur(8px)">
    <div style="font-size:12px;font-weight:600;letter-spacing:.04em">🚀 ${pad || site}</div>
    ${pad && site ? `<div style="opacity:.6;font-size:10px;margin-top:1px">${site}</div>` : ''}
    ${rows}${more}
    <div style="opacity:.45;font-size:10px;margin-top:5px">NET = No Earlier Than · Launch Library 2 / The Space Devs</div></div>`;
}

export default function LaunchLayers({ mapRef, mapStyle }: {
  mapRef: React.RefObject<MlMap | null>;
  mapStyle?: string;
}) {
  const [fc, setFc] = useState<GeoJSON.FeatureCollection>(EMPTY);
  const popup = useRef<Popup | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => fetch('/api/launches')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { launches?: LaunchRecord[]; sites?: LaunchSite[] }) => {
        if (cancelled) return;
        // The route ships the merged window ready-made; sites win, and
        // grouping the flat launch list locally is the fallback.
        const sites = Array.isArray(body?.sites) && body.sites.length
          ? body.sites
          : groupSites(Array.isArray(body?.launches) ? body.launches : []);
        setFc(sitesToGeoJson(sites));
      })
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
      if (!map.getLayer('launch-site-points')) {
        map.addLayer({
          id: 'launch-site-points', type: 'circle', source: SOURCE,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 5, 8, 8],
            'circle-color': '#FF6D00', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.4,
          },
        });
        map.addLayer({
          id: 'launch-site-label', type: 'symbol', source: SOURCE,
          layout: {
            'text-field': ['get', 'siteName'], 'text-size': 11, 'text-offset': [0, 1.3], 'text-anchor': 'top',
            'text-font': ['Noto Sans Regular'], 'text-allow-overlap': false,
          },
          paint: { 'text-color': '#FFCCBC', 'text-halo-color': 'rgba(0,0,0,0.75)', 'text-halo-width': 1.2 },
        });
        map.addLayer({
          id: 'launch-site-count', type: 'symbol', source: SOURCE,
          layout: {
            'text-field': ['to-string', ['get', 'count']], 'text-size': 10,
            'text-font': ['Noto Sans Regular'], 'text-allow-overlap': true,
          },
          paint: { 'text-color': '#ffffff' },
        });
      }
    } catch (e) {
      console.warn('[OSIRIS] launches layer:', e);
      return;
    }
    const onClick = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      popup.current?.remove();
      popup.current = new Popup({ closeButton: true, closeOnClick: true, className: 'osiris-launch-popup' })
        .setLngLat(e.lngLat)
        .setHTML(popupHtml((f.properties ?? {}) as Record<string, unknown>))
        .addTo(map);
    };
    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; };
    map.on('click', 'launch-site-points', onClick);
    map.on('mouseenter', 'launch-site-points', onEnter);
    map.on('mouseleave', 'launch-site-points', onLeave);
    return () => {
      map.off('click', 'launch-site-points', onClick);
      map.off('mouseenter', 'launch-site-points', onEnter);
      map.off('mouseleave', 'launch-site-points', onLeave);
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
