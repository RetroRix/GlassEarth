/**
 * Glass Earth — SIMULATED traffic. Read this before touching it:
 *
 * These vehicles are NOT live traffic data. Nothing here comes from a
 * probe, a sensor or a traffic feed — there is no traffic feed in this
 * app. The vehicles are invented agents that flow along the real road
 * lines of the basemap in the current view, at speeds plausible for each
 * road's class. It is ambience — the God's Eye View form — a way to make
 * a street-level map feel alive, in the same family as the wind
 * particles. The honesty rule for this feature is absolute:
 *
 *   - the layer is named "Traffic (Simulated)" in the panel;
 *   - every status line the layer reports carries the disclaimer below;
 *   - the vehicles are one neutral colour, never the red/amber/green of
 *     live-congestion products, and nothing counts, rates or colours
 *     "congestion" — there is no congestion here to measure.
 *
 * If a real flow source ever arrives (TomTom or similar, keyed — none
 * exists today), it must be a separate layer with its own name; this
 * simulation never feeds, merges with or stands in for real data.
 *
 * Everything in this file is pure: road-graph building, agent spawning
 * and movement math. Reading the basemap's tiles and drawing the agents
 * is traffic-sim-layer's job.
 */

/** The disclaimer, verbatim, wherever the layer describes itself. */
export const TRAFFIC_SIM_DISCLAIMER = 'Simulated vehicles for visualisation — not live traffic data';

/**
 * The zoom the layer wakes at. Below it the tiles do not yet carry the
 * minor roads and the view is too wide for street ambience to read;
 * the panel line says so rather than drawing nothing in silence.
 */
export const TRAFFIC_SIM_MIN_ZOOM = 12;

/**
 * Hard cap on live agents. A street-level view can carry thousands of
 * road segments; the cap keeps the per-frame GeoJSON refresh and the
 * step math trivially cheap on a phone. Density still scales with the
 * roads (see targetAgentCount) — the cap only bites in the densest
 * downtown views.
 */
export const TRAFFIC_SIM_MAX_AGENTS = 320;

/** How long the map must sit still after a move before the roads are re-read — the house settle window (camera ghosting, transit). */
export const TRAFFIC_SIM_SETTLE_MS = 350;

/** Weighted road-metres per agent: one vehicle per 4 km of class-weighted road. */
const WEIGHTED_M_PER_AGENT = 4000;

/** The road classes a car belongs on, keyed to the OSM highway values both basemap vocabularies carry. */
export const DRIVABLE_CLASSES = [
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
  'minor', 'unclassified', 'residential', 'living_street', 'service',
] as const;
export type DrivableClass = (typeof DRIVABLE_CLASSES)[number];
const DRIVABLE = new Set<string>(DRIVABLE_CLASSES);

/** Cruise speed per class, metres/second — the posted-limit shape of each road, not a measurement. */
export const CLASS_SPEED_MPS: Record<DrivableClass, number> = {
  motorway: 26.8,     // ~96 km/h
  trunk: 22.2,        // ~80 km/h
  primary: 15.6,      // ~56 km/h
  secondary: 12.5,    // ~45 km/h
  tertiary: 11.1,     // ~40 km/h
  minor: 9.7,         // ~35 km/h
  unclassified: 9.7,
  residential: 8.3,   // ~30 km/h
  living_street: 5.6, // ~20 km/h
  service: 4.2,       // ~15 km/h
};

/**
 * How thickly each class carries agents. Motorways are the planet's
 * visible arteries, service lanes are near-empty; the weighting is what
 * makes the density read as "traffic-like" without measuring anything.
 */
export const CLASS_WEIGHT: Record<DrivableClass, number> = {
  motorway: 10, trunk: 8, primary: 6, secondary: 4, tertiary: 3,
  minor: 2, unclassified: 2, residential: 1.5, living_street: 1, service: 0.6,
};

