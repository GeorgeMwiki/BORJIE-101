/**
 * HQ wake-trigger — persona-drift breach detector.
 *
 * Central Command Phase A gap #6 closure. K3 (persona drift) computes
 * an L2 distance between the kernel's per-turn persona vector and the
 * tenant-anchored `BORJIE_REFERENCE_PERSONA`. Per the existing
 * thresholds:
 *
 *   - Per-turn ceiling : 0.150 (kernel.ts persona-drift alert)
 *   - 24h aggregate    : 0.075 (operator dashboard threshold)
 *
 * This trigger fires when the AGGREGATE-L2 over the last 24h exceeds
 * 0.075 for a tenant — a sustained breach that the per-turn alert
 * doesn't surface (a single below-threshold turn doesn't fire, but a
 * day's worth of marginal turns does).
 *
 * Severity model:
 *   - 0.075 - 0.099 → medium
 *   - 0.100 - 0.149 → high
 *   - 0.150+        → critical (also tripping the per-turn ceiling)
 *
 * The HQ goal is NOT itself a sovereign action — it asks for an
 * investigation, not an automatic retune. Persona retuning crosses the
 * four-eye gate because it touches the kernel's reference vector,
 * which affects every subsequent turn for the tenant.
 */
import type {
  WakeTrigger,
  WakeTriggerDetectArgs,
  WakeTriggerDetectedGoal,
} from '../../initiative/wake-loop.js';

export interface PersonaDriftAggregateRow {
  readonly tenantId: string;
  /** Aggregate L2 over the rolling window. */
  readonly aggregateL2: number;
  /** Number of turns in the window — context for the operator. */
  readonly turnCount: number;
  /** Dominant dimension contributing to the drift (e.g. "warmth",
   *  "directness", "formality") — null when no single dim dominates. */
  readonly dominantDim: string | null;
  /** ISO string for the start of the rolling window. */
  readonly windowStartedAt: string;
}

export interface PersonaDriftReadPort {
  getRecentAggregate(args: {
    readonly tenantId: string;
    readonly windowHours: number;
    readonly asOf: Date;
  }): Promise<PersonaDriftAggregateRow | null>;
}

export interface PersonaDriftBreachTriggerDeps {
  readonly driftRead?: PersonaDriftReadPort;
  /** Aggregate-L2 floor that counts as a breach. Default 0.075. */
  readonly aggregateL2Floor?: number;
  /** Rolling window in hours. Default 24. */
  readonly windowHours?: number;
  readonly resolveAssigneeUserId?: (
    tenantId: string,
  ) => Promise<string | null>;
}

const DEFAULT_AGGREGATE_L2_FLOOR = 0.075;
const DEFAULT_WINDOW_HOURS = 24;

async function resolveAssignee(
  deps: PersonaDriftBreachTriggerDeps,
  tenantId: string,
): Promise<string> {
  if (!deps.resolveAssigneeUserId) return 'hq-bot';
  const resolved = await deps.resolveAssigneeUserId(tenantId).catch(() => null);
  return resolved ?? 'hq-bot';
}

function severityFor(l2: number): 'medium' | 'high' | 'critical' {
  if (l2 >= 0.15) return 'critical';
  if (l2 >= 0.1) return 'high';
  return 'medium';
}

function priorityForSeverity(
  severity: 'medium' | 'high' | 'critical',
): WakeTriggerDetectedGoal['priority'] {
  if (severity === 'critical') return 'critical';
  if (severity === 'high') return 'high';
  return 'medium';
}

export function createPersonaDriftBreachTrigger(
  deps: PersonaDriftBreachTriggerDeps,
): WakeTrigger {
  const aggregateL2Floor =
    deps.aggregateL2Floor ?? DEFAULT_AGGREGATE_L2_FLOOR;
  const windowHours = deps.windowHours ?? DEFAULT_WINDOW_HOURS;

  return {
    id: 'hq.persona-drift-breach',
    description:
      'HQ-tier — detect tenants whose aggregate-L2 persona drift over ' +
      '24h breaches 0.075; suggest a kernel reference-vector ' +
      'investigation before per-turn alerts cascade.',
    async detect({
      tenantId,
      clock,
    }: WakeTriggerDetectArgs): Promise<ReadonlyArray<WakeTriggerDetectedGoal>> {
      if (!deps.driftRead) return [];
      const asOf = clock();
      const row = await deps.driftRead
        .getRecentAggregate({
          tenantId,
          windowHours,
          asOf,
        })
        .catch(() => null);
      if (!row) return [];
      if (row.aggregateL2 < aggregateL2Floor) return [];
      const severity = severityFor(row.aggregateL2);
      const userId = await resolveAssignee(deps, tenantId);
      const dimLabel = row.dominantDim
        ? ` (dim=${row.dominantDim})`
        : '';

      return [
        {
          userId,
          threadId: `wake-hq-persona-drift-${row.tenantId}`,
          title:
            `Persona drift L2=${row.aggregateL2.toFixed(3)}${dimLabel} — ` +
            `${row.tenantId}`,
          description:
            `Tenant ${row.tenantId} has a ${windowHours}h aggregate ` +
            `persona-drift L2 of ${row.aggregateL2.toFixed(3)} ` +
            `(threshold ${aggregateL2Floor.toFixed(3)}, ${row.turnCount} ` +
            `turns, window started ${row.windowStartedAt}). Severity ` +
            `${severity}. Investigate reference-vector calibration before ` +
            `per-turn alerts cascade.`,
          priority: priorityForSeverity(severity),
          steps: [
            {
              seq: 1,
              description:
                `Review persona-drift trace for ${row.tenantId} ` +
                `(${windowHours}h window)`,
              toolName: null,
              toolPayload: null,
            },
            {
              seq: 2,
              description:
                `Propose persona-drift mitigation for ${row.tenantId}`,
              toolName: 'platform.persona-drift-mitigation-proposed',
              toolPayload: {
                tenantId: row.tenantId,
                aggregateL2: row.aggregateL2,
                threshold: aggregateL2Floor,
                turnCount: row.turnCount,
                dominantDim: row.dominantDim,
                severity,
              },
            },
          ],
        },
      ];
    },
  };
}
