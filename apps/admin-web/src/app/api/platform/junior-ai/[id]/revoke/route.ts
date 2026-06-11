/**
 * Junior-AI revoke BFF proxy.
 *
 *   POST /api/platform/junior-ai/:id/revoke
 *     -> gateway POST /api/v1/junior-ai/:id/revoke
 *
 * The gateway permanently revokes a junior (terminal). This proxy only
 * forwards auth; revoke takes no body.
 */

import { NextRequest } from 'next/server';
import { getApiGatewayBase, proxyJson } from '@/lib/proxy';

export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function POST(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const base = getApiGatewayBase();
  return proxyJson(
    `${base}/api/v1/junior-ai/${encodeURIComponent(id)}/revoke`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}
