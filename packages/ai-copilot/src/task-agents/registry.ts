/**
 * TASK_AGENT_REGISTRY — the canonical Readonly<Record<string, TaskAgent>>
 * exposing every registered narrow-scope agent for the executor and the
 * api-gateway router to enumerate.
 *
 * Keep this list explicit. Every agent is imported by name so code-search
 * (jump-to-definition / grep) lands right on the implementation. We do
 * not side-load via glob.
 */
import type { TaskAgent } from './types.js';
import { royaltyReminderAgent } from './agents/royalty-reminder.agent.js';
import { lateFeeCalculatorAgent } from './agents/late-fee-calculator.agent.js';
import { offtakeRenewalSchedulerAgent } from './agents/offtake-renewal-scheduler.agent.js';
import { siteClosureNoticeAgent } from './agents/site-closure-notice.agent.js';
import { inspectionReminderAgent } from './agents/inspection-reminder.agent.js';
import { vendorInvoiceApproverAgent } from './agents/vendor-invoice-approver.agent.js';
import { buyerSentimentMonitorAgent } from './agents/buyer-sentiment-monitor.agent.js';
import { royaltyArrearsLadderTickAgent } from './agents/royalty-arrears-ladder-tick.agent.js';
import { insuranceExpiryMonitorAgent } from './agents/insurance-expiry-monitor.agent.js';
import { licenseExpiryMonitorAgent } from './agents/license-expiry-monitor.agent.js';
import { productionMeterReadingReminderAgent } from './agents/production-meter-reading-reminder.agent.js';
import { availableCapacityMarketerAgent } from './agents/available-capacity-marketer.agent.js';
import { proactiveMaintenanceAlertAgent } from './agents/proactive-maintenance-alert.agent.js';
import { crossBuyerChurnRiskAgent } from './agents/cross-buyer-churn-risk.agent.js';
import { paymentPlanProposerAgent } from './agents/payment-plan-proposer.agent.js';

// The full typed registry. Order is stable (insertion order) for UI
// enumeration but the consumer is `Record`-shaped for O(1) lookup by id.
export const TASK_AGENT_REGISTRY: Readonly<Record<string, TaskAgent>> =
  Object.freeze({
    [royaltyReminderAgent.id]: royaltyReminderAgent as unknown as TaskAgent,
    [lateFeeCalculatorAgent.id]: lateFeeCalculatorAgent as unknown as TaskAgent,
    [offtakeRenewalSchedulerAgent.id]: offtakeRenewalSchedulerAgent as unknown as TaskAgent,
    [siteClosureNoticeAgent.id]: siteClosureNoticeAgent as unknown as TaskAgent,
    [inspectionReminderAgent.id]: inspectionReminderAgent as unknown as TaskAgent,
    [vendorInvoiceApproverAgent.id]: vendorInvoiceApproverAgent as unknown as TaskAgent,
    [buyerSentimentMonitorAgent.id]: buyerSentimentMonitorAgent as unknown as TaskAgent,
    [royaltyArrearsLadderTickAgent.id]: royaltyArrearsLadderTickAgent as unknown as TaskAgent,
    [insuranceExpiryMonitorAgent.id]: insuranceExpiryMonitorAgent as unknown as TaskAgent,
    [licenseExpiryMonitorAgent.id]: licenseExpiryMonitorAgent as unknown as TaskAgent,
    [productionMeterReadingReminderAgent.id]: productionMeterReadingReminderAgent as unknown as TaskAgent,
    [availableCapacityMarketerAgent.id]: availableCapacityMarketerAgent as unknown as TaskAgent,
    [proactiveMaintenanceAlertAgent.id]: proactiveMaintenanceAlertAgent as unknown as TaskAgent,
    [crossBuyerChurnRiskAgent.id]: crossBuyerChurnRiskAgent as unknown as TaskAgent,
    [paymentPlanProposerAgent.id]: paymentPlanProposerAgent as unknown as TaskAgent,
  });

/** Typed union of every agent id currently in the registry. */
export type TaskAgentId = keyof typeof TASK_AGENT_REGISTRY;

/** Flat list for UI enumeration. */
export const TASK_AGENTS: ReadonlyArray<TaskAgent> = Object.freeze(
  Object.values(TASK_AGENT_REGISTRY),
);
