/**
 * Observability Types - BORJIE Platform
 * 
 * Core type definitions for audit events, domain events, and event infrastructure.
 */

// Re-export existing audit types
export * from './types/audit.types.js';
export * from './types/telemetry.types.js';

// ============================================================================
// Domain Event Types
// ============================================================================

/**
 * Base domain event interface following DDD patterns
 */
export interface DomainEvent<T = unknown> {
  /** Unique event ID (UUID v7 for time-ordering) */
  id: string;
  /** Event type name (e.g., 'PropertyCreated', 'PaymentReceived') */
  type: string;
  /** Aggregate type that emitted the event */
  aggregateType: string;
  /** ID of the aggregate */
  aggregateId: string;
  /** Event timestamp */
  timestamp: Date;
  /** Timestamp in milliseconds for ordering */
  timestampMs: number;
  /** Event version for schema evolution */
  version: number;
  /** Event payload/data */
  payload: T;
  /** Event metadata */
  metadata: DomainEventMetadata;
}

/**
 * Metadata attached to domain events
 */
export interface DomainEventMetadata {
  /** Tenant ID for multi-tenant isolation */
  tenantId?: string;
  /** User ID who triggered the event */
  userId?: string;
  /** Correlation ID for request tracing */
  correlationId?: string;
  /** Causation ID (ID of the event that caused this one) */
  causationId?: string;
  /** Trace ID from distributed tracing */
  traceId?: string;
  /** Span ID from distributed tracing */
  spanId?: string;
  /** Source service that emitted the event */
  sourceService?: string;
  /** Additional custom metadata */
  custom?: Record<string, unknown>;
}

/**
 * Event envelope for outbox pattern
 */
export interface EventEnvelope<T = unknown> {
  /** Unique envelope ID */
  id: string;
  /** The domain event */
  event: DomainEvent<T>;
  /** Sequence number for ordering within aggregate */
  sequenceNumber: number;
  /** Event priority */
  priority: EventPriority;
  /** Processing status */
  status: OutboxStatus;
  /** Retry count */
  retryCount: number;
  /** Maximum retries allowed */
  maxRetries: number;
  /** Last error message if failed */
  lastError?: string;
  /** Next retry timestamp */
  nextRetryAt?: Date;
  /** Created timestamp */
  createdAt: Date;
  /** Published timestamp */
  publishedAt?: Date;
}

/**
 * Event priority levels
 */
export type EventPriority = 'low' | 'normal' | 'high' | 'critical';

/**
 * Outbox event status
 */
export type OutboxStatus = 'pending' | 'processing' | 'published' | 'failed' | 'dead_letter';

// ============================================================================
// Event Handler Types
// ============================================================================

/**
 * Event handler function signature
 */
export type EventHandler<T = unknown> = (event: DomainEvent<T>) => Promise<void>;

/**
 * Event handler with metadata
 */
export interface EventHandlerRegistration<T = unknown> {
  /** Unique handler ID */
  id: string;
  /** Event pattern to match (supports wildcards) */
  pattern: string;
  /** Handler function */
  handler: EventHandler<T>;
  /** Handler options */
  options?: EventHandlerOptions;
}

/**
 * Options for event handlers
 */
export interface EventHandlerOptions {
  /** Maximum concurrent executions */
  concurrency?: number;
  /** Retry on failure */
  retryOnFailure?: boolean;
  /** Maximum retries */
  maxRetries?: number;
  /** Retry delay in milliseconds */
  retryDelayMs?: number;
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Filter function for additional filtering */
  filter?: (event: DomainEvent) => boolean;
}

// ============================================================================
// Event Subscription Types
// ============================================================================

/**
 * Subscription configuration for external delivery
 */
export interface EventSubscription {
  /** Subscription ID */
  id: string;
  /** Subscriber identifier */
  subscriberId: string;
  /** Subscriber name */
  subscriberName: string;
  /** Event pattern to match */
  eventPattern: string;
  /** Aggregate pattern (optional) */
  aggregatePattern?: string;
  /** Delivery endpoint */
  endpoint: string;
  /** Endpoint type */
  endpointType: 'http' | 'https' | 'sqs' | 'sns' | 'kafka' | 'webhook';
  /** Custom headers for delivery */
  headers?: Record<string, string>;
  /** Whether subscription is active */
  isActive: boolean;
  /** Rate limit (events per second) */
  maxEventsPerSecond?: number;
  /** Tenant ID */
  tenantId?: string;
}

// ============================================================================
// Event Store Types
// ============================================================================

/**
 * Event store interface for persistence
 */
export interface IEventStore {
  /** Append events to the store */
  append(events: DomainEvent[]): Promise<void>;
  /** Get events for an aggregate */
  getByAggregate(aggregateType: string, aggregateId: string, fromVersion?: number): Promise<DomainEvent[]>;
  /** Get events by correlation ID */
  getByCorrelationId(correlationId: string): Promise<DomainEvent[]>;
  /** Get events since a timestamp */
  getSince(timestamp: Date, limit?: number): Promise<DomainEvent[]>;
}

// ============================================================================
// Predefined Domain Event Types
// ============================================================================

/** Property-related events */
export interface PropertyCreatedPayload {
  propertyId: string;
  name: string;
  type: string;
  address: string;
}

export interface PropertyUpdatedPayload {
  propertyId: string;
  changes: Record<string, { from: unknown; to: unknown }>;
}

/** Lease-related events */
export interface LeaseCreatedPayload {
  leaseId: string;
  propertyId: string;
  unitId: string;
  tenantId: string;
  startDate: string;
  endDate: string;
  rentAmount: number;
}

export interface LeaseTerminatedPayload {
  leaseId: string;
  reason: string;
  effectiveDate: string;
}

/** Payment-related events */
export interface PaymentReceivedPayload {
  paymentId: string;
  leaseId: string;
  amount: number;
  currency: string;
  method: string;
  reference: string;
}

export interface PaymentFailedPayload {
  paymentId: string;
  leaseId: string;
  amount: number;
  reason: string;
}

/** Maintenance-related events */
export interface MaintenanceRequestCreatedPayload {
  requestId: string;
  propertyId: string;
  unitId: string;
  category: string;
  priority: string;
  description: string;
}

export interface MaintenanceCompletedPayload {
  requestId: string;
  workOrderId: string;
  completedBy: string;
  resolution: string;
  cost: number;
}

/** User-related events */
export interface UserCreatedPayload {
  userId: string;
  email: string;
  role: string;
}

export interface UserRoleChangedPayload {
  userId: string;
  previousRole: string;
  newRole: string;
  changedBy: string;
}
