/**
 * Platform industry slot proxy.
 *
 *   GET /api/platform/industry/[slot]
 *       → gateway GET /api/v1/platform/industry/:slot (if exists)
 *
 * Each slot corresponds to one of the six DP-aggregated KPI tiles on the
 * industry dashboard. When the gateway route is not yet wired, returns a
 * structured empty payload so the tile renders the "degraded" card rather
 * than throwing a network error (the industry page maps 503 → degraded).
 *
 * Auth: the platform session cookie + Authorization header are forwarded
 * by `proxyJson`.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { getApiGatewayBase, proxyJson } from '@/lib/proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slot: string }> },
): Promise<NextResponse> {
  const { slot } = await params;
  const base = getApiGatewayBase();
  const upstream = await proxyJson(
    `${base}/api/v1/platform/industry/${encodeURIComponent(slot)}`,
    { method: 'GET' },
  );

  // If the gateway returns 404 (aggregator route absent) surface a 503 so
  // the industry page's per-slot degraded guard fires correctly. The page keys
  // on the 503 status (not this code), so the code is purely informational.
  if (upstream.status === 404) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'AGGREGATOR_UNAVAILABLE', message: `Industry slot '${slot}' is not yet available from the platform aggregator.` },
      },
      { status: 503 },
    );
  }

  return upstream;
}
