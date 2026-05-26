/**
 * `translation_evals` repository.
 *
 * In-memory implementation, conforms to `TranslationEvalRepository`.
 * Each row is keyed by (tenant_id, run_id, judge, judgedAt) so a run
 * can carry many judge scores. Rows are frozen on insert.
 */

import { randomUUID } from 'node:crypto';
import type { TranslationEval, TranslationEvalRepository } from '../types.js';
import { computeTranslationAuditHash } from '../audit/audit-chain-link.js';

export interface InMemoryTranslationEvalRepoDeps {
  readonly now: () => Date;
}

export function createInMemoryTranslationEvalRepository(
  deps: InMemoryTranslationEvalRepoDeps = { now: () => new Date() },
): TranslationEvalRepository {
  const rows = new Map<string, TranslationEval>();

  return {
    async insert(input) {
      const id = randomUUID();
      const judgedAt = deps.now();
      const auditHash = computeTranslationAuditHash({
        op: 'eval',
        runId: input.runId,
        judge: input.judge,
        score: input.score,
        judgedAt: judgedAt.toISOString(),
      });
      const row: TranslationEval = Object.freeze({
        id,
        tenantId: input.tenantId,
        runId: input.runId,
        judge: input.judge,
        score: input.score,
        rubric: Object.freeze({ ...input.rubric }),
        judgedAt,
        auditHash,
      });
      rows.set(id, row);
      return row;
    },

    async listForRun(tenantId, runId) {
      const filtered: TranslationEval[] = [];
      for (const row of rows.values()) {
        if (row.tenantId === tenantId && row.runId === runId) {
          filtered.push(row);
        }
      }
      filtered.sort((a, b) => a.judgedAt.getTime() - b.judgedAt.getTime());
      return Object.freeze(filtered);
    },
  };
}
