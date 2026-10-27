/**
 * Glass Earth — SIMULATED traffic on the map (see lib/traffic-sim for the
 * honesty rule this layer lives under: these vehicles are invented, the
 * layer is named "Traffic (Simulated)", and every status line it reports
 * says it is not live traffic data).
 *
 * Attached while the layer is on, and it owns everything it draws, the
 * way the transit layer does:
 *
 *   - the roads come from the basemap itself — the CARTO GL styles
 *     (dark-matter / Positron) carry a vector source whose `roads`
 *     source-layer (Protomaps schema; the older OpenMapTiles
 *     `transportation` is tried as a fallback for other styles) is
 *     already downloaded to draw the streets. Reading it with
 *     querySourceFeatures costs no new requests and works under the
 *     satellite overlay too (the vector source stays loaded; only
 *     its paint is covered). Directions' routers (Valhalla/OSRM)
 *     answer point-to-point routes only — neither offers viewport
 *     road geometry — so the tiles are the one honest source of
 *     roads here. (Schema verified against the live styles and tiles,
 *     2026-10-27: an earlier draft of this layer assumed OpenMapTiles
 *     naming throughout and would have found no roads at all.)
 *   - agents are rebuilt when the view settles (the house 350 ms
 *     settle), step at up to 30 fps while the tab is visible, and stop
 *     with the layer or the tab.
 *   - below street zoom the layer draws nothing and the panel line
 *     explains the gate, rather than a silent empty map.
 *
 * The vehicles are map content (a GeoJSON source on the map), so the
 * sensor looks treat them like any other picture surface; the panel
 * chrome that names them is never filtered.
 */
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import {
  TRAFFIC_SIM_MIN_ZOOM, TRAFFIC_SIM_SETTLE_MS,
  buildRoadGraph, mulberry32, positionOnSegment, spawnAgents, stepAgents,
  targetAgentCount, type RawRoadFeature, type RoadGraph, type TrafficAgent,
} from './traffic-sim';

export type TrafficSimState = 'zoom' | 'ready' | 'empty' | 'unavailable';
export interface TrafficSimStatus {
  state: TrafficSimState;
  /** One line for the layer panel. Always carries the not-live-data disclaimer. */
  text: string;
}
export interface TrafficSimLayerOptions {
  onStatus?: (status: TrafficSimStatus) => void;
}

const SRC = 'traffic-sim';
const LAYER_HALO = 'traffic-sim-halo';
const LAYER_DOTS = 'traffic-sim-dots';
export const TRAFFIC_SIM_LAYER_IDS = [LAYER_HALO, LAYER_DOTS];

/** The one colour the vehicles wear — an ice blue, chosen because no live-traffic product uses it for a flow state. */
export const TRAFFIC_SIM_COLOR = '#38BDF8';
/** Frames per second: enough that motion reads as driving, no more. */
const FPS = 30;
/** Roads may spill this far past the view's edge (agents on them drive in, not pop in). */
const BOUNDS_PAD = 0.12;

const EMPTY = { type: 'FeatureCollection' as const, features: [] as never[] };
const count = (n: number) => n.toLocaleString('en-US');

