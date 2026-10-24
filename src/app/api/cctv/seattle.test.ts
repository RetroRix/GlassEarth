import { describe, it, expect, vi } from 'vitest';
import { fetchSeattleCameras, mapSeattleCamera, isLivePlaylist, type SeattleRecord } from './seattle';

/** A verbatim row from the Traffic Cam Photobooth sea_server.json list. */
const sample: SeattleRecord = {
  name: 'Fauntleroy Way SW & SW Cloverdale St',
  liveCameraUrl: 'https://61e0c5d388c2e.streamlock.net:443/live/Fauntleroy_SW_Cloverdale_NS.stream/playlist.m3u8',
  stillCameraUrl: null,
  latitude: 47.526783365445,
  longitude: -122.392755787503,
};

describe('mapSeattleCamera', () => {
  it('maps a Seattle camera to its Wowza HLS stream, with no snapshot to fall back to', () => {
    expect(mapSeattleCamera('CMR-0112', sample)).toEqual({
      id: 'seattle-CMR-0112',
      lat: 47.526783365445,
      lng: -122.392755787503,
      name: 'Fauntleroy Way SW & SW Cloverdale St',
      city: 'Seattle',
      country: 'US',
      source: 'SDOT',
      stream_url: sample.liveCameraUrl,
      stream_type: 'hls',
    });
  });

  it('keeps a real still URL when the list has one, and never points feed_url at the playlist', () => {
    const withStill = mapSeattleCamera('CMR-9', {
      ...sample,
      stillCameraUrl: 'https://example.com/still.jpg',
    });
    expect(withStill?.feed_url).toBe('https://example.com/still.jpg');
    expect(mapSeattleCamera('CMR-9', sample)?.feed_url).toBeUndefined();
  });

  it('drops unplaceable or stream-less rows', () => {
    expect(mapSeattleCamera('CMR-9', { ...sample, latitude: '' })).toBeNull();
    expect(mapSeattleCamera('CMR-9', { ...sample, liveCameraUrl: 'https://example.com/cam.mp4' })).toBeNull();
    expect(mapSeattleCamera('CMR-9', { ...sample, liveCameraUrl: '' })).toBeNull();
  });
});

describe('isLivePlaylist', () => {
  const okFetch = vi.fn(async () => new Response('#EXTM3U\n#EXT-X-VERSION:3\n'));
  const notFoundFetch = vi.fn(async () => new Response('Not found', { status: 404 }));
  const notHlsFetch = vi.fn(async () => new Response('<html>nope</html>'));

  it('accepts a 200 with a real playlist body', async () => {
    await expect(isLivePlaylist('https://x/live.m3u8', okFetch as never)).resolves.toBe(true);
  });

  it('rejects a 404 and a 200 that is not a playlist', async () => {
    await expect(isLivePlaylist('https://x/dead.m3u8', notFoundFetch as never)).resolves.toBe(false);
    await expect(isLivePlaylist('https://x/dead.m3u8', notHlsFetch as never)).resolves.toBe(false);
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real list + Wowza edge).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchSeattleCameras (live)', () => {
  liveIt('wires only the playlists that actually resolve', async () => {
    const cams = await fetchSeattleCameras();
    expect(cams.length).toBeGreaterThan(50);
    expect(cams.every(c => c.source === 'SDOT' && c.stream_type === 'hls' && c.stream_url)).toBe(true);
  }, 120000);
});
