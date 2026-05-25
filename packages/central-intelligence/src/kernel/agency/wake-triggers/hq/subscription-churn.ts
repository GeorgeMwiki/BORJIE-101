/**
 * HQ wake-trigger — subscription churn detector.
 *
 * Central Command Phase A gap #6 closure (see
 * `.planning/research/central-command/2025-bn-internal-gap-audit.md`
 * §6): the wake-loop's three existing triggers (arrears, lease-expiry,
 * vacancy) are all tenant-scoped. HQ has zero autonomous source of
 * goals around subscription health, AI cost, DLQ depth, or persona
 * drift. This trigger is the FIRST HQ-tier detector and the template
 * the other three follow.
 *
 * Detection logic: scan the `tenants` table for status transitions in
 * the last 24h. Any tenant that flipped active → churned (or, more
 * generally, any tenant whose row was updated in that window AND now
 * has `is_active = false`) fires a wake-goal that suggests a save-the-
 * customer outreach.
 *
 * The detector is read-port-typed (NOT a Drizzle handle) so the
 * kernel package stays free of `@borjie/database` imports. The
 * api-gateway composition root wires the real Drizzle adapter.
 *
 * Severity model (carried in the `WakeEvent` payload, NOT in the
 * trigger output — the wake-loop translates payload severity into
 * goal priority):
 *
 *   - 1 churn in window → severity = "low" → priority = "medium"
 *   - 2-4 churns        → severity = "medium" → priority = "high"
 *   - 5+ churns         → severity = "high" → priority = "critical"
 *
 * Sovereign-action policy: the action this trigger proposes
 * (`platform.subscription-save-outreach`) is NOT in
 * `SOVEREIGN_TIER_ACTION_NAMES` — it's a normal medium-stakes outreach.
 * The four-eye gate still applies whenever the AutonomyPolicy requires
 * approval for the platform-hq tier.
 */
import type {
  WakeTrigger,
  WakeTriggerDetectArgs,
  WakeTriggerDetectedGoal,
} from '../../initiative/wake-loop.js';

export interface SubscriptionChurnRow {
  readonly tenantId: string;
  /** ISO string when the tenant row last transitioned. */
  readonly churnedAt: string;
  /** Optional human label for the tenant (powers the goal title). */
  readonly tenantName: string | null;
}

/**
 * Read port — the detector calls this once per tick per tenantId.
 * Returns the recent churn events for THAT tenant only (typically 0
 * or 1; >1 means the tenant was reactivated then churned again within
 * the window — rare but non-zero in practice).
 *
 * Implementations:
 *   - Production: a Drizzle adapter that SELECTs
 *     `tenants WHERE id = $1 AND is_active = false AND updated_at > NOW() - INTERVAL '24h'`
 *   - Tests: pass an in-memory map.
 */
export interface SubscriptionChurnReadPort {
  listRecentChurns(args: {
    readonly tenantId: string;
    readonly windowHours: number;
    readonly asOf: Date;
  }): Promise<ReadonlyArray<SubscriptionChurnRow>>;
}

export interface SubscriptionChurnTriggerDeps {
  readonly churnRead?: SubscriptionChurnReadPort;
  /** Rolling window in hours. Default 24. */
  readonly windowHours?: number;
  /** Bound on how many churn rows we'll convert to goals per tenant
   *  per tick (defense-in-depth). */
  readonly perTenantLimit?: number;
  /** Resolves the userId the goal should be assigned to (HQ operator).
   *  Falls back to `'hq-bot'` so goals can still open. */
  readonly resolveAssigneeUserId?: (
    tenantId: string,
  ) => Promise<string | null>;
}

const DEFAULT_WINDOW_HOURS = 24;
const DEFAULT_PER_TENANT_LIMIT = 10;

async function resolveAssignee(
  deps: SubscriptionChurnTriggerDeps,
  tenantId: string,
): Promise<string> {
  if (!deps.resolveAssigneeUserId) return 'hq-bot';
  const resolved = await deps.resolveAssigneeUserId(tenantId).catch(() => null);
  return resolved ?? 'hq-bot';
}

/**
 * Severity is derived from the per-tick churn count for the tenant.
 * The wake-loop translates payload severity into goal priority below.
 */
function severityFor(count: number): 'low' | 'medium' | 'high' {
  if (count >= 5) return 'high';
  if (count >= 2) return 'medium';
  return 'low';
}

function priorityForSeverity(
  severity: 'low' | 'medium' | 'high',
): WakeTriggerDetectedGoal['priority'] {
  if (severity === 'high') return 'critical';
  if (severity === 'medium') return 'high';
  return 'medium';
}

export function createSubscriptionChurnTrigger(
  deps: SubscriptionChurnTriggerDeps,
): WakeTrigger {
  const windowHours = deps.windowHours ?? DEFAULT_WINDOW_HOURS;
  const perTenantLimit = deps.perTenantLimit ?? DEFAULT_PER_TENANT_LIMIT;

  return {
    id: 'hq.subscription-churn',
    description:
      'HQ-tier — detect tenants that churned in the last 24h and ' +
      'open a save-the-customer outreach goal.',
    async detect({
      tenantId,
      clock,
    }: WakeTriggerDetectArgs): Promise<ReadonlyArray<WakeTriggerDetectedGoal>> {
      if (!deps.churnRead) return [];
      const asOf = clock();
      const rows = await deps.churnRead
        .listRecentChurns({ tenantId, windowHours, asOf })
        .catch(() => [] as ReadonlyArray<SubscriptionChurnRow>);
      if (!rows.length) return [];
      const bounded = rows.slice(0, perTenantLimit);
      const severity = severityFor(bounded.length);
      const userId = await resolveAssignee(deps, tenantId);

      return bounded.map<WakeTriggerDetectedGoal>((row) => ({
        userId,
        threadId: `wake-hq-subscription-churn-${row.tenantId}`,
        title: `Save outreach for ${row.tenantName ?? row.tenantId}`,
        description:
          `Tenant ${row.tenantId} churned at ${row.churnedAt}. ` +
          `Severity ${severity}. Suggest a same-day outreach + ` +
          `incentive analysis before win-back window closes.`,
        priority: priorityForSeverity(severity),
        steps: [
          {
            seq: 1,
            description: `Review churn context for tenant ${row.tenantId}`,
            toolName: null,
            toolPayload: null,
          },
          {
            seq: 2,
            description: `Draft save-outreach for tenant ${row.tenantId}`,
            toolName: 'platform.subscription-save-outreach',
            toolPayload: {
              tenantId: row.tenantId,
              churnedAt: row.churnedAt,
              severity,
            },
          },
        ],
      }));
    },
  };
}
