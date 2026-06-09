/**
 * Task-Agents runs BFF proxy (recent runs from the audit log).
 *
 *   GET /api/platform/task-agents/runs?agent_id=&limit=
 *     -> gateway GET /api/v1/task-agents/runs?agent_id=&limit=
 *
 * Read-only projection of recent task-agent runs. Thin pass-through that
 * echoes the query string; the gateway reads the append-only audit log.
 */

import { NextRequest } from 'next/server';
import { getApiGatewayBase, proxyJson } from '@/lib/proxy';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const base = getApiGatewayBase();
  const incoming = new URL(req.url);
  const qs = incoming.searchParams.toString();
  const suffix = qs.length > 0 ? `?${qs}` : '';
  return proxyJson(`${base}/api/v1/task-agents/runs${suffix}`, {
    method: 'GET',
  });
}
