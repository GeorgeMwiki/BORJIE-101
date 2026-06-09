/**
 * Task-Agents manual-trigger BFF proxy.
 *
 *   POST /api/platform/task-agents/:id/run
 *     -> gateway POST /api/v1/task-agents/:id/run
 *
 * Manually triggers a registered task agent. The gateway validates the
 * payload against the agent's own zod schema and runs the executor; this
 * proxy only forwards auth + body ({ payload }).
 */

import { NextRequest } from 'next/server';
import { getApiGatewayBase, proxyJson, readJsonBody } from '@/lib/proxy';

export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function POST(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const base = getApiGatewayBase();
  const body = (await readJsonBody(req)) ?? JSON.stringify({});
  return proxyJson(
    `${base}/api/v1/task-agents/${encodeURIComponent(id)}/run`,
    { method: 'POST', body },
  );
}
