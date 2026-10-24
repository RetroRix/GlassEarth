import { NextResponse } from 'next/server';
import { visitorIp } from '@/lib/ssrf-guard';

/* The answer is one visitor's location. No cache, shared or otherwise, may
   hand it to the next visitor. */
const NO_STORE = { 'Cache-Control': 'private, no-store' };

// Server-side proxy for IP geolocation — avoids mixed-content block on HTTPS pages
// First source: the host's own geo headers (Vercel sets x-vercel-ip-* on every
// request — city-level, free, no external call). The three providers below are
// only the fallback for deployments where those headers are absent.
export async function GET(request: Request) {
  try {
    /* Vercel's edge derives these from the connection itself, so they are the
       visitor's city even when the proxy chain has lost the address — and they
       cost no provider call. A malformed or null-island reading falls through
       to the providers rather than flying the visitor to 0,0. */
    const vLat = Number(request.headers.get('x-vercel-ip-latitude'));
    const vLon = Number(request.headers.get('x-vercel-ip-longitude'));
    if (
      Number.isFinite(vLat) &&
      Number.isFinite(vLon) &&
      vLat >= -90 &&
      vLat <= 90 &&
      vLon >= -180 &&
      vLon <= 180 &&
      !(vLat === 0 && vLon === 0)
    ) {
      const ip = visitorIp(request) ?? '';
      let city = request.headers.get('x-vercel-ip-city') ?? '';
      try {
        city = decodeURIComponent(city);
      } catch {
        city = '';
      }
      return NextResponse.json(
        {
          status: 'success',
          query: ip || 'vercel',
          lat: vLat,
          lon: vLon,
          city: city || 'Unknown',
          regionName: request.headers.get('x-vercel-ip-country-region') ?? 'Unknown',
          country: request.headers.get('x-vercel-ip-country') ?? 'Unknown',
          isp: 'Unknown',
          org: 'Unknown',
          as: 'Unknown',
        },
        { headers: NO_STORE },
      );
    }

    const ip = visitorIp(request) ?? '';

    /* No public address means the proxy chain lost the visitor's. Asking the
       providers without one locates this server instead, which would fly
       every such visitor to the server's city. Only in development, where the
       server is the developer's own machine, is that the right answer. */
    if (!ip && process.env.NODE_ENV === 'production') {
      return NextResponse.json({ status: 'fail', message: 'Visitor address unknown' }, { headers: NO_STORE });
    }

    // ── Provider 1: ipapi.co (HTTPS, free tier 1000/day) ──
    try {
      const url = ip ? `https://ipapi.co/${ip}/json/` : 'https://ipapi.co/json/';
      const res = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        cache: 'no-store',
        headers: { 'User-Agent': 'OSIRIS/4.2' },
      });
      if (res.ok) {
        const d = await res.json();
        if (!d.error && d.latitude) {
          return NextResponse.json({
            status: 'success',
            query: d.ip,
            lat: d.latitude,
            lon: d.longitude,
            city: d.city,
            regionName: d.region,
            country: d.country_name,
            isp: d.org || 'Unknown',
            org: d.org || 'Unknown',
            as: d.asn ? `AS${d.asn} ${d.org}` : 'Unknown',
          }, { headers: NO_STORE });
        }
      }
    } catch { /* fall through */ }

    // ── Provider 2: freeipapi.com (HTTPS, no key needed) ──
    try {
      const url = ip ? `https://freeipapi.com/api/json/${ip}` : 'https://freeipapi.com/api/json';
      const res = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        cache: 'no-store',
      });
      if (res.ok) {
        const d = await res.json();
        if (d.latitude) {
          return NextResponse.json({
            status: 'success',
            query: d.ipAddress || ip || 'auto',
            lat: d.latitude,
            lon: d.longitude,
            city: d.cityName || 'Unknown',
            regionName: d.regionName || 'Unknown',
            country: d.countryName || 'Unknown',
            isp: d.isp || 'Unknown',
            org: d.isp || 'Unknown',
            as: 'Unknown',
          }, { headers: NO_STORE });
        }
      }
    } catch { /* fall through */ }

    // ── Provider 3: ip-api.com (HTTP — safe here because this is server-to-server) ──
    try {
      const url = ip
        ? `http://ip-api.com/json/${ip}?fields=status,lat,lon,city,regionName,country,query,isp,org,as`
        : 'http://ip-api.com/json/?fields=status,lat,lon,city,regionName,country,query,isp,org,as';
      const res = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'success') {
          return NextResponse.json(data, { headers: NO_STORE });
        }
      }
    } catch { /* fall through */ }

    return NextResponse.json({ error: 'All geolocation providers failed' }, { status: 502, headers: NO_STORE });
  } catch (e) {
    return NextResponse.json(
      { error: 'Failed to reach geolocation service', detail: e instanceof Error ? e.message : String(e) },
      { status: 503, headers: NO_STORE }
    );
  }
}
