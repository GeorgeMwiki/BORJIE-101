/**
 * Control Tower BFF proxy.
 *
 *   GET  /api/platform/control-tower         -> gateway GET  /admin/control-tower/controls
 *   POST /api/platform/control-tower         -> gateway POST /admin/control-tower/toggle
 *
 * Thin pass-through onto the api-gateway (the gateway enforces SUPER_ADMIN /
 * ADMIN + four-eye + SOC2 audit). The staff session cookie + Authorization
 * header are forwarded by `proxyJson`. Toggling a HIGH-impact control lands a
 * pending_approval row server-side; the second-eye approval goes through the
 * sibling `[journalId]/approve` route.
 */

import { NextRequest } from 'next/server';
import { getApiGatewayBase, proxyJson, readJsonBody } from '@/lib/proxy';

export const runtime = 'nodejs';

export async function GET() {
  const base = getApiGatewayBase();
  return proxyJson(`${base}/api/v1/admin/control-tower/controls`, {
    method: 'GET',
  });
}

export async function POST(req: NextRequest) {
  const base = getApiGatewayBase();
  const body = await readJsonBody(req);
  if (body === null) {
    return proxyJson(`${base}/api/v1/admin/control-tower/toggle`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }
  return proxyJson(`${base}/api/v1/admin/control-tower/toggle`, {
    method: 'POST',
    body,
  });
}
