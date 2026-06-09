/**
 * Control-plane AI-SUGGEST BFF proxy.
 *
 *   POST /api/platform/control-plane/ai-suggest
 *     -> gateway POST /admin/control-plane/ai-suggest
 *
 * HITL recommender — suggest-only. The gateway NEVER writes config from this
 * route; it returns a ranked per-use-case routing proposal for the admin to
 * REVIEW and then APPLY via PUT /llm-routing. Forwards auth + body only.
 */

import { NextRequest } from 'next/server';
import { getApiGatewayBase, proxyJson, readJsonBody } from '@/lib/proxy';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const base = getApiGatewayBase();
  const body = (await readJsonBody(req)) ?? JSON.stringify({});
  return proxyJson(`${base}/api/v1/admin/control-plane/ai-suggest`, {
    method: 'POST',
    body,
  });
}
