import { NextRequest, NextResponse } from 'next/server';

import { getApiGatewayBase, proxyJson, readJsonBody } from '@/lib/proxy';

/**
 * Proxy: create a new platform-scope intelligence thread.
 *
 * Forwards POST /api/v1/intelligence/thread with `{ scope: 'platform',
 * persona: 'industry-observer' }` and the staff session cookie /
 * Authorization header so the gateway can enforce role gates.
 */
export async function POST(req: NextRequest) {
  const incoming = await readJsonBody(req);
  if (incoming === null) {
    return NextResponse.json({ error: 'json body required' }, { status: 400 });
  }
  // Re-serialise with scope + persona enforced at this layer so a
  // misbehaving caller cannot escape the platform scope by omitting
  // the field. The gateway double-checks but defence-in-depth here.
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(incoming) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  const body = JSON.stringify({
    ...parsed,
    scope: 'platform',
    persona: parsed.persona ?? 'industry-observer',
  });

  const base = getApiGatewayBase();
  return proxyJson(`${base}/api/v1/intelligence/thread`, {
    method: 'POST',
    body,
    contentType: 'application/json',
  });
}
