/**
 * Proposals decline BFF proxy.
 *
 *   POST /api/platform/proposals/:id/decline
 *     -> gateway POST /api/v1/proposals/:id/decline
 *
 * The gateway records the decline reason + resolver and only mutates rows
 * still in pending_hitl. This proxy only forwards auth + body.
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
    `${base}/api/v1/proposals/${encodeURIComponent(id)}/decline`,
    { method: 'POST', body },
  );
}
