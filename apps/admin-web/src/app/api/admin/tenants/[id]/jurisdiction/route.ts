/**
 * Tenant jurisdiction-override BFF proxy (JC-7 / JC-8).
 *
 *   GET  /api/admin/tenants/:id/jurisdiction
 *     -> gateway GET  /api/v1/admin/tenants/:id/jurisdiction
 *        { current, pending, history }
 *
 *   POST /api/admin/tenants/:id/jurisdiction   (PROPOSE)
 *     -> gateway POST /api/v1/admin/tenants/:id/jurisdiction
 *        { newCountryCode, reason, verifiedWith } -> 202 { proposalId, ... }
 *
 * Thin pass-through onto the api-gateway, which enforces
 * requireRole(SUPER_ADMIN | ADMIN | SUPPORT) + the four-eye flow + the audit
 * chain. The staff session cookie + Supabase Bearer are forwarded by
 * `proxyJson`. This is the missing same-origin half of the contract the
 * `TenantJurisdictionPanel` consumes — without it the panel 404s.
 */

import { NextRequest } from 'next/server';
import { getApiGatewayBase, proxyJson, readJsonBody } from '@/lib/proxy';

export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function GET(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const base = getApiGatewayBase();
  return proxyJson(
    `${base}/api/v1/admin/tenants/${encodeURIComponent(id)}/jurisdiction`,
    { method: 'GET' },
  );
}

export async function POST(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const base = getApiGatewayBase();
  const body = (await readJsonBody(req)) ?? JSON.stringify({});
  return proxyJson(
    `${base}/api/v1/admin/tenants/${encodeURIComponent(id)}/jurisdiction`,
    { method: 'POST', body },
  );
}
