/**
 * Platform radar signals proxy.
 *
 *   GET /api/platform/radar/signals
 *       → gateway GET /api/v1/platform/radar/signals (if exists)
 *
 * When the gateway route is not yet wired, returns a structured empty
 * payload (`{ signals: [] }`) with status 200 so the radar page renders
 * the "stream empty" state rather than the permanent "degraded" banner.
 * A 503 from the gateway is passed through as-is so the page's degraded
 * guard fires correctly.
 *
 * Auth: the platform session cookie + Authorization header are forwarded
 * by `proxyJson`.
 */

import { NextResponse } from 'next/server';
import { getApiGatewayBase, proxyJson } from '@/lib/proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const base = getApiGatewayBase();
  const upstream = await proxyJson(
    `${base}/api/v1/platform/radar/signals`,
    { method: 'GET' },
  );

  // If the gateway returns 404 (route not yet wired) return an empty
  // signals array so the page renders cleanly instead of degraded.
  if (upstream.status === 404) {
    return NextResponse.json({ signals: [] }, { status: 200 });
  }

  return upstream;
}
