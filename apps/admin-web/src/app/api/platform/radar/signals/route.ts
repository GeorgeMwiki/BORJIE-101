/**
 * Platform radar signals proxy.
 *
 *   GET /api/platform/radar/signals
 *       → gateway GET /api/v1/platform/radar/signals (if exists)
 *
 * The gateway radar aggregator is not yet mounted. When it returns 404
 * we surface a 503 so the radar page's degraded guard fires and shows an
 * honest "pipeline offline" card — rather than a fake `{ signals: [] }`
 * that would render "Pipeline healthy, stream empty", which lies about a
 * stream that has no backend. A real 503 from the gateway is passed
 * through as-is.
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

  // If the gateway returns 404 (aggregator route not yet mounted) surface
  // a 503 so the radar page's degraded guard fires correctly. The page
  // keys on the 503 status, so the code is purely informational.
  if (upstream.status === 404) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'RADAR_PIPELINE_UNAVAILABLE',
          message: 'The radar aggregator is not yet available from the platform.',
        },
      },
      { status: 503 },
    );
  }

  return upstream;
}
