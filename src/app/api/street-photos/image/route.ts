import { NextRequest, NextResponse } from 'next/server';
import { isUuid, panoramaxPictureUrl } from '@/lib/street-photos';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

/**
 * OSIRIS — street-photo image relay. The viewer asks for a picture by
 * id + size only; the server fetches it from the Panoramax meta-catalog
 * (which redirects to whichever federation instance holds the file) and
 * relays the bytes. One fixed upstream host + a UUID-shaped id means
 * this can never become an open proxy, and the browser never talks to
 * third-party photo hosts directly (restrictive networks break those).
 * Only bytes that sniff as JPEG are served — Panoramax derivatives are
 * JPEG by construction.
 */

const MAX_BYTES = 12 * 1024 * 1024;
const SIZES = new Set(['sd', 'thumb']);

function isJpeg(data: Buffer): boolean {
  return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  const size = req.nextUrl.searchParams.get('size') ?? 'sd';
  if (!isUuid(id) || !SIZES.has(size)) {
    return NextResponse.json({ error: 'Invalid picture reference' }, { status: 400 });
  }
  try {
    const res = await fetch(panoramaxPictureUrl(id, size as 'sd' | 'thumb'), {
      signal: AbortSignal.timeout(20_000),
      cache: 'no-store',
    });
    if (!res.ok) return NextResponse.json({ error: 'Picture unavailable' }, { status: 502 });
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES || !isJpeg(buf)) {
      return NextResponse.json({ error: 'Picture unavailable' }, { status: 502 });
    }
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    });
  } catch (e) {
    console.warn('[OSIRIS] street-photos image:', e);
    return NextResponse.json({ error: 'Picture unavailable' }, { status: 502 });
  }
}
