/**
 * Predictive-interventions wiring — composes the AI-native
 * `PredictiveInterventions` agent (from
 * `@borjie/ai-copilot/ai-native/predictive-interventions`) on top
 * of the Drizzle-backed `tenant_predictions` /
 * `predictive_intervention_opportunities` storage adapter shipped in
 * `@borjie/database` (commit e33cebc, migration 0106).
 *
 * The DB service exposes `insertPrediction`, `insertOpportunity`,
 * `listRecentPredictions`, and `listOpenOpportunities`. The agent's
 * port additionally requires `listActiveTenants(tenantId)` which
 * projects one `TenantFeatureSnapshot` per active mining BUYER (the
 * mining-domain customer). The original property-domain join
 * (leases / customers / payments / cases / intelligence_history /
 * credit_rating_snapshots / arrears_cases) referenced tables ALL
 * dropped in migration `0003_mining_domain.sql`; importing them bound
 * `undefined` and crashed `listActiveTenants` with a raw TypeError.
 * This wiring re-points the join to the SURVIVING mining tables
 * `buyers` + `sales`: the payment-on-time rate and arrears-days are
 * derived from each buyer's mineral-sale settlement history; the
 * property-only signals (credit score, tenancy months, sentiment,
 * churn, disputes) are returned `null`/`0` — the agent's heuristic
 * baseline gracefully handles the absent signals.
 *
 * LLM port: when an `anthropicClientFactory`
 * (`buildBudgetGuardedAnthropicClient`) is supplied, the wiring exposes
 * a per-tenant `agentFor(tenantId)` factory that builds a
 * `ClassifyLLMPort` backed by the budget-guarded Anthropic client. The
 * default `wiring.agent` continues to operate in heuristic-baseline
 * mode (no LLM) so it can be used outside a request scope (e.g.
 * background jobs that don't pre-resolve a tenant context).
 *
 * Returns `null` when `deps.db` is absent (in-memory / test mode); the
 * caller is responsible for skipping the predictive-interventions
 * routes in that case.
 *
 * Tenant isolation is preserved end-to-end: every query is scoped by
 * `tenantId` and `customerId`, the agent threads those ids through
 * every emission, and the LLM client is built per-tenant so the budget
 * guard knows which cap to enforce.
 */

import { and, eq, gte, sql } from 'drizzle-orm';

import { createDatabaseClient } from '@borjie/database';
import { createTenantPredictionsService } from '@borjie/database';
import { buyers, sales } from '@borjie/database';
import {
  createPredictiveInterventions,
  type ClassifyLLMPort,
  type InterventionOpportunity,
  type InterventionSignalType,
  type PredictiveInterventionRepository,
  type TenantFeatureSnapshot,
  type TenantPrediction,
} from '@borjie/ai-copilot/ai-native';
import {
  ModelTier,
  type BudgetGuardedAnthropicClient,
} from '@borjie/ai-copilot/providers';
import {
  withAgentSpan,
  recordDegraded,
} from '../instrumentation/agent-spans.js';

/**
 * DatabaseClient derived via `ReturnType<typeof createDatabaseClient>`
 * to sidestep the package-barrel `TS2709 Cannot use namespace ... as
 * a type` drift (see service-registry.ts).
 */
type DatabaseClient = ReturnType<typeof createDatabaseClient>;

/**
 * Factory shape exported by the service-registry for building a
 * per-tenant budget-guarded Anthropic client (Wave 26 Agent Z4).
 */
export type BudgetGuardedAnthropicClientFactory = (
  tenantId: string,
  operation?: string,
) => BudgetGuardedAnthropicClient;

export interface PredictiveInterventionsWiringDeps {
  readonly db: DatabaseClient | null;
  readonly logger?: { warn(meta: object, msg: string): void };
  /**
   * Optional. When supplied, `agentFor(tenantId)` returns an agent
   * backed by a `ClassifyLLMPort` adapter that calls Claude. Without
   * it, every agent runs in heuristic-baseline mode.
   */
  readonly anthropicClientFactory?: BudgetGuardedAnthropicClientFactory | null;
  /**
   * Optional. When supplied, the agent injects `now` from this
   * callable rather than `new Date()`. Used by tests to drive the
   * arrears-days clock deterministically.
   */
  readonly now?: () => Date;
}

