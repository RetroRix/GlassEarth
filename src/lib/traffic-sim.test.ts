import { describe, expect, it } from 'vitest';
import {
  TRAFFIC_SIM_DISCLAIMER, TRAFFIC_SIM_MAX_AGENTS, TRAFFIC_SIM_MIN_ZOOM,
  bearingDeg, buildRoadGraph, canTravel, haversineM, mulberry32,
  normalizeOneway, nodeKey, positionOnSegment, spawnAgents, stepAgents,
  targetAgentCount, turnAngleDeg, type RawRoadFeature, type RoadGraph,
} from './traffic-sim';

/** ~111 m of latitude per 0.001°, ~96 m of longitude at El Paso's latitude. Grid helpers keep fixtures readable. */
const line = (coords: [number, number][], props: Record<string, unknown> = { class: 'residential' }): RawRoadFeature => ({
  geometry: { type: 'LineString', coordinates: coords },
  properties: props,
});

/** A plus-shaped junction at (-106.4, 31.8): one east–west road, one north–south, sharing the centre vertex exactly. */
const cross = (ewProps: Record<string, unknown> = { class: 'primary' }, nsProps: Record<string, unknown> = { class: 'primary' }): RawRoadFeature[] => [
  line([[-106.402, 31.8], [-106.4, 31.8], [-106.398, 31.8]], ewProps),
  line([[-106.4, 31.798], [-106.4, 31.8], [-106.4, 31.802]], nsProps),
];

describe('geometry helpers', () => {
  it('haversine measures a known step', () => {
    // 0.001° of latitude is ~111.19 m anywhere on Earth.
    expect(haversineM([-106.4, 31.8], [-106.4, 31.801])).toBeCloseTo(111.19, 0);
    expect(haversineM([-106.4, 31.8], [-106.4, 31.8])).toBe(0);
  });

  it('bearing reads the compass', () => {
    expect(bearingDeg([0, 0], [0, 1])).toBeCloseTo(0, 5);      // north
    expect(bearingDeg([0, 0], [1, 0])).toBeCloseTo(90, 0);     // east
    expect(bearingDeg([0, 0], [0, -1])).toBeCloseTo(180, 5);   // south
    expect(bearingDeg([0, 0], [-1, 0])).toBeCloseTo(270, 0);   // west
  });

  it('turn angle is the small way round', () => {
    expect(turnAngleDeg(350, 10)).toBe(20);
    expect(turnAngleDeg(0, 180)).toBe(180);
    expect(turnAngleDeg(90, 90)).toBe(0);
  });

  it('node keys round to about a metre', () => {
    expect(nodeKey(-106.400001, 31.800001)).toBe(nodeKey(-106.4, 31.8));
    expect(nodeKey(-106.4001, 31.8)).not.toBe(nodeKey(-106.4, 31.8));
  });
});

describe('normalizeOneway', () => {
  it('reads every shape the tiles use', () => {
    expect(normalizeOneway(1)).toBe(1);
    expect(normalizeOneway('1')).toBe(1);
    expect(normalizeOneway(true)).toBe(1);
    expect(normalizeOneway(-1)).toBe(-1);
    expect(normalizeOneway('-1')).toBe(-1);
    expect(normalizeOneway(0)).toBe(0);
    expect(normalizeOneway(undefined)).toBe(0);
    expect(normalizeOneway(null)).toBe(0);
  });
});

