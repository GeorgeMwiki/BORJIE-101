/**
 * Borjie public MCP server — shared types.
 *
 * The public MCP surface differs from the internal `@borjie/mcp-server`
 * (BossNyumba-era property tooling) in three ways:
 *   1. Auth is OAuth2 device flow, not API key.
 *   2. Scopes are Borjie-mining-domain shaped (`owner:read`,
 *      `owner:write`, `owner:draft`, `owner:reminders`, `owner:share`,
 *      `admin:read`).
 *   3. Tool descriptors are sourced from the api-gateway brain-tools
 *      catalog at boot — no parallel registry.
 *
 * Tenant isolation: every tool call carries the agent's auth context
 * which holds the tenantId resolved from the access-token row. The
 * gateway middleware binds `app.current_tenant_id` GUC before any
 * downstream database call. The MCP layer never reaches across tenants.
 */

export type BorjieScope =
  | 'owner:read'
  | 'owner:write'
  | 'owner:draft'
  | 'owner:reminders'
  | 'owner:share'
  | 'admin:read';

export const BORJIE_SCOPES: ReadonlyArray<BorjieScope> = Object.freeze([
  'owner:read',
  'owner:write',
  'owner:draft',
  'owner:reminders',
  'owner:share',
  'admin:read',
]);

export interface BorjieMcpAuthContext {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly agentName: string;
  readonly agentTokenId: string;
  readonly scopes: ReadonlyArray<BorjieScope>;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly correlationId: string;
}

/**
 * A tool descriptor for the public MCP server. Mirrors the brain-tools
 * descriptor shape but flattens the zod schema to JSON Schema so MCP
 * clients (which do not know about zod) can render it.
 */
export interface BorjieMcpToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: BorjieMcpJsonSchema;
  readonly requiredScopes: ReadonlyArray<BorjieScope>;
  readonly stakes: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly isWrite: boolean;
  readonly requiresConfirmation: boolean;
}

export interface BorjieMcpJsonSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, BorjieMcpJsonProperty>>;
  readonly required: ReadonlyArray<string>;
}

export interface BorjieMcpJsonProperty {
  readonly type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  readonly description?: string;
  readonly enum?: ReadonlyArray<string>;
  readonly items?: BorjieMcpJsonProperty;
  readonly format?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Resources — what an external MCP client can read as side-data
// ─────────────────────────────────────────────────────────────────────

export interface BorjieMcpResource {
  readonly uri: string;
  readonly name: string;
  readonly description: string;
  readonly mimeType: string;
}

export interface BorjieMcpResourceContent {
  readonly uri: string;
  readonly mimeType: string;
  readonly text?: string;
  readonly base64?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Prompts — pre-canned prompt templates exposed via prompts/list
// ─────────────────────────────────────────────────────────────────────

export interface BorjieMcpPrompt {
  readonly name: string;
  readonly description: string;
  readonly arguments: ReadonlyArray<BorjieMcpPromptArgument>;
}

export interface BorjieMcpPromptArgument {
  readonly name: string;
  readonly description: string;
  readonly required: boolean;
}

export interface BorjieMcpPromptMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: { readonly type: 'text'; readonly text: string };
}

// ─────────────────────────────────────────────────────────────────────
// Tool invocation — the response shape mirrors the home-chat envelope
// so external agents render the same blocks the owner sees.
// ─────────────────────────────────────────────────────────────────────

export interface BorjieMcpToolSuccess {
  readonly ok: true;
  readonly content: ReadonlyArray<BorjieMcpToolContentBlock>;
  readonly confidence: number;
  readonly evidenceIds: ReadonlyArray<string>;
  readonly provenance: BorjieMcpProvenance;
  readonly requiresConfirmation: boolean;
}

export interface BorjieMcpToolFailure {
  readonly ok: false;
  readonly errorCode: string;
  readonly message: string;
  readonly correlationId: string;
}

export type BorjieMcpToolResult = BorjieMcpToolSuccess | BorjieMcpToolFailure;

export interface BorjieMcpToolContentBlock {
  readonly type: 'text' | 'json' | 'card' | 'media' | 'draft';
  readonly text?: string;
  readonly data?: unknown;
}

export interface BorjieMcpProvenance {
  readonly via: 'mcp';
  readonly agentName: string;
  readonly agentTokenId: string;
  readonly toolName: string;
  readonly invokedAt: string;
  readonly auditChainHash: string;
}
