/**
 * In-memory `CrossReferencesRepository` adapter.
 *
 * Wave BLACKBOARD-CORE. Pure-memory adapter for tests + dev.
 * Enforces the UNIQUE (tenant_id, src_post_id, dst_post_id, ref_kind)
 * constraint declared by migration 0073 by collapsing repeated
 * inserts idempotently — the second `record` call with the same
 * quadruple returns the existing row.
 */

import { randomUUID } from 'node:crypto';
import {
  type CrossReference,
  type CrossReferencesRepository,
  type RecordCrossReferenceInput,
} from '../types.js';
import { computeBlackboardHash, GENESIS_HASH } from '../audit/hash-chain.js';

interface InMemoryCrossReferencesRepositoryDeps {
  readonly now?: () => Date;
}

export function createInMemoryCrossReferencesRepository(
  deps: InMemoryCrossReferencesRepositoryDeps = {},
): CrossReferencesRepository {
  const now = deps.now ?? (() => new Date());
  const rows = new Map<string, CrossReference>();
  const byQuad = new Map<string, CrossReference>();

  return {
    async record(input: RecordCrossReferenceInput) {
      if (input.srcPostId === input.dstPostId) {
        throw new Error(
          `Cross-reference endpoints must differ (src=dst=${input.srcPostId})`,
        );
      }
      const quad = `${input.tenantId}::${input.srcPostId}::${input.dstPostId}::${input.refKind}`;
      const existing = byQuad.get(quad);
      if (existing !== undefined) return existing;
      const t = now();
      const id = randomUUID();
      const auditHash = computeBlackboardHash(
        {
          op: 'crossref',
          tenantId: input.tenantId,
          srcPostId: input.srcPostId,
          dstPostId: input.dstPostId,
          refKind: input.refKind,
          confidence: input.confidence,
          detectedAtIso: t.toISOString(),
        },
        GENESIS_HASH,
      );
      const row: CrossReference = Object.freeze({
        id,
        tenantId: input.tenantId,
        srcPostId: input.srcPostId,
        dstPostId: input.dstPostId,
        refKind: input.refKind,
        confidence: input.confidence,
        detectedAt: t,
        auditHash,
      });
      rows.set(id, row);
      byQuad.set(quad, row);
      return row;
    },

    async listForPost(tenantId: string, postId: string) {
      const matches: CrossReference[] = [];
      for (const row of rows.values()) {
        if (row.tenantId !== tenantId) continue;
        if (row.srcPostId !== postId && row.dstPostId !== postId) continue;
        matches.push(row);
      }
      return matches
        .slice()
        .sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());
    },
  };
}
