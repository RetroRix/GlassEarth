import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RADIO_FAVORITES_KEY, TV_FAVORITES_KEY, isMixedContent, loadRadioFavorites,
  loadTvFavorites, newsFirst, normalizeRadioStation, normalizeRadioStations,
  parseM3u, saveRadioFavorites, saveTvFavorites, type RadioStation, type TvChannel,
} from './stations';

afterEach(() => vi.unstubAllGlobals());

const M3U = `#EXTM3U
#EXTINF:-1 tvg-id="CNN.us@SD" tvg-logo="https://cdn.example/cnn.png" group-title="News",CNN (US)
https://cdn.example/cnn/index.m3u8
#EXTINF:-1 tvg-id="HBO.us@HD" tvg-logo="" group-title="Movies",HBO East
#EXTVLCOPT:http-referrer=https://www.example.com/
#EXTVLCOPT:http-user-agent=Mozilla/5.0
https://cdn.example/hbo/index.m3u8
#EXTINF:-1 tvg-id="AfterDark" group-title="Adult",After Dark TV
https://cdn.example/adult/index.m3u8
#EXTINF:-1 group-title="Sports",No ID Sports
https://cdn.example/sports.m3u8
#EXTINF:-1 tvg-id="CNN.us@SD" group-title="News",CNN duplicate entry
https://cdn.example/cnn/index.m3u8
`;

describe('parseM3u', () => {
  it('parses attributes, names and stream URLs', () => {
    const channels = parseM3u(M3U, { country: 'US' });
    const cnn = channels.find(c => c.name.startsWith('CNN'));
    expect(cnn).toMatchObject({
      id: 'CNN.us@SD', country: 'US', category: 'News',
      logo: 'https://cdn.example/cnn.png', url: 'https://cdn.example/cnn/index.m3u8',
    });
  });

  it('captures #EXTVLCOPT referrer and user-agent hints', () => {
    const hbo = parseM3u(M3U).find(c => c.name === 'HBO East');
    expect(hbo?.referer).toBe('https://www.example.com/');
    expect(hbo?.userAgent).toBe('Mozilla/5.0');
  });

  it('drops adult-group entries and dedupes by id', () => {
    const channels = parseM3u(M3U);
    expect(channels.some(c => /after dark/i.test(c.name))).toBe(false);
    expect(channels.filter(c => c.id === 'CNN.us@SD')).toHaveLength(1);
  });

  it('synthesizes an id when tvg-id is missing and keeps the slice category', () => {
    const sports = parseM3u(M3U).find(c => c.name === 'No ID Sports');
    expect(sports?.id).toContain('no-id-sports');
    expect(sports?.category).toBe('Sports');
  });

  it('returns nothing for empty or playlist-less text', () => {
    expect(parseM3u('')).toEqual([]);
    expect(parseM3u('#EXTM3U\n')).toEqual([]);
  });
});

describe('newsFirst', () => {
  it('leads with news-group channels, order preserved within groups', () => {
    const mk = (name: string, category: string): TvChannel => ({ id: name, name, country: 'US', category, logo: '', url: `https://${name}` });
    const out = newsFirst([mk('a', 'Sports'), mk('b', 'News'), mk('c', 'Movies'), mk('d', 'News')]);
    expect(out.map(c => c.name)).toEqual(['b', 'd', 'a', 'c']);
  });
});

describe('radio normalization', () => {
  it('prefers url_resolved and maps the display fields', () => {
    const s = normalizeRadioStation({
      stationuuid: 'u1', name: ' KTEP ', country: 'United States', state: 'Texas',
      tags: 'public radio,news', bitrate: 128, codec: 'MP3',
      favicon: 'https://x/f.png', url: 'http://old/', url_resolved: 'https://stream.example/ktep.mp3', votes: 42,
    });
    expect(s).toMatchObject({ uuid: 'u1', name: 'KTEP', url: 'https://stream.example/ktep.mp3', bitrate: 128, votes: 42 });
  });

  it('rejects records without a uuid or any stream URL', () => {
    expect(normalizeRadioStation({ name: 'x', url_resolved: 'https://a/b' })).toBeNull();
    expect(normalizeRadioStation({ stationuuid: 'u' })).toBeNull();
    expect(normalizeRadioStations('nope')).toEqual([]);
    expect(normalizeRadioStations([{ stationuuid: 'u', url_resolved: 'https://a/b' }])).toHaveLength(1);
  });

  it('flags plain-http streams as mixed content on the https app', () => {
    expect(isMixedContent('http://stream.example/a.mp3')).toBe(true);
    expect(isMixedContent('https://stream.example/a.mp3')).toBe(false);
  });
});

describe('favourites persistence', () => {
  const memoryStore = () => {
    const map = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, v); },
      removeItem: (k: string) => { map.delete(k); },
    });
    return map;
  };

  it('round-trips TV and radio favourites under their own keys', () => {
    const map = memoryStore();
    const tv: TvChannel = { id: 'a', name: 'A', country: 'US', category: 'News', logo: '', url: 'https://a/x.m3u8' };
    const radio: RadioStation = { uuid: 'u', name: 'R', country: 'US', state: '', tags: '', bitrate: 0, codec: 'MP3', favicon: '', url: 'https://r/x.mp3', votes: 0 };
    saveTvFavorites([tv]);
    saveRadioFavorites([radio]);
    expect(map.has(TV_FAVORITES_KEY)).toBe(true);
    expect(map.has(RADIO_FAVORITES_KEY)).toBe(true);
    expect(loadTvFavorites()).toEqual([tv]);
    expect(loadRadioFavorites()).toEqual([radio]);
  });

  it('degrades to empty when storage is absent or corrupt', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{not json', setItem: () => {}, removeItem: () => {} });
    expect(loadTvFavorites()).toEqual([]);
    expect(loadRadioFavorites()).toEqual([]);
  });
});
