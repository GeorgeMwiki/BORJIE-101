/**
 * Audit Store Interface
 * 
 * Abstract interface for audit event persistence.
 * Implementations can target PostgreSQL, Elasticsearch, cloud audit services, etc.
 */

import type {
  AuditEvent,
  AuditQueryOptions,
  AuditQueryResult,
} from '../types/audit.types.js';

/**
 * Interface for audit event storage backends
 */
export interface IAuditStore {
  /**
   * Store a single audit event
   * @param event The audit event to store
   * @returns Promise that resolves when stored
   */
  store(event: AuditEvent): Promise<void>;

  /**
   * Store multiple audit events in a batch
   * @param events Array of audit events to store
   * @returns Promise that resolves when all stored
   */
  storeBatch(events: AuditEvent[]): Promise<void>;

  /**
   * Query audit events
   * @param options Query options for filtering and pagination
   * @returns Paginated query result
   */
  query(options: AuditQueryOptions): Promise<AuditQueryResult>;

  /**
   * Get a single audit event by ID
   * @param id Audit event ID
   * @returns The audit event or null if not found
   */
  getById(id: string): Promise<AuditEvent | null>;

  /**
   * Get audit events for a specific resource
   * @param targetType Resource type
   * @param targetId Resource ID
   * @param options Additional query options
   * @returns Paginated query result
   */
  getByTarget(
    targetType: string,
    targetId: string,
    options?: Omit<AuditQueryOptions, 'targetType' | 'targetId'>
  ): Promise<AuditQueryResult>;

  /**
   * Get audit events for a specific actor
   * @param actorId Actor ID
   * @param options Additional query options
   * @returns Paginated query result
   */
  getByActor(
    actorId: string,
    options?: Omit<AuditQueryOptions, 'actorId'>
  ): Promise<AuditQueryResult>;

  /**
   * Health check for the store
   * @returns True if store is healthy
   */
  healthCheck(): Promise<boolean>;

  /**
   * Close connections and cleanup
   */
  close(): Promise<void>;
}

/**
 * Configuration for audit store implementations
 */
export interface AuditStoreConfig {
  /** Maximum batch size for batch operations */
  maxBatchSize?: number;
  /** Flush interval for buffered writes (ms) */
  flushIntervalMs?: number;
  /** Retry count for failed operations */
  retryCount?: number;
  /** Retry delay base (ms) */
  retryDelayMs?: number;
}

export const DEFAULT_AUDIT_STORE_CONFIG: Required<AuditStoreConfig> = {
  maxBatchSize: 100,
  flushIntervalMs: 5000,
  retryCount: 3,
  retryDelayMs: 1000,
};
