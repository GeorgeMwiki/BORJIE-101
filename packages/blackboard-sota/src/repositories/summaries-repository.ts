/**
 * Summaries repository — in-memory + SQL adapters.
 *
 * Wave BLACKBOARD-CORE. Both adapters implement `SummariesRepository`
 * from `../types.ts`. Each summary chains into the per-region audit
 * chain so a tampered summary breaks verification.
 *
 * @module @borjie/blackboard-sota/repositories/summaries-repository
 */

import { GENESIS_HASH } from '@borjie/audit-hash-chain';
import { computeBlackboardHash } from '../audit/hash-chain.js';
import {
  type AppendSummaryInput,
  type Summary,
  type SummariesRepository,
  type SummaryKind,
} from '../types.js';

let counter = 0;
function nextId(): string {
  counter += 1;
  return `sum-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// In-memory adapter
// ---------------------------------------------------------------------------

export interface InMemorySummariesRepositoryDeps {
  readonly now?: () => Date;
  readonly idFactory?: () => string;
}

export function createInMemorySummariesRepository(
  deps: InMemorySummariesRepositoryDeps = {},
): SummariesRepository {
  const now = deps.now ?? (() => new Date());
  const idFactory = deps.idFactory ?? (() => nextId());
  const byId = new Map<string, Summary>();
  const lastHashByRegion = new Map<string, string>();

  function regionKey(tenantId: string, regionId: string): string {
    return `${tenantId}::${regionId}`;
  }

  return {
    async append(input: AppendSummaryInput) {
      const id = idFactory();
      const generatedAt = now();
      const k = regionKey(input.tenantId, input.regionId);
      const prev = lastHashByRegion.get(k) ?? GENESIS_HASH;
      const auditHash = computeBlackboardHash(
        {
          kind: 'summary:append',
          id,
          tenantId: input.tenantId,
          regionId: input.regionId,
          summaryKind: input.summaryKind,
          summaryText: input.summaryText,
          tokenCount: input.tokenCount,
          coversFrom: input.coversFrom.toISOString(),
          coversTo: input.coversTo.toISOString(),
          generatedAt: generatedAt.toISOString(),
        },
        prev,
      );
      const row: Summary = Object.freeze({
        id,
        tenantId: input.tenantId,
        regionId: input.regionId,
        summaryKind: input.summaryKind,
        summaryText: input.summaryText,
        tokenCount: input.tokenCount,
        coversFrom: input.coversFrom,
        coversTo: input.coversTo,
        generatedAt,
        auditHash,
      });
      byId.set(id, row);
      lastHashByRegion.set(k, auditHash);
      return row;
    },

    async listByRegion(tenantId, regionId) {
      const out: Summary[] = [];
      for (const s of byId.values()) {
        if (s.tenantId !== tenantId || s.regionId !== regionId) continue;
        out.push(s);
      }
      out.sort((a, b) => a.generatedAt.getTime() - b.generatedAt.getTime());
      return Object.freeze([...out]);
    },

    async latestForRegion(tenantId, regionId, kind: SummaryKind) {
      let best: Summary | null = null;
      for (const s of byId.values()) {
        if (s.tenantId !== tenantId) continue;
        if (s.regionId !== regionId) continue;
        if (s.summaryKind !== kind) continue;
        if (best === null || s.generatedAt.getTime() > best.generatedAt.getTime()) {
          best = s;
        }
      }
      return best;
    },
  };
}

// ---------------------------------------------------------------------------
// SQL adapter
// ---------------------------------------------------------------------------

export interface SummariesSqlDriver {
  insertRow(row: Summary): Promise<void>;
  selectByRegion(
    tenantId: string,
    regionId: string,
  ): Promise<ReadonlyArray<Summary>>;
  selectLatestByKind(
    tenantId: string,
    regionId: string,
    kind: SummaryKind,
  ): Promise<Summary | null>;
  selectLastAuditHashForRegion(
    tenantId: string,
    regionId: string,
  ): Promise<string | null>;
}

export function createSqlSummariesRepository(
  driver: SummariesSqlDriver,
  deps: { readonly now?: () => Date; readonly idFactory?: () => string } = {},
): SummariesRepository {
  const now = deps.now ?? (() => new Date());
  const idFactory = deps.idFactory ?? (() => nextId());
  return {
    async append(input) {
      const id = idFactory();
      const generatedAt = now();
      const prev =
        (await driver.selectLastAuditHashForRegion(input.tenantId, input.regionId)) ??
        GENESIS_HASH;
      const auditHash = computeBlackboardHash(
        {
          kind: 'summary:append',
          id,
          tenantId: input.tenantId,
          regionId: input.regionId,
          summaryKind: input.summaryKind,
          summaryText: input.summaryText,
          tokenCount: input.tokenCount,
          coversFrom: input.coversFrom.toISOString(),
          coversTo: input.coversTo.toISOString(),
          generatedAt: generatedAt.toISOString(),
        },
        prev,
      );
      const row: Summary = Object.freeze({
        id,
        tenantId: input.tenantId,
        regionId: input.regionId,
        summaryKind: input.summaryKind,
        summaryText: input.summaryText,
        tokenCount: input.tokenCount,
        coversFrom: input.coversFrom,
        coversTo: input.coversTo,
        generatedAt,
        auditHash,
      });
      await driver.insertRow(row);
      return row;
    },
    async listByRegion(tenantId, regionId) {
      return driver.selectByRegion(tenantId, regionId);
    },
    async latestForRegion(tenantId, regionId, kind) {
      return driver.selectLatestByKind(tenantId, regionId, kind);
    },
  };
}
