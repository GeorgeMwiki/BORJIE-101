/**
 * Handoff queue — port + in-memory reference implementation.
 *
 * The wire-side adapter implements `HandoffQueuePort` (from
 * `slo/auto-rollback.ts`) against the persisted `exception_inbox` table.
 * This file provides:
 *
 *   - A port-level interface for *consumers* (the human handoff UI), in
 *     addition to the producer-side `HandoffQueuePort`.
 *   - An `InMemoryHandoffQueue` for tests + local dev.
 */

import type { HandoffQueueEntry } from '../types.js';

export interface HandoffQueueReader {
  /** List queued entries, optionally filtering by tenant. */
  list(filters?: { readonly tenantId?: string; readonly subMd?: string }): Promise<ReadonlyArray<HandoffQueueEntry>>;
  /** Mark an entry resolved (human took action). */
  resolve(id: string, resolverUserId: string): Promise<void>;
  /** Mark an entry abandoned (decision: no-op, drop). */
  abandon(id: string, resolverUserId: string, reason: string): Promise<void>;
}

/**
 * In-memory implementation. NOT for production — there's no persistence,
 * no concurrency-safety, no quorum. For unit tests + local repl only.
 */
export class InMemoryHandoffQueue implements HandoffQueueReader {
  private readonly entries: Map<string, HandoffQueueEntry> = new Map();

  async enqueue(entry: HandoffQueueEntry): Promise<void> {
    if (this.entries.has(entry.id)) {
      throw new Error(`duplicate handoff entry id: ${entry.id}`);
    }
    this.entries.set(entry.id, entry);
  }

  async list(filters?: {
    readonly tenantId?: string;
    readonly subMd?: string;
  }): Promise<ReadonlyArray<HandoffQueueEntry>> {
    const all = Array.from(this.entries.values());
    if (!filters) return all;
    return all.filter((e) => {
      if (filters.tenantId && e.tenantId !== filters.tenantId) return false;
      if (filters.subMd && e.subMd !== filters.subMd) return false;
      return true;
    });
  }

  async resolve(id: string, _resolverUserId: string): Promise<void> {
    const existing = this.entries.get(id);
    if (!existing) throw new Error(`no such handoff entry: ${id}`);
    const updated: HandoffQueueEntry = Object.freeze({
      ...existing,
      status: 'resolved',
    });
    this.entries.set(id, updated);
  }

  async abandon(id: string, _resolverUserId: string, _reason: string): Promise<void> {
    const existing = this.entries.get(id);
    if (!existing) throw new Error(`no such handoff entry: ${id}`);
    const updated: HandoffQueueEntry = Object.freeze({
      ...existing,
      status: 'abandoned',
    });
    this.entries.set(id, updated);
  }

  /** Test helper. */
  size(): number {
    return this.entries.size;
  }
}
