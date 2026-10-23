import { describe, it, expect } from 'vitest';
import {
  cameraName,
  fetchWestVirginiaCameras,
  mapRecord,
  streamUrlFromPlayerPage,
  type WvCameraRecord,
} from './westvirginia';

/** A verbatim row from wv511.org/wsvc/gmap.asmx/buildCamerasJSONKeyedSerialized. */
const sample: WvCameraRecord = {
  origin: 'Camera-669fee457101b83b3088bf4c',
  md5: 'CAM117',
  title: 'I-81',
  description: '<div id="camDescription">[BER]I-81 @ 0.5<span style="float:right">West Virginia DOT</span></div><!--<div id="staticCamHolder"><p><img class="webmapcamimg" id="imgCAM117" src="/images/cam_unavailable.jpg?nocache=20261023160036" /></p></div>--><!--STREAMING:1--><div id="streamingCamHolder"></div>',
  start_lat: '39.302863',
  start_lng: '-78.078892',
  icon: 'icon_feed',
};

/** The playlist CAM117's own player page names (verified live). */
const STREAM = 'https://vtc1.roadsummary.com/rtplive/CAM117/playlist.m3u8';

describe('cameraName', () => {
  it('reads the label out of the description and strips the county code', () => {
    expect(cameraName(sample)).toBe('I-81 @ 0.5');
    expect(cameraName({ ...sample, description: '<div id="camDescription">[CAB]I-64 @ 11 Hal Greer I/C<span style="float:right">West Virginia DOT</span></div>' }))
      .toBe('I-64 @ 11 Hal Greer I/C');
  });

  it('falls back to the route when there is no description label', () => {
    expect(cameraName({ ...sample, description: null })).toBe('I-81');
    expect(cameraName({ ...sample, description: null, title: null })).toBeNull();
  });
});

describe('streamUrlFromPlayerPage', () => {
  it('takes the playlist the player page loads for this camera', () => {
    const html = `<script>hls.loadSource("https://vtc1.roadsummary.com/rtplive/CAM117/playlist.m3u8");</script>`;
    expect(streamUrlFromPlayerPage(html, 'CAM117')).toBe(STREAM);
  });

  it('does not take another camera’s playlist, or a page with none', () => {
    const other = `<script>hls.loadSource("https://vtc3.roadsummary.com/rtplive/CAM027/playlist.m3u8");</script>`;
    expect(streamUrlFromPlayerPage(other, 'CAM117')).toBeNull();
    expect(streamUrlFromPlayerPage('<html>no player</html>', 'CAM117')).toBeNull();
  });
});

describe('mapRecord (West Virginia)', () => {
  it('maps a camera once its stream is resolved', () => {
    expect(mapRecord(sample, STREAM)).toEqual({
      id: 'wvdoh-CAM117',
      lat: 39.302863,
      lng: -78.078892,
      name: 'I-81 @ 0.5',
      city: 'West Virginia',
      country: 'US',
      stream_url: STREAM,
      stream_type: 'hls',
      external_url: 'https://wv511.org/flowplayeri.aspx?CAMID=CAM117',
      source: 'WVDOH',
    });
  });

  it('drops rows without a resolved stream — the index alone has no viewable feed', () => {
    expect(mapRecord(sample, null)).toBeNull();
    expect(mapRecord(sample)).toBeNull();
  });

  it('drops rows without usable coordinates, and any outside West Virginia', () => {
    expect(mapRecord({ ...sample, start_lat: '' }, STREAM)).toBeNull();
    expect(mapRecord({ ...sample, start_lat: null, start_lng: null }, STREAM)).toBeNull();
    expect(mapRecord({ ...sample, md5: '' }, STREAM)).toBeNull();
    // Columbus, OH — over the state line.
    expect(mapRecord({ ...sample, start_lat: '39.96', start_lng: '-83.0' }, STREAM)).toBeNull();
  });

  /* A real published row: CAM105 on WV-9 in Jefferson County, a few
     hundredths of a degree east of the -77.8 bounds line. */
  it('drops the Jefferson County row that falls east of the bounds line', () => {
    expect(mapRecord({ ...sample, md5: 'CAM105', start_lat: '39.262684', start_lng: '-77.764616' }, STREAM)).toBeNull();
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real WV511
// service, then every camera's player page; a cold load takes minutes).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchWestVirginiaCameras (live)', () => {
  liveIt('resolves the statewide index into streaming cameras', async () => {
    const cams = await fetchWestVirginiaCameras();
    expect(cams.length).toBeGreaterThan(100);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);

    for (const cam of cams) {
      expect(cam.id).toMatch(/^wvdoh-CAM\d+$/);
      expect(cam.country).toBe('US');
      expect(cam.source).toBe('WVDOH');
      expect(cam.lat).toBeGreaterThanOrEqual(37.2);
      expect(cam.lat).toBeLessThanOrEqual(40.6);
      expect(cam.lng).toBeGreaterThanOrEqual(-82.7);
      expect(cam.lng).toBeLessThanOrEqual(-77.8);
      expect(cam.stream_type).toBe('hls');
      expect(cam.stream_url).toMatch(/^https:\/\/[a-z0-9-]+\.roadsummary\.com\/rtplive\/CAM\d+\/playlist\.m3u8$/);
    }
  }, 300_000);
});