/**
 * Which drivable class a basemap feature is, or null when it is not a
 * road a car belongs on. Two vocabularies occur in the wild:
 *
 *   - Protomaps — CARTO's current GL styles (dark-matter and Positron
 *     both): the `roads` source-layer carries `kind_detail`, the OSM
 *     highway tag itself (motorway, primary, residential, …; ramps get
 *     the `_link` suffix and take their parent road's class), with the
 *     coarser `kind` (highway, major_road, medium_road, minor_road,
 *     path) behind it. Verified against live tiles over El Paso,
 *     2026-10-27: there is NO one-way field in this schema — direction
 *     is unknown there, and the consistent-direction rule applies.
 *   - OpenMapTiles — the older CARTO styles and other OMT sources:
 *     `class` on the `transportation` source-layer, same highway values.
 *
 * Anything else — paths, steps, cycleways, footways, in either
 * vocabulary — is not a car road and resolves to null.
 */
const KIND_DETAIL_CLASS: Record<string, DrivableClass> = {
  motorway: 'motorway', motorway_link: 'motorway',
  trunk: 'trunk', trunk_link: 'trunk',
  primary: 'primary', primary_link: 'primary',
  secondary: 'secondary', secondary_link: 'secondary',
  tertiary: 'tertiary', tertiary_link: 'tertiary',
  unclassified: 'unclassified', residential: 'residential',
  living_street: 'living_street', service: 'service',
  road: 'unclassified',
};
const KIND_CLASS: Record<string, DrivableClass> = {
  highway: 'trunk', major_road: 'primary', medium_road: 'tertiary', minor_road: 'minor',
};
export function roadClassOf(properties: Record<string, unknown> | null | undefined): DrivableClass | null {
  if (!properties) return null;
  const omt = properties.class;
  if (typeof omt === 'string' && DRIVABLE.has(omt)) return omt as DrivableClass;
  const detail = properties.kind_detail;
  if (typeof detail === 'string' && detail in KIND_DETAIL_CLASS) return KIND_DETAIL_CLASS[detail];
  const kind = properties.kind;
  if (typeof kind === 'string' && kind in KIND_CLASS) return KIND_CLASS[kind];
  return null;
}

/** A road feature as the basemap tiles hand it over (GeoJSON-shaped). */
export interface RawRoadFeature {
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: Record<string, unknown> | null;
}

/** One drivable stretch of road: a polyline with its length worked out. */
export interface RoadSegment {
  /** [lng, lat] vertices in the feature's own order. */
  points: [number, number][];
  /** Cumulative metres at each vertex; cum[0] = 0, last = lengthM. */
  cum: number[];
  lengthM: number;
  cls: DrivableClass;
  /** 1: travel only in vertex order; -1: only against it; 0: both ways. */
  oneway: -1 | 0 | 1;
  speedMps: number;
  /** Spawn weight: class weight × length. */
  weight: number;
}

/** Where a segment passes a point other segments can meet it: its index, and which vertex. */
export interface NodeRef { seg: number; vertex: number }

export interface RoadGraph {
  segments: RoadSegment[];
  /** Junction key → the segment ends that meet there. */
  nodes: Map<string, NodeRef[]>;
  totalWeight: number;
}

/** A simulated vehicle: where it is on its road, which way, how fast. */
export interface TrafficAgent {
  seg: number;
  /** Metres along the segment, in vertex order, whatever the travel direction. */
  distM: number;
  /** Travel direction in vertex order. */
  dir: 1 | -1;
  speedMps: number;
}

