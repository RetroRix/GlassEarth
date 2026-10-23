import { describe, it, expect } from 'vitest';
import {
  fetchMissouriCameras,
  mapStreamRecord,
  mapSnapshotRecord,
  type ModotStreamRecord,
  type ModotSnapshotRecord,
} from './missouri';

/** A verbatim row from /timconfig/feed/desktop/StreamingCams2.json (St. Louis). */
const streamSample: ModotStreamRecord = {
  location: '141 AT 21, MM 27.1',
  x: -90.424496,
  y: 38.4623,
  html: 'https://sfs02-traveler.modot.mo.gov/rtplive/MODOT_CAM_209/playlist.m3u8',
};

/** A verbatim camera from /map/js/snapshot.json (Poplar Bluff). */
const snapSample: ModotSnapshotRecord = {
  id: 1,
  caption: 'Bus-60 @ Bus-67 in Poplar Bluff',
  url: '/traffic_camera_snapshots/Bus-60@Bus-67_PoplarBluff/Bus-60@Bus-67_PoplarBluff.jpg',
  location: { x: -90.407624, y: 36.758538 },
};

describe('mapStreamRecord', () => {
  it('maps a streaming camera, taking its id from the playlist token', () => {
    expect(mapStreamRecord(streamSample)).toEqual({
      id: 'modot-modot-cam-209',
      lat: 38.4623,
      lng: -90.424496,
      name: '141 AT 21, MM 27.1',
      city: 'Missouri',
      country: 'US',
      stream_url: 'https://sfs02-traveler.modot.mo.gov/rtplive/MODOT_CAM_209/playlist.m3u8',
      stream_type: 'hls',
      source: 'MoDOT',
    });
  });

  it('maps the other two stream shapes the feed uses — KC Scout proxy and Ozarks Wowza', () => {
    expect(mapStreamRecord({
      location: 'I-29 NB At 64th St', x: -94.634608, y: 39.206444,
      html: 'https://traveler.modot.org/tisvc/api/Tms/CameraStream/M029NBC-07-LQ',
    })?.id).toBe('modot-m029nbc-07-lq');
    expect(mapStreamRecord({
      location: '7TH AND MO 249', x: -94.423841, y: 37.083421,
      html: 'https://s2.ozarkstrafficoneview.com/rtplive/CAM1045/playlist.m3u8',
    })?.id).toBe('modot-cam1045');
  });

  it('drops rows whose address is not a MoDOT stream, and out-of-state rows', () => {
    expect(mapStreamRecord({ ...streamSample, html: 'https://example.com/video.mp4' })).toBeNull();
    expect(mapStreamRecord({ ...streamSample, html: null })).toBeNull();
    // Deep in Kansas, west of the box the region is registered with.
    expect(mapStreamRecord({ ...streamSample, x: -96.73, y: 39.05 })).toBeNull();
  });
});

describe('mapSnapshotRecord', () => {
  it('maps a snapshot camera against the traveler host', () => {
    expect(mapSnapshotRecord(snapSample)).toEqual({
      id: 'modot-snap-1',
      lat: 36.758538,
      lng: -90.407624,
      name: 'Bus-60 @ Bus-67 in Poplar Bluff',
      city: 'Missouri',
      country: 'US',
      feed_url: 'https://traveler.modot.org/traffic_camera_snapshots/Bus-60@Bus-67_PoplarBluff/Bus-60@Bus-67_PoplarBluff.jpg',
      source: 'MoDOT',
    });
  });

  it('drops snapshot rows without an image path or usable coordinates', () => {
    expect(mapSnapshotRecord({ ...snapSample, url: null })).toBeNull();
    expect(mapSnapshotRecord({ ...snapSample, location: null })).toBeNull();
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits both real MoDOT feeds;
// traveler.modot.org intermittently bot-walls this network with 503s, so a
// transient failure here is the host, not the mapping).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchMissouriCameras (live)', () => {
  liveIt('returns both feeds, well-formed', async () => {
    const cams = await fetchMissouriCameras();
    expect(cams.length).toBeGreaterThan(850);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('MoDOT');
      expect(cam.lat).toBeGreaterThanOrEqual(36.0);
      expect(cam.lat).toBeLessThanOrEqual(40.6);
      expect(cam.lng).toBeGreaterThanOrEqual(-95.8);
      expect(cam.lng).toBeLessThanOrEqual(-89.1);
      if (cam.stream_url) {
        expect(cam.stream_type).toBe('hls');
        // Wowza rows end in .m3u8; KC Scout proxy rows end in the camera code.
        expect(cam.stream_url).toMatch(/\.m3u8$|CameraStream\/[A-Za-z0-9-]+$/);
      } else {
        expect(cam.feed_url).toContain('traveler.modot.org/traffic_camera_snapshots/');
      }
    }
  }, 60_000);
});
