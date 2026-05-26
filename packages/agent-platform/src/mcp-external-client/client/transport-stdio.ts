/**
 * stdio transport adapter.
 *
 * For local MCP servers Borjie spawns as subprocesses (filesystem,
 * puppeteer, memory, sequential-thinking, plus any package the catalog
 * marks as `transport: 'stdio'`). The SDK provides
 * `StdioClientTransport` from `@modelcontextprotocol/sdk/client/stdio`;
 * we lazy-load it so the package still type-checks without the SDK at
 * runtime (mirrors the pattern in `services/mcp-server-tra/src/mcp.ts`).
 *
 * Spec: `Docs/DESIGN/MCP_EXTERNAL_CLIENT_SPEC.md` §2.
 */

import type { McpAuthContext, McpCatalogEntry } from '../types.js';

/** Connection params the SDK consumes — kept small for clarity. */
export interface StdioConnectionParams {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string>>;
}

/**
 * Translate a catalog entry + auth context into the stdio params the
 * SDK accepts. The auth tokens are injected as environment variables;
 * each public server documents the envs it reads (`SLACK_BOT_TOKEN`,
 * `GITHUB_TOKEN`, …).
 */
export function buildStdioConnectionParams(
  entry: McpCatalogEntry,
  auth: McpAuthContext,
): StdioConnectionParams {
  if (entry.transport !== 'stdio') {
    throw new Error(
      `transport-stdio: catalog entry ${entry.id} declares ${entry.transport}`,
    );
  }
  const env: Record<string, string> = {};
  if (auth.mode === 'api_key' && auth.apiKey) {
    env[envKeyForServer(entry.id, 'API_KEY')] = auth.apiKey;
  }
  if (
    (auth.mode === 'oauth_token' || auth.mode === 'oauth_pkce') &&
    auth.accessToken
  ) {
    env[envKeyForServer(entry.id, 'TOKEN')] = auth.accessToken;
  }
  return Object.freeze({
    command: 'npx',
    args: Object.freeze(['-y', entry.packageName]),
    env: Object.freeze(env),
  });
}

/**
 * Map a catalog id to the conventional env var. Hand-rolled — the
 * upstream servers do not share a single convention.
 */
export function envKeyForServer(
  serverId: string,
  kind: 'API_KEY' | 'TOKEN',
): string {
  switch (serverId) {
    case 'slack':
      return 'SLACK_BOT_TOKEN';
    case 'github':
      return 'GITHUB_TOKEN';
    case 'google-drive':
      return 'GOOGLE_DRIVE_ACCESS_TOKEN';
    case 'postgres':
      return 'POSTGRES_CONNECTION_STRING';
    case 'notion':
      return 'NOTION_API_TOKEN';
    case 'stripe':
      return 'STRIPE_SECRET_KEY';
    case 'linear':
      return 'LINEAR_API_KEY';
    default:
      return `BORJIE_MCP_${serverId.toUpperCase().replace(/-/g, '_')}_${kind}`;
  }
}
