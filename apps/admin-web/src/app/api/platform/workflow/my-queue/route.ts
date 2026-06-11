/**
 * Workflow Engine BFF proxy (caller's open runs).
 *
 *   GET /api/platform/workflow/my-queue
 *     -> gateway GET /api/v1/workflow/runs/my-queue
 *
 * Read-first surface over the persistent + four-eyes-capable workflow
 * engine. Listing only; starting / approving runs stays a follow-up that
 * rides the durable-saga wave. Thin pass-through; the gateway is auth-gated.
 */

import { getApiGatewayBase, proxyJson } from '@/lib/proxy';

export const runtime = 'nodejs';

export async function GET() {
  const base = getApiGatewayBase();
  return proxyJson(`${base}/api/v1/workflow/runs/my-queue`, { method: 'GET' });
}
