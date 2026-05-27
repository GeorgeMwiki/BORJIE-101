/**
 * In-memory `SummariesRepository` adapter.
 *
 * Wave BLACKBOARD-CORE. Pure-memory adapter for tests + dev. Chains
 * `audit_hash` per region (spec §11): summaries continue the same
 * per-region chain that posts use, so a tampered summary breaks
 * `verifyRegionChain` exactly as a tampered post would.
 */

import { randomUUID } from 'node:crypto';
import {
  type AppendSummaryInput,
  type Summary,
  type SummariesRepository,
  type SummaryKind,
} from '../types.js';
import { computeBlackboardHash, GENESIS_HASH } from '../audit/hash-chain.js';

interface InMemorySummariesRepositoryDeps {
  readonly now?: () => Date;
}

export function createInMemorySummariesRepository(
  deps: InMemorySummariesRepositoryDeps = {},
): SummariesRepository {
  const now = deps.now ?? (() => new Date());
  const rows = new Map<string, Summary>();
  // Per-region tail for chaining summaries into the region's chain.
  const tails = new Map<string, string>();

  function tailKey(tenantId: string, regionId: string): string {
    return `${tenantId}::${regionId}::summary`;
  }

  return {
    async append(input: AppendSummaryInput): Promise<Summary> {
      const t = now();
      const id = randomUUID();
      const tk = tailKey(input.tenantId, input.regionId);
      const prevHash = tails.get(tk) ?? GENESIS_HASH;
      const auditHash = computeBlackboardHash(
        {
          op: 'summary',
          tenantId: input.tenantId,
          regionId: input.regionId,
          summaryKind: input.summaryKind,
          summaryText: input.summaryText,
          tokenCount: input.tokenCount,
          coversFromIso: input.coversFrom.toISOString(),
          coversToIso: input.coversTo.toISOString(),
          generatedAtIso: t.toISOString(),
        },
        prevHash,
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
        generatedAt: t,
        auditHash,
      });
      rows.set(id, row);
      tails.set(tk, auditHash);
      return row;
    },

    async listByRegion(tenantId: string, regionId: string) {
      const matches: Summary[] = [];
      for (const row of rows.values()) {
        if (row.tenantId !== tenantId) continue;
        if (row.regionId !== regionId) continue;
        matches.push(row);
      }
      return matches
        .slice()
        .sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());
    },

    async latestForRegion(
      tenantId: string,
      regionId: string,
      kind: SummaryKind,
    ) {
      let best: Summary | null = null;
      for (const row of rows.values()) {
        if (row.tenantId !== tenantId) continue;
        if (row.regionId !== regionId) continue;
        if (row.summaryKind !== kind) continue;
        if (best === null || row.generatedAt.getTime() > best.generatedAt.getTime()) {
          best = row;
        }
      }
      return best;
    },
  };
}
