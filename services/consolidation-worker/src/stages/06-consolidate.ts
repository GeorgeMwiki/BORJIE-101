/**
 * Stage 06 — Consolidate.
 *
 * B4 Phase B: real Zep/Graphiti-style community detection over the
 * temporal entity graph. Per the architecture spec
 * (`.planning/central-command/00-architecture.md`) the consolidation
 * worker partitions tenant subgraphs into communities so the brain's
 * retrieval layer can summarise at community granularity instead of
 * row-by-row.
 *
 * The community-detection algorithm is Louvain modularity-maximisation:
 *
 *   V.D. Blondel, J.-L. Guillaume, R. Lambiotte, and E. Lefebvre.
 *   "Fast unfolding of communities in large networks."
 *   J. Stat. Mech. (2008) — https://arxiv.org/abs/0803.0476.
 *
 * The real algorithm lives in `@borjie/database`
 * (`temporal-entity-graph.service.ts` + `.louvain.ts`); this stage is
 * the thin orchestrator-facing port. When no consolidator port is
 * wired (unit tests, local dev with missing DB), the stage degrades to
 * a zero-impact no-op so the rest of the cascade keeps running.
 */

import type {
  ConsolidateMergeReport,
  StageLogger,
} from './types.js';

export interface EntityConsolidatorPort {
  consolidateForTenant(args: {
    readonly tenantId: string | null;
  }): Promise<ConsolidateMergeReport>;
}

export interface ConsolidateArgs {
  readonly tenantIds: ReadonlyArray<string | null>;
  readonly consolidator?: EntityConsolidatorPort;
  readonly logger: StageLogger;
}

export interface ConsolidateReport {
  readonly entitiesMerged: number;
  readonly perTenant: Record<string, ConsolidateMergeReport>;
}

export async function runConsolidateStage(
  args: ConsolidateArgs,
): Promise<ConsolidateReport> {
  const perTenant: Record<string, ConsolidateMergeReport> = {};
  let total = 0;
  if (!args.consolidator) {
    args.logger.info(
      { stage: '06-consolidate' },
      'consolidate stage skipped (no temporal-graph port wired)',
    );
    return { entitiesMerged: 0, perTenant };
  }
  const unique = uniqueTenants(args.tenantIds);
  for (const tenantId of unique) {
    // Cross-tenant consolidation is a privacy boundary — only operate
    // on real tenant ids (null = global / cross-tenant pool).
    if (tenantId === null) continue;
    try {
      const report = await args.consolidator.consolidateForTenant({
        tenantId,
      });
      perTenant[tenantId] = report;
      total += report.mergedEntities;
    } catch (error) {
      args.logger.warn(
        {
          stage: '06-consolidate',
          tenantId,
          err: asMessage(error),
        },
        'consolidate failed for tenant',
      );
    }
  }
  args.logger.info(
    {
      stage: '06-consolidate',
      entitiesMerged: total,
      tenants: unique.filter((t) => t !== null).length,
      algorithm: 'louvain',
    },
    'consolidate stage complete',
  );
  return { entitiesMerged: total, perTenant };
}

function uniqueTenants(
  ids: ReadonlyArray<string | null>,
): ReadonlyArray<string | null> {
  const seen = new Set<string>();
  const out: Array<string | null> = [];
  for (const id of ids) {
    const k = id ?? '__null__';
    if (!seen.has(k)) {
      seen.add(k);
      out.push(id);
    }
  }
  return out;
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
