/**
 * Persona Registry per-persona BFF proxy (patch + delete).
 *
 *   PUT    /api/platform/persona-registry/:id -> gateway PUT    /api/v1/persona-registry/:id
 *   DELETE /api/platform/persona-registry/:id -> gateway DELETE /api/v1/persona-registry/:id
 *
 * SUPER_ADMIN / ADMIN only (enforced upstream). This proxy only forwards
 * auth + body.
 */

import { NextRequest } from 'next/server';
import { getApiGatewayBase, proxyJson, readJsonBody } from '@/lib/proxy';

export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function PUT(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const base = getApiGatewayBase();
  const body = (await readJsonBody(req)) ?? JSON.stringify({});
  return proxyJson(
    `${base}/api/v1/persona-registry/${encodeURIComponent(id)}`,
    { method: 'PUT', body },
  );
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const base = getApiGatewayBase();
  return proxyJson(
    `${base}/api/v1/persona-registry/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
}
