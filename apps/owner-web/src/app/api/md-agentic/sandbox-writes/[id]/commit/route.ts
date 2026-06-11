/**
 * MD-Agentic sandbox-write commit BFF proxy (high-stakes).
 *
 *   POST /api/md-agentic/sandbox-writes/:id/commit
 *     -> gateway POST /api/v1/md-agentic/sandbox/writes/:id/commit
 *
 * Commit validates + atomically applies the staged write and hash-chains
 * the audit entry. This is the high-stakes path: the gateway enforces the
 * role gate + four-eye / inviolable rails server-side. This proxy only
 * forwards the verified bearer.
 */

import { NextRequest } from 'next/server';
import { proxyToGateway } from '@/lib/gateway-proxy';

export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function POST(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  return proxyToGateway(
    `/api/v1/md-agentic/sandbox/writes/${encodeURIComponent(id)}/commit`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}
