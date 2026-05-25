import { getApiGatewayBase, proxyJson } from '@/lib/proxy';

/**
 * Privacy-budget readout proxy.
 *
 * Forwards GET /api/v1/platform/budget (DP-accountant snapshot) to the
 * api-gateway with the staff session cookie + Authorization header so
 * the gateway can enforce HQ-tier auth upstream. The accountant lives
 * in `@borjie/graph-privacy`; the gateway composes it onto the
 * registry via `services.privacyBudgetComposer`.
 */
export async function GET() {
  const base = getApiGatewayBase();
  return proxyJson(`${base}/api/v1/platform/budget`, { method: 'GET' });
}
