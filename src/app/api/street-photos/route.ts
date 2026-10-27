import { NextRequest, NextResponse } from 'next/server';
import {
  isUuid, transformPicture, transformSearchResults, MAX_PHOTOS_PER_FETCH,
} from '@/lib/street-photos';

export const dynamic = 'force-dynamic';

/**
 * OSIRIS — street-level photos from Panoramax (the open street-photo
 * commons): a federation of public instances behind the keyless
 * meta-catalog STAC API at api.panoramax.xyz. Two modes:
 *
 *  ?bbox=w,s,e,n       pictures in a viewport (street zoom only — the
 *                      client gates at z14; spans are capped here too)
 *  ?collection=&id=    one picture (sequence prev/next navigation)
 *
 * The browser never calls Panoramax directly (restrictive networks
 * break direct third-party calls); responses are cached briefly
 * server-side. Every picture keeps its own licence + contributor from
 * the feed — attribution is a licence condition. No key.
 */

const API = 'https://api.panoramax.xyz/api';
const TTL_MS = 5 * 60 * 1000;
const MAX_SPAN_DEG = 0.5;
const CACHE_MAX = 60;

const cache = new Map<string, { body: unknown; expiresAt: number }>();

function cached(key: string): unknown | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) { cache.delete(key); return null; }
  return hit.body;
}

function store(key: string, body: unknown): void {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { body, expiresAt: Date.now() + TTL_MS });
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store',
    headers: { Accept: 'application/geo+json, application/json' },
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function parseBbox(raw: string | null): [number, number, number, number] | null {
  if (!raw) return null;
  const parts = raw.split(',').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) return null;
  const [w, s, e, n] = parts;
  if (w < -180 || e > 180 || s < -90 || n > 90 || w >= e || s >= n) return null;
  if (e - w > MAX_SPAN_DEG || n - s > MAX_SPAN_DEG) return null;
  return [w, s, e, n];
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const collection = q.get('collection');
  const id = q.get('id');

  // Single-picture mode (sequence navigation in the viewer).
  if (collection || id) {
    if (!isUuid(collection) || !isUuid(id)) {
      return NextResponse.json({ error: 'Invalid picture reference' }, { status: 400 });
    }
    const key = `item:${collection}:${id}`;
    const hit = cached(key);
    if (hit) return NextResponse.json(hit, { headers: { 'Cache-Control': 'public, max-age=60' } });
    try {
      const raw = await getJson(`${API}/collections/${collection}/items/${id}`);
      const photo = transformPicture(raw);
      if (!photo) return NextResponse.json({ error: 'Picture not found' }, { status: 404 });
      const body = { photo: photo.properties, coordinates: photo.geometry.coordinates };
      store(key, body);
      return NextResponse.json(body, { headers: { 'Cache-Control': 'public, max-age=60' } });
    } catch (e) {
      console.warn('[OSIRIS] street-photos item:', e);
      return NextResponse.json({ error: 'Street photo unavailable' }, { status: 502 });
    }
  }

  // Viewport mode.
  const bbox = parseBbox(q.get('bbox'));
  if (!bbox) return NextResponse.json({ error: 'Invalid bbox' }, { status: 400 });
  const key = `bbox:${bbox.map(n => n.toFixed(3)).join(',')}`;
  const hit = cached(key);
  if (hit) return NextResponse.json(hit, { headers: { 'Cache-Control': 'public, max-age=60' } });
  try {
    const url = `${API}/search?bbox=${bbox.join(',')}&limit=${MAX_PHOTOS_PER_FETCH}`;
    const raw = await getJson(url);
    const features = transformSearchResults(raw);
    const body = {
      type: 'FeatureCollection',
      features,
      count: features.length,
      capped: features.length >= MAX_PHOTOS_PER_FETCH,
      generatedAt: new Date().toISOString(),
    };
    store(key, body);
    return NextResponse.json(body, { headers: { 'Cache-Control': 'public, max-age=60' } });
  } catch (e) {
    console.warn('[OSIRIS] street-photos:', e);
    return NextResponse.json({ error: 'Street photos unavailable' }, { status: 502 });
  }
}