describe('buildRoadGraph', () => {
  it('keeps drivable classes and drops the rest', () => {
    const g = buildRoadGraph([
      line([[-106.4, 31.8], [-106.399, 31.8]], { class: 'motorway' }),
      line([[-106.4, 31.8], [-106.399, 31.8]], { class: 'path' }),
      line([[-106.4, 31.8], [-106.399, 31.8]], { class: 'cycleway' }),
      line([[-106.4, 31.8], [-106.399, 31.8]], { class: 'footway' }),
      line([[-106.4, 31.8], [-106.399, 31.8]], { class: 'pedestrian' }),
      line([[-106.4, 31.8], [-106.399, 31.8]], { class: 'steps' }),
      line([[-106.4, 31.8], [-106.399, 31.8]], {}),
    ]);
    expect(g.segments).toHaveLength(1);
    expect(g.segments[0].cls).toBe('motorway');
  });

  it('computes lengths and cumulative distances', () => {
    const g = buildRoadGraph([line([[-106.4, 31.8], [-106.4, 31.801], [-106.4, 31.802]])]);
    const seg = g.segments[0];
    expect(seg.cum[0]).toBe(0);
    expect(seg.cum[1]).toBeCloseTo(111.19, 0);
    expect(seg.lengthM).toBeCloseTo(222.38, 0);
    expect(seg.lengthM).toBe(seg.cum[seg.cum.length - 1]);
  });

  it('splits MultiLineString features into parts', () => {
    const g = buildRoadGraph([{
      geometry: {
        type: 'MultiLineString',
        coordinates: [
          [[-106.4, 31.8], [-106.399, 31.8]],
          [[-106.398, 31.8], [-106.397, 31.8]],
        ],
      },
      properties: { class: 'secondary' },
    }]);
    expect(g.segments).toHaveLength(2);
  });

  it('joins segments that share an endpoint into one junction', () => {
    const g = buildRoadGraph(cross());
    const centre = nodeKey(-106.4, 31.8);
    const refs = g.nodes.get(centre) ?? [];
    expect(refs).toHaveLength(2);
    expect(new Set(refs.map(r => r.seg)).size).toBe(2);
  });

  it('dedupes a road carried whole by two tiles', () => {
    const f = line([[-106.4, 31.8], [-106.399, 31.801]], { class: 'tertiary' });
    const g = buildRoadGraph([f, f]);
    expect(g.segments).toHaveLength(1);
  });

  it('carries class speed and spawn weight', () => {
    const g = buildRoadGraph([line([[-106.4, 31.8], [-106.399, 31.8]], { class: 'motorway' })]);
    const seg = g.segments[0];
    expect(seg.speedMps).toBeCloseTo(26.8);
    expect(seg.weight).toBeCloseTo(10 * seg.lengthM);
    expect(g.totalWeight).toBe(seg.weight);
  });
});

describe('targetAgentCount', () => {
  it('is zero with no roads', () => {
    expect(targetAgentCount(buildRoadGraph([]))).toBe(0);
  });

  it('scales with weighted road length and caps', () => {
    // ~140 km of motorway in a straight line of ~0.95 km hops.
    const parts: RawRoadFeature[] = [];
    for (let i = 0; i < 150; i++) parts.push(line([[-106.4 + i * 0.01, 31.8], [-106.4 + (i + 1) * 0.01, 31.8]], { class: 'motorway' }));
    const g = buildRoadGraph(parts);
    expect(targetAgentCount(g)).toBe(TRAFFIC_SIM_MAX_AGENTS);
    const small = buildRoadGraph([line([[-106.4, 31.8], [-106.399, 31.8]], { class: 'motorway' })]);
    const n = targetAgentCount(small);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThan(TRAFFIC_SIM_MAX_AGENTS);
  });
});

describe('positionOnSegment', () => {
  it('interpolates and flips bearing with direction', () => {
    const g = buildRoadGraph([line([[-106.4, 31.8], [-106.4, 31.802]])]);
    const seg = g.segments[0];
    const mid = positionOnSegment(seg, seg.lengthM / 2, 1);
    expect(mid.lat).toBeCloseTo(31.801, 4);
    expect(mid.bearing).toBeCloseTo(0, 0); // north in vertex order
    expect(positionOnSegment(seg, seg.lengthM / 2, -1).bearing).toBeCloseTo(180, 0);
    const clamped = positionOnSegment(seg, seg.lengthM * 3, 1);
    expect(clamped.lat).toBeCloseTo(31.802, 6);
  });
});

