/**
 * Audit Logging Types
 * Types for the audit logging service
 */

/** Supported audit actions */
export type AuditAction =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'login'
  | 'logout'
  | 'export'
  | 'approve'
  | 'reject';

/** Change record for update operations */
export interface AuditChange {
  readonly field: string;
  readonly oldValue: unknown;
  readonly newValue: unknown;
}

/** A single audit log entry */
export interface AuditEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly action: AuditAction;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly userId: string | null;
  readonly userEmail: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly changes: readonly AuditChange[];
  readonly timestamp: string;
  readonly metadata: Record<string, unknown>;
}

/** Date range for filtering */
export interface DateRange {
  readonly from: string;
  readonly to: string;
}

/** Query parameters for audit log retrieval */
export interface AuditQuery {
  readonly tenantId: string;
  readonly entityType?: string;
  readonly entityId?: string;
  readonly userId?: string;
  readonly action?: AuditAction;
  readonly dateRange?: DateRange;
  readonly limit: number;
  readonly offset: number;
}

/** Paginated audit log result */
export interface PaginatedAuditResult {
  readonly items: readonly AuditEntry[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
}

/** Audit statistics for a tenant */
export interface AuditStats {
  readonly totalActions: number;
  readonly actionsByType: Record<AuditAction, number>;
  readonly uniqueUsers: number;
  readonly uniqueEntities: number;
}

/** Retention policy configuration */
export interface RetentionPolicy {
  readonly tenantId: string;
  readonly retentionDays: number;
  readonly updatedAt: string;
}

/** Context passed to audit service (IP, user agent, etc.) */
export interface AuditContext {
  readonly userId?: string | null;
  readonly userEmail?: string | null;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

/** Search filters for audit log */
export interface AuditSearchFilters {
  readonly entityType?: string;
  readonly entityId?: string;
  readonly userId?: string;
  readonly action?: AuditAction;
  readonly dateRange?: DateRange;
  readonly limit?: number;
  readonly offset?: number;
}
