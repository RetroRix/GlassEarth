import { describe, expect, it } from 'vitest';
import { FAST_SERVICES } from './tv-services';

describe('FAST services catalogue', () => {
  it('carries the five big free services, each a link out to the official site', () => {
    expect(FAST_SERVICES.map(s => s.id)).toEqual(['pluto', 'tubi', 'roku-channel', 'xumo', 'sling-freestream']);
    for (const service of FAST_SERVICES) {
      expect(service.url).toMatch(/^https:\/\//);
      expect(service.name.length).toBeGreaterThan(0);
      expect(service.tagline.length).toBeGreaterThan(0);
      expect(service.note).toMatch(/free/i);
    }
  });

  it('has unique ids', () => {
    expect(new Set(FAST_SERVICES.map(s => s.id)).size).toBe(FAST_SERVICES.length);
  });
});
