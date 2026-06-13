/**
 * Junior-AI Factory BFF proxy (list + provision).
 *
 *   GET  /api/platform/junior-ai   -> gateway GET  /api/v1/junior-ai/mine
 *   POST /api/platform/junior-ai   -> gateway POST /api/v1/junior-ai/provision
 *
 * Thin pass-through. The gateway enforces the team-lead role gate
 * (TENANT_ADMIN / SUPER_ADMIN), the policy-subset
 * guard, and the lifecycle caps. This proxy only forwards auth + body.
 */

import { NextRequest } from 'next/server';
import { getApiGatewayBase, proxyJson, readJsonBody } from '@/lib/proxy';

export const runtime = 'nodejs';

export async function GET() {
  const base = getApiGatewayBase();
  return proxyJson(`${base}/api/v1/junior-ai/mine`, { method: 'GET' });
}

export async function POST(req: NextRequest) {
  const base = getApiGatewayBase();
  const body = (await readJsonBody(req)) ?? JSON.stringify({});
  return proxyJson(`${base}/api/v1/junior-ai/provision`, {
    method: 'POST',
    body,
  });
}
