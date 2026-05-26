/**
 * `@borjie/agent-platform/mcp-external-client` — barrel.
 *
 * Wave 18BB-MCP-EXT. Spec:
 * `Docs/DESIGN/MCP_EXTERNAL_CLIENT_SPEC.md`.
 *
 * This sub-barrel is intentionally *not* re-exported from the parent
 * `agent-platform/src/index.ts` — the parent barrel is touched by
 * Wave 18V-FIX concurrent work; we avoid merge conflicts the same way
 * `junior-spawner/index.ts` does. Downstream consumers import from
 * `@borjie/agent-platform/src/mcp-external-client/index.ts` until the
 * parent barrel is wired in a follow-up.
 */

// Types
export type {
  McpAuthMode,
  McpAuthContext,
  McpAuditLink,
  McpCatalogEntry,
  McpClientFactory,
  McpClientLike,
  McpMutationTier,
  McpResultContent,
  McpServerHandle,
  McpToolDescriptor,
  McpToolInvocation,
  McpToolResult,
  McpTransportKind,
} from './types.js';

// Catalog
export {
  PUBLIC_MCP_CATALOG,
  findCatalogEntry,
  isCatalogWellFormed,
} from './catalog/public-servers.js';

// Client + transports
export { createMcpExternalClient } from './client/mcp-client.js';
export type { McpExternalClientDeps } from './client/mcp-client.js';
export {
  buildStdioConnectionParams,
  envKeyForServer,
} from './client/transport-stdio.js';
export type { StdioConnectionParams } from './client/transport-stdio.js';
export {
  buildSseConnectionParams,
  isSafeUrl,
} from './client/transport-sse.js';
export type { SseConnectionParams } from './client/transport-sse.js';
export { buildHttpConnectionParams } from './client/transport-http.js';
export type { HttpConnectionParams } from './client/transport-http.js';

// Auth
export { createOAuthTokenManager } from './auth/oauth-token-manager.js';
export type {
  CredentialStore,
  DecryptedCredentials,
  OAuthRefresher,
  OAuthTokenManagerDeps,
} from './auth/oauth-token-manager.js';

// Invocation
export { createToolDispatcher } from './invocation/tool-dispatcher.js';
export type {
  AuditChainSink,
  ConnectionLookup,
  InvokeAdapter,
  MutationAuthority,
  ToolDispatcherDeps,
  TierOverrideMap,
} from './invocation/tool-dispatcher.js';
export { mapMcpResult } from './invocation/result-mapper.js';
export type { RawMcpCallResult } from './invocation/result-mapper.js';

// Audit
export { buildAuditLink } from './audit/audit-chain-link.js';
export type { BuildAuditLinkInput } from './audit/audit-chain-link.js';