export interface PredictiveInterventionsWiring {
  /**
   * Heuristic-baseline agent (no LLM). Safe for background jobs that
   * don't have a tenant context up-front.
   */
  readonly agent: ReturnType<typeof createPredictiveInterventions>;
  /**
   * Per-tenant agent factory. When `anthropicClientFactory` was
   * supplied, the returned agent uses the budget-guarded Anthropic
   * client; otherwise it falls back to the heuristic baseline.
   */
  readonly agentFor: (
    tenantId: string,
  ) => ReturnType<typeof createPredictiveInterventions>;
}

// ---------------------------------------------------------------------------
// listActiveTenants — Drizzle join
// ---------------------------------------------------------------------------

/**
 * One row per active buyer, carrying the two derivable mining signals.
 * Internal shape — projected to the full readonly TenantFeatureSnapshot
 * (property-only fields null/0) by the caller.
 */
interface ActiveTenantRow {
  customerId: string;
  paymentOnTimeRate: number | null;
  arrearsDays: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SIX_MONTHS_MS = 180 * DAY_MS;

/**
 * Real Drizzle implementation of `listActiveTenants`, mining-domain
 * edition. Projects one `TenantFeatureSnapshot` per active BUYER from
 * the surviving `buyers` + `sales` tables. Returns `[]` on any query
 * error so the agent's nightly run degrades gracefully.
 *
 * Mining mapping:
 *   - customer            ← buyer (kyc_status != 'rejected')
 *   - paymentOnTimeRate   ← fraction of the buyer's recent sales whose
 *                           payment_status is a settled state
 *                           (completed | paid | settled)
 *   - arrearsDays         ← max age (days) of any still-pending sale
 *   - creditScore / tenancyMonths / rollingSentiment / churnSignalAvg
 *                         ← null (no surviving mining source)
 *   - openCases / disputeCount90d ← 0 (no surviving mining source)
 */
async function listActiveTenantsImpl(
  db: DatabaseClient,
  tenantId: string,
  now: () => Date,
  logger?: { warn(meta: object, msg: string): void },
): Promise<readonly TenantFeatureSnapshot[]> {
  if (!tenantId) return [];

  const cutoff6m = new Date(now().getTime() - SIX_MONTHS_MS);
  const today = now();

  try {
    // 1. Active buyers (the mining-domain customer). A buyer is "active"
    //    when it is not KYC-rejected; the bid/sale flow gates further.
    const buyerRows = (await db
      .select({ id: buyers.id })
      .from(buyers)
      .where(
        and(
          eq(buyers.tenantId, tenantId),
          sql`${buyers.kycStatus} <> 'rejected'`,
        ),
      )) as ReadonlyArray<{ id: string }>;

    if (buyerRows.length === 0) return [];
    const activeCustomerIds = buyerRows.map((b) => b.id);

    // 2. Per-buyer payment on-time rate over the last 6 months. A sale is
    //    "settled" when payment_status is completed | paid | settled.
    const paymentTotalsRaw = (await db
      .select({
        buyerId: sales.buyerId,
        total: sql<number>`count(*)::int`,
        settled: sql<number>`sum(case when ${sales.paymentStatus} in ('completed','paid','settled') then 1 else 0 end)::int`,
      })
      .from(sales)
      .where(
        and(
          eq(sales.tenantId, tenantId),
          gte(sales.ts, cutoff6m),
          sql`${sales.buyerId} is not null`,
        ),
      )
      .groupBy(sales.buyerId)) as ReadonlyArray<{
      buyerId: string | null;
      total: number;
      settled: number;
    }>;

    const paymentRateByCustomer = new Map<string, number | null>();
    for (const r of paymentTotalsRaw) {
      if (!r.buyerId) continue;
      const total = Number(r.total) || 0;
      const settled = Number(r.settled) || 0;
      paymentRateByCustomer.set(
        r.buyerId,
        total > 0 ? Math.max(0, Math.min(1, settled / total)) : null,
      );
    }

    // 3. arrearsDays — age (days) of the OLDEST still-pending sale per
    //    buyer (a delivered parcel the buyer has not settled).
    const arrearsRowsRaw = (await db
      .select({
        buyerId: sales.buyerId,
        oldestPending: sql<string | null>`min(${sales.ts})`,
      })
      .from(sales)
      .where(
        and(
          eq(sales.tenantId, tenantId),
          eq(sales.paymentStatus, 'pending'),
          sql`${sales.buyerId} is not null`,
        ),
      )
      .groupBy(sales.buyerId)) as ReadonlyArray<{
      buyerId: string | null;
      oldestPending: string | Date | null;
    }>;
    const arrearsByCustomer = new Map<string, number>();
    for (const r of arrearsRowsRaw) {
      if (!r.buyerId || r.oldestPending == null) continue;
      const ms =
        r.oldestPending instanceof Date
          ? r.oldestPending.getTime()
          : new Date(r.oldestPending).getTime();
      if (Number.isNaN(ms)) continue;
      const days = Math.max(0, Math.floor((today.getTime() - ms) / DAY_MS));
      arrearsByCustomer.set(r.buyerId, days);
    }

    // 4. Project rows.
    const rows: ActiveTenantRow[] = activeCustomerIds.map((customerId) => ({
      customerId,
      paymentOnTimeRate: paymentRateByCustomer.get(customerId) ?? null,
      arrearsDays: arrearsByCustomer.get(customerId) ?? null,
    }));

    return rows.map(
      (r): TenantFeatureSnapshot => ({
        tenantId,
        customerId: r.customerId,
        paymentOnTimeRate: r.paymentOnTimeRate,
        arrearsDays: r.arrearsDays,
        // Property-only signals with no surviving mining source — null/0.
        creditScore: null,
        tenancyMonths: null,
        openCases: 0,
        rollingSentiment: null,
        churnSignalAvg: null,
        disputeCount90d: 0,
      }),
    );
  } catch (error) {
    if (logger) {
      logger.warn(
        { tenantId, err: error instanceof Error ? error.message : String(error) },
        'predictive-interventions.listActiveTenants failed; degrading to []',
      );
    }
    return [];
  }
}

// ---------------------------------------------------------------------------
// ClassifyLLMPort adapter — wraps the budget-guarded Anthropic client
// ---------------------------------------------------------------------------

/**
 * Build a thin `ClassifyLLMPort` that calls Claude via the budget-guarded
 * Anthropic SDK and returns the raw content for the agent to parse with
 * `safeJsonParse`. The agent already forces JSON-only via its system prompt.
 *
 * Errors bubble up to the agent which catches them and falls through to the
 * heuristic baseline (see `callLLM` in predictive-interventions/index.ts).
 */
function createAnthropicClassifyPort(
  client: BudgetGuardedAnthropicClient,
): ClassifyLLMPort {
  return {
    async classify(input) {
      const model = input.model ?? client.defaultModel ?? ModelTier.SONNET;
      const response = await client.sdk.messages.create({
        model,
        max_tokens: 1024,
        temperature: 0.2,
        system: input.systemPrompt,
        messages: [{ role: 'user', content: input.userPrompt }],
      });
      const raw = response.content
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text as string)
        .join('\n')
        .trim();
      return {
        raw,
        modelVersion: model,
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Repo adapter
// ---------------------------------------------------------------------------

/**
 * Adapt the DB service into the agent's
 * `PredictiveInterventionRepository` port. `listActiveTenants` is the
 * one method the DB service does NOT expose — it projects per-buyer
 * settlement features from the mining `buyers` + `sales` tables, which
 * we run here directly (see `listActiveTenantsImpl`).
 */
function createRepoAdapter(
  db: DatabaseClient,
  now: () => Date,
  logger?: PredictiveInterventionsWiringDeps['logger'],
): PredictiveInterventionRepository {
  const svc = createTenantPredictionsService(db);

  return {
    async listActiveTenants(tenantId: string) {
      return listActiveTenantsImpl(db, tenantId, now, logger);
    },

    async insertPrediction(prediction: TenantPrediction): Promise<TenantPrediction> {
      // The agent's TenantPrediction and the DB service's
      // TenantPredictionShape are structurally identical (verified
      // field-by-field). Pass through unchanged; the DB adapter
      // returns the same record on success.
      const stored = await svc.insertPrediction(prediction);
      return {
        ...prediction,
        ...stored,
      };
    },

    async insertOpportunity(op: InterventionOpportunity): Promise<InterventionOpportunity> {
      // The DB service's `signalType` is `string`; the agent's is the
      // `InterventionSignalType` union. Narrow at the read boundary.
      const stored = await svc.insertOpportunity(op);
      return {
        ...op,
        ...stored,
        signalType: op.signalType,
      };
    },

    async listRecentPredictions(
      tenantId: string,
      customerId: string,
    ): Promise<readonly TenantPrediction[]> {
      const rows = await svc.listRecentPredictions(tenantId, customerId);
      // Shape is identical; cast horizonDays through to satisfy the
      // agent's union (DB service already clamps to 30|60|90).
      return rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        customerId: r.customerId,
        horizonDays: r.horizonDays,
        probPayOnTime: r.probPayOnTime,
        probPayLate: r.probPayLate,
        probDefault: r.probDefault,
        probChurn: r.probChurn,
        probDispute: r.probDispute,
        modelVersion: r.modelVersion,
        confidence: r.confidence,
        explanation: r.explanation,
        featureSnapshot: r.featureSnapshot,
        promptHash: r.promptHash,
        computedAt: r.computedAt,
      }));
    },
  };
}

/**
 * Coerce a free-form string from the DB layer into the agent's
 * `InterventionSignalType` union. Unknown values fall back to
 * `'high_default_risk'` rather than throwing — defensive for older
 * rows written before the union was finalised.
 */
export function narrowSignalType(value: string): InterventionSignalType {
  if (
    value === 'high_default_risk' ||
    value === 'high_churn_risk' ||
    value === 'high_dispute_risk' ||
    value === 'sentiment_collapse'
  ) {
    return value;
  }
  return 'high_default_risk';
}

/**
 * Build the predictive-interventions wiring. Returns `null` when no
 * DB client is available (the caller is responsible for skipping the
 * routes that depend on this agent).
 */
export function createPredictiveInterventionsWiring(
  deps: PredictiveInterventionsWiringDeps,
): PredictiveInterventionsWiring | null {
  if (!deps.db) {
    if (deps.logger) {
      deps.logger.warn(
        {},
        'predictive-interventions wiring skipped — no DB client available',
      );
    }
    return null;
  }

  const now = deps.now ?? (() => new Date());
  const repo = createRepoAdapter(deps.db, now, deps.logger);
  const factory = deps.anthropicClientFactory ?? null;

  // No anthropic client factory means the LLM port runs in heuristic-
  // baseline mode for every tenant. Surface that on the
  // `agent_port_degraded_total` counter so dashboards can flag the
  // posture explicitly.
  if (!factory) {
    recordDegraded(
      'predictive-interventions',
      'ClassifyLLMPort',
      'NO_ANTHROPIC_CLIENT_FACTORY',
    );
  }

  // Heuristic-baseline agent — used when the caller doesn't have a
  // tenant context (e.g. background jobs running ahead of the
  // request-scoped LLM client). We instrument once so reference
  // identity holds across `agent` and the no-factory `agentFor` path.
  const baselineAgent = instrumentPredictiveAgent(
    createPredictiveInterventions({
      repo,
      now,
      // llm/publisher/budgetGuard intentionally omitted.
    }),
  );

  function buildAgentForTenant(tenantId: string) {
    if (!factory || !tenantId) {
      // Without a factory we share the (already-instrumented) baseline
      // agent — feature-snapshot tenancy still routes correctly because
      // the agent threads the tenantId from `features.tenantId`.
      return baselineAgent;
    }
    const client = factory(tenantId, 'predictive-interventions:predict');
    const llm = createAnthropicClassifyPort(client);
    return instrumentPredictiveAgent(
      createPredictiveInterventions({
        repo,
        llm,
        now,
      }),
    );
  }

  return {
    agent: baselineAgent,
    agentFor: buildAgentForTenant,
  };
}

/**
 * Wrap the agent's three public methods (`predictOne`, `runNightly`,
 * `listRecent`) in `withAgentSpan(...)` so each invocation produces an
 * `agent.predictive-interventions.*` span and increments the per-agent
 * counter / latency histogram. Returns a fresh object — does not
 * mutate the underlying agent.
 */
function instrumentPredictiveAgent(
  agent: ReturnType<typeof createPredictiveInterventions>,
): ReturnType<typeof createPredictiveInterventions> {
  return {
    predictOne(features, horizonDays) {
      return withAgentSpan(
        'predictive-interventions',
        'predictOne',
        () => agent.predictOne(features, horizonDays),
        {
          tenantId: features?.tenantId ?? null,
          attributes: {
            ...(features?.customerId && { customerId: features.customerId }),
            ...(typeof horizonDays === 'number' && { horizonDays }),
          },
        },
      );
    },
    runNightly(tenantId) {
      return withAgentSpan(
        'predictive-interventions',
        'runNightly',
        () => agent.runNightly(tenantId),
        { tenantId },
      );
    },
    listRecent(tenantId, customerId) {
      return withAgentSpan(
        'predictive-interventions',
        'listRecent',
        () => agent.listRecent(tenantId, customerId),
        { tenantId, attributes: { customerId } },
      );
    },
  };
}

export {
  createRepoAdapter as __createRepoAdapterForTests,
  createAnthropicClassifyPort as __createAnthropicClassifyPortForTests,
  listActiveTenantsImpl as __listActiveTenantsImplForTests,
};
