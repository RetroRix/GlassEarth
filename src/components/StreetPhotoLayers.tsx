'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { type GeoJSONSource, type Map as MlMap, type MapLayerMouseEvent } from 'maplibre-gl';
import { ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-react';
import { LOOK_MEDIA_CLASS } from '@/lib/sensor-looks';
import { STREET_PHOTO_MIN_ZOOM, type StreetPhotoProps } from '@/lib/street-photos';

/**
 * OSIRIS — the Street Photos layer: crowd-sourced ground-level imagery
 * from Panoramax (the open street-photo commons), via /api/street-photos
 * (server-side proxy + cache; the browser never calls Panoramax).
 *
 * Dots only exist at street zoom (z14+) — street-level photos make no
 * sense from orbit — and only where contributors have actually shot:
 * an uncovered area simply has no dots. Clicking a dot opens the photo
 * full-frame with the feed's own capture date, the contributor credit
 * and the picture's own licence (CC BY-SA / Licence Ouverte — the
 * credit is a licence condition, shown in the viewer, not buried).
 */

const SOURCE = 'street-photos';
const ATTRIBUTION = 'Street photos © Panoramax contributors';
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const LAYERS = ['street-photo-points'] as const;

function fmtCaptured(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function compass(az: number | null): string {
  if (az === null || !Number.isFinite(az)) return '';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(((az % 360) / 45)) % 8];
}

export default function StreetPhotoLayers({ mapRef, mapStyle }: {
  mapRef: React.RefObject<MlMap | null>;
  mapStyle?: string;
}) {
  const [selected, setSelected] = useState<StreetPhotoProps | null>(null);
  const [navBusy, setNavBusy] = useState(false);
  const fcRef = useRef<GeoJSON.FeatureCollection>(EMPTY);
  const seededRef = useRef<GeoJSON.FeatureCollection | null>(null);
  const byIdRef = useRef<Map<string, StreetPhotoProps>>(new Map());
  const abortRef = useRef<AbortController | null>(null);

  const applyFc = useCallback((fc: GeoJSON.FeatureCollection) => {
    fcRef.current = fc;
    const byId = new Map<string, StreetPhotoProps>();
    for (const f of fc.features) {
      const p = (f.properties ?? null) as StreetPhotoProps | null;
      if (p?.id) byId.set(p.id, p);
    }
    byIdRef.current = byId;
    const map = mapRef.current;
    if (!map) return;
    try {
      const src = map.getSource(SOURCE) as GeoJSONSource | undefined;
      if (src && seededRef.current !== fc) {
        src.setData(fc);
        seededRef.current = fc;
      }
    } catch { /* style mid-swap; styledata ensure() re-seeds */ }
  }, [mapRef]);

  // Sequence navigation: fetch the neighbour through our own route.
  const navigate = useCallback(async (targetId: string | null, targetCollection: string | null) => {
    if (!targetId || !targetCollection || navBusy) return;
    setNavBusy(true);
    try {
      const r = await fetch(`/api/street-photos?collection=${targetCollection}&id=${targetId}`);
      if (!r.ok) return;
      const body = await r.json() as { photo?: StreetPhotoProps };
      if (body.photo) setSelected(body.photo);
    } catch { /* stay on the current photo */ } finally {
      setNavBusy(false);
    }
  }, [navBusy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selected) return;
      if (e.key === 'Escape') setSelected(null);
      if (e.key === 'ArrowLeft') void navigate(selected.prevId, selected.prevCollection);
      if (e.key === 'ArrowRight') void navigate(selected.nextId, selected.nextCollection);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, navigate]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    void mapStyle;
    // Mounted only once the map style has loaded (mapReady upstream);
    // ensure() is idempotent and re-runs on styledata, so boot style
    // swaps (which wipe foreign sources) heal within a frame.
    const ensure = () => {
      try {
        if (!map.getSource(SOURCE)) {
          map.addSource(SOURCE, { type: 'geojson', data: fcRef.current, attribution: ATTRIBUTION });
          seededRef.current = fcRef.current;
        } else if (seededRef.current !== fcRef.current) {
          (map.getSource(SOURCE) as GeoJSONSource).setData(fcRef.current);
          seededRef.current = fcRef.current;
        }
        if (!map.getLayer('street-photo-points')) {
          map.addLayer({
            id: 'street-photo-points', type: 'circle', source: SOURCE, minzoom: STREET_PHOTO_MIN_ZOOM,
            paint: {
              'circle-radius': ['interpolate', ['linear'], ['zoom'], STREET_PHOTO_MIN_ZOOM, 4.5, 18, 7],
              'circle-color': '#CE93D8', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.3,
              'circle-opacity': 0.92,
            },
          });
        }
      } catch (e) {
        console.warn('[OSIRIS] street-photos layer:', e);
      }
    };
    ensure();
    map.on('styledata', ensure);

    let debounce: ReturnType<typeof setTimeout> | null = null;
    const fetchViewport = () => {
      try {
        if (map.getZoom() < STREET_PHOTO_MIN_ZOOM) {
          if (fcRef.current !== EMPTY) applyFc(EMPTY);
          return;
        }
        const b = map.getBounds();
        const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(',');
        abortRef.current?.abort();
        const ac = new AbortController();
        abortRef.current = ac;
        fetch(`/api/street-photos?bbox=${bbox}`, { signal: ac.signal })
          .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
          .then((body: GeoJSON.FeatureCollection) => {
            if (Array.isArray(body?.features)) applyFc(body);
          })
          .catch(() => { /* keep the last good dots (abort = superseded) */ });
      } catch { /* map mid-teardown */ }
    };
    const onMoveEnd = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(fetchViewport, 350);
    };
    fetchViewport();
    map.on('moveend', onMoveEnd);

    const onClick = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id;
      const photo = typeof id === 'string' ? byIdRef.current.get(id) : undefined;
      if (photo) setSelected(photo);
    };
    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; };
    map.on('click', 'street-photo-points', onClick);
    map.on('mouseenter', 'street-photo-points', onEnter);
    map.on('mouseleave', 'street-photo-points', onLeave);
    return () => {
      if (debounce) clearTimeout(debounce);
      abortRef.current?.abort();
      map.off('styledata', ensure);
      map.off('moveend', onMoveEnd);
      map.off('click', 'street-photo-points', onClick);
      map.off('mouseenter', 'street-photo-points', onEnter);
      map.off('mouseleave', 'street-photo-points', onLeave);
    };
  }, [mapRef, mapStyle, applyFc]);

  // Unmount: the layer comes off the map entirely.
  useEffect(() => {
    return () => {
      const map = mapRef.current;
      if (!map) return;
      try {
        for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(SOURCE)) map.removeSource(SOURCE);
      } catch { /* map already gone */ }
    };
  }, [mapRef]);

  if (!selected) return null;
  const captured = fmtCaptured(selected.capturedAt);
  const facing = compass(selected.azimuth);
  const navBtn = 'pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-black/55 text-white backdrop-blur transition hover:bg-black/80 disabled:opacity-30';

  return (
    <div className="fixed inset-0 z-[500] flex flex-col" style={{ background: 'rgba(2,4,10,0.94)' }} role="dialog" aria-label="Street photo viewer">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/70">
          Street photo · Panoramax
        </div>
        <button type="button" onClick={() => setSelected(null)} aria-label="Close photo"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/25 text-white transition hover:bg-white/10">
          <X size={17} />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={selected.id}
          src={`/api/street-photos/image?id=${selected.id}&size=sd`}
          alt={selected.contributor ? `Street photo by ${selected.contributor}` : 'Street photo'}
          className={`${LOOK_MEDIA_CLASS} max-h-full max-w-full object-contain`}
          draggable={false}
        />
        <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
          {selected.prevId && (
            <button type="button" aria-label="Previous photo in sequence" disabled={navBusy}
              onClick={() => void navigate(selected.prevId, selected.prevCollection)} className={navBtn}>
              <ChevronLeft size={20} />
            </button>
          )}
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
          {selected.nextId && (
            <button type="button" aria-label="Next photo in sequence" disabled={navBusy}
              onClick={() => void navigate(selected.nextId, selected.nextCollection)} className={navBtn}>
              <ChevronRight size={20} />
            </button>
          )}
        </div>
      </div>

      {/* Credit bar — the licence attribution lives here, always visible. */}
      <div className="px-4 pb-4 pt-3 font-mono text-white">
        <div className="text-[13px]">
          📷 Photo by <span className="font-semibold">{selected.contributor ?? 'unknown contributor'}</span>
          <span className="text-white/60"> · Panoramax</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/70">
          {captured && <span>Captured {captured}</span>}
          {facing && <span>Camera facing {facing}</span>}
          {selected.licenseLabel && (
            selected.licenseUrl
              ? <a href={selected.licenseUrl} target="_blank" rel="noreferrer" className="underline decoration-white/40 underline-offset-2 hover:text-white">Licence: {selected.licenseLabel}</a>
              : <span>Licence: {selected.licenseLabel}</span>
          )}
          <a href={selected.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline decoration-white/40 underline-offset-2 hover:text-white">
            View on Panoramax <ExternalLink size={11} />
          </a>
        </div>
      </div>
    </div>
  );
}
