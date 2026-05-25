/**
 * In-Memory Audit Store
 * 
 * Simple in-memory implementation for development, testing, and local environments.
 * NOT suitable for production use - events are lost on process restart.
 */

import type {
  AuditEvent,
  AuditQueryOptions,
  AuditQueryResult,
} from '../types/audit.types.js';
import type { IAuditStore, AuditStoreConfig } from './audit-store.interface.js';
import { DEFAULT_AUDIT_STORE_CONFIG } from './audit-store.interface.js';

export class MemoryAuditStore implements IAuditStore {
  private events: Map<string, AuditEvent> = new Map();
  private config: Required<AuditStoreConfig>;

  constructor(config: AuditStoreConfig = {}) {
    this.config = { ...DEFAULT_AUDIT_STORE_CONFIG, ...config };
  }

  async store(event: AuditEvent): Promise<void> {
    this.events.set(event.id, event);
  }

  async storeBatch(events: AuditEvent[]): Promise<void> {
    for (const event of events) {
      this.events.set(event.id, event);
    }
  }

  async query(options: AuditQueryOptions): Promise<AuditQueryResult> {
    let filtered = Array.from(this.events.values());

    // Apply filters
    if (options.tenantId) {
      filtered = filtered.filter(e => e.tenant?.tenantId === options.tenantId);
    }
    if (options.actorId) {
      filtered = filtered.filter(e => e.actor.id === options.actorId);
    }
    if (options.category) {
      filtered = filtered.filter(e => e.category === options.category);
    }
    if (options.action) {
      filtered = filtered.filter(e => e.action === options.action);
    }
    if (options.outcome) {
      filtered = filtered.filter(e => e.outcome === options.outcome);
    }
    if (options.targetType) {
      filtered = filtered.filter(e =>
        e.targets?.some(t => t.type === options.targetType)
      );
    }
    if (options.targetId) {
      filtered = filtered.filter(e =>
        e.targets?.some(t => t.id === options.targetId)
      );
    }
    if (options.startTime) {
      const startMs = options.startTime.getTime();
      filtered = filtered.filter(e => e.timestampMs >= startMs);
    }
    if (options.endTime) {
      const endMs = options.endTime.getTime();
      filtered = filtered.filter(e => e.timestampMs < endMs);
    }

    // Sort
    const sortOrder = options.sortOrder ?? 'desc';
    filtered.sort((a, b) => {
      const diff = a.timestampMs - b.timestampMs;
      return sortOrder === 'asc' ? diff : -diff;
    });

    // Paginate
    const offset = options.offset ?? 0;
    const limit = Math.min(options.limit ?? 100, 1000);
    const total = filtered.length;
    const paginated = filtered.slice(offset, offset + limit);

    return {
      events: paginated,
      total,
      offset,
      limit,
      hasMore: offset + paginated.length < total,
    };
  }

  async getById(id: string): Promise<AuditEvent | null> {
    return this.events.get(id) ?? null;
  }

  async getByTarget(
    targetType: string,
    targetId: string,
    options: Omit<AuditQueryOptions, 'targetType' | 'targetId'> = {}
  ): Promise<AuditQueryResult> {
    return this.query({ ...options, targetType, targetId });
  }

  async getByActor(
    actorId: string,
    options: Omit<AuditQueryOptions, 'actorId'> = {}
  ): Promise<AuditQueryResult> {
    return this.query({ ...options, actorId });
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    this.events.clear();
  }

  /**
   * Get total event count (for testing)
   */
  getCount(): number {
    return this.events.size;
  }

  /**
   * Clear all events (for testing)
   */
  clear(): void {
    this.events.clear();
  }
}
