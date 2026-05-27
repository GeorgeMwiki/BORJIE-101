/**
 * Cross-references repository — in-memory + SQL adapters.
 *
 * Wave BLACKBOARD-CORE. Both adapters implement
 * `CrossReferencesRepository`. UNIQUE on
 * `(tenantId, srcPostId, dstPostId, refKind)` — re-inserts are
 * idempotent and return the existing row.
 *
 * @module @borjie/blackboard-sota/repositories/cross-references-repository
 */

import { GENESIS_HASH } from '@borjie/audit-hash-chain';
import { computeBlackboardHash } from '../audit/hash-chain.js';
import {
  type CrossReference,
  type CrossReferenceKind,
  type CrossReferencesRepository,
  type RecordCrossReferenceInput,
} from '../types.js';

let counter = 0;
function nextId(): string {
  counter += 1;
  return `xref-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function quad(
  tenantId: string,
  src: string,
  dst: string,
  kind: CrossReferenceKind,
): string {
  return `${tenantId}::${src}::${dst}::${kind}`;
}

// ---------------------------------------------------------------------------
// In-memory adapter
// ---------------------------------------------------------------------------

export interface InMemoryCrossReferencesRepositoryDeps {
  readonly now?: () => Date;
  readonly idFactory?: () => string;
}

export function createInMemoryCrossReferencesRepository(
  deps: InMemoryCrossReferencesRepositoryDeps = {},
): CrossReferencesRepository {
  const now = deps.now ?? (() => new Date());
  const idFactory = deps.idFactory ?? (() => nextId());
  const byId = new Map<string, CrossReference>();
  const byQuad = new Map<string, string>();
  const lastHashByTenant = new Map<string, string>();

  return {
    async record(input: RecordCrossReferenceInput) {
      const q = quad(
        input.tenantId,
        input.srcPostId,
        input.dstPostId,
        input.refKind,
      );
      const existingId = byQuad.get(q);
      if (existingId !== undefined) {
        const row = byId.get(existingId);
        if (row !== undefined) return row;
      }
      const id = idFactory();
      const detectedAt = now();
      const prev = lastHashByTenant.get(input.tenantId) ?? GENESIS_HASH;
      const confidence = Math.max(0, Math.min(1, input.confidence));
      const auditHash = computeBlackboardHash(
        {
          kind: 'crossref:record',
          id,
          tenantId: input.tenantId,
          srcPostId: input.srcPostId,
          dstPostId: input.dstPostId,
          refKind: input.refKind,
          confidence,
          detectedAt: detectedAt.toISOString(),
        },
        prev,
      );
      const row: CrossReference = Object.freeze({
        id,
        tenantId: input.tenantId,
        srcPostId: input.srcPostId,
        dstPostId: input.dstPostId,
        refKind: input.refKind,
        confidence,
        detectedAt,
        auditHash,
      });
      byId.set(id, row);
      byQuad.set(q, id);
      lastHashByTenant.set(input.tenantId, auditHash);
      return row;
    },

    async listForPost(tenantId, postId) {
      const out: CrossReference[] = [];
      for (const r of byId.values()) {
        if (r.tenantId !== tenantId) continue;
        if (r.srcPostId !== postId && r.dstPostId !== postId) continue;
        out.push(r);
      }
      out.sort((a, b) => a.detectedAt.getTime() - b.detectedAt.getTime());
      return Object.freeze([...out]);
    },
  };
}

// ---------------------------------------------------------------------------
// SQL adapter
// ---------------------------------------------------------------------------

export interface CrossReferencesSqlDriver {
  insertRow(row: CrossReference): Promise<void>;
  selectByQuad(
    tenantId: string,
    srcPostId: string,
    dstPostId: string,
    refKind: CrossReferenceKind,
  ): Promise<CrossReference | null>;
  selectForPost(
    tenantId: string,
    postId: string,
  ): Promise<ReadonlyArray<CrossReference>>;
  selectLastAuditHash(tenantId: string): Promise<string | null>;
}

export function createSqlCrossReferencesRepository(
  driver: CrossReferencesSqlDriver,
  deps: { readonly now?: () => Date; readonly idFactory?: () => string } = {},
): CrossReferencesRepository {
  const now = deps.now ?? (() => new Date());
  const idFactory = deps.idFactory ?? (() => nextId());
  return {
    async record(input) {
      const existing = await driver.selectByQuad(
        input.tenantId,
        input.srcPostId,
        input.dstPostId,
        input.refKind,
      );
      if (existing !== null) return existing;
      const id = idFactory();
      const detectedAt = now();
      const prev = (await driver.selectLastAuditHash(input.tenantId)) ?? GENESIS_HASH;
      const confidence = Math.max(0, Math.min(1, input.confidence));
      const auditHash = computeBlackboardHash(
        {
          kind: 'crossref:record',
          id,
          tenantId: input.tenantId,
          srcPostId: input.srcPostId,
          dstPostId: input.dstPostId,
          refKind: input.refKind,
          confidence,
          detectedAt: detectedAt.toISOString(),
        },
        prev,
      );
      const row: CrossReference = Object.freeze({
        id,
        tenantId: input.tenantId,
        srcPostId: input.srcPostId,
        dstPostId: input.dstPostId,
        refKind: input.refKind,
        confidence,
        detectedAt,
        auditHash,
      });
      await driver.insertRow(row);
      return row;
    },
    async listForPost(tenantId, postId) {
      return driver.selectForPost(tenantId, postId);
    },
  };
}
