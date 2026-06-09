/**
 * Control-plane LLM-ROUTING BFF proxy.
 *
 *   GET /api/platform/control-plane/llm-routing?scope=global|tenant:<id>
 *     -> gateway GET /admin/control-plane/llm-routing
 *   PUT /api/platform/control-plane/llm-routing
 *     -> gateway PUT /admin/control-plane/llm-routing
 *
 * Thin pass-through onto the api-gateway. The gateway is the authoritative gate:
 * it re-validates the routing document (validateRoutingConfig + validateEnsemble),
 * drops locked / sovereign use-cases, projects ensemble cost, and audits every
 * write. This proxy only forwards auth + body — platform config, never tenant data.
 */

import { NextRequest } from 'next/server';
import { getApiGatewayBase, proxyJson, readJsonBody } from '@/lib/proxy';

export const runtime = 'nodejs';

const BASE_PATH = '/api/v1/admin/control-plane/llm-routing';

export async function GET(req: NextRequest) {
  const base = getApiGatewayBase();
  const scope = req.nextUrl.searchParams.get('scope');
  const query = scope ? `?scope=${encodeURIComponent(scope)}` : '';
  return proxyJson(`${base}${BASE_PATH}${query}`, { method: 'GET' });
}

export async function PUT(req: NextRequest) {
  const base = getApiGatewayBase();
  const body = (await readJsonBody(req)) ?? JSON.stringify({});
  return proxyJson(`${base}${BASE_PATH}`, { method: 'PUT', body });
}
