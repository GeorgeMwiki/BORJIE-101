/**
 * Persona Registry BFF proxy (list + register).
 *
 *   GET  /api/platform/persona-registry -> gateway GET  /api/v1/persona-registry
 *   POST /api/platform/persona-registry -> gateway POST /api/v1/persona-registry
 *
 * The gateway gates every persona-registry route on SUPER_ADMIN / ADMIN
 * and hot-swaps personas across the cross-portal bus. This proxy only
 * forwards auth + body.
 */

import { NextRequest } from 'next/server';
import { getApiGatewayBase, proxyJson, readJsonBody } from '@/lib/proxy';

export const runtime = 'nodejs';

export async function GET() {
  const base = getApiGatewayBase();
  return proxyJson(`${base}/api/v1/persona-registry`, { method: 'GET' });
}

export async function POST(req: NextRequest) {
  const base = getApiGatewayBase();
  const body = (await readJsonBody(req)) ?? JSON.stringify({});
  return proxyJson(`${base}/api/v1/persona-registry`, {
    method: 'POST',
    body,
  });
}
