/**
 * Tenant jurisdiction-override REJECT BFF proxy (JC-7).
 *
 *   POST /api/admin/tenants/:id/jurisdiction/:proposalId/reject
 *     -> gateway POST /api/v1/admin/tenants/:id/jurisdiction/:proposalId/reject
 *        { decisionNote? }
 *
 * Marks a pending proposal rejected (no country flip). Auth + role gating +
 * audit are enforced by the gateway.
 */

import { NextRequest } from 'next/server';
import { getApiGatewayBase, proxyJson, readJsonBody } from '@/lib/proxy';

export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ readonly id: string; readonly proposalId: string }>;
}

export async function POST(req: NextRequest, context: RouteContext) {
  const { id, proposalId } = await context.params;
  const base = getApiGatewayBase();
  const body = (await readJsonBody(req)) ?? JSON.stringify({});
  return proxyJson(
    `${base}/api/v1/admin/tenants/${encodeURIComponent(
      id,
    )}/jurisdiction/${encodeURIComponent(proposalId)}/reject`,
    { method: 'POST', body },
  );
}
