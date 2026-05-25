/**
 * Audit Repository Interface
 * Abstract storage for audit log entries
 */

import type {
  AuditEntry,
  AuditQuery,
  PaginatedAuditResult,
  AuditStats,
  RetentionPolicy,
} from './types.js';

export interface AuditRepository {
  /** Create a new audit entry */
  create(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<AuditEntry>;

  /** Query audit log with filters */
  findMany(query: AuditQuery): Promise<PaginatedAuditResult>;

  /** Get history for a specific entity */
  findEntityHistory(
    tenantId: string,
    entityType: string,
    entityId: string
  ): Promise<readonly AuditEntry[]>;

  /** Get activity for a specific user */
  findUserActivity(
    tenantId: string,
    userId: string,
    dateRange: { from: string; to: string }
  ): Promise<readonly AuditEntry[]>;

  /** Search audit log by term */
  search(
    tenantId: string,
    searchTerm: string,
    filters?: {
      entityType?: string;
      entityId?: string;
      userId?: string;
      action?: string;
      dateRange?: { from: string; to: string };
      limit?: number;
      offset?: number;
    }
  ): Promise<PaginatedAuditResult>;

  /** Get audit statistics */
  getStats(
    tenantId: string,
    dateRange: { from: string; to: string }
  ): Promise<AuditStats>;

  /** Delete records older than retention */
  deleteOlderThan(tenantId: string, beforeTimestamp: string): Promise<number>;

  /** Get retention policy for tenant */
  getRetentionPolicy(tenantId: string): Promise<RetentionPolicy | null>;

  /** Set retention policy for tenant */
  setRetentionPolicy(policy: RetentionPolicy): Promise<RetentionPolicy>;
}