describe('canTravel — one-way law', () => {
  it('allows travel only in the permitted direction', () => {
    const g = buildRoadGraph([
      line([[-106.4, 31.8], [-106.399, 31.8]], { class: 'primary', oneway: 1 }),
      line([[-106.4, 31.9], [-106.399, 31.9]], { class: 'primary', oneway: -1 }),
      line([[-106.4, 32.0], [-106.399, 32.0]], { class: 'primary' }),
    ]);
    const [fwd, rev, both] = g.segments;
    expect(canTravel(fwd, 1)).toBe(true);
    expect(canTravel(fwd, -1)).toBe(false);
    expect(canTravel(rev, 1)).toBe(false);
    expect(canTravel(rev, -1)).toBe(true);
    expect(canTravel(both, 1)).toBe(true);
    expect(canTravel(both, -1)).toBe(true);
  });
});

describe('spawnAgents', () => {
  it('is deterministic for a seed and stays on the roads', () => {
    const g = buildRoadGraph(cross());
    const a = spawnAgents(g, 20, mulberry32(7));
    const b = spawnAgents(g, 20, mulberry32(7));
    expect(a).toEqual(b);
    for (const agent of a) {
      const seg = g.segments[agent.seg];
      expect(agent.distM).toBeGreaterThanOrEqual(0);
      expect(agent.distM).toBeLessThanOrEqual(seg.lengthM);
      expect(agent.speedMps).toBeGreaterThan(seg.speedMps * 0.8);
      expect(agent.speedMps).toBeLessThan(seg.speedMps * 1.2);
    }
  });

  it('never spawns against a one-way', () => {
    const g = buildRoadGraph([line([[-106.4, 31.8], [-106.399, 31.8]], { class: 'primary', oneway: -1 })]);
    for (const agent of spawnAgents(g, 30, mulberry32(3))) expect(agent.dir).toBe(-1);
  });

  it('favours the heavier classes', () => {
    const g = buildRoadGraph([
      line([[-106.4, 31.8], [-106.39, 31.8]], { class: 'motorway' }),
      line([[-106.4, 31.9], [-106.39, 31.9]], { class: 'service' }),
    ]);
    const agents = spawnAgents(g, 200, mulberry32(11));
    const onMotorway = agents.filter(a => g.segments[a.seg].cls === 'motorway').length;
    // Equal lengths; weights 10 vs 0.6 — the motorway should take the overwhelming share.
    expect(onMotorway).toBeGreaterThan(150);
  });
});

