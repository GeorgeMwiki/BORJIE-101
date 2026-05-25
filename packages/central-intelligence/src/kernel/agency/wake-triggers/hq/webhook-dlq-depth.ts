/**
 * HQ wake-trigger — webhook dead-letter queue (DLQ) depth detector.
 *
 * Central Command Phase A gap #6 closure. The webhook DLQ (`webhook_dlq`
 * — see `services/api-gateway/src/routes/webhook-dlq*.ts` for the
 * operator surface) holds inbound webhooks that failed all retry
 * attempts. A high DLQ depth signals systemic delivery failure:
 * either an upstream provider is misconfigured or downstream consumers
 * are silently rejecting deliveries.
 *
 * Default threshold: 50 stale items per tenant. "Stale" = older than
 * the configured staleness window (default 1 hour) so transient spikes
 * during a deploy don't fire a wake-goal.
 *
 * Severity model:
 *   - 50-199 stale items → medium
 *   - 200-999            → high
 *   - 1000+              → critical
 */
import type {
  WakeTrigger,
  WakeTriggerDetectArgs,
  WakeTriggerDetectedGoal,
} from '../../initiative/wake-loop.js';

export interface DlqDepthRow {
  readonly tenantId: string;
  readonly staleCount: number;
  /** Oldest stale row's age in hours — surfaced on the goal so the
   *  operator sees the "how long has this been bleeding" signal. */
  readonly oldestStaleHours: number;
  /** Optional dominant provider (e.g. "gepg", "kra") so the goal title
   *  can name the culprit when one provider dominates the DLQ. */
  readonly dominantProvider: string | null;
}

export interface WebhookDlqDepthReadPort {
  countStaleByTenant(args: {
    readonly tenantId: string;
    readonly staleAfterHours: number;
    readonly asOf: Date;
  }): Promise<DlqDepthRow | null>;
}

export interface WebhookDlqDepthTriggerDeps {
  readonly dlqRead?: WebhookDlqDepthReadPort;
  /** Trigger only when stale-count ≥ this. Default 50. */
  readonly staleCountFloor?: number;
  /** Rows older than this many hours are considered "stale" for the
   *  purposes of triggering. Default 1. */
  readonly staleAfterHours?: number;
  readonly resolveAssigneeUserId?: (
    tenantId: string,
  ) => Promise<string | null>;
}

const DEFAULT_STALE_COUNT_FLOOR = 50;
const DEFAULT_STALE_AFTER_HOURS = 1;

async function resolveAssignee(
  deps: WebhookDlqDepthTriggerDeps,
  tenantId: string,
): Promise<string> {
  if (!deps.resolveAssigneeUserId) return 'hq-bot';
  const resolved = await deps.resolveAssigneeUserId(tenantId).catch(() => null);
  return resolved ?? 'hq-bot';
}

function severityFor(count: number): 'medium' | 'high' | 'critical' {
  if (count >= 1000) return 'critical';
  if (count >= 200) return 'high';
  return 'medium';
}

function priorityForSeverity(
  severity: 'medium' | 'high' | 'critical',
): WakeTriggerDetectedGoal['priority'] {
  if (severity === 'critical') return 'critical';
  if (severity === 'high') return 'high';
  return 'medium';
}

export function createWebhookDlqDepthTrigger(
  deps: WebhookDlqDepthTriggerDeps,
): WakeTrigger {
  const staleCountFloor =
    deps.staleCountFloor ?? DEFAULT_STALE_COUNT_FLOOR;
  const staleAfterHours =
    deps.staleAfterHours ?? DEFAULT_STALE_AFTER_HOURS;

  return {
    id: 'hq.webhook-dlq-depth',
    description:
      'HQ-tier — detect tenants with >=50 stale webhook DLQ items; ' +
      'suggest a replay-or-drain plan to operations.',
    async detect({
      tenantId,
      clock,
    }: WakeTriggerDetectArgs): Promise<ReadonlyArray<WakeTriggerDetectedGoal>> {
      if (!deps.dlqRead) return [];
      const asOf = clock();
      const row = await deps.dlqRead
        .countStaleByTenant({
          tenantId,
          staleAfterHours,
          asOf,
        })
        .catch(() => null);
      if (!row) return [];
      if (row.staleCount < staleCountFloor) return [];
      const severity = severityFor(row.staleCount);
      const userId = await resolveAssignee(deps, tenantId);

      const providerLabel = row.dominantProvider
        ? ` (${row.dominantProvider} dominant)`
        : '';

      return [
        {
          userId,
          threadId: `wake-hq-webhook-dlq-${row.tenantId}`,
          title: `Webhook DLQ depth ${row.staleCount}${providerLabel} — ${row.tenantId}`,
          description:
            `Tenant ${row.tenantId} has ${row.staleCount} stale webhook ` +
            `DLQ items (oldest ${row.oldestStaleHours}h). ` +
            `Severity ${severity}. Decide between bulk-replay, ` +
            `drain-to-archive, or alert the dominant provider.`,
          priority: priorityForSeverity(severity),
          steps: [
            {
              seq: 1,
              description: `Review DLQ snapshot for ${row.tenantId}`,
              toolName: null,
              toolPayload: null,
            },
            {
              seq: 2,
              description: `Plan replay or drain for ${row.tenantId}`,
              toolName: 'platform.webhook-dlq-decision',
              toolPayload: {
                tenantId: row.tenantId,
                staleCount: row.staleCount,
                oldestStaleHours: row.oldestStaleHours,
                dominantProvider: row.dominantProvider,
                severity,
              },
            },
          ],
        },
      ];
    },
  };
}
