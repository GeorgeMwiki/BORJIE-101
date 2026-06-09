/**
 * Platform insights patterns proxy.
 *
 *   GET /api/platform/insights/patterns
 *       → gateway GET /api/v1/platform/insights/patterns (if exists)
 *
 * When the gateway route is not yet wired, returns a structured empty
 * payload (`{ patterns: [] }`) with status 200 so the insights page
 * renders the "no patterns" state rather than the permanent "degraded"
 * banner.
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
    `${base}/api/v1/platform/insights/patterns`,
    { method: 'GET' },
  );

  // If the gateway returns 404 (route not yet wired) return an empty
  // patterns array so the page renders cleanly instead of degraded.
  if (upstream.status === 404) {
    return NextResponse.json({ patterns: [] }, { status: 200 });
  }

  return upstream;
}
