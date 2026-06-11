/**
 * Control-plane POWERS BFF proxy.
 *
 *   GET /api/platform/control-plane/powers?flags=a,b,c
 *     -> gateway GET /admin/control-plane/powers
 *   PUT /api/platform/control-plane/powers
 *     -> gateway PUT /admin/control-plane/powers
 *
 * Thin pass-through onto the api-gateway, which enforces SUPER_ADMIN / ADMIN,
 * rejects sovereign / kill-switch flags, and hash-chains every mutation into a
 * SecurityEvent + undo_journal row. The staff session cookie + Authorization
 * header are forwarded by `proxyJson`; this proxy never touches business data.
 */

import { NextRequest } from 'next/server';
import { getApiGatewayBase, proxyJson, readJsonBody } from '@/lib/proxy';

export const runtime = 'nodejs';

const BASE_PATH = '/api/v1/admin/control-plane/powers';

export async function GET(req: NextRequest) {
  const base = getApiGatewayBase();
  const flags = req.nextUrl.searchParams.get('flags');
  const query = flags ? `?flags=${encodeURIComponent(flags)}` : '';
  return proxyJson(`${base}${BASE_PATH}${query}`, { method: 'GET' });
}

export async function PUT(req: NextRequest) {
  const base = getApiGatewayBase();
  const body = (await readJsonBody(req)) ?? JSON.stringify({});
  return proxyJson(`${base}${BASE_PATH}`, { method: 'PUT', body });
}
