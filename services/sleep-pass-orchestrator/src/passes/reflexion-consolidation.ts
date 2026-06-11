/**
 * Sleep pass — nightly reflexion consolidation (Wave-3 DARK-ORGAN closure,
 * Docs/research/MASTER_WIRING_CLOSURE_PLAN.md).
 *
 * The kernel's 4-pass reflexion consolidation
 * (`@borjie/central-intelligence` `runNightlySleep`:
 * dedupe-cluster → extract-patterns → update-guidelines → prune-stale)
 * was BUILT + unit-tested but had NO production caller — the
 * sleep-pass-orchestrator registered ten other passes but never this one,
 * so the consolidation never ran in prod. The session-end reflexion WRITER
 * (`recordReflexion`) is the LIVE path and is UNTOUCHED by this pass — this
 * pass only CONSOLIDATES what that writer already persisted.
 *
 * Dependency discipline (mirrors graph-rag-community-summaries.ts): this
 * pass file imports NO `@borjie/*` package. It accepts a
 * {@link ReflexionConsolidationRunner} port that the composition root wires
 * to the real `runNightlySleep` + its four Drizzle-backed reflexion
 * adapters (over `reflexion_buffer` / `reflexion_guidelines`). The
 * orchestrator package keeps its thin dependency surface; an in-memory
 * runner here keeps the pass reachable + testable.
 *
 * HARD-RULE compliance (closure plan):
 *   - Cadence: NIGHTLY (04:15 local), off the hot turn path. NOT the
 *     session-end writer cadence.
 *   - Env flag: gated at the composition root via
 *     `BORJIE_REFLEXION_SLEEP_ENABLED` (default OFF acceptable — this is
 *     compute-heavy 4-pass consolidation). When disabled the composition
 *     root simply does not register this pass.
 *   - Budget bound: a hard `maxDurationMs` + a cooperative `abortSignal`
 *     checked between tenants. Per-tenant failure does NOT abort the run.
 *   - Fail-safe: a tenant that throws is skipped; the pass aggregates and
 *     never rejects.
 *   - Propose-only: consolidation rewrites the brain's own guideline doc;
 *     it never touches money / licence (no sovereign rail).
 *
 * @module services/sleep-pass-orchestrator/src/passes/reflexion-consolidation
 */

import type { PassResult, SleepPass } from '../types.js';

// ---------------------------------------------------------------------------
// Port — what the composition root wires to `runNightlySleep`.
// ---------------------------------------------------------------------------

/** Aggregate counts the runner reports for one tenant's consolidation run. */
export interface ReflexionTenantConsolidation {
  readonly tenantId: string;
  /** reflexions clustered in pass-1. */
  readonly clustered: number;
  /** guideline rows inserted/overwritten in pass-3. */
  readonly guidelinesWritten: number;
  /** reflexions soft-pruned in pass-4. */
  readonly pruned: number;
  /** Non-fatal per-pass errors (the run still completes). */
  readonly errors: ReadonlyArray<string>;
}

export interface ReflexionConsolidationRunner {
  /** List tenants with at least one un-consolidated reflexion. */
  listTenants(): Promise<ReadonlyArray<string>>;
  /**
   * Run the 4-pass consolidation for one tenant. MUST be idempotent —
   * a re-run over already-consolidated reflexions writes nothing new.
   * MUST NOT throw for an ordinary per-tenant failure: return the error
   * in `errors` so the orchestrator can continue to the next tenant.
   */
  runForTenant(args: {
    readonly tenantId: string;
    readonly abortSignal: AbortSignal;
  }): Promise<ReflexionTenantConsolidation>;
}

// ---------------------------------------------------------------------------
// In-memory runner — deterministic reference shape + test double.
// ---------------------------------------------------------------------------

export interface InMemoryReflexionSeed {
  readonly tenantId: string;
  readonly clustered: number;
  readonly guidelinesWritten: number;
  readonly pruned: number;
}

export function createInMemoryReflexionRunner(
  seed: ReadonlyArray<InMemoryReflexionSeed>,
): ReflexionConsolidationRunner & {
  callsFor: (tenantId: string) => number;
} {
  const calls = new Map<string, number>();
  return {
    async listTenants() {
      return seed.map((s) => s.tenantId);
    },
    async runForTenant({ tenantId }) {
      calls.set(tenantId, (calls.get(tenantId) ?? 0) + 1);
      const match = seed.find((s) => s.tenantId === tenantId);
      if (match === undefined) {
        return {
          tenantId,
          clustered: 0,
          guidelinesWritten: 0,
          pruned: 0,
          errors: [],
        };
      }
      return {
        tenantId: match.tenantId,
        clustered: match.clustered,
        guidelinesWritten: match.guidelinesWritten,
        pruned: match.pruned,
        errors: [],
      };
    },
    callsFor: (tenantId) => calls.get(tenantId) ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Pass
// ---------------------------------------------------------------------------

const PASS_ID = 'reflexion-consolidation';

export function createReflexionConsolidationPass(
  runner: ReflexionConsolidationRunner,
): SleepPass {
  return {
    id: PASS_ID,
    schedule: {
      // 04:15 local — after graph-rag-community-summaries (03:30), deep in
      // the off-peak window so the LLM-touching passes do not contend.
      cadence: { kind: 'daily', hour: 4, minute: 15 },
      // 18-hour minimum interval so a manual one-off run cannot re-fire.
      minIntervalMinutes: 60 * 18,
      priority: 4,
      // 20-min hard cap; per-tenant progress is durable (each tenant's
      // reflexion rows are independently consolidated + committed).
      maxDurationMs: 20 * 60_000,
    },
    async run({ abortSignal, now }): Promise<PassResult> {
      const startedAt = now().toISOString();
      let tenants: ReadonlyArray<string>;
      try {
        tenants = await runner.listTenants();
      } catch (err) {
        return {
          passId: PASS_ID,
          itemsProcessed: 0,
          itemsEmitted: 0,
          notes: `listTenants failed: ${err instanceof Error ? err.message : String(err)}`,
          startedAt,
          completedAt: now().toISOString(),
          aborted: abortSignal.aborted,
          errored: true,
        };
      }

      let clustered = 0;
      let guidelinesWritten = 0;
      let pruned = 0;
      let tenantErrors = 0;
      for (const tenantId of tenants) {
        if (abortSignal.aborted) break;
        try {
          const r = await runner.runForTenant({ tenantId, abortSignal });
          clustered += r.clustered;
          guidelinesWritten += r.guidelinesWritten;
          pruned += r.pruned;
          if (r.errors.length > 0) tenantErrors += r.errors.length;
        } catch {
          // Per-tenant failure is non-fatal — partial progress is intended.
          tenantErrors += 1;
          continue;
        }
      }

      return {
        passId: PASS_ID,
        itemsProcessed: clustered,
        itemsEmitted: guidelinesWritten,
        notes:
          `tenants=${tenants.length} clustered=${clustered} ` +
          `guidelines=${guidelinesWritten} pruned=${pruned} ` +
          `tenantErrors=${tenantErrors}`,
        startedAt,
        completedAt: now().toISOString(),
        aborted: abortSignal.aborted,
        errored: false,
      };
    },
  };
}
