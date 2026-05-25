import { NextRequest, NextResponse } from 'next/server';

import { getApiGatewayBase, proxyJson } from '@/lib/proxy';

interface RouteContext {
  readonly params: Promise<{ readonly threadId: string }>;
}

/**
 * Proxy: read a single platform-scope intelligence thread.
 *
 * Forwards GET /api/v1/intelligence/thread/:id (with `scope=platform`
 * enforcement upstream) and mirrors the gateway response.
 */
export async function GET(
  _req: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const params = await context.params;
  const threadId = params.threadId;
  if (!threadId || threadId.length === 0) {
    return NextResponse.json({ error: 'threadId required' }, { status: 400 });
  }
  const base = getApiGatewayBase();
  const url = `${base}/api/v1/intelligence/thread/${encodeURIComponent(threadId)}?scope=platform`;
  return proxyJson(url, { method: 'GET' });
}
