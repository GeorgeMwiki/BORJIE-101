/**
 * HQ wake-trigger — AI cost overrun detector.
 *
 * Central Command Phase A gap #6 closure. Pairs with the existing
 * `tenant_budget_envelopes` table (K4 schema): each tenant has a
 * period-bound USD ceiling on AI sensor spend. When a tenant is past
 * 80% of its envelope AND still has 7+ days left in the period, fire a
 * goal so HQ can either:
 *
 *   - Top up the envelope (tenant-initiated request),
 *   - Throttle their tier's sensor chain,
 *   - Or notify the customer of an imminent breach.
 *
 * Why ≥7 days remaining and not all the way to 100%? Because a tenant
 * burning their envelope on day 24 of a 30-day cycle is normal usage;
 * a tenant past 80% on day 5 is anomalous. The window is intentionally
 * conservative — we'd rather miss a marginal breach than spam HQ with
 * end-of-cycle false positives.
 *
 * Severity model:
 *   - 80-89% with 7+ days remaining → medium
 *   - 90-99%                        → high
 *   - 100%+ (already breached)      → critical
 */
import type {
  WakeTrigger,
  WakeTriggerDetectArgs,
  WakeTriggerDetectedGoal,
} from '../../initiative/wake-loop.js';

export interface BudgetEnvelopeRow {
  readonly tenantId: string;
  readonly periodKey: string;
  /** Spend so far this period, in microdollars to match K4. */
  readonly spendMicros: number;
  /** Period cap in microdollars. */
  readonly capMicros: number;
  /** ISO date the period ends — used for the 7-day remaining check. */
  readonly periodEndsAt: string;
}

export interface AiCostOverrunReadPort {
  /** Returns ALL envelopes for the tenant that match the at-risk
   *  predicate the port has agreed with the gateway composition root.
   *  Typically: "spend ≥ 0.8 * cap AND periodEndsAt > NOW() + 7d". */
  listAtRiskEnvelopes(args: {
    readonly tenantId: string;
    readonly utilizationFloor: number;
    readonly minDaysRemaining: number;
    readonly asOf: Date;
  }): Promise<ReadonlyArray<BudgetEnvelopeRow>>;
}

export interface AiCostOverrunTriggerDeps {
  readonly costRead?: AiCostOverrunReadPort;
  /** Utilization threshold below which we won't fire (default 0.8). */
  readonly utilizationFloor?: number;
  /** Minimum days remaining in the period to count as "still has runway"
   *  (default 7). */
  readonly minDaysRemaining?: number;
  readonly perTenantLimit?: number;
  readonly resolveAssigneeUserId?: (
    tenantId: string,
  ) => Promise<string | null>;
}

const DEFAULT_UTILIZATION_FLOOR = 0.8;
const DEFAULT_MIN_DAYS_REMAINING = 7;
const DEFAULT_PER_TENANT_LIMIT = 5;

async function resolveAssignee(
  deps: AiCostOverrunTriggerDeps,
  tenantId: string,
): Promise<string> {
  if (!deps.resolveAssigneeUserId) return 'hq-bot';
  const resolved = await deps.resolveAssigneeUserId(tenantId).catch(() => null);
  return resolved ?? 'hq-bot';
}

function severityFor(utilization: number): 'medium' | 'high' | 'critical' {
  if (utilization >= 1.0) return 'critical';
  if (utilization >= 0.9) return 'high';
  return 'medium';
}

function priorityForSeverity(
  severity: 'medium' | 'high' | 'critical',
): WakeTriggerDetectedGoal['priority'] {
  if (severity === 'critical') return 'critical';
  if (severity === 'high') return 'high';
  return 'medium';
}

export function createAiCostOverrunTrigger(
  deps: AiCostOverrunTriggerDeps,
): WakeTrigger {
  const utilizationFloor =
    deps.utilizationFloor ?? DEFAULT_UTILIZATION_FLOOR;
  const minDaysRemaining =
    deps.minDaysRemaining ?? DEFAULT_MIN_DAYS_REMAINING;
  const perTenantLimit = deps.perTenantLimit ?? DEFAULT_PER_TENANT_LIMIT;

  return {
    id: 'hq.ai-cost-overrun',
    description:
      'HQ-tier — detect tenants past their AI cost utilization floor ' +
      'with non-trivial runway left in the period; suggest top-up or ' +
      'sensor-chain throttle.',
    async detect({
      tenantId,
      clock,
    }: WakeTriggerDetectArgs): Promise<ReadonlyArray<WakeTriggerDetectedGoal>> {
      if (!deps.costRead) return [];
      const asOf = clock();
      const rows = await deps.costRead
        .listAtRiskEnvelopes({
          tenantId,
          utilizationFloor,
          minDaysRemaining,
          asOf,
        })
        .catch(() => [] as ReadonlyArray<BudgetEnvelopeRow>);
      if (!rows.length) return [];
      const bounded = rows.slice(0, perTenantLimit);
      const userId = await resolveAssignee(deps, tenantId);

      return bounded.map<WakeTriggerDetectedGoal>((row) => {
        const utilization =
          row.capMicros > 0 ? row.spendMicros / row.capMicros : 0;
        const severity = severityFor(utilization);
        return {
          userId,
          threadId: `wake-hq-ai-cost-${row.tenantId}-${row.periodKey}`,
          title: `AI cost ${(utilization * 100).toFixed(0)}% — ${row.tenantId}`,
          description:
            `Tenant ${row.tenantId} is at ${(utilization * 100).toFixed(0)}% ` +
            `of their AI envelope (${row.spendMicros}/${row.capMicros} ` +
            `microdollars) for period ${row.periodKey} ending ${row.periodEndsAt}. ` +
            `Severity ${severity}. Decide between top-up + throttle + ` +
            `customer-notify.`,
          priority: priorityForSeverity(severity),
          steps: [
            {
              seq: 1,
              description: `Review AI cost envelope for ${row.tenantId}`,
              toolName: null,
              toolPayload: null,
            },
            {
              seq: 2,
              description: `Decide top-up vs throttle for ${row.tenantId}`,
              toolName: 'platform.ai-cost-overrun-decision',
              toolPayload: {
                tenantId: row.tenantId,
                periodKey: row.periodKey,
                utilization,
                spendMicros: row.spendMicros,
                capMicros: row.capMicros,
                severity,
              },
            },
          ],
        };
      });
    },
  };
}
