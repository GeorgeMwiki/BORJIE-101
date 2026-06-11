/**
 * Proposals approve BFF proxy.
 *
 *   POST /api/platform/proposals/:id/approve
 *     -> gateway POST /api/v1/proposals/:id/approve
 *
 * The gateway runs the REAL state transition (pending_hitl -> accepted),
 * stamps the approver, and rejects non-pending states (409). This proxy
 * only forwards auth + body; four-eye / approver-tier rules live upstream.
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
    `${base}/api/v1/proposals/${encodeURIComponent(id)}/approve`,
    { method: 'POST', body },
  );
}
