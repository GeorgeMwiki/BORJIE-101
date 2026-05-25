/**
 * BORJIE MCP Types
 *
 * Shared type definitions for the MCP server. These bridge between
 * the Model Context Protocol and BORJIE's multi-tenant property
 * management domain.
 *
 * Every type is readonly / immutable — we never mutate tenant-scoped
 * data in place.
 */

// ============================================================================
// Server Configuration
// ============================================================================

export interface McpServerConfig {
  readonly name: string;
  readonly version: string;
  readonly description: string;
}

// ============================================================================
// Tenant-Scoped Auth Principal
// ============================================================================

/**
 * Everything that downstream tool handlers need to know about the caller.
 * Always scoped to a single tenant — tools receive this object and must
 * never return data from a different tenant.
 */
export interface McpAuthContext {
  readonly tenantId: string;
  readonly principalId: string;
  readonly principalType: 'api-key' | 'jwt';
  readonly tier: McpTier;
  readonly scopes: ReadonlyArray<McpScope>;
  readonly issuedAt: number;
  readonly expiresAt?: number;
  readonly correlationId: string;
}

export type McpScope =
  | 'read:properties'
  | 'read:tenants'
  | 'read:cases'
  | 'write:cases'
  | 'read:letters'
  | 'write:letters'
  | 'read:payments'
  | 'read:occupancy'
  | 'read:graph'
  | 'read:warehouse'
  | 'read:taxonomy'
  | 'read:compliance'
  | 'read:ai-costs'
  | 'execute:skills';

// ============================================================================
// Tier Model
// ============================================================================

/**
 * SaaS-subscription tier — controls which tools and models the caller
 * can reach. Cheapest first.
 */
export type McpTier = 'standard' | 'pro' | 'enterprise';

export interface TierDefinition {
  readonly tier: McpTier;
  readonly displayName: string;
  readonly description: string;
  readonly allowedTools: ReadonlyArray<string> | '*';
  readonly maxCostPerCallUsdMicro: number;
  readonly monthlyBudgetUsdMicro?: number;
}

// ============================================================================
// Tool Definitions
// ============================================================================

export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, McpSchemaProperty>>;
  readonly requiredInputs: ReadonlyArray<string>;
  readonly requiredScopes: ReadonlyArray<McpScope>;
  readonly minimumTier: McpTier;
  readonly estimatedCostUsdMicro: number;
}

export interface McpSchemaProperty {
  readonly type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  readonly description?: string;
  readonly enum?: ReadonlyArray<string>;
}

// ============================================================================
// Tool Results (MCP-shaped)
// ============================================================================

export interface McpToolSuccess<T = unknown> {
  readonly ok: true;
  readonly data: T;
}

export interface McpToolFailure {
  readonly ok: false;
  readonly error: string;
  readonly errorCode?: string;
}

export type McpToolResult<T = unknown> = McpToolSuccess<T> | McpToolFailure;

/**
 * A handler always receives an already-authenticated context that carries
 * the tenantId. It is the handler's responsibility to scope its reads.
 */
export type McpToolHandler = (
  input: Record<string, unknown>,
  context: McpAuthContext,
) => Promise<McpToolResult>;

// ============================================================================
// Resource Definitions
// ============================================================================

export interface McpStaticResource {
  readonly uri: string;
  readonly name: string;
  readonly description: string;
  readonly mimeType: string;
  readonly category: McpResourceCategory;
}

export interface McpTemplateResource {
  readonly uriTemplate: string;
  readonly name: string;
  readonly description: string;
  readonly mimeType: string;
}

export type McpResourceCategory =
  | 'portfolio'
  | 'tenant'
  | 'compliance'
  | 'analytics'
  | 'maintenance'
  | 'warehouse'
  | 'graph';

export type McpResourceResolver = (
  uri: string,
  context: McpAuthContext,
  variables?: Record<string, string>,
) => Promise<string>;

// ============================================================================
// Cost Tracking
// ============================================================================

export interface McpCostEntry {
  readonly tenantId: string;
  readonly principalId: string;
  readonly toolName: string;
  readonly tier: McpTier;
  readonly estimatedCostUsdMicro: number;
  readonly actualCostUsdMicro?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly durationMs: number;
  readonly wasFree: boolean;
  readonly correlationId: string;
  readonly timestamp: string;
}

export interface McpCostSnapshot {
  readonly tenantId: string;
  readonly totalCostUsdMicro: number;
  readonly callCount: number;
  readonly freeCallCount: number;
  readonly paidCallCount: number;
  readonly costByTool: Readonly<Record<string, number>>;
  readonly costByTier: Readonly<Record<McpTier, number>>;
  readonly periodStart: string;
  readonly periodEnd: string;
}

/**
 * Tiny port the MCP server uses to persist cost. In prod this is wired
 * to the Wave-10 AI cost ledger (@borjie/ai-copilot createCostLedger).
 * In tests we inject an in-memory implementation.
 */
export interface CostLedgerPort {
  record(entry: McpCostEntry): Promise<void>;
  snapshot(tenantId: string): Promise<McpCostSnapshot>;
}

// ============================================================================
// Auth Port (pluggable — API key lookup OR JWT verification)
// ============================================================================

export interface AuthPort {
  authenticate(
    request: AuthRequestLike,
  ): Promise<McpAuthContext | AuthFailure>;
}

export interface AuthRequestLike {
  readonly headers: Readonly<Record<string, string | undefined>>;
}

export interface AuthFailure {
  readonly ok: false;
  readonly status: number;
  readonly error: string;
  readonly errorCode: string;
}

// ============================================================================
// Skill (universal tool adapter) input
// ============================================================================

export interface RunSkillInput {
  readonly skillName: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export interface RunSkillResult {
  readonly skillName: string;
  readonly result: McpToolResult;
  readonly durationMs: number;
}
