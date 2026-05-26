/**
 * `@borjie/agent-platform/mcp-external-client` — public type surface.
 *
 * Wave 18BB-MCP-EXT. Spec: `Docs/DESIGN/MCP_EXTERNAL_CLIENT_SPEC.md`.
 *
 * Borjie publishes three internal MCP servers (`services/mcp-server-*`)
 * but the kernel cannot consume *from* the wider MCP ecosystem (10,000+
 * public servers — Slack, GitHub, Notion, GDrive, …). This module
 * defines the type contract for the inverse arrow: connecting outward
 * to public MCP servers and surfacing their tools to the kernel tool
 * registry as first-class entries.
 *
 * No runtime behaviour here — pure types. The client implementation
 * (`client/mcp-client.ts`) and dispatcher (`invocation/tool-dispatcher.ts`)
 * consume these.
 */

/** Transport flavours the client can speak. */
export type McpTransportKind = 'stdio' | 'sse' | 'http';

/** Authentication modes a catalog entry can declare. */
export type McpAuthMode = 'none' | 'api_key' | 'oauth_token' | 'oauth_pkce';

/**
 * Mutation-authority tier carried on every external tool call. Tier 0 =
 * read-only, tier 1 = side-effect, tier 2 = irreversible. The dispatcher
 * runs the tier check *before* the remote call leaves the box.
 */
export type McpMutationTier = 0 | 1 | 2;

/**
 * Catalog entry — static metadata about a known public MCP server.
 * Tenants opt in by inserting an `mcp_external_connections` row that
 * references one of these `id`s.
 */
export interface McpCatalogEntry {
  readonly id: string;
  readonly displayName: string;
  readonly packageName: string;
  readonly transport: McpTransportKind;
  readonly auth: McpAuthMode;
  readonly maxTier: McpMutationTier;
  readonly description: string;
  readonly oauthProvider?: string;
  readonly scopes?: readonly string[];
}

/**
 * Auth context handed to the client at invocation time. The token
 * manager fetches this from the encrypted store; the client must never
 * hold it longer than the invocation.
 */
export interface McpAuthContext {
  readonly tenantId: string;
  readonly serverId: string;
  readonly mode: McpAuthMode;
  readonly accessToken?: string;
  readonly apiKey?: string;
  readonly expiresAt?: number;
}

/**
 * Descriptor returned by `tools/list` on a remote server. We re-validate
 * the input schema with Ajv before dispatching — never trust a remote
 * schema blindly.
 */
export interface McpToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

/** A kernel-facing tool invocation against a remote MCP server. */
export interface McpToolInvocation {
  readonly tenantId: string;
  readonly serverId: string;
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly correlationId: string;
}

/** Canonical result envelope the kernel sees. */
export interface McpToolResult {
  readonly ok: boolean;
  readonly content: ReadonlyArray<McpResultContent>;
  readonly errorMessage?: string;
}

export type McpResultContent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'json'; readonly value: unknown };

/**
 * A live handle to one connected MCP server. The external client owns
 * a map of these keyed by `(tenantId, serverId)`.
 */
export interface McpServerHandle {
  readonly tenantId: string;
  readonly serverId: string;
  readonly entry: McpCatalogEntry;
  readonly tools: ReadonlyArray<McpToolDescriptor>;
  readonly connectedAt: number;
  readonly close: () => Promise<void>;
}

/** Audit-chain link emitted on every external tool call. */
export interface McpAuditLink {
  readonly tenantId: string;
  readonly connectionId: string;
  readonly toolName: string;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly outcome: 'ok' | 'error';
  readonly errorMessage?: string;
}

/**
 * Internal: handle the SDK Client through this opaque interface so the
 * surface area we depend on is small (and so tests can pass a fake).
 */
export interface McpClientLike {
  readonly listTools: () => Promise<ReadonlyArray<McpToolDescriptor>>;
  readonly callTool: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<McpToolResult>;
  readonly close: () => Promise<void>;
}

/** Pure factory: catalog + auth → live client. Injected for testing. */
export type McpClientFactory = (
  entry: McpCatalogEntry,
  auth: McpAuthContext,
) => Promise<McpClientLike>;
