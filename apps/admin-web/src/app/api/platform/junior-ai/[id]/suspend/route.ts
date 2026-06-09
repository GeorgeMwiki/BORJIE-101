/**
 * Junior-AI suspend BFF proxy.
 *
 *   POST /api/platform/junior-ai/:id/suspend
 *     -> gateway POST /api/v1/junior-ai/:id/suspend
 *
 * The gateway pauses an active junior (reversible). This proxy only
 * forwards auth + body ({ reason }).
 */

import { NextRequest } from 'next/server';
import { getApiGatewayBase, proxyJson, readJsonBody } from '@/lib/proxy';

export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function POST(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const base = getApiGatewayBase();
  const body = (await readJsonBody(req)) ?? JSON.stringify({});
  return proxyJson(
    `${base}/api/v1/junior-ai/${encodeURIComponent(id)}/suspend`,
    { method: 'POST', body },
  );
}
