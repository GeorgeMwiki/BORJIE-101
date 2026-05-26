/**
 * Server-Sent-Events transport adapter (legacy remote MCP).
 *
 * Modern MCP remote servers prefer streamable HTTP, but a non-trivial
 * subset still publishes over SSE. The SDK ships
 * `SSEClientTransport`; we expose a `buildSseConnectionParams` builder
 * symmetrical to the stdio one.
 *
 * Spec: `Docs/DESIGN/MCP_EXTERNAL_CLIENT_SPEC.md` §2.
 */

import type { McpAuthContext, McpCatalogEntry } from '../types.js';

export interface SseConnectionParams {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * Build SSE params from an entry + auth. `endpointUrl` is supplied per
 * call rather than hardcoded in the catalog because remote endpoints
 * are per-tenant in many providers.
 */
export function buildSseConnectionParams(
  entry: McpCatalogEntry,
  auth: McpAuthContext,
  endpointUrl: string,
): SseConnectionParams {
  if (entry.transport !== 'sse') {
    throw new Error(
      `transport-sse: catalog entry ${entry.id} declares ${entry.transport}`,
    );
  }
  if (!isSafeUrl(endpointUrl)) {
    throw new Error(`transport-sse: refusing unsafe url ${endpointUrl}`);
  }
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
  };
  if (auth.mode === 'api_key' && auth.apiKey) {
    headers['Authorization'] = `Bearer ${auth.apiKey}`;
  }
  if (
    (auth.mode === 'oauth_token' || auth.mode === 'oauth_pkce') &&
    auth.accessToken
  ) {
    headers['Authorization'] = `Bearer ${auth.accessToken}`;
  }
  return Object.freeze({
    url: endpointUrl,
    headers: Object.freeze(headers),
  });
}

/**
 * Cheap SSRF guard — disallows non-https, loopback, private ranges. The
 * webhook-delivery package owns the canonical guard; we mirror its
 * shape so the security review can grep both.
 */
export function isSafeUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname;
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1'
  ) {
    return false;
  }
  if (/^10\./.test(host)) return false;
  if (/^192\.168\./.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  return true;
}
