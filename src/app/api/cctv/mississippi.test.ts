import { describe, it, expect } from 'vitest';
import {
  fetchMississippiCameras,
  parseSiteViews,
  hlsUrlFor,
  mapCamera,
  type MdotSite,
  type MdotView,
} from './mississippi';

/** A verbatim site marker from default.aspx/LoadCameraData (Jackson, I-55). */
const site: MdotSite = {
  markerid: 'camsite_1',
  tooltip: 'I-55 at Lakeland Dr',
  lat: 32.33378,
  lon: -90.16269,
};

/** A verbatim view call from mapbubbles/camerasite.aspx?site=1. */
const view: MdotView = {
  thumbnailUrl: 'https://streamingjxn1.mdottraffic.com/thumbnail?application=rtplive&streamname=010406.stream&size=352x240&format=jpg&fitmode=stretch',
  streamId: '010406',
  label: 'I-55 N at Lakeland Dr PTZ',
};

describe('parseSiteViews', () => {
  it('reads the switcher calls out of a site page, de-duplicated by stream', () => {
    const html = [
      `onclick="switchcam('https://streamingjxn1.mdottraffic.com/thumbnail?application=rtplive&streamname=010406.stream&size=352x240&format=jpg&fitmode=stretch', '010406', 'I-55 N at Lakeland Dr PTZ','', this, false)"`,
      `onclick="switchcam('https://streamingjxn2.mdottraffic.com/thumbnail?application=rtplive&streamname=010501.stream&size=352x240&format=jpg&fitmode=stretch', '010501', 'I-55 S at Lakeland Dr PTZ','', this, false)"`,
      // The page repeats the first view as its default — it must not land twice.
      `onclick="switchcam('https://streamingjxn1.mdottraffic.com/thumbnail?application=rtplive&streamname=010406.stream&size=352x240&format=jpg&fitmode=stretch', '010406', 'I-55 N at Lakeland Dr PTZ','', this, false)"`,
    ].join('\n');
    expect(parseSiteViews(html)).toEqual([
      view,
      {
        thumbnailUrl: 'https://streamingjxn2.mdottraffic.com/thumbnail?application=rtplive&streamname=010501.stream&size=352x240&format=jpg&fitmode=stretch',
        streamId: '010501',
        label: 'I-55 S at Lakeland Dr PTZ',
      },
    ]);
  });

  it('finds nothing in a page with no camera calls', () => {
    expect(parseSiteViews('<html><body>no cameras</body></html>')).toEqual([]);
  });
});

describe('hlsUrlFor', () => {
  it('derives the playlist on the same Wowza host from the streamname', () => {
    expect(hlsUrlFor(view.thumbnailUrl)).toBe('https://streamingjxn1.mdottraffic.com/rtplive/010406.stream/playlist.m3u8');
    expect(hlsUrlFor('https://streaminglym4.mdottraffic.com/thumbnail?application=rtplive&streamname=D6-0024.stream&size=352x240&format=jpg&fitmode=stretch'))
      .toBe('https://streaminglym4.mdottraffic.com/rtplive/D6-0024.stream/playlist.m3u8');
  });

  it('refuses addresses that are not MDOT streaming thumbnails', () => {
    expect(hlsUrlFor('https://example.com/thumbnail?streamname=x.stream')).toBeNull();
    expect(hlsUrlFor('not a url')).toBeNull();
  });
});

describe('mapCamera', () => {
  it('maps a site view with thumbnail and derived HLS', () => {
    expect(mapCamera(site, view)).toEqual({
      id: 'mdot-010406',
      lat: 32.33378,
      lng: -90.16269,
      name: 'I-55 N at Lakeland Dr PTZ',
      city: 'Mississippi',
      country: 'US',
      feed_url: view.thumbnailUrl,
      stream_url: 'https://streamingjxn1.mdottraffic.com/rtplive/010406.stream/playlist.m3u8',
      stream_type: 'hls',
      source: 'MDOT',
    });
  });

  it('drops sites outside Mississippi', () => {
    // Memphis — over the Tennessee line, so not ours to draw.
    expect(mapCamera({ ...site, lat: 35.1495, lon: -90.049 }, view)).toBeNull();
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (pages all 458 real MDOT sites; slow).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchMississippiCameras (live)', () => {
  liveIt('pages every site and returns well-formed cameras', async () => {
    const cams = await fetchMississippiCameras();
    expect(cams.length).toBeGreaterThan(800);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.id).toMatch(/^mdot-/);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('MDOT');
      expect(cam.lat).toBeGreaterThanOrEqual(30.1);
      expect(cam.lat).toBeLessThanOrEqual(35.0);
      expect(cam.lng).toBeGreaterThanOrEqual(-91.7);
      expect(cam.lng).toBeLessThanOrEqual(-88.1);
      expect(cam.feed_url).toContain('.mdottraffic.com/thumbnail?');
      expect(cam.stream_type).toBe('hls');
      expect(cam.stream_url).toMatch(/\/rtplive\/.+\.stream\/playlist\.m3u8$/);
    }
  }, 300_000);
});
