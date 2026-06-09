/**
 * MD-Agentic sandbox-write reject BFF proxy.
 *
 *   POST /api/md-agentic/sandbox-writes/:id/reject
 *     -> gateway POST /api/v1/md-agentic/sandbox/writes/:id/reject
 *
 * Rejects a staged write and records the rejection log. The gateway gates
 * the route + validates the body ({ reason }); this proxy forwards the
 * verified bearer + body.
 */

import { NextRequest } from 'next/server';
import { proxyToGateway, readJsonBody } from '@/lib/gateway-proxy';

export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function POST(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const body = (await readJsonBody(req)) ?? JSON.stringify({});
  return proxyToGateway(
    `/api/v1/md-agentic/sandbox/writes/${encodeURIComponent(id)}/reject`,
    { method: 'POST', body },
  );
}
