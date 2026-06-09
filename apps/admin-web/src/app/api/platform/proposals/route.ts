/**
 * Proposals approval-queue BFF proxy (list).
 *
 *   GET /api/platform/proposals?status=pending_hitl
 *     -> gateway GET /api/v1/proposals?status=pending_hitl
 *
 * Thin pass-through onto the api-gateway. The gateway enforces tenant
 * isolation (auth-middleware tenantId claim + RLS belt-and-braces) and
 * four-eye on the approve path server-side; this proxy only forwards the
 * staff session cookie + Authorization header and echoes the query string.
 */

import { NextRequest } from 'next/server';
import { getApiGatewayBase, proxyJson } from '@/lib/proxy';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const base = getApiGatewayBase();
  const incoming = new URL(req.url);
  const qs = incoming.searchParams.toString();
  const suffix = qs.length > 0 ? `?${qs}` : '?status=pending_hitl';
  return proxyJson(`${base}/api/v1/proposals${suffix}`, { method: 'GET' });
}
