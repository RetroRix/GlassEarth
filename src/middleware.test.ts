import { describe, expect, it } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import { config, middleware } from './middleware';
import { version as maplibreVersion } from 'maplibre-gl/package.json';

const vendorDir = fileURLToPath(new URL('../public/vendor/maplibre/', import.meta.url));
const workerPath = `/vendor/maplibre/${maplibreVersion}/maplibre-gl-worker.mjs`;

/* PR #330 moved the MapLibre worker out of the bundle and onto a self-hosted
   public/ path. When that file is not retrievable the canvas and the
   main-thread entity layers still draw, but no vector tile can be parsed, so
   the basemap never arrives and startup times out into "The map couldn't
   finish loading" — the production failure that forced the revert to fac8d1b.
   Both halves of that path are asserted here: the file has to ship, and the
   analytics matcher has to leave it alone. */
describe('map runtime assets', () => {
  const matches = (path: string) => config.matcher.some(m => new RegExp(`^${m}$`).test(path));

  it('ships the worker the bundle actually asks for', () => {
    expect(existsSync(`${vendorDir}${maplibreVersion}/maplibre-gl-worker.mjs`)).toBe(true);
    // The worker is a module that imports this sibling by relative path.
    expect(existsSync(`${vendorDir}${maplibreVersion}/maplibre-gl-shared.mjs`)).toBe(true);
  });

  it('keeps exactly one vendored version, so local cannot pass while a clean deploy fails', () => {
    expect(readdirSync(vendorDir, { withFileTypes: true })
      .filter(e => e.isDirectory()).map(e => e.name)).toEqual([maplibreVersion]);
  });

  it('does not put analytics in front of the map worker, its sibling, or the basemap style', () => {
    expect(matches(workerPath)).toBe(false);
    expect(matches(`/vendor/maplibre/${maplibreVersion}/maplibre-gl-shared.mjs`)).toBe(false);
    expect(matches('/dark-matter-style.json')).toBe(false);
  });

  it('still counts page views', () => {
    expect(matches('/')).toBe(true);
    expect(matches('/merch')).toBe(true);
    expect(matches('/api/cctv')).toBe(false);
  });
});

/* The front door took / on 2026-11-15 and the app moved to /app. Every
   link shared while the app lived at the root carries app query params;
   the middleware must carry those visits into the app with the query
   string untouched, and must leave a bare root visit (and unrelated
   params like utm tags) on the door. */
describe('front door redirect', () => {
  const event = { waitUntil: () => {} } as never;
  const run = (url: string) => middleware(new NextRequest(url), event);

  it('carries a layers link into the app with its params intact', () => {
    const res = run('https://www.glassearthlive.com/?layers=maritime,satellites,cctv');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://www.glassearthlive.com/app?layers=maritime,satellites,cctv');
  });

  it('carries a shared view and a live target into the app', () => {
    const res = run('https://www.glassearthlive.com/?lat=31.7619&lon=-106.485&zoom=9&flight=abc123&cs=UAL123');
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.pathname).toBe('/app');
    expect(loc.searchParams.get('lat')).toBe('31.7619');
    expect(loc.searchParams.get('lon')).toBe('-106.485');
    expect(loc.searchParams.get('flight')).toBe('abc123');
    expect(loc.searchParams.get('cs')).toBe('UAL123');
  });

  it('carries ship, camera, oi and spooky params into the app', () => {
    for (const q of ['ship=123456789&sn=Ever+Given', 'cam=txdot-elp-123', 'oi=run-1', 'spooky=1']) {
      const res = run(`https://www.glassearthlive.com/?${q}`);
      expect(res.status, q).toBe(307);
      expect(new URL(res.headers.get('location')!).pathname, q).toBe('/app');
    }
  });

  it('leaves a bare root visit on the door', () => {
    const res = run('https://www.glassearthlive.com/');
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('leaves unrelated params (utm tags) on the door', () => {
    const res = run('https://www.glassearthlive.com/?utm_source=facebook');
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('never redirects the app route itself', () => {
    const res = run('https://www.glassearthlive.com/app?layers=cctv');
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });
});
