/**
 * MD-Agentic sandbox-writes BFF proxy (list).
 *
 *   GET /api/md-agentic/sandbox-writes?status=&targetTable=
 *     -> gateway GET /api/v1/md-agentic/sandbox/writes?status=&targetTable=
 *
 * Read-first review queue of staged MD-Agentic sandbox writes. The gateway
 * gates the whole router on owner/admin roles and runs the REAL atomic
 * write only on commit; this proxy forwards the verified bearer + query.
 */

import { NextRequest } from 'next/server';
import { proxyToGateway } from '@/lib/gateway-proxy';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const incoming = new URL(req.url);
  const qs = incoming.searchParams.toString();
  const suffix = qs.length > 0 ? `?${qs}` : '?status=pending';
  return proxyToGateway(`/api/v1/md-agentic/sandbox/writes${suffix}`, {
    method: 'GET',
  });
}
