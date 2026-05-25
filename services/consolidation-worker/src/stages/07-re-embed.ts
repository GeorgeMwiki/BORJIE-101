/**
 * Stage 07 — Re-embed.
 *
 * B4 Phase B: real bulk re-embedder. Re-embeds rows in
 * `kernel_memory_semantic` with the CURRENT embedding-model version so
 * retrieval stays consistent when the embedder is upgraded.
 *
 * Wiring: this stage talks to a `ReEmbedPort` (duck-typed locally so
 * the worker compiles without compile-time deps on `@borjie/
 * database`). The composition root wires the real port —
 * `createSemanticBulkReEmbedService` — which:
 *
 *   - iterates the table in chunks of 100 rows
 *   - skips rows whose `last_embedded_at` is newer than the model-
 *     version cutoff (resumable on restart)
 *   - stamps `last_embedded_at = NOW()` per successful row
 *
 * Hard cap: 500 rows / tenant / tick. The default cap can be raised
 * via `perTenantLimit` on the orchestrator's deps when an operator
 * forces a large-scale re-embed (model version bump).
 *
 * Per-tenant errors are absorbed; the cascade continues with the next
 * tenant.
 */

import type { ReEmbedReport, StageLogger } from './types.js';

export interface ReEmbedPort {
  reEmbedForTenant(args: {
    readonly tenantId: string | null;
    readonly limit: number;
    /** Optional resume-cutoff; rows fresher than this are skipped. */
    readonly modelCutoff?: Date | string;
  }): Promise<ReEmbedReport>;
}

export interface ReEmbedArgs {
  readonly tenantIds: ReadonlyArray<string | null>;
  readonly reEmbedder?: ReEmbedPort;
  readonly logger: StageLogger;
  /** Hard cap per tenant per tick. Default 500. */
  readonly perTenantLimit?: number;
  /**
   * The point in time the active embedding-model version went live.
   * Rows whose `last_embedded_at` is at or after this timestamp are
   * skipped. Default: never (epoch) — every row is eligible.
   */
  readonly modelCutoff?: Date | string;
}

const DEFAULT_LIMIT = 500;

export interface ReEmbedStageReport {
  readonly factsReEmbedded: number;
  readonly perTenant: Record<string, ReEmbedReport>;
}

export async function runReEmbedStage(
  args: ReEmbedArgs,
): Promise<ReEmbedStageReport> {
  const perTenant: Record<string, ReEmbedReport> = {};
  let total = 0;
  if (!args.reEmbedder) {
    args.logger.info(
      { stage: '07-re-embed' },
      're-embed stage skipped (no bulk re-embedder wired)',
    );
    return { factsReEmbedded: 0, perTenant };
  }
  const limit = args.perTenantLimit ?? DEFAULT_LIMIT;
  const unique = uniqueTenants(args.tenantIds);
  for (const tenantId of unique) {
    try {
      const portArgs: {
        tenantId: string | null;
        limit: number;
        modelCutoff?: Date | string;
      } = { tenantId, limit };
      if (args.modelCutoff !== undefined) {
        portArgs.modelCutoff = args.modelCutoff;
      }
      const report = await args.reEmbedder.reEmbedForTenant(portArgs);
      const safeKey = tenantId ?? '__global__';
      perTenant[safeKey] = report;
      total += report.reEmbeddedCount;
    } catch (error) {
      args.logger.warn(
        {
          stage: '07-re-embed',
          tenantId,
          err: asMessage(error),
        },
        're-embed failed for tenant',
      );
    }
  }
  args.logger.info(
    {
      stage: '07-re-embed',
      factsReEmbedded: total,
      tenants: unique.length,
    },
    're-embed stage complete',
  );
  return { factsReEmbedded: total, perTenant };
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
