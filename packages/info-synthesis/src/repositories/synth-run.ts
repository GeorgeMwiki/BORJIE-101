/**
 * `synth_runs` repository.
 *
 * In-memory implementation. The Drizzle-backed adapter ships in the
 * database package (Wave M7 SQL-backed adapter). Both implementations
 * conform to `SynthRunRepository` from `../types.ts`.
 *
 * Immutability: rows are frozen on insert; state transitions replace
 * the row outright.
 */

import { randomUUID } from 'node:crypto';
import type { SynthRun, SynthRunRepository, SynthRunStatus } from '../types.js';
import { computeSynthAuditHash, GENESIS_HASH } from '../audit/audit-chain-link.js';

export interface InMemorySynthRunRepoDeps {
  readonly now: () => Date;
}

export function createInMemorySynthRunRepository(
  deps: InMemorySynthRunRepoDeps = { now: () => new Date() },
): SynthRunRepository {
  const rows = new Map<string, SynthRun>();
  /** Per-tenant chain head — the last synth_run row's auditHash. */
  const chainHead = new Map<string, string>();

  function head(tenantId: string): string {
    return chainHead.get(tenantId) ?? GENESIS_HASH;
  }

  return {
    async start(input) {
      const id = randomUUID();
      const startedAt = deps.now();
      const prevHash = head(input.tenantId);
      const auditHash = computeSynthAuditHash(
        {
          op: 'start',
          tenantId: input.tenantId,
          query: input.query,
          corpusIds: input.corpusIds,
          startedAt: startedAt.toISOString(),
        },
        prevHash,
      );
      const row: SynthRun = Object.freeze({
        id,
        tenantId: input.tenantId,
        query: input.query,
        corpusIds: Object.freeze([...input.corpusIds]),
        startedAt,
        endedAt: null,
        status: 'pending' as SynthRunStatus,
        auditHash,
        prevHash,
      });
      rows.set(id, row);
      chainHead.set(input.tenantId, auditHash);
      return row;
    },

    async markRunning(tenantId, id) {
      replaceStatus(rows, tenantId, id, 'running', deps.now());
    },

    async markSucceeded(tenantId, id) {
      replaceStatus(rows, tenantId, id, 'succeeded', deps.now());
    },

    async markFailed(tenantId, id) {
      replaceStatus(rows, tenantId, id, 'failed', deps.now());
    },

    async findById(tenantId, id) {
      const row = rows.get(id);
      if (row === undefined || row.tenantId !== tenantId) {
        return null;
      }
      return row;
    },

    async listRecentForTenant(tenantId, limit) {
      const filtered: SynthRun[] = [];
      for (const row of rows.values()) {
        if (row.tenantId === tenantId) {
          filtered.push(row);
        }
      }
      filtered.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
      return filtered.slice(0, Math.max(0, limit));
    },
  };
}

function replaceStatus(
  rows: Map<string, SynthRun>,
  tenantId: string,
  id: string,
  next: SynthRunStatus,
  now: Date,
): void {
  const existing = rows.get(id);
  if (existing === undefined || existing.tenantId !== tenantId) {
    return;
  }
  const endedAt =
    next === 'succeeded' || next === 'failed' ? now : existing.endedAt;
  rows.set(
    id,
    Object.freeze({
      ...existing,
      status: next,
      endedAt,
    }),
  );
}
