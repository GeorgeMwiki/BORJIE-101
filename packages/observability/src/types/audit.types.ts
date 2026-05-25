/**
 * Audit Event Types for BORJIE Platform
 * 
 * These types define the structure for audit logging across all services.
 * Audit events are immutable and stored for compliance, security, and operational visibility.
 */

/**
 * Categories of audit events aligned with domain operations
 */
export const AuditCategory = {
  /** Authentication and session events */
  AUTH: 'AUTH',
  /** Authorization and access control events */
  AUTHZ: 'AUTHZ',
  /** Tenant and organization management */
  TENANT: 'TENANT',
  /** User account operations */
  USER: 'USER',
  /** Property and unit management */
  PROPERTY: 'PROPERTY',
  /** Lease and occupancy events */
  LEASE: 'LEASE',
  /** Payment and financial transactions */
  PAYMENT: 'PAYMENT',
  /** Maintenance and work orders */
  MAINTENANCE: 'MAINTENANCE',
  /** Document and file operations */
  DOCUMENT: 'DOCUMENT',
  /** Communication and notifications */
  COMMUNICATION: 'COMMUNICATION',
  /** System and infrastructure events */
  SYSTEM: 'SYSTEM',
  /** Data access and export events */
  DATA_ACCESS: 'DATA_ACCESS',
} as const;

export type AuditCategory = typeof AuditCategory[keyof typeof AuditCategory];

/**
 * Outcome of the audited operation
 */
export const AuditOutcome = {
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  DENIED: 'DENIED',
  ERROR: 'ERROR',
} as const;

export type AuditOutcome = typeof AuditOutcome[keyof typeof AuditOutcome];

/**
 * Severity level for audit events
 */
export const AuditSeverity = {
  /** Routine operations */
  INFO: 'INFO',
  /** Notable but non-critical events */
  WARNING: 'WARNING',
  /** Security-relevant or compliance-critical events */
  CRITICAL: 'CRITICAL',
} as const;

export type AuditSeverity = typeof AuditSeverity[keyof typeof AuditSeverity];

/**
 * Actor performing the audited action
 */
export interface AuditActor {
  /** Actor type: user, service, system */
  type: 'user' | 'service' | 'system';
  /** Unique identifier of the actor */
  id: string;
  /** Human-readable name or service name */
  name?: string;
  /** Email for user actors */
  email?: string;
  /** Roles active at time of action */
  roles?: string[];
  /** IP address if applicable */
  ipAddress?: string;
  /** User agent if applicable */
  userAgent?: string;
}

/**
 * Target resource of the audited action
 */
export interface AuditTarget {
  /** Resource type (e.g., 'Property', 'Lease', 'User') */
  type: string;
  /** Resource identifier */
  id: string;
  /** Human-readable name or description */
  name?: string;
  /** Additional identifiers (e.g., unit number, lease reference) */
  identifiers?: Record<string, string>;
}

/**
 * Tenant context for multi-tenant isolation
 */
export interface AuditTenantContext {
  /** Tenant/organization ID */
  tenantId: string;
  /** Tenant name */
  tenantName?: string;
  /** Environment (production, staging, development) */
  environment?: string;
}

/**
 * Request context for traceability
 */
export interface AuditRequestContext {
  /** Correlation/trace ID for distributed tracing */
  traceId?: string;
  /** Span ID within the trace */
  spanId?: string;
  /** Request ID from API gateway */
  requestId?: string;
  /** Session ID if applicable */
  sessionId?: string;
  /** Source service name */
  sourceService?: string;
  /** HTTP method if applicable */
  httpMethod?: string;
  /** API endpoint path if applicable */
  httpPath?: string;
}

/**
 * Change details for data modification events
 */
export interface AuditChangeRecord {
  /** Field name that changed */
  field: string;
  /** Previous value (redacted for sensitive fields) */
  previousValue?: unknown;
  /** New value (redacted for sensitive fields) */
  newValue?: unknown;
  /** Whether value was redacted */
  redacted?: boolean;
}

/**
 * Complete audit event structure
 */
export interface AuditEvent {
  /** Unique event identifier (UUID v7 for time-ordering) */
  id: string;
  /** Event timestamp in ISO 8601 format */
  timestamp: string;
  /** Timestamp in milliseconds since epoch for indexing */
  timestampMs: number;
  /** Event category */
  category: AuditCategory;
  /** Specific action performed (e.g., 'LOGIN', 'CREATE', 'UPDATE', 'DELETE') */
  action: string;
  /** Human-readable description of the event */
  description: string;
  /** Outcome of the operation */
  outcome: AuditOutcome;
  /** Severity level */
  severity: AuditSeverity;
  /** Actor who performed the action */
  actor: AuditActor;
  /** Target resource(s) of the action */
  targets?: AuditTarget[];
  /** Tenant context for multi-tenant isolation */
  tenant?: AuditTenantContext;
  /** Request context for traceability */
  request?: AuditRequestContext;
  /** Data changes for modification events */
  changes?: AuditChangeRecord[];
  /** Reason for action (for approvals, denials, etc.) */
  reason?: string;
  /** Additional metadata specific to the event type */
  metadata?: Record<string, unknown>;
  /** Schema version for evolution */
  schemaVersion: string;
}

/**
 * Options for creating audit events
 */
export interface CreateAuditEventOptions {
  category: AuditCategory;
  action: string;
  description: string;
  outcome: AuditOutcome;
  severity?: AuditSeverity;
  actor: AuditActor;
  targets?: AuditTarget[];
  tenant?: AuditTenantContext;
  request?: AuditRequestContext;
  changes?: AuditChangeRecord[];
  reason?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Query options for retrieving audit events
 */
export interface AuditQueryOptions {
  /** Filter by tenant ID */
  tenantId?: string;
  /** Filter by actor ID */
  actorId?: string;
  /** Filter by category */
  category?: AuditCategory;
  /** Filter by action */
  action?: string;
  /** Filter by outcome */
  outcome?: AuditOutcome;
  /** Filter by target type */
  targetType?: string;
  /** Filter by target ID */
  targetId?: string;
  /** Start timestamp (inclusive) */
  startTime?: Date;
  /** End timestamp (exclusive) */
  endTime?: Date;
  /** Pagination: offset */
  offset?: number;
  /** Pagination: limit (max 1000) */
  limit?: number;
  /** Sort order */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Paginated audit query result
 */
export interface AuditQueryResult {
  events: AuditEvent[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}
