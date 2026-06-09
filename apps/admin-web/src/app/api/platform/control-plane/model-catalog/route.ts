/**
 * Control-plane MODEL-CATALOG BFF proxy.
 *
 *   GET /api/platform/control-plane/model-catalog
 *     -> gateway GET /admin/control-plane/model-catalog
 *
 * Read-only. Returns the model catalog (cost / capability / latency), the
 * combine-strategy enum, and the assignable + locked use-case sets so the
 * admin UI hydrates real metadata for the pickers. Forwards auth only.
 */

import { getApiGatewayBase, proxyJson } from '@/lib/proxy';

export const runtime = 'nodejs';

export async function GET() {
  const base = getApiGatewayBase();
  return proxyJson(`${base}/api/v1/admin/control-plane/model-catalog`, {
    method: 'GET',
  });
}