const EARTH_R_M = 6_371_000;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres between two [lng, lat] points. */
export function haversineM(a: [number, number], b: [number, number]): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing in degrees (0 = north, 90 = east) from a to b. */
export function bearingDeg(a: [number, number], b: [number, number]): number {
  const dLng = toRad(b[0] - a[0]);
  const y = Math.sin(dLng) * Math.cos(toRad(b[1]));
  const x = Math.cos(toRad(a[1])) * Math.sin(toRad(b[1])) - Math.sin(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Smallest angle between two bearings, 0–180. */
export function turnAngleDeg(from: number, to: number): number {
  const d = Math.abs(((to - from) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/**
 * The junction key for a point. A metre of rounding: the same source
 * vertex arrives identically from every tile that carries it, while
 * genuinely distinct corners of a junction sit further apart than this.
 */
export function nodeKey(lng: number, lat: number): string {
  return `${lng.toFixed(5)},${lat.toFixed(5)}`;
}

/** OMT hands oneway over as 1/0, sometimes -1, occasionally a string or boolean. */
export function normalizeOneway(raw: unknown): -1 | 0 | 1 {
  if (raw === 1 || raw === '1' || raw === true) return 1;
  if (raw === -1 || raw === '-1') return -1;
  return 0;
}

const isCoord = (p: unknown): p is [number, number] =>
  Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/** The line parts of a road feature: one for a LineString, many for a MultiLineString, none otherwise. */
export function lineParts(feature: RawRoadFeature): [number, number][][] {
  const g = feature.geometry;
  if (!g || !Array.isArray(g.coordinates)) return [];
  if (g.type === 'LineString') return [g.coordinates.filter(isCoord)];
  if (g.type === 'MultiLineString') {
    return (g.coordinates as unknown[]).filter(Array.isArray).map(part => (part as unknown[]).filter(isCoord));
  }
  return [];
}

/**
 * Build the road graph for a view from raw basemap features. Footways,
 * cycleways, paths and the rest of the non-drivable classes are dropped
 * — cars do not belong on them, however the tiles classify them. Exact
 * duplicate lines (a road carried whole by two overlapping tiles) are
 * kept once; tile-clipped copies of one road join through the shared
 * junction keys, so agents flow across tile seams at real vertices.
 *
 * Every vertex is indexed as a potential junction, not just the ends:
 * in the source data two roads that cross share a vertex in the MIDDLE
 * of both lines, and an agent that could only turn at line ends would
 * sail through every crossroads it met.
 */
export function buildRoadGraph(features: readonly RawRoadFeature[]): RoadGraph {
  const segments: RoadSegment[] = [];
  const nodes = new Map<string, NodeRef[]>();
  const seen = new Set<string>();
  let totalWeight = 0;

  const addNode = (key: string, ref: NodeRef) => {
    const list = nodes.get(key);
    if (list) list.push(ref);
    else nodes.set(key, [ref]);
  };

  for (const feature of features) {
    const cls = roadClassOf(feature.properties);
    if (!cls) continue;
    const oneway = normalizeOneway(feature.properties?.oneway ?? feature.properties?.one_way);
    for (const part of lineParts(feature)) {
      // Collapse consecutive duplicates (tile clipping leaves them).
      const points: [number, number][] = [];
      for (const p of part) {
        const last = points[points.length - 1];
        if (!last || last[0] !== p[0] || last[1] !== p[1]) points.push([p[0], p[1]]);
      }
      if (points.length < 2) continue;
      const dedupeKey = `${cls}|${points.map(p => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join(';')}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const cum = [0];
      for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + haversineM(points[i - 1], points[i]));
      const lengthM = cum[cum.length - 1];
      if (!(lengthM > 0)) continue;
      const idx = segments.length;
      const weight = CLASS_WEIGHT[cls as DrivableClass] * lengthM;
      segments.push({ points, cum, lengthM, cls: cls as DrivableClass, oneway, speedMps: CLASS_SPEED_MPS[cls as DrivableClass], weight });
      totalWeight += weight;
      points.forEach((p, vertex) => addNode(nodeKey(p[0], p[1]), { seg: idx, vertex }));
    }
  }
  return { segments, nodes, totalWeight };
}

/** How many agents this view's roads carry: scales with class-weighted length, capped, never negative. */
export function targetAgentCount(graph: RoadGraph): number {
  if (!graph.segments.length || graph.totalWeight <= 0) return 0;
  const scaled = Math.round(graph.totalWeight / WEIGHTED_M_PER_AGENT);
  return Math.max(1, Math.min(TRAFFIC_SIM_MAX_AGENTS, scaled));
}

/** A position and heading along a segment at a distance in vertex order, travelling `dir`. */
export function positionOnSegment(seg: RoadSegment, distM: number, dir: 1 | -1): { lng: number; lat: number; bearing: number } {
  const d = Math.max(0, Math.min(seg.lengthM, distM));
  let i = 1;
  while (i < seg.cum.length - 1 && seg.cum[i] < d) i++;
  const span = seg.cum[i] - seg.cum[i - 1];
  const t = span > 0 ? (d - seg.cum[i - 1]) / span : 0;
  const a = seg.points[i - 1], b = seg.points[i];
  const lng = a[0] + (b[0] - a[0]) * t;
  const lat = a[1] + (b[1] - a[1]) * t;
  const forward = bearingDeg(a, b);
  return { lng, lat, bearing: dir === 1 ? forward : (forward + 180) % 360 };
}

/** May an agent travel segment `seg` in direction `dir` (vertex order) under its one-way rule? */
export function canTravel(seg: RoadSegment, dir: 1 | -1): boolean {
  return seg.oneway === 0 || seg.oneway === dir;
}

/** The vertex an agent at distM travelling `dir` reaches next (its own vertex, if it sits on the terminal one). */
function nextVertex(seg: RoadSegment, distM: number, dir: 1 | -1): number {
  const { cum } = seg;
  if (dir === 1) {
    for (let i = 0; i < cum.length; i++) if (cum[i] > distM + 1e-6) return i;
    return cum.length - 1;
  }
  for (let i = cum.length - 1; i >= 0; i--) if (cum[i] < distM - 1e-6) return i;
  return 0;
}

/** Bearing of the edge of `seg` between vertices i and j. */
const edgeBearing = (seg: RoadSegment, i: number, j: number) => bearingDeg(seg.points[i], seg.points[j]);

/** Deterministic RNG for tests and for a stable first paint. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Place one agent on a fresh road, weighted toward the bigger classes. */
export function spawnAgent(graph: RoadGraph, rng: () => number): TrafficAgent | null {
  if (!graph.segments.length || graph.totalWeight <= 0) return null;
  let pick = rng() * graph.totalWeight;
  let seg = graph.segments[graph.segments.length - 1];
  for (const s of graph.segments) {
    pick -= s.weight;
    if (pick <= 0) { seg = s; break; }
  }
  const idx = graph.segments.indexOf(seg);
  const dir = (seg.oneway !== 0 ? seg.oneway : rng() < 0.5 ? 1 : -1) as 1 | -1;
  return {
    seg: idx,
    distM: rng() * seg.lengthM,
    dir,
    // Each driver its own pace around the class speed.
    speedMps: seg.speedMps * (0.85 + rng() * 0.3),
  };
}

export function spawnAgents(graph: RoadGraph, count: number, rng: () => number): TrafficAgent[] {
  const agents: TrafficAgent[] = [];
  for (let i = 0; i < count; i++) {
    const a = spawnAgent(graph, rng);
    if (a) agents.push(a);
  }
  return agents;
}

/**
 * Move every agent forward by dtSeconds of travel. At every junction
 * vertex — any point where another road meets this one, mid-line as
 * often as at an end — the agent chooses: carry on, or turn onto a
 * connecting road, preferring the straightest legal continuation and
 * never travelling against a one-way. A two-way dead end turns it
 * around; an agent boxed in by one-way roads is quietly respawned
 * elsewhere in the view (from the street, it simply drove out of the
 * area). An agent's speed follows the road it is on: joining a
 * motorway speeds it up, a side street slows it down, each keeping
 * its own pace factor.
 */
export function stepAgents(graph: RoadGraph, agents: TrafficAgent[], dtSeconds: number, rng: () => number): void {
  if (!(dtSeconds > 0)) return;
  for (const agent of agents) {
    let remaining = agent.speedMps * dtSeconds;
    let hops = 0;
    while (remaining > 0 && hops++ < 16) {
      const seg = graph.segments[agent.seg];
      if (!seg) break;
      const n = seg.points.length;
      const v = nextVertex(seg, agent.distM, agent.dir);
      const toVertex = Math.abs(seg.cum[v] - agent.distM);
      if (remaining < toVertex) {
        agent.distM += agent.dir * remaining;
        remaining = 0;
        break;
      }
      // Arrive at vertex v and decide what happens there.
      remaining -= toVertex;
      agent.distM = seg.cum[v];
      const atEnd = (agent.dir === 1 && v === n - 1) || (agent.dir === -1 && v === 0);
      const refs = graph.nodes.get(nodeKey(seg.points[v][0], seg.points[v][1])) ?? [];
      const isJunction = refs.some(r => r.seg !== agent.seg);
      if (!isJunction && !atEnd) continue; // an ordinary bend in this road: carry on

      const arrival = agent.dir === 1 ? edgeBearing(seg, v - 1, v) : edgeBearing(seg, v + 1, v);
      type Option =
        | { kind: 'continue'; turn: number }
        | { kind: 'turn'; seg: number; vertex: number; dir: 1 | -1; turn: number };
      const options: Option[] = [];
      if (!atEnd) {
        const onward = agent.dir === 1 ? edgeBearing(seg, v, v + 1) : edgeBearing(seg, v, v - 1);
        options.push({ kind: 'continue', turn: turnAngleDeg(arrival, onward) });
      }
      for (const ref of refs) {
        if (ref.seg === agent.seg) continue;
        const next = graph.segments[ref.seg];
        const last = next.points.length - 1;
        for (const d of [1, -1] as const) {
          if (!canTravel(next, d)) continue;
          if (d === 1 && ref.vertex >= last) continue;   // nowhere ahead that way
          if (d === -1 && ref.vertex <= 0) continue;
          const entry = d === 1 ? edgeBearing(next, ref.vertex, ref.vertex + 1) : edgeBearing(next, ref.vertex, ref.vertex - 1);
          options.push({ kind: 'turn', seg: ref.seg, vertex: ref.vertex, dir: d, turn: turnAngleDeg(arrival, entry) });
        }
      }
      // Prefer continuing fairly straight; among near-straight options, chance picks.
      options.sort((a, b) => a.turn - b.turn);
      const near = options.filter(o => o.turn <= (options[0]?.turn ?? 0) + 45);
      const choice = near.length ? near[Math.min(near.length - 1, Math.floor(rng() * near.length))] : undefined;
      if (choice?.kind === 'turn') {
        const pace = agent.speedMps / seg.speedMps; // the driver's own factor carries across roads
        const next = graph.segments[choice.seg];
        agent.seg = choice.seg;
        agent.dir = choice.dir;
        agent.distM = next.cum[choice.vertex];
        agent.speedMps = next.speedMps * Math.max(0.7, Math.min(1.3, pace));
        continue;
      }
      if (choice?.kind === 'continue') continue;
      // No legal way onward.
      if (atEnd && seg.oneway === 0) {
        // A two-way dead end: turn around and head back.
        agent.dir = (agent.dir * -1) as 1 | -1;
        continue;
      }
      if (atEnd) {
        // Boxed in by one-way roads: start over somewhere in the view.
        const fresh = spawnAgent(graph, rng);
        if (fresh) Object.assign(agent, fresh);
      }
      break;
    }
    // Whatever the junctions did, the agent stays on its road.
    const seg = graph.segments[agent.seg];
    if (seg) agent.distM = Math.max(0, Math.min(seg.lengthM, agent.distM));
  }
}
