import { getApiGatewayBase, proxyJson } from '@/lib/proxy';

/**
 * Proxy: list platform-scope intelligence threads (Industry conversations).
 *
 * Forwards GET /api/v1/intelligence/threads?scope=platform to the
 * api-gateway with the staff session cookie + Authorization header so
 * the gateway can enforce the SUPER_ADMIN / ADMIN role gate upstream.
 *
 * In production `API_GATEWAY_URL` must be set; the proxy helper throws
 * if not. In dev it falls back to `http://localhost:4000`.
 */
export async function GET() {
  const base = getApiGatewayBase();
  return proxyJson(`${base}/api/v1/intelligence/threads?scope=platform`, {
    method: 'GET',
  });
}
