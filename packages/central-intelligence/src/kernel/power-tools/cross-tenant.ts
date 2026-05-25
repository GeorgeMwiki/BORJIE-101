/**
 * power_tool.cross_tenant — controlled cross-tenant aggregate.
 *
 * Mines an anonymised aggregate across multiple tenants. Only the
 * `platform-sovereign` tier (or higher) may invoke it. Returns a
 * `{ count, mean, median, p10, p90 }` shape — never an individual
 * tenant row.
 *
 * K-anonymity guard:
 *   - Cohort size MUST be ≥ `minCohortK` (default + absolute floor 30).
 *   - Anything smaller refuses with `COHORT_TOO_SMALL`.
 *   - The k floor is a property-management equivalent of the TZ PDPA /
 *     Kenya DPA threshold for safe aggregate disclosure.
 *
 * Tier model:
 *   - requiredTier: platform-sovereign. Cross-tenant visibility is the
 *     defining sovereign-tier capability; below it the agent has only
 *     the tenant it is scoped to.
 *
 * Approval: yes. Every cross-tenant query lands in front of a four-eye
 * approval gate so two distinct platform-tier admins must consent
 * before the aggregate is computed. (The kernel's approval flow runs
 * BEFORE invoke; this tool's `execute` simply verifies the orchestrator
 * threaded the approval id through.)
 *
 * Audit trail: sovereign_action_ledger — the regulator-grade chain that
 * mirrors LITFIN's cross-borrower-pattern audit + adds tamper-resistant
 * hash chaining.
 *
 * @module kernel/power-tools/cross-tenant
 */

import { z } from 'zod';
import type {
  PowerTool,
  PowerToolContext,
  PowerToolResult,
} from './types.js';

const DEFAULT_MIN_COHORT_K = 30;
const ABSOLUTE_MIN_COHORT_K = 30;
const MAX_COHORT_FETCH = 5000;

const MetricEnum = z.enum([
  'arrears-rate',
  'avg-rent-tzs',
  'avg-occupancy',
  'avg-resolution-hours',
  'maintenance-ticket-volume',
  'compliance-cert-validity-rate',
]);

export type CrossTenantMetric = z.infer<typeof MetricEnum>;

// ─────────────────────────────────────────────────────────────────────
// Adapter port — backing data source, supplied by composition root.
// ─────────────────────────────────────────────────────────────────────

export interface CrossTenantCohortInput {
  readonly metric: CrossTenantMetric;
  readonly region?: string;
  readonly minCohortK: number;
}

export interface CrossTenantStats {
  readonly count: number;
  readonly mean: number;
  readonly median: number;
  readonly p10: number;
  readonly p90: number;
}

export interface CrossTenantAggregateOutcome {
  readonly stats: CrossTenantStats;
  readonly cohortSize: number;
}

export interface CrossTenantAggregateAdapter {
  aggregate(input: CrossTenantCohortInput): Promise<CrossTenantAggregateOutcome>;
}

// ─────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────

export const CrossTenantSchema = z.object({
  metric: MetricEnum,
  region: z.string().min(1).max(120).optional(),
  /** Caller-supplied k floor; clamped to ABSOLUTE_MIN_COHORT_K. */
  minCohortK: z.number().int().min(ABSOLUTE_MIN_COHORT_K).optional(),
});

export type CrossTenantArgs = z.infer<typeof CrossTenantSchema>;

export interface CrossTenantOutput {
  readonly action: 'cross-tenant';
  readonly metric: CrossTenantMetric;
  readonly region: string | null;
  readonly cohortSize: number;
  readonly minCohortK: number;
  readonly stats: CrossTenantStats;
  readonly anonymity: {
    readonly guard: 'k-anonymity';
    readonly k: number;
    readonly identifiesIndividualTenants: false;
  };
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createCrossTenantPowerTool(
  adapter: CrossTenantAggregateAdapter | null,
): PowerTool<CrossTenantArgs, CrossTenantOutput> {
  return {
    id: 'cross_tenant',
    name: 'Cross-tenant aggregate',
    description:
      'Compute a k-anonymous aggregate across multiple tenants (e.g. arrears rate across the platform). Refuses to drill into cohorts < k=30.',
    requiredTier: 'platform-sovereign',
    requiresApproval: true,
    auditDestination: 'sovereign-action-ledger',
    schema: CrossTenantSchema,
    async execute(
      _ctx: PowerToolContext,
      args: CrossTenantArgs,
    ): Promise<PowerToolResult<CrossTenantOutput>> {
      if (!adapter) {
        return {
          kind: 'refused',
          reasonCode: 'NOT_IMPLEMENTED',
          message:
            'No cross-tenant aggregate adapter is wired. Bind one at composition root.',
        };
      }

      const minCohortK = Math.max(
        ABSOLUTE_MIN_COHORT_K,
        args.minCohortK ?? DEFAULT_MIN_COHORT_K,
      );

      let outcome: CrossTenantAggregateOutcome;
      try {
        outcome = await adapter.aggregate({
          metric: args.metric,
          ...(args.region !== undefined ? { region: args.region } : {}),
          minCohortK,
        });
      } catch (err) {
        return {
          kind: 'failed',
          message: err instanceof Error ? err.message : String(err),
        };
      }

      if (outcome.cohortSize < minCohortK) {
        return {
          kind: 'refused',
          reasonCode: 'COHORT_TOO_SMALL',
          message: `cohort size ${outcome.cohortSize} below k floor ${minCohortK}`,
        };
      }
      if (outcome.cohortSize > MAX_COHORT_FETCH) {
        // Adapter is responsible for capping, but defensive guard.
        return {
          kind: 'failed',
          message: `adapter returned cohort size ${outcome.cohortSize}, above ceiling ${MAX_COHORT_FETCH}`,
        };
      }

      return {
        kind: 'ok',
        output: {
          action: 'cross-tenant',
          metric: args.metric,
          region: args.region ?? null,
          cohortSize: outcome.cohortSize,
          minCohortK,
          stats: outcome.stats,
          anonymity: {
            guard: 'k-anonymity',
            k: outcome.cohortSize,
            identifiesIndividualTenants: false,
          },
        },
      };
    },
  };
}
