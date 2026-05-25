/**
 * Agent Platform Types
 *
 * Shared type definitions for the cross-agent layer. Every type is readonly
 * so downstream consumers cannot mutate the request/response envelope.
 */

// ============================================================================
// Registered agents
// ============================================================================

export interface RegisteredAgent {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly ownerTenantId: string;
  readonly apiKeyPrefix: string;
  readonly apiKeyHash: string;
  readonly hmacSecretHash: string;
  readonly scopes: ReadonlyArray<AgentScope>;
  readonly rateLimitRpm: number;
  readonly webhookUrl?: string;
  readonly status: AgentStatus;
  readonly createdAt: string;
  readonly lastSeenAt?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export type AgentStatus = 'active' | 'suspended' | 'revoked';

// ============================================================================
// Scope vocabulary
// ============================================================================

export type AgentScope =
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
  | 'execute:skills'
  | 'subscribe:events'
  | 'admin:agents';

export const ALL_AGENT_SCOPES: ReadonlyArray<AgentScope> = Object.freeze([
  'read:properties',
  'read:tenants',
  'read:cases',
  'write:cases',
  'read:letters',
  'write:letters',
  'read:payments',
  'read:occupancy',
  'read:graph',
  'read:warehouse',
  'read:taxonomy',
  'read:compliance',
  'read:ai-costs',
  'execute:skills',
  'subscribe:events',
  'admin:agents',
]);

// ============================================================================
// Auth result
// ============================================================================

export interface AgentAuthSuccess {
  readonly ok: true;
  readonly agent: RegisteredAgent;
  readonly scopes: ReadonlyArray<AgentScope>;
  readonly correlationId: string;
}

export interface AgentAuthError {
  readonly ok: false;
  readonly error: string;
  readonly errorCode: string;
  readonly status: number;
  readonly correlationId: string;
}

export type AgentAuthResult = AgentAuthSuccess | AgentAuthError;

// ============================================================================
// Structured error envelope
// ============================================================================

export interface AgentErrorResponse {
  readonly ok: false;
  readonly error: string;
  readonly errorCode: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: string;
}

// ============================================================================
// Idempotency
// ============================================================================

export interface IdempotencyRecord {
  readonly key: string;
  readonly agentId: string;
  readonly method: string;
  readonly path: string;
  readonly requestHash: string;
  readonly statusCode: number;
  readonly responseBody: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

// ============================================================================
// Webhook subscriptions / deliveries
// ============================================================================

export interface WebhookSubscription {
  readonly id: string;
  readonly agentId: string;
  readonly tenantId: string;
  readonly eventTypes: ReadonlyArray<string>;
  readonly url: string;
  readonly secretHash: string;
  readonly status: WebhookSubscriptionStatus;
  readonly failureCount: number;
  readonly lastDeliveredAt?: string;
  readonly createdAt: string;
}

export type WebhookSubscriptionStatus = 'active' | 'paused' | 'failed';

export interface WebhookDelivery {
  readonly id: string;
  readonly subscriptionId: string;
  readonly eventType: string;
  readonly eventId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly status: WebhookDeliveryStatus;
  readonly attempts: number;
  readonly lastAttemptAt?: string;
  readonly responseStatus?: number;
  readonly errorMessage?: string;
  readonly createdAt: string;
}

export type WebhookDeliveryStatus =
  | 'pending'
  | 'delivered'
  | 'failed'
  | 'retrying';

// ============================================================================
// Event catalog — subscribable event types
// ============================================================================

export const SUBSCRIBABLE_EVENTS: ReadonlyArray<string> = Object.freeze([
  'property.created',
  'property.updated',
  'unit.created',
  'unit.updated',
  'lease.created',
  'lease.renewed',
  'lease.terminated',
  'tenant.created',
  'tenant.updated',
  'case.created',
  'case.assigned',
  'case.resolved',
  'payment.received',
  'payment.failed',
  'arrears.threshold_breached',
  'compliance.flag_raised',
  'ai.budget_warning',
]);

// ============================================================================
// Agent card (A2A)
// ============================================================================

export interface AgentCard {
  readonly name: string;
  readonly description: string;
  readonly url: string;
  readonly version: string;
  readonly provider: AgentCardProvider;
  readonly capabilities: ReadonlyArray<AgentCapability>;
  readonly authentication: AgentCardAuth;
  readonly tools: ReadonlyArray<ToolSummary>;
  readonly resources: ReadonlyArray<ResourceSummary>;
  readonly rateLimit: AgentCardRateLimit;
}

export interface AgentCardProvider {
  readonly organization: string;
  readonly url: string;
  readonly contact: string;
}

export interface AgentCapability {
  readonly name: string;
  readonly description: string;
}

export interface AgentCardAuth {
  readonly schemes: ReadonlyArray<string>;
  readonly registrationUrl: string;
  readonly tokenUrl?: string;
}

export interface ToolSummary {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly requiredScopes: ReadonlyArray<string>;
  readonly category: string;
}

export interface ResourceSummary {
  readonly uri: string;
  readonly name: string;
  readonly description: string;
  readonly mimeType: string;
}

export interface AgentCardRateLimit {
  readonly defaultRpm: number;
  readonly maxRpm: number;
  readonly burstLimit: number;
}
