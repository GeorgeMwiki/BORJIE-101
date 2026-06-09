/**
 * Task-Agents registry BFF proxy (list).
 *
 *   GET /api/platform/task-agents -> gateway GET /api/v1/task-agents
 *
 * Lists the uniform registry of narrow-scope task agents (id, title,
 * trigger, guardrails). Thin pass-through; the gateway is auth-gated.
 */

import { getApiGatewayBase, proxyJson } from '@/lib/proxy';

export const runtime = 'nodejs';

export async function GET() {
  const base = getApiGatewayBase();
  return proxyJson(`${base}/api/v1/task-agents`, { method: 'GET' });
}