export function attachTrafficSim(map: MlMap, opts: TrafficSimLayerOptions): () => void {
  let disposed = false;
  let graph: RoadGraph | null = null;
  let agents: TrafficAgent[] = [];
  let roadSourceId: string | null = null;
  let settle: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let frame: number | undefined;
  let lastFrameAt = 0;
  let lastStatus = '';
  const rng = mulberry32((Date.now() & 0xffff) ^ 0x5eed);

  const hidden = () => typeof document !== 'undefined' && document.hidden;
  const report = (state: TrafficSimState, text: string) => {
    if (disposed || `${state}|${text}` === lastStatus) return;
    lastStatus = `${state}|${text}`;
    opts.onStatus?.({ state, text });
  };
  const source = () => map.getSource(SRC) as GeoJSONSource | undefined;

  // ── Sources and layers ──
  try {
    map.addSource(SRC, { type: 'geojson', data: EMPTY });
    map.addLayer({
      id: LAYER_HALO, type: 'circle', source: SRC, minzoom: TRAFFIC_SIM_MIN_ZOOM,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], TRAFFIC_SIM_MIN_ZOOM, 6, 16, 11],
        'circle-color': TRAFFIC_SIM_COLOR, 'circle-opacity': 0.16, 'circle-blur': 0.7,
      },
    });
    map.addLayer({
      id: LAYER_DOTS, type: 'circle', source: SRC, minzoom: TRAFFIC_SIM_MIN_ZOOM,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], TRAFFIC_SIM_MIN_ZOOM, 2.4, 16, 4.4],
        'circle-color': TRAFFIC_SIM_COLOR, 'circle-opacity': 0.92,
        'circle-stroke-color': '#04202F', 'circle-stroke-width': 1, 'circle-stroke-opacity': 0.65,
      },
    });
  } catch (err) {
    console.warn('[OSIRIS] Simulated traffic could not start:', err);
    report('unavailable', 'Simulated traffic unavailable on this map · not live traffic data');
    return () => { /* nothing was attached */ };
  }

  /** The basemap's vector sources that could carry roads, best first: the one already proven, then any vector source. */
  const roadSourceCandidates = (): string[] => {
    const ids: string[] = [];
    try {
      const sources = (map.getStyle()?.sources ?? {}) as Record<string, { type?: string }>;
      for (const [id, s] of Object.entries(sources)) if (s?.type === 'vector') ids.push(id);
    } catch { /* style not ready: no candidates this round */ }
    if (roadSourceId && ids.includes(roadSourceId)) {
      ids.splice(ids.indexOf(roadSourceId), 1);
      ids.unshift(roadSourceId);
    }
    return ids;
  };

  /** Road features for the current view from the basemap tiles, or null when no source answers yet. */
  const readRoads = (): RawRoadFeature[] | null => {
    for (const id of roadSourceCandidates()) {
      // CARTO's current styles name the layer 'roads' (Protomaps schema);
      // OpenMapTiles styles call it 'transportation'. First hit wins.
      for (const sourceLayer of ['roads', 'transportation']) {
        try {
          const feats = map.querySourceFeatures(id, { sourceLayer });
          if (feats.length) {
            roadSourceId = id;
            return feats as unknown as RawRoadFeature[];
          }
        } catch { /* that source has no such layer: try the next */ }
      }
    }
    return null;
  };

  /** Does a segment touch the (padded) view? Agents belong to the streets on screen. */
  const segmentInView = (seg: RoadGraph['segments'][number]) => {
    const b = map.getBounds();
    const padLng = (b.getEast() - b.getWest()) * BOUNDS_PAD;
    const padLat = (b.getNorth() - b.getSouth()) * BOUNDS_PAD;
    const w = b.getWest() - padLng, e = b.getEast() + padLng, s = b.getSouth() - padLat, n = b.getNorth() + padLat;
    return seg.points.some(p => p[0] >= w && p[0] <= e && p[1] >= s && p[1] <= n);
  };

  const draw = () => {
    const src = source();
    if (!src || !graph) return;
    if (!agents.length) { src.setData(EMPTY); return; }
    const features = agents.map(a => {
      const seg = graph!.segments[a.seg];
      const pos = positionOnSegment(seg, a.distM, a.dir);
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [pos.lng, pos.lat] },
        properties: {},
      };
    });
    src.setData({ type: 'FeatureCollection', features });
  };

  // ── Animation ──
  const tick = (now: number) => {
    frame = undefined;
    if (disposed || hidden()) return;
    if (graph && agents.length && map.getZoom() >= TRAFFIC_SIM_MIN_ZOOM && now - lastFrameAt >= 1000 / FPS) {
      const dt = Math.min(0.1, Math.max(0.001, (now - lastFrameAt) / 1000 || 0.016));
      lastFrameAt = now;
      try {
        stepAgents(graph, agents, dt, rng);
        draw();
      } catch { /* a bad frame drops the vehicles, never the map */ }
    }
    frame = requestAnimationFrame(tick);
  };
  const startFrames = () => { if (frame === undefined && !disposed) frame = requestAnimationFrame(tick); };

  // ── Rebuilding the view's roads and vehicles ──
  const rebuild = () => {
    if (disposed || hidden()) return;
    try {
      if (map.getZoom() < TRAFFIC_SIM_MIN_ZOOM) {
        graph = null;
        agents = [];
        source()?.setData(EMPTY);
        report('zoom', `Simulated vehicles · zoom in to street level (${TRAFFIC_SIM_MIN_ZOOM}+) · not live traffic data`);
        return;
      }
      const raw = readRoads();
      if (!raw) {
        // Tiles for this view have not landed yet; the sourcedata hook retries.
        graph = null;
        agents = [];
        source()?.setData(EMPTY);
        report('empty', `Simulated vehicles · roads still loading · not live traffic data`);
        return;
      }
      const full = buildRoadGraph(raw);
      // The tiles cover more than the view; keep the segments that touch
      // it and remap the junction index onto the survivors, so agents
      // only ever ride — and turn within — the kept network.
      const keepIdx: number[] = [];
      full.segments.forEach((s, i) => { if (segmentInView(s)) keepIdx.push(i); });
      const remap = new Map(keepIdx.map((old, i) => [old, i] as [number, number]));
      const nodes = new Map<string, { seg: number; vertex: number }[]>();
      for (const [key, refs] of full.nodes) {
        const kept = refs.filter(r => remap.has(r.seg)).map(r => ({ seg: remap.get(r.seg)!, vertex: r.vertex }));
        if (kept.length) nodes.set(key, kept);
      }
      const segments = keepIdx.map(i => full.segments[i]);
      graph = { segments, nodes, totalWeight: segments.reduce((sum, s) => sum + s.weight, 0) };
      const target = targetAgentCount(graph);
      agents = spawnAgents(graph, target, rng);
      draw();
      startFrames();
      if (!agents.length) report('empty', `Simulated vehicles · no roads in this view · not live traffic data`);
      else report('ready', `${count(agents.length)} simulated vehicles · not live traffic data`);
    } catch (err) {
      console.warn('[OSIRIS] Simulated traffic rebuild failed:', err);
      graph = null;
      agents = [];
      try { source()?.setData(EMPTY); } catch { /* map going away */ }
      report('unavailable', 'Simulated traffic unavailable here · not live traffic data');
    }
  };

  const scheduleRebuild = () => {
    clearTimeout(settle);
    settle = setTimeout(rebuild, TRAFFIC_SIM_SETTLE_MS);
  };
  const onMoveEnd = () => scheduleRebuild();
  const onSourceData = () => {
    // Roads missing at street zoom usually means the tiles are still
    // arriving; retry shortly after data lands until the graph fills.
    if (disposed || graph?.segments.length || map.getZoom() < TRAFFIC_SIM_MIN_ZOOM) return;
    clearTimeout(retry);
    retry = setTimeout(rebuild, 250);
  };
  const onVisibility = () => { if (!hidden()) { rebuild(); startFrames(); } };

  map.on('moveend', onMoveEnd);
  map.on('sourcedata', onSourceData);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  rebuild();

  return () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(settle);
    clearTimeout(retry);
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    map.off('moveend', onMoveEnd);
    map.off('sourcedata', onSourceData);
    // The style may already be gone when the whole map is being torn down.
    try {
      for (const id of TRAFFIC_SIM_LAYER_IDS) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(SRC)) map.removeSource(SRC);
    } catch { /* map removed */ }
  };
}
