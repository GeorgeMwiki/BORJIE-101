/**
 * In-Memory Audit Repository
 * For development and testing
 */

import type {
  AuditEntry,
  AuditQuery,
  PaginatedAuditResult,
  AuditStats,
  RetentionPolicy,
  AuditAction,
} from './types.js';

import type { AuditRepository } from './audit-repository.interface.js';
import { randomHex } from '../common/id-generator.js';

export class MemoryAuditRepository implements AuditRepository {
  private entries: AuditEntry[] = [];
  private retentionPolicies = new Map<string, RetentionPolicy>();

  async create(
    input: Omit<AuditEntry, 'id' | 'timestamp'>
  ): Promise<AuditEntry> {
    const id = `audit_${Date.now()}_${randomHex(4)}`;
    const timestamp = new Date().toISOString();
    const entry: AuditEntry = {
      ...input,
      id,
      timestamp,
    };
    this.entries.push(entry);
    return entry;
  }

  async findMany(query: AuditQuery): Promise<PaginatedAuditResult> {
    let filtered = this.entries.filter((e) => e.tenantId === query.tenantId);

    if (query.entityType) {
      filtered = filtered.filter((e) => e.entityType === query.entityType);
    }
    if (query.entityId) {
      filtered = filtered.filter((e) => e.entityId === query.entityId);
    }
    if (query.userId) {
      filtered = filtered.filter((e) => e.userId === query.userId);
    }
    if (query.action) {
      filtered = filtered.filter((e) => e.action === query.action);
    }
    if (query.dateRange) {
      filtered = filtered.filter(
        (e) =>
          e.timestamp >= query.dateRange!.from &&
          e.timestamp <= query.dateRange!.to
      );
    }

    filtered.sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1));
    const total = filtered.length;
    const items = filtered.slice(
      query.offset,
      query.offset + query.limit
    );
    return {
      items,
      total,
      limit: query.limit,
      offset: query.offset,
      hasMore: query.offset + items.length < total,
    };
  }

  async findEntityHistory(
    tenantId: string,
    entityType: string,
    entityId: string
  ): Promise<readonly AuditEntry[]> {
    return this.entries
      .filter(
        (e) =>
          e.tenantId === tenantId &&
          e.entityType === entityType &&
          e.entityId === entityId
      )
      .sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1));
  }

  async findUserActivity(
    tenantId: string,
    userId: string,
    dateRange: { from: string; to: string }
  ): Promise<readonly AuditEntry[]> {
    return this.entries
      .filter(
        (e) =>
          e.tenantId === tenantId &&
          e.userId === userId &&
          e.timestamp >= dateRange.from &&
          e.timestamp <= dateRange.to
      )
      .sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1));
  }

  async search(
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
  ): Promise<PaginatedAuditResult> {
    const term = searchTerm.toLowerCase();
    let filtered = this.entries.filter(
      (e) =>
        e.tenantId === tenantId &&
        (e.entityType.toLowerCase().includes(term) ||
          (e.entityId ?? '').toLowerCase().includes(term) ||
          (e.userEmail ?? '').toLowerCase().includes(term) ||
          JSON.stringify(e.changes).toLowerCase().includes(term) ||
          JSON.stringify(e.metadata).toLowerCase().includes(term))
    );

    if (filters?.entityType) {
      filtered = filtered.filter((e) => e.entityType === filters.entityType);
    }
    if (filters?.entityId) {
      filtered = filtered.filter((e) => e.entityId === filters.entityId);
    }
    if (filters?.userId) {
      filtered = filtered.filter((e) => e.userId === filters.userId);
    }
    if (filters?.action) {
      filtered = filtered.filter((e) => e.action === filters.action);
    }
    if (filters?.dateRange) {
      filtered = filtered.filter(
        (e) =>
          e.timestamp >= filters.dateRange!.from &&
          e.timestamp <= filters.dateRange!.to
      );
    }

    filtered.sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1));
    const limit = filters?.limit ?? 50;
    const offset = filters?.offset ?? 0;
    const total = filtered.length;
    const items = filtered.slice(offset, offset + limit);

    return {
      items,
      total,
      limit,
      offset,
      hasMore: offset + items.length < total,
    };
  }

  async getStats(
    tenantId: string,
    dateRange: { from: string; to: string }
  ): Promise<AuditStats> {
    const filtered = this.entries.filter(
      (e) =>
        e.tenantId === tenantId &&
        e.timestamp >= dateRange.from &&
        e.timestamp <= dateRange.to
    );

    const actionsByType: Record<AuditAction, number> = {
      create: 0,
      read: 0,
      update: 0,
      delete: 0,
      login: 0,
      logout: 0,
      export: 0,
      approve: 0,
      reject: 0,
    };

    const userIds = new Set<string>();
    const entities = new Set<string>();

    for (const e of filtered) {
      actionsByType[e.action]++;
      if (e.userId) userIds.add(e.userId);
      if (e.entityId) entities.add(`${e.entityType}:${e.entityId}`);
    }

    return {
      totalActions: filtered.length,
      actionsByType,
      uniqueUsers: userIds.size,
      uniqueEntities: entities.size,
    };
  }

  async deleteOlderThan(
    tenantId: string,
    beforeTimestamp: string
  ): Promise<number> {
    const before = this.entries.length;
    this.entries = this.entries.filter(
      (e) => !(e.tenantId === tenantId && e.timestamp < beforeTimestamp)
    );
    return before - this.entries.length;
  }

  async getRetentionPolicy(tenantId: string): Promise<RetentionPolicy | null> {
    return this.retentionPolicies.get(tenantId) ?? null;
  }

  async setRetentionPolicy(policy: RetentionPolicy): Promise<RetentionPolicy> {
    this.retentionPolicies.set(policy.tenantId, policy);
    return policy;
  }
}