describe('stepAgents', () => {
  const rng = () => mulberry32(42);

  it('advances an agent along its road by speed × time', () => {
    const g = buildRoadGraph([line([[-106.4, 31.8], [-106.4, 31.81]], { class: 'primary' })]);
    const agent = { seg: 0, distM: 100, dir: 1 as const, speedMps: 10 };
    stepAgents(g, [agent], 2, rng());
    expect(agent.distM).toBeCloseTo(120);
    expect(agent.seg).toBe(0);
  });

  it('flows through a junction onto the connecting road', () => {
    const g = buildRoadGraph(cross());
    // East–west is segment 0, running east from its midpoint junction at distM of the first leg.
    const ew = g.segments[0];
    const agent = { seg: 0, distM: ew.cum[1] - 5, dir: 1 as const, speedMps: ew.speedMps };
    stepAgents(g, [agent], 3, rng()); // ~47 m: crosses the junction
    const total = g.segments[agent.seg];
    const pos = positionOnSegment(total, agent.distM, agent.dir);
    // It must sit exactly on one of the two roads of the cross.
    const onEW = Math.abs(pos.lat - 31.8) < 1e-6;
    const onNS = Math.abs(pos.lng - -106.4) < 1e-6;
    expect(onEW || onNS).toBe(true);
    expect(pos.lng).toBeGreaterThan(-106.4); // it travelled east of the junction
  });

  it('turns onto the crossing road where its own road ends mid-line', () => {
    // A stem from the south ending at the middle vertex of the east–west road.
    const g = buildRoadGraph([
      line([[-106.402, 31.8], [-106.4, 31.8], [-106.398, 31.8]], { class: 'primary' }),
      line([[-106.4, 31.796], [-106.4, 31.8]], { class: 'secondary' }),
    ]);
    const stem = g.segments[1];
    const agent = { seg: 1, distM: stem.lengthM - 3, dir: 1 as const, speedMps: 12 };
    stepAgents(g, [agent], 2, rng()); // ~24 m: reaches the junction and must turn
    expect(agent.seg).toBe(0); // now on the east–west road
    const pos = positionOnSegment(g.segments[0], agent.distM, agent.dir);
    expect(Math.abs(pos.lat - 31.8)).toBeLessThan(1e-6);
  });

  it('turns around at a two-way dead end', () => {
    const g = buildRoadGraph([line([[-106.4, 31.8], [-106.399, 31.8]], { class: 'residential' })]);
    const seg = g.segments[0];
    const agent = { seg: 0, distM: seg.lengthM - 2, dir: 1 as const, speedMps: 10 };
    stepAgents(g, [agent], 1, rng()); // 8 m past the end, reflected
    expect(agent.dir).toBe(-1);
    expect(agent.distM).toBeLessThan(seg.lengthM);
    expect(agent.distM).toBeGreaterThan(seg.lengthM - 12);
  });

  it('never travels against a one-way, even at its end', () => {
    // A one-way street running east, joined at its east end by a road that
    // may only be entered westbound — a trap. The agent must not take it;
    // boxed in, it respawns on the one-way, still eastbound.
    const g: RoadGraph = buildRoadGraph([
      line([[-106.402, 31.8], [-106.4, 31.8]], { class: 'primary', oneway: 1 }),
      line([[-106.4, 31.8], [-106.4, 31.802]], { class: 'primary', oneway: -1 }),
    ]);
    const agent = { seg: 0, distM: g.segments[0].lengthM - 1, dir: 1 as const, speedMps: 15 };
    for (let i = 0; i < 20; i++) {
      stepAgents(g, [agent], 0.5, rng());
      const seg = g.segments[agent.seg];
      if (seg.oneway !== 0) expect(agent.dir).toBe(seg.oneway);
      expect(agent.distM).toBeGreaterThanOrEqual(0);
      expect(agent.distM).toBeLessThanOrEqual(seg.lengthM);
    }
  });

  it('keeps every agent on the graph over a long run', () => {
    const g = buildRoadGraph([
      ...cross({ class: 'primary' }, { class: 'secondary' }),
      line([[-106.398, 31.8], [-106.396, 31.802]], { class: 'residential', oneway: 1 }),
      line([[-106.4, 31.802], [-106.402, 31.804]], { class: 'tertiary' }),
    ]);
    const agents = spawnAgents(g, 40, mulberry32(9));
    const r = mulberry32(5);
    for (let i = 0; i < 600; i++) stepAgents(g, agents, 0.1, r);
    for (const agent of agents) {
      const seg = g.segments[agent.seg];
      expect(seg).toBeDefined();
      expect(agent.distM).toBeGreaterThanOrEqual(0);
      expect(agent.distM).toBeLessThanOrEqual(seg.lengthM + 1e-9);
      if (seg.oneway !== 0) expect(agent.dir).toBe(seg.oneway);
      const pos = positionOnSegment(seg, agent.distM, agent.dir);
      expect(Number.isFinite(pos.lng)).toBe(true);
      expect(Number.isFinite(pos.lat)).toBe(true);
    }
  });
});

describe('honesty constants', () => {
  it('the disclaimer says what the layer is', () => {
    expect(TRAFFIC_SIM_DISCLAIMER).toMatch(/Simulated/i);
    expect(TRAFFIC_SIM_DISCLAIMER).toMatch(/not live traffic data/i);
  });

  it('the gates are the documented ones', () => {
    expect(TRAFFIC_SIM_MIN_ZOOM).toBe(12);
    expect(TRAFFIC_SIM_MAX_AGENTS).toBe(320);
  });
});
