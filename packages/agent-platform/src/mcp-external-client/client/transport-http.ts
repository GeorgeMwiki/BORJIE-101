/**
 * Streamable HTTP transport adapter (modern MCP remote).
 *
 * The MCP spec moved from SSE to streamable HTTP for remote servers in
 * late 2024. The SDK ships `StreamableHTTPClientTransport`; we build
 * the params it consumes.
 *
 * Spec: `Docs/DESIGN/MCP_EXTERNAL_CLIENT_SPEC.md` §2.
 */

import type { McpAuthContext, McpCatalogEntry } from '../types.js';
import { isSafeUrl } from './transport-sse.js';

export interface HttpConnectionParams {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export function buildHttpConnectionParams(
  entry: McpCatalogEntry,
  auth: McpAuthContext,
  endpointUrl: string,
): HttpConnectionParams {
  if (entry.transport !== 'http') {
    throw new Error(
      `transport-http: catalog entry ${entry.id} declares ${entry.transport}`,
    );
  }
  if (!isSafeUrl(endpointUrl)) {
    throw new Error(`transport-http: refusing unsafe url ${endpointUrl}`);
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
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
