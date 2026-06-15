/**
 * Platform insights patterns proxy.
 *
 *   GET /api/platform/insights/patterns
 *       → gateway GET /api/v1/platform/insights/patterns (if exists)
 *
 * The gateway insights aggregator is not yet mounted. When it returns
 * 404 we surface a 503 so the insights page's degraded guard fires and
 * shows an honest "pattern explorer offline" card rather than a fake
 * empty "no patterns" state that presents a born-dark surface as a
 * healthy one.
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

  // If the gateway returns 404 (aggregator route not yet mounted) surface
  // a 503 so the insights page's degraded guard fires correctly. The page
  // keys on the 503 status, so the code is purely informational.
  if (upstream.status === 404) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INSIGHTS_INDEX_UNAVAILABLE',
          message: 'The insights aggregator is not yet available from the platform.',
        },
      },
      { status: 503 },
    );
  }

  return upstream;
}
