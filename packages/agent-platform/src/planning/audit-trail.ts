/**
 * In-memory AuditSink — the default for tests + dev. Production wires
 * a persistent sink (Postgres / S3 / Kafka) that satisfies the same
 * interface.
 *
 * Pure-ish: the sink mutates its own internal Array but exposes only
 * immutable reads + idempotent appends.
 */

import type { AuditEntry, AuditSink } from './types.js';

export class InMemoryAuditSink implements AuditSink {
  private readonly entries: AuditEntry[] = [];

  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(Object.freeze({ ...entry }));
  }

  async list(): Promise<ReadonlyArray<AuditEntry>> {
    return Object.freeze([...this.entries]);
  }

  /** Test helper — synchronous snapshot. */
  snapshot(): ReadonlyArray<AuditEntry> {
    return Object.freeze([...this.entries]);
  }

  /** Test helper — clear. */
  clear(): void {
    this.entries.length = 0;
  }
}

let entryCounter = 0;

export function nextEntryId(): string {
  entryCounter += 1;
  return `audit-${Date.now()}-${entryCounter}`;
}
