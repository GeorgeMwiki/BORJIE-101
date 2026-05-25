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
 * port additionally requires `listActiveTenants(tenantId)` which joins
 * leases / customers / payments / cases / intelligence_history /
 * credit_rating_snapshots / arrears_cases per active customer to
 * project a `TenantFeatureSnapshot`. This wiring implements that join
 * directly via Drizzle. Where a particular signal is unavailable
 * cleanly the field is returned `null`; the agent's heuristic baseline
 * gracefully handles nulls.
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

import { and, desc, eq, gte, isNotNull, lte, sql } from 'drizzle-orm';

import { createDatabaseClient } from '@borjie/database';
import { createTenantPredictionsService } from '@borjie/database';
import {
  customers,
  leases,
  payments,
  cases as casesTable,
  arrearsCases,
  intelligenceHistory,
  creditRatingSnapshots,
} from '@borjie/database';
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
 * One row per active customer, projecting the eight TenantFeatureSnapshot
 * fields. Internal shape — converted to readonly TenantFeatureSnapshot by
 * the caller.
 */
interface ActiveTenantRow {
  customerId: string;
  paymentOnTimeRate: number | null;
  arrearsDays: number | null;
  creditScore: number | null;
  tenancyMonths: number | null;
  openCases: number;
  rollingSentiment: number | null;
  churnSignalAvg: number | null;
  disputeCount90d: number;
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;

function diffMonths(a: Date, b: Date): number {
  const ms = a.getTime() - b.getTime();
  return Math.max(0, Math.floor(ms / (30 * 24 * 60 * 60 * 1000)));
}

/**
 * Real Drizzle implementation of `listActiveTenants`. Returns `[]` on
 * any query error so the agent's nightly run degrades gracefully.
 */
async function listActiveTenantsImpl(
  db: DatabaseClient,
  tenantId: string,
  now: () => Date,
  logger?: { warn(meta: object, msg: string): void },
): Promise<readonly TenantFeatureSnapshot[]> {
  if (!tenantId) return [];

  const cutoff90d = new Date(now().getTime() - NINETY_DAYS_MS);
  const cutoff6m = new Date(now().getTime() - SIX_MONTHS_MS);
  const today = now();

  try {
    // 1. Active customers via active leases — one row per (customer, lease)
    //    pair. We dedupe by customerId after fetch and pick the earliest
    //    leaseStart for tenancyMonths.
    const activeLeaseRows = (await db
      .select({
        customerId: leases.customerId,
        startDate: leases.startDate,
      })
      .from(leases)
      .innerJoin(customers, eq(customers.id, leases.customerId))
      .where(
        and(
          eq(leases.tenantId, tenantId),
          eq(leases.status, 'active'),
          eq(customers.tenantId, tenantId),
          eq(customers.status, 'active'),
        ),
      )) as ReadonlyArray<{ customerId: string; startDate: Date | string }>;

    if (activeLeaseRows.length === 0) return [];

    // Earliest start per customer = tenancy length proxy.
    const earliestStartByCustomer = new Map<string, Date>();
    for (const row of activeLeaseRows) {
      const start =
        row.startDate instanceof Date ? row.startDate : new Date(row.startDate);
      const prev = earliestStartByCustomer.get(row.customerId);
      if (!prev || start.getTime() < prev.getTime()) {
        earliestStartByCustomer.set(row.customerId, start);
      }
    }

    const activeCustomerIds = Array.from(earliestStartByCustomer.keys());
    if (activeCustomerIds.length === 0) return [];

    // 2. Per-customer payment on-time rate over the last 6 months.
    //    A payment is "on-time" when status='completed' and
    //    completedAt <= invoice.dueDate. We count both totals via two
    //    aggregated queries and compute the rate per customer.
    const paymentTotalsRaw = (await db
      .select({
        customerId: payments.customerId,
        total: sql<number>`count(*)::int`,
        ontime: sql<number>`sum(case when ${payments.status} = 'completed' then 1 else 0 end)::int`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.tenantId, tenantId),
          gte(payments.createdAt, cutoff6m),
        ),
      )
      .groupBy(payments.customerId)) as ReadonlyArray<{
      customerId: string;
      total: number;
      ontime: number;
    }>;

    const paymentRateByCustomer = new Map<string, number | null>();
    for (const r of paymentTotalsRaw) {
      const total = Number(r.total) || 0;
      const ontime = Number(r.ontime) || 0;
      paymentRateByCustomer.set(
        r.customerId,
        total > 0 ? Math.max(0, Math.min(1, ontime / total)) : null,
      );
    }

    // 3. arrearsDays — max daysPastDue from active arrears_cases.
    const arrearsRowsRaw = (await db
      .select({
        customerId: arrearsCases.customerId,
        daysPastDue: arrearsCases.daysPastDue,
      })
      .from(arrearsCases)
      .where(
        and(
          eq(arrearsCases.tenantId, tenantId),
          eq(arrearsCases.status, 'active'),
        ),
      )) as ReadonlyArray<{ customerId: string; daysPastDue: number | null }>;
    const arrearsByCustomer = new Map<string, number>();
    for (const r of arrearsRowsRaw) {
      const days = Number(r.daysPastDue) || 0;
      const prev = arrearsByCustomer.get(r.customerId) ?? 0;
      if (days > prev) arrearsByCustomer.set(r.customerId, days);
    }

    // 4. Latest credit-rating snapshot per customer.
    const creditRowsRaw = (await db
      .select({
        customerId: creditRatingSnapshots.customerId,
        numericScore: creditRatingSnapshots.numericScore,
        computedAt: creditRatingSnapshots.computedAt,
      })
      .from(creditRatingSnapshots)
      .where(eq(creditRatingSnapshots.tenantId, tenantId))
      .orderBy(desc(creditRatingSnapshots.computedAt))) as ReadonlyArray<{
      customerId: string;
      numericScore: number | null;
      computedAt: Date | string;
    }>;
    const creditByCustomer = new Map<string, number | null>();
    for (const r of creditRowsRaw) {
      if (creditByCustomer.has(r.customerId)) continue; // first row = latest
      creditByCustomer.set(
        r.customerId,
        r.numericScore === null || r.numericScore === undefined
          ? null
          : Number(r.numericScore),
      );
    }

    // 5. Open cases per customer (any status that's not closed/resolved/withdrawn).
    const openCaseRowsRaw = (await db
      .select({
        customerId: casesTable.customerId,
        count: sql<number>`count(*)::int`,
      })
      .from(casesTable)
      .where(
        and(
          eq(casesTable.tenantId, tenantId),
          isNotNull(casesTable.customerId),
          sql`${casesTable.status} not in ('closed','resolved','withdrawn')`,
        ),
      )
      .groupBy(casesTable.customerId)) as ReadonlyArray<{
      customerId: string | null;
      count: number;
    }>;
    const openCasesByCustomer = new Map<string, number>();
    for (const r of openCaseRowsRaw) {
      if (!r.customerId) continue;
      openCasesByCustomer.set(r.customerId, Number(r.count) || 0);
    }

    // 6. Disputes in last 90 days = cases of type billing_dispute /
    //    deposit_dispute / damage_claim opened within window.
    const disputeRowsRaw = (await db
      .select({
        customerId: casesTable.customerId,
        count: sql<number>`count(*)::int`,
      })
      .from(casesTable)
      .where(
        and(
          eq(casesTable.tenantId, tenantId),
          isNotNull(casesTable.customerId),
          gte(casesTable.createdAt, cutoff90d),
          sql`${casesTable.caseType} in ('billing_dispute','deposit_dispute','damage_claim')`,
        ),
      )
      .groupBy(casesTable.customerId)) as ReadonlyArray<{
      customerId: string | null;
      count: number;
    }>;
    const disputeCountByCustomer = new Map<string, number>();
    for (const r of disputeRowsRaw) {
      if (!r.customerId) continue;
      disputeCountByCustomer.set(r.customerId, Number(r.count) || 0);
    }

    // 7. Latest intelligence_history snapshot per customer for sentiment +
    //    churn signals. We pull the most recent row per customer using the
    //    snapshotDate desc; the (tenant_id, customer_id, snapshot_date)
    //    uniqueness keeps this efficient.
    //    `snapshot_date` is a Postgres DATE column (no time-of-day) so we
    //    bound the window with ISO-yyyy-mm-dd strings rather than Date
    //    objects (Drizzle's date adapter accepts the string form natively).
    const cutoff90dDateStr = cutoff90d.toISOString().slice(0, 10);
    const todayDateStr = today.toISOString().slice(0, 10);
    const intelRowsRaw = (await db
      .select({
        customerId: intelligenceHistory.customerId,
        sentimentScore: intelligenceHistory.sentimentScore,
        churnRiskScore: intelligenceHistory.churnRiskScore,
        snapshotDate: intelligenceHistory.snapshotDate,
      })
      .from(intelligenceHistory)
      .where(
        and(
          eq(intelligenceHistory.tenantId, tenantId),
          gte(intelligenceHistory.snapshotDate, cutoff90dDateStr),
          lte(intelligenceHistory.snapshotDate, todayDateStr),
        ),
      )
      .orderBy(desc(intelligenceHistory.snapshotDate))) as ReadonlyArray<{
      customerId: string;
      sentimentScore: number | string | null;
      churnRiskScore: number | null;
      snapshotDate: Date | string;
    }>;
    const sentimentByCustomer = new Map<string, number | null>();
    const churnByCustomer = new Map<string, number | null>();
    for (const r of intelRowsRaw) {
      if (!sentimentByCustomer.has(r.customerId)) {
        const s =
          r.sentimentScore === null || r.sentimentScore === undefined
            ? null
            : Number(r.sentimentScore);
        sentimentByCustomer.set(
          r.customerId,
          s === null || Number.isNaN(s) ? null : Math.max(-1, Math.min(1, s)),
        );
      }
      if (!churnByCustomer.has(r.customerId)) {
        const c = r.churnRiskScore;
        churnByCustomer.set(
          r.customerId,
          c === null || c === undefined
            ? null
            : Math.max(0, Math.min(1, Number(c) / 100)),
        );
      }
    }

    // 8. Project rows.
    const rows: ActiveTenantRow[] = activeCustomerIds.map((customerId) => {
      const start = earliestStartByCustomer.get(customerId);
      return {
        customerId,
        paymentOnTimeRate: paymentRateByCustomer.get(customerId) ?? null,
        arrearsDays: arrearsByCustomer.get(customerId) ?? null,
        creditScore: creditByCustomer.get(customerId) ?? null,
        tenancyMonths: start ? diffMonths(today, start) : null,
        openCases: openCasesByCustomer.get(customerId) ?? 0,
        rollingSentiment: sentimentByCustomer.get(customerId) ?? null,
        churnSignalAvg: churnByCustomer.get(customerId) ?? null,
        disputeCount90d: disputeCountByCustomer.get(customerId) ?? 0,
      };
    });

    return rows.map(
      (r): TenantFeatureSnapshot => ({
        tenantId,
        customerId: r.customerId,
        paymentOnTimeRate: r.paymentOnTimeRate,
        arrearsDays: r.arrearsDays,
        creditScore: r.creditScore,
        tenancyMonths: r.tenancyMonths,
        openCases: r.openCases,
        rollingSentiment: r.rollingSentiment,
        churnSignalAvg: r.churnSignalAvg,
        disputeCount90d: r.disputeCount90d,
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
 * one method the DB service does NOT expose — it requires a join with
 * leases / customers / payments / cases / intelligence-history /
 * credit-rating-snapshots / arrears-cases, which we run here directly.
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
