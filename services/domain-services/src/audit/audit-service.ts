/**
 * Audit Logging Service
 * Records and queries audit trail for compliance and security
 */

import type {
  AuditAction,
  AuditEntry,
  AuditChange,
  AuditQuery,
  PaginatedAuditResult,
  AuditStats,
  AuditSearchFilters,
  DateRange,
} from './types.js';
import type { AuditRepository } from './audit-repository.interface.js';
import { getAuditContext } from './audit-context.js';

export interface AuditServiceOptions {
  readonly repository: AuditRepository;
}

export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  /**
   * Log an audit event.
   * Context (userId, userEmail, ipAddress, userAgent) is auto-captured from AuditContext when not provided.
   */
  async logAudit(
    tenantId: string,
    action: AuditAction,
    entityType: string,
    entityId: string | null,
    userId?: string | null,
    changes?: readonly AuditChange[],
    metadata?: Record<string, unknown>
  ): Promise<AuditEntry> {
    const ctx = getAuditContext();
    return this.repository.create({
      tenantId,
      action,
      entityType,
      entityId,
      userId: userId ?? ctx.userId ?? null,
      userEmail: ctx.userEmail ?? null,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
      changes: changes ?? [],
      metadata: metadata ?? {},
    });
  }

  /** Get audit log with query filters */
  async getAuditLog(query: AuditQuery): Promise<PaginatedAuditResult> {
    // nosemgrep: missing-tenant-id-arg reason: `query: AuditQuery` requires `tenantId` at the type level (see types.ts).
    return this.repository.findMany(query);
  }

  /** Get history for a specific entity */
  async getEntityHistory(
    tenantId: string,
    entityType: string,
    entityId: string
  ): Promise<readonly AuditEntry[]> {
    return this.repository.findEntityHistory(
      tenantId,
      entityType,
      entityId
    );
  }

  /** Get activity for a specific user within a date range */
  async getUserActivity(
    tenantId: string,
    userId: string,
    dateRange: DateRange
  ): Promise<readonly AuditEntry[]> {
    return this.repository.findUserActivity(
      tenantId,
      userId,
      dateRange
    );
  }

  /** Export audit log in CSV or JSON format */
  async exportAuditLog(
    tenantId: string,
    query: Omit<AuditQuery, 'limit' | 'offset'> & { limit?: number },
    format: 'csv' | 'json'
  ): Promise<string> {
    const fullQuery: AuditQuery = {
      ...query,
      limit: query.limit ?? 10000,
      offset: 0,
    };
    // nosemgrep: missing-tenant-id-arg reason: `fullQuery: AuditQuery` requires `tenantId` at the type level (see types.ts).
    const result = await this.repository.findMany(fullQuery);

    if (format === 'json') {
      return JSON.stringify(
        { items: result.items, total: result.total, exportedAt: new Date().toISOString() },
        null,
        2
      );
    }

    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const headers = [
      'id',
      'tenantId',
      'action',
      'entityType',
      'entityId',
      'userId',
      'userEmail',
      'ipAddress',
      'userAgent',
      'timestamp',
      'changes',
      'metadata',
    ];
    const rows = result.items.map((e) =>
      [
        e.id,
        e.tenantId,
        e.action,
        e.entityType,
        e.entityId ?? '',
        e.userId ?? '',
        e.userEmail ?? '',
        e.ipAddress ?? '',
        e.userAgent ?? '',
        e.timestamp,
        JSON.stringify(e.changes),
        JSON.stringify(e.metadata),
      ].map(String).map(escape).join(',')
    );
    return [headers.map(escape).join(','), ...rows].join('\n');
  }

  /** Get audit statistics for a tenant */
  async getAuditStats(
    tenantId: string,
    dateRange: DateRange
  ): Promise<AuditStats> {
    return this.repository.getStats(tenantId, dateRange);
  }

  /** Search audit log by term with optional filters */
  async searchAuditLog(
    tenantId: string,
    searchTerm: string,
    filters?: AuditSearchFilters
  ): Promise<PaginatedAuditResult> {
    return this.repository.search(tenantId, searchTerm, filters);
  }

  /** Configure retention policy for a tenant */
  async configureRetention(
    tenantId: string,
    retentionDays: number
  ): Promise<void> {
    await this.repository.setRetentionPolicy({
      tenantId,
      retentionDays,
      updatedAt: new Date().toISOString(),
    });
  }

  /** Purge records older than retention policy */
  async purgeOldRecords(tenantId: string): Promise<number> {
    const policy = await this.repository.getRetentionPolicy(tenantId);
    if (!policy) return 0;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - policy.retentionDays);
    const beforeTimestamp = cutoff.toISOString();

    return this.repository.deleteOlderThan(tenantId, beforeTimestamp);
  }
}
