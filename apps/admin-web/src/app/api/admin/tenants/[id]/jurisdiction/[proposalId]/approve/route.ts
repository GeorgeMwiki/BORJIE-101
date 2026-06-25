/**
 * Tenant jurisdiction-override four-eye APPROVE BFF proxy (JC-7).
 *
 *   POST /api/admin/tenants/:id/jurisdiction/:proposalId/approve
 *     -> gateway POST /api/v1/admin/tenants/:id/jurisdiction/:proposalId/approve
 *        { decisionNote? }
 *
 * The approver MUST be a DIFFERENT internal admin than the proposer — the
 * gateway enforces the four-eye invariant (409 four_eye_violation) and runs
 * the real country flip + audit-chain + owner cockpit pulse on approval.
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
    )}/jurisdiction/${encodeURIComponent(proposalId)}/approve`,
    { method: 'POST', body },
  );
}
