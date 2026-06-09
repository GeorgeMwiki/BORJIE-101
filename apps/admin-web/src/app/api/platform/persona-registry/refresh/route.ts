/**
 * Persona Registry refresh BFF proxy.
 *
 *   POST /api/platform/persona-registry/refresh
 *     -> gateway POST /api/v1/persona-registry/refresh
 *
 * Force-re-reads personas from the DB. SUPER_ADMIN / ADMIN only (upstream).
 */

import { NextRequest } from 'next/server';
import { getApiGatewayBase, proxyJson } from '@/lib/proxy';

export const runtime = 'nodejs';

export async function POST(_req: NextRequest) {
  const base = getApiGatewayBase();
  return proxyJson(`${base}/api/v1/persona-registry/refresh`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
