import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { validateHost } from '@/lib/ssrf-guard';
import {
  averageHashFromGrayscale,
  isPlaceholderHash,
  PLACEHOLDER_HASH_SIZE,
  PLACEHOLDER_HASH_THRESHOLD,
} from '@/lib/placeholder';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

/** A snapshot fetch that takes longer than this is not answering. */
const FETCH_TIMEOUT_MS = 8000;
/** Placeholders are small graphics; refuse to buffer anything bigger. */
const MAX_BYTES = 2 * 1024 * 1024;

export interface PlaceholderVerdict {
  placeholder: boolean;
  /** Bits to the nearest known placeholder artwork. */
  distance: number;
  /** Which artwork matched, or null. */
  signature: string | null;
}

/**
 * The verdict for one image's bytes. Exported for tests: the route handler
 * adds URL parsing and the SSRF guard, this adds the decode and the hash.
 * Anything undecodable is not a placeholder — the safe direction is to keep
 * the LIVE STILL badge, never to invent UNAVAILABLE.
 */
export async function classifySnapshotBuffer(data: Buffer): Promise<PlaceholderVerdict> {
  const gray = await sharp(data)
    .resize(PLACEHOLDER_HASH_SIZE, PLACEHOLDER_HASH_SIZE, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer();
  const hash = averageHashFromGrayscale([...gray]);
  const { placeholder, distance, signature } = isPlaceholderHash(hash);
  return { placeholder, distance, signature };
}

async function readCapped(body: ReadableStream<Uint8Array> | null): Promise<Buffer | null> {
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BYTES) return null;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function GET(req: Request) {
  /* new URL(req.url) rather than req.nextUrl: the handler also runs under
     plain Request objects in tests, where nextUrl does not exist. */
  const raw = (new URL(req.url).searchParams.get('url') ?? '').trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 });
  }
  if (url.protocol !== 'https:') {
    return NextResponse.json({ error: 'https only' }, { status: 400 });
  }
  /* The URL comes from the client, so the host is validated exactly like
     the proxy route validates its targets — DNS answers in a reserved
     range are refused before any fetch is attempted. */
  const host = await validateHost(url.hostname);
  if (!host.ok) {
    return NextResponse.json({ error: host.reason ?? 'host not allowed' }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'image/*', 'User-Agent': 'GlassEarth/placeholder-check' },
    });
  } catch {
    return NextResponse.json({ error: 'fetch failed' }, { status: 502 });
  }
  if (!res.ok) {
    return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 });
  }
  const data = await readCapped(res.body);
  if (data === null) {
    return NextResponse.json({ error: 'empty or oversized image' }, { status: 502 });
  }
  let verdict: PlaceholderVerdict;
  try {
    verdict = await classifySnapshotBuffer(data);
  } catch {
    /* Not a decodable image (an error page, a blank body): unknown, not a
       placeholder — the tile keeps its STILL badge. */
    return NextResponse.json({ error: 'undecodable image' }, { status: 502 });
  }
  return NextResponse.json({ ...verdict, threshold: PLACEHOLDER_HASH_THRESHOLD });
}
