/**
 * HQ-tier wake triggers — Central Command Phase A gap #6.
 *
 * Four detectors that bring the wake-loop's autonomous surface up to
 * platform-HQ scope, complementing the three existing tenant-scope
 * triggers (arrears / lease-expiry / vacancy).
 *
 * Each detector is read-port-typed so the central-intelligence package
 * stays free of database / queue / event-bus imports. The api-gateway
 * composition root wires real ports against Drizzle services and the
 * existing `tenant_budget_envelopes` / `webhook_dlq` / persona-drift
 * stores.
 *
 * Wiring location:
 *   `services/api-gateway/src/composition/wake-loop-cron.ts`
 *
 * Trigger IDs (stable — operator dashboards key off these):
 *   - hq.subscription-churn
 *   - hq.ai-cost-overrun
 *   - hq.webhook-dlq-depth
 *   - hq.persona-drift-breach
 */
export {
  createSubscriptionChurnTrigger,
  type SubscriptionChurnReadPort,
  type SubscriptionChurnRow,
  type SubscriptionChurnTriggerDeps,
} from './subscription-churn.js';

export {
  createAiCostOverrunTrigger,
  type AiCostOverrunReadPort,
  type AiCostOverrunTriggerDeps,
  type BudgetEnvelopeRow,
} from './ai-cost-overrun.js';

export {
  createWebhookDlqDepthTrigger,
  type DlqDepthRow,
  type WebhookDlqDepthReadPort,
  type WebhookDlqDepthTriggerDeps,
} from './webhook-dlq-depth.js';

export {
  createPersonaDriftBreachTrigger,
  type PersonaDriftAggregateRow,
  type PersonaDriftBreachTriggerDeps,
  type PersonaDriftReadPort,
} from './persona-drift-breach.js';

import type { WakeTrigger } from '../../initiative/wake-loop.js';
import {
  createSubscriptionChurnTrigger,
  type SubscriptionChurnTriggerDeps,
} from './subscription-churn.js';
import {
  createAiCostOverrunTrigger,
  type AiCostOverrunTriggerDeps,
} from './ai-cost-overrun.js';
import {
  createWebhookDlqDepthTrigger,
  type WebhookDlqDepthTriggerDeps,
} from './webhook-dlq-depth.js';
import {
  createPersonaDriftBreachTrigger,
  type PersonaDriftBreachTriggerDeps,
} from './persona-drift-breach.js';

export interface HqWakeTriggerDeps {
  readonly subscriptionChurn?: SubscriptionChurnTriggerDeps;
  readonly aiCostOverrun?: AiCostOverrunTriggerDeps;
  readonly webhookDlqDepth?: WebhookDlqDepthTriggerDeps;
  readonly personaDriftBreach?: PersonaDriftBreachTriggerDeps;
}

/**
 * One-call factory that builds all four HQ triggers. Pass empty deps
 * sub-objects to keep a trigger registered but emitting no goals (the
 * detector returns [] when its read port is missing) — useful when
 * one of the dependent services is not yet wired.
 */
export function createHqWakeTriggers(
  deps: HqWakeTriggerDeps,
): ReadonlyArray<WakeTrigger> {
  return [
    createSubscriptionChurnTrigger(deps.subscriptionChurn ?? {}),
    createAiCostOverrunTrigger(deps.aiCostOverrun ?? {}),
    createWebhookDlqDepthTrigger(deps.webhookDlqDepth ?? {}),
    createPersonaDriftBreachTrigger(deps.personaDriftBreach ?? {}),
  ];
}

/**
 * Stable list of HQ trigger IDs — useful for dashboard / log filters
 * that want to slice "HQ" from "tenant" wake triggers.
 */
export const HQ_WAKE_TRIGGER_IDS: ReadonlyArray<string> = [
  'hq.subscription-churn',
  'hq.ai-cost-overrun',
  'hq.webhook-dlq-depth',
  'hq.persona-drift-breach',
];
