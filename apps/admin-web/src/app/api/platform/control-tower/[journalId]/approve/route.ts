/**
 * Control Tower four-eye approval BFF proxy.
 *
 *   POST /api/platform/control-tower/:journalId/approve
 *     -> gateway POST /admin/control-tower/toggle/:journalId/approve
 *
 * The second operator approves a pending HIGH-impact toggle. The gateway runs
 * the REAL mutation on approval (kill-switch / feature-flag) and rejects
 * same-actor approvals; this proxy only forwards auth + body.
 */

import { NextRequest } from 'next/server';
import { getApiGatewayBase, proxyJson, readJsonBody } from '@/lib/proxy';

export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ readonly journalId: string }>;
}

export async function POST(req: NextRequest, context: RouteContext) {
  const { journalId } = await context.params;
  const base = getApiGatewayBase();
  const body = (await readJsonBody(req)) ?? JSON.stringify({});
  return proxyJson(
    `${base}/api/v1/admin/control-tower/toggle/${encodeURIComponent(journalId)}/approve`,
    { method: 'POST', body },
  );
}
