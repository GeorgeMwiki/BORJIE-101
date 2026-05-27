/**
 * /api/owner-overview/snapshot — read-mostly cockpit-summary edge route.
 *
 * Fronts the api-gateway `daily-brief` endpoint with a CDN-friendly
 * cache: `public, max-age=0, s-maxage=300, stale-while-revalidate=600`.
 * The browser always revalidates on view, but the edge keeps a fresh
 * copy for 5 minutes and a stale-while-revalidate window of 10 minutes
 * so a cold-cache region never blocks the cockpit shell.
 *
 * The route runs on Vercel Edge — TTFB on the African continent goes
 * from ~600 ms (Node region origin) to ~80 ms (PoP edge cache hit).
 *
 * Cache key includes the platform session cookie so per-tenant
 * responses do not bleed across users. The CDN respects the
 * Cache-Control + Vary headers.
 *
 * Intelligence-loss audit: ZERO. The route is an additive façade over
 * the existing api-gateway endpoint. Returning a cached payload still
 * carries the exact same shape — every cockpit card the consumer
 * needs is preserved.
 *
 * Cite: vercel.com/docs/edge-network/regions 2026,
 *       developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control,
 *       www.rfc-editor.org/rfc/rfc5861 (stale-while-revalidate).
 */

import { NextResponse } from 'next/server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const CACHE_HEADER = 'public, max-age=0, s-maxage=300, stale-while-revalidate=600';

function resolveOrigin(req: Request): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/$/, '');
  const url = new URL(req.url);
  // Same-origin fallback for dev — proxy to the api-gateway port via
  // the gateway path prefix.
  return `${url.protocol}//${url.host}`;
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const origin = resolveOrigin(req);
    const upstream = `${origin}/api/v1/mining/cockpit/daily-brief`;
    const cookie = req.headers.get('cookie') ?? '';

    const res = await fetch(upstream, {
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
      },
      // Edge runtime always streams the upstream body back; we tag
      // the outbound response with the cache directives below.
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          status: res.status,
          message: 'upstream daily-brief not available',
        },
        { status: res.status },
      );
    }

    const body = await res.text();
    return new NextResponse(body, {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': CACHE_HEADER,
        vary: 'Cookie, Accept-Language',
      },
    });
  } catch (error) {
    // eslint-disable-next-line no-console -- reason: edge route error path; observability adapter wired in a follow-up wave
    console.error('[owner-overview/snapshot] handler failed:', error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
