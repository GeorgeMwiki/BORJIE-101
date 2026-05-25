/**
 * In-memory audit sink — append-only. Useful for tests and local dev.
 * Production wires a real sink (Postgres `connector_audit_log` table or
 * the central audit service).
 */

import type { AuditSink } from './base-connector.js';

type AuditEntry = Parameters<AuditSink['audit']>[0];

export interface InMemoryAuditSink extends AuditSink {
  entries(): readonly AuditEntry[];
  clear(): void;
}

export function createInMemoryAuditSink(): InMemoryAuditSink {
  const buffer: AuditEntry[] = [];

  return {
    async audit(args: AuditEntry): Promise<void> {
      buffer.push(args);
    },
    entries(): readonly AuditEntry[] {
      return Object.freeze(buffer.slice());
    },
    clear(): void {
      buffer.length = 0;
    },
  };
}
