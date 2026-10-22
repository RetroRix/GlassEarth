import { describe, expect, it } from 'vitest';
import {
  FR24_ATTRIBUTION,
  SPOTTING_AIRPORTS,
  liveAtcUrl,
  youtubeChannelUrl,
  youtubeEmbedUrl,
  youtubeWatchUrl,
} from './plane-spotting';

describe('plane-spotting catalogue', () => {
  it('has the five launch airports with well-formed stream references', () => {
    expect(SPOTTING_AIRPORTS.map(a => a.icao)).toEqual(['KLAX', 'KLAS', 'EGLL', 'TNCM', 'LKPR']);
    for (const a of SPOTTING_AIRPORTS) {
      expect(a.icao).toMatch(/^[A-Z]{4}$/);
      expect(a.iata).toMatch(/^[A-Z]{3}$/);
      /* YouTube ids are 11 chars; channel ids are UC + 22. */
      expect(a.videoId).toMatch(/^[\w-]{11}$/);
      expect(a.channelId).toMatch(/^UC[\w-]{22}$/);
      expect(a.lat).toBeGreaterThan(-90);
      expect(a.lat).toBeLessThan(90);
      expect(a.lng).toBeGreaterThan(-180);
      expect(a.lng).toBeLessThan(180);
      for (const link of a.links) expect(link.url).toMatch(/^https:\/\//);
    }
  });

  it('keeps ids unique', () => {
    expect(new Set(SPOTTING_AIRPORTS.map(a => a.icao)).size).toBe(SPOTTING_AIRPORTS.length);
    expect(new Set(SPOTTING_AIRPORTS.map(a => a.videoId)).size).toBe(SPOTTING_AIRPORTS.length);
  });

  it('requires the verbatim attribution on, and only on, the Flightradar24 streams', () => {
    for (const a of SPOTTING_AIRPORTS) {
      if (a.channelId === 'UCcGI_kXwKl_QhyW9jK_8gIA') expect(a.attribution).toBe(FR24_ATTRIBUTION);
      else expect(a.attribution).toBeUndefined();
    }
    expect(FR24_ATTRIBUTION).toContain('Flightradar24 YouTube channel');
  });
});

describe('URL builders', () => {
  it('builds the embed, watch, channel and LiveATC URLs', () => {
    expect(youtubeEmbedUrl('n4I0d44oBEs')).toContain('youtube-nocookie.com/embed/n4I0d44oBEs');
    expect(youtubeWatchUrl('n4I0d44oBEs')).toBe('https://www.youtube.com/watch?v=n4I0d44oBEs');
    expect(youtubeChannelUrl('UCcGI_kXwKl_QhyW9jK_8gIA')).toBe('https://www.youtube.com/channel/UCcGI_kXwKl_QhyW9jK_8gIA');
    expect(liveAtcUrl('EGLL')).toBe('https://www.liveatc.net/search/?icao=EGLL');
  });
});
