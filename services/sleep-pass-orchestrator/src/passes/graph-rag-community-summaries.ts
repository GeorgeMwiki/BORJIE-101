/**
 * Sleep pass — generate GraphRAG community summaries nightly.
 *
 * Companion to `Docs/DESIGN/GRAPH_RAG_ROUTER_SPEC.md` §4. The pass:
 *
 *   1. For each tenant the adapter exposes, walks the per-tenant
 *      knowledge graph (entities + relations).
 *   2. Runs lightweight community detection (label-propagation /
 *      Louvain-style; see `@borjie/graph-rag-router/community-detector`).
 *   3. For every community whose `signatureHash` differs from the
 *      previous run, calls the injected LLM summariser and persists
 *      a new `CommunitySummary` row.
 *   4. Communities whose signatures are unchanged are short-circuited
 *      — zero LLM tokens spent.
 *
 * Adapters are injected (no DB / no LLM imports in the pass).
 *
 * Note: this pass file does not import `@borjie/graph-rag-router` at
 * runtime — it accepts a `GraphRAGCommunityAdapter` port that the
 * composition root wires up (so the orchestrator's own
 * package.json does not need to take a workspace dep on the router).
 */

import type { PassResult, SleepPass } from '../types.js';

// ---------------------------------------------------------------------------
// Port — what the composition root wires.
// ---------------------------------------------------------------------------

export interface GraphRAGTenantSummaryPlan {
  readonly tenantId: string;
  readonly communitiesConsidered: number;
  readonly communitiesSummarised: number;
  readonly communitiesSkipped: number;
}

export interface GraphRAGCommunityAdapter {
  /** List tenants with at least one knowledge-graph entity. */
  listTenants(): Promise<ReadonlyArray<string>>;
  /**
   * Run community detection + (selective) summarisation for one tenant.
   * MUST be idempotent — re-runs on an unchanged graph generate zero
   * new summaries.
   */
  runForTenant(args: {
    readonly tenantId: string;
    readonly abortSignal: AbortSignal;
  }): Promise<GraphRAGTenantSummaryPlan>;
}

// ---------------------------------------------------------------------------
// In-memory adapter — used by the test below + as a reference shape.
// ---------------------------------------------------------------------------

export interface InMemoryTenantSeed {
  readonly tenantId: string;
  readonly communitiesConsidered: number;
  readonly communitiesSummarised: number;
  readonly communitiesSkipped: number;
}

export function createInMemoryGraphRAGAdapter(
  seed: ReadonlyArray<InMemoryTenantSeed>,
): GraphRAGCommunityAdapter & {
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
          communitiesConsidered: 0,
          communitiesSummarised: 0,
          communitiesSkipped: 0,
        };
      }
      return {
        tenantId: match.tenantId,
        communitiesConsidered: match.communitiesConsidered,
        communitiesSummarised: match.communitiesSummarised,
        communitiesSkipped: match.communitiesSkipped,
      };
    },
    callsFor: (tenantId) => calls.get(tenantId) ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Pass
// ---------------------------------------------------------------------------

const PASS_ID = 'graph-rag-community-summaries';

export function createGraphRAGCommunitySummariesPass(
  adapter: GraphRAGCommunityAdapter,
): SleepPass {
  return {
    id: PASS_ID,
    schedule: {
      // 03:30 local — off-peak in EAT, after metrics-rollup at 01:30.
      cadence: { kind: 'daily', hour: 3, minute: 30 },
      // 18-hour minimum interval so a manual one-off run cannot re-fire.
      minIntervalMinutes: 60 * 18,
      priority: 3,
      // 30 min hard cap; partial progress is durable per tenant.
      maxDurationMs: 30 * 60_000,
    },
    async run({ abortSignal, now }): Promise<PassResult> {
      const startedAt = now().toISOString();
      const tenants = await adapter.listTenants();
      let considered = 0;
      let emitted = 0;
      let skipped = 0;
      for (const tenantId of tenants) {
        if (abortSignal.aborted) break;
        try {
          const plan = await adapter.runForTenant({ tenantId, abortSignal });
          considered += plan.communitiesConsidered;
          emitted += plan.communitiesSummarised;
          skipped += plan.communitiesSkipped;
        } catch {
          // Continue on per-tenant failure — partial progress is
          // intentional. The detailed error is surfaced via the
          // adapter's own observability surface; the pass result
          // captures aggregate counts only.
          continue;
        }
      }
      return {
        passId: PASS_ID,
        itemsProcessed: considered,
        itemsEmitted: emitted,
        notes: `tenants=${tenants.length} summarised=${emitted} skipped=${skipped}`,
        startedAt,
        completedAt: now().toISOString(),
        aborted: abortSignal.aborted,
        errored: false,
      };
    },
  };
}
