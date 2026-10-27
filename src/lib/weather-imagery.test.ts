import { describe, expect, it } from 'vitest';
import {
  capFrames, framesAt, halfHourTicks, nearestFrame, parseWmsTimes, unionTimeline, wmsTileUrl, WX_SOURCES,
} from './weather-imagery';

const CAPS = `<?xml version="1.0"?>
<WMS_Capabilities version="1.3.0"><Capability><Layer>
  <Name>weather_radar</Name>
  <Layer><Name>other_layer</Name>
    <Dimension name="time" units="ISO8601">2020-01-01T00:00:00.000Z</Dimension>
  </Layer>
  <Layer><Name>base_reflectivity_mosaic</Name>
    <Dimension name="time" units="ISO8601">2026-10-27T05:08:00.000Z,2026-10-27T05:04:00.000Z, 2026-10-27T05:12:00.000Z ,2026-10-27T05:08:00.000Z,not-a-time</Dimension>
  </Layer>
</Layer></Capability></WMS_Capabilities>`;

describe('parseWmsTimes', () => {
  it('reads the named layer’s time dimension, sorted and deduped', () => {
    expect(parseWmsTimes(CAPS, 'base_reflectivity_mosaic')).toEqual([
      Date.parse('2026-10-27T05:04:00.000Z'),
      Date.parse('2026-10-27T05:08:00.000Z'),
      Date.parse('2026-10-27T05:12:00.000Z'),
    ]);
  });
  it('does not read another layer’s dimension', () => {
    expect(parseWmsTimes(CAPS, 'other_layer')).toEqual([Date.parse('2020-01-01T00:00:00.000Z')]);
  });
  it('returns nothing for a missing layer or a layer with no time dimension', () => {
    expect(parseWmsTimes(CAPS, 'nope')).toEqual([]);
    expect(parseWmsTimes('<Layer><Name>x</Name></Layer>', 'x')).toEqual([]);
  });
});

describe('nearestFrame', () => {
  const times = [0, 10, 20, 30];
  it('picks the closest published frame', () => {
    expect(nearestFrame(times, 12)).toBe(10);
    expect(nearestFrame(times, 18)).toBe(20);
    expect(nearestFrame(times, 20)).toBe(20);
  });
  it('holds the first frame before the run and the last after it', () => {
    expect(nearestFrame(times, -500)).toBe(0);
    expect(nearestFrame(times, 9999)).toBe(30);
  });
  it('breaks an exact tie towards the earlier frame', () => {
    expect(nearestFrame(times, 15)).toBe(10);
    expect(nearestFrame(times, 25)).toBe(20);
  });
  it('is null when the source has published nothing', () => {
    expect(nearestFrame([], 10)).toBeNull();
  });
});

describe('unionTimeline + framesAt', () => {
  const frames = { radar: [0, 4, 8, 12], satellite: [0, 5, 10], lightning: [0, 15] };
  it('unions the active sources’ frame times, sorted', () => {
    expect(unionTimeline(frames, ['radar', 'satellite'])).toEqual([0, 4, 5, 8, 10, 12]);
    expect(unionTimeline(frames, ['lightning'])).toEqual([0, 15]);
    expect(unionTimeline(frames, [])).toEqual([]);
  });
  it('steps every source to its nearest frame at a union step', () => {
    // At the satellite step t=5 the radar holds its 4 frame and the
    // lightning (not yet started stepping) holds its 0 frame.
    expect(framesAt(frames, ['radar', 'satellite', 'lightning'], 5)).toEqual({ radar: 4, satellite: 5, lightning: 0 });
    expect(framesAt(frames, ['radar', 'satellite', 'lightning'], 12)).toEqual({ radar: 12, satellite: 10, lightning: 15 });
  });
  it('omits a source with no frames at all', () => {
    expect(framesAt({ radar: [0, 4] }, ['radar', 'lightning'], 2)).toEqual({ radar: 0 });
  });
});

describe('wmsTileUrl', () => {
  it('addresses the source’s WMS layer at the frame’s own instant', () => {
    const url = wmsTileUrl(WX_SOURCES.radar, Date.parse('2026-10-27T05:12:00.000Z'));
    expect(url).toContain('https://nowcoast.noaa.gov/geoserver/weather_radar/wms?');
    expect(url).toContain('layers=base_reflectivity_mosaic');
    expect(url).toContain('bbox={bbox-epsg-3857}');
    expect(url).toContain(`time=${encodeURIComponent('2026-10-27T05:12:00.000Z')}`);
    expect(url).toContain('crs=EPSG:3857');
    expect(url).toContain('transparent=true');
  });
});

describe('halfHourTicks', () => {
  it('marks local half hours strictly inside the range', () => {
    const first = new Date(2026, 9, 27, 5, 3).getTime();
    const last = new Date(2026, 9, 27, 6, 45).getTime();
    expect(halfHourTicks(first, last).map(t => new Date(t).getMinutes())).toEqual([30, 0, 30]);
  });
  it('is empty for a range with no half hour in it', () => {
    const first = new Date(2026, 9, 27, 5, 3).getTime();
    expect(halfHourTicks(first, first + 10 * 60_000)).toEqual([]);
  });
});

describe('capFrames', () => {
  it('keeps the newest frames', () => {
    expect(capFrames([1, 2, 3, 4], 2)).toEqual([3, 4]);
    expect(capFrames([1, 2], 5)).toEqual([1, 2]);
  });
});
