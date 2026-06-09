/**
 * Flow-autonomy BFF proxy (per-flow auto|gated postures).
 *
 *   GET /api/platform/workflow/flow-autonomy          -> gateway GET /api/v1/workflow/flow-autonomy
 *   GET /api/platform/workflow/flow-autonomy?pending=1 -> gateway GET /api/v1/workflow/flow-autonomy/pending
 *
 * Read-first. The set-posture decision (POST) is the OpenAI-SDK
 * always_approve primitive and stays a follow-up. Thin pass-through; the
 * gateway is auth-gated and the inviolable rails still gate every action.
 */

import { NextRequest } from 'next/server';
import { getApiGatewayBase, proxyJson } from '@/lib/proxy';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const base = getApiGatewayBase();
  const incoming = new URL(req.url);
  const pending = incoming.searchParams.get('pending');
  const path = pending === '1' ? '/flow-autonomy/pending' : '/flow-autonomy';
  return proxyJson(`${base}/api/v1/workflow${path}`, { method: 'GET' });
}
