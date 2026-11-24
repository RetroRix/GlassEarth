import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  try {
    /* Only CARTO's basemap hosts, over https on the default port: the style,
       tiles, sprite and fonts all live there, and the map needs nothing else
       from cartocdn.com. No basemap URL has a query string, so it is dropped,
       which keeps one stored copy per tile in the year-long fetch cache. */
    const targetUrl = new URL(url);
    const host = targetUrl.hostname.toLowerCase();
    if (
      targetUrl.protocol !== 'https:' || targetUrl.port || targetUrl.username || targetUrl.password ||
      (host !== 'basemaps.cartocdn.com' && !host.endsWith('.basemaps.cartocdn.com'))
    ) {
      return NextResponse.json({ error: 'Forbidden domain' }, { status: 403 });
    }
    targetUrl.search = '';
    targetUrl.hash = '';

    /* CARTO's basemap platform refuses some bot-shaped User-Agents with a
       403 — the old 'Osiris-Tile-Proxy/1.0' string is one of them (verified
       2026-11-24: style, tiles and glyphs all 403 with it, all 200 without
       it; the refusal took the whole basemap down for every visitor). Send
       an agent string that names the app and its site instead. */
    /* The style JSON is the basemap's table of contents: CARTO can swap
       the tile snapshot it points at, so a year-immutable cached style
       turns their next change into a long outage for returning visitors.
       Style/sprite JSON gets an hour; the tiles, glyphs and images it
       points at are snapshot-addressed and keep the year. */
    const isStyleJson = targetUrl.pathname.endsWith('.json');

    const response = await fetch(targetUrl.toString(), { signal: AbortSignal.timeout(15000),
      headers: {
        'Accept': '*/*',
        'User-Agent': 'Mozilla/5.0 (compatible; GlassEarth/1.0; +https://www.glassearthlive.com)',
      },
      // Using Next.js fetch cache options to heavily cache tiles locally
      next: {
        revalidate: isStyleJson ? 3600 : 31536000,
      }
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch tile' }, { status: response.status });
    }

    const data = await response.arrayBuffer();

    // Forward the content-type from the upstream response
    const contentType = response.headers.get('content-type') || 'application/octet-stream';

    return new NextResponse(data, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': isStyleJson ? 'public, max-age=3600' : 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error) {
    console.error('Tile proxy error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
