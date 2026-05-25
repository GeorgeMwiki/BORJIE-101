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
import { rentReminderAgent } from './agents/rent-reminder.agent.js';
import { lateFeeCalculatorAgent } from './agents/late-fee-calculator.agent.js';
import { leaseRenewalSchedulerAgent } from './agents/lease-renewal-scheduler.agent.js';
import { moveOutNoticeAgent } from './agents/move-out-notice.agent.js';
import { inspectionReminderAgent } from './agents/inspection-reminder.agent.js';
import { vendorInvoiceApproverAgent } from './agents/vendor-invoice-approver.agent.js';
import { tenantSentimentMonitorAgent } from './agents/tenant-sentiment-monitor.agent.js';
import { arrearsLadderTickAgent } from './agents/arrears-ladder-tick.agent.js';
import { insuranceExpiryMonitorAgent } from './agents/insurance-expiry-monitor.agent.js';
import { licenseExpiryMonitorAgent } from './agents/license-expiry-monitor.agent.js';
import { utilityMeterReadingReminderAgent } from './agents/utility-meter-reading-reminder.agent.js';
import { vacancyMarketerAgent } from './agents/vacancy-marketer.agent.js';
import { proactiveMaintenanceAlertAgent } from './agents/proactive-maintenance-alert.agent.js';
import { crossTenantChurnRiskAgent } from './agents/cross-tenant-churn-risk.agent.js';
import { paymentPlanProposerAgent } from './agents/payment-plan-proposer.agent.js';

// The full typed registry. Order is stable (insertion order) for UI
// enumeration but the consumer is `Record`-shaped for O(1) lookup by id.
export const TASK_AGENT_REGISTRY: Readonly<Record<string, TaskAgent>> =
  Object.freeze({
    [rentReminderAgent.id]: rentReminderAgent,
    [lateFeeCalculatorAgent.id]: lateFeeCalculatorAgent,
    [leaseRenewalSchedulerAgent.id]: leaseRenewalSchedulerAgent,
    [moveOutNoticeAgent.id]: moveOutNoticeAgent,
    [inspectionReminderAgent.id]: inspectionReminderAgent,
    [vendorInvoiceApproverAgent.id]: vendorInvoiceApproverAgent,
    [tenantSentimentMonitorAgent.id]: tenantSentimentMonitorAgent,
    [arrearsLadderTickAgent.id]: arrearsLadderTickAgent,
    [insuranceExpiryMonitorAgent.id]: insuranceExpiryMonitorAgent,
    [licenseExpiryMonitorAgent.id]: licenseExpiryMonitorAgent,
    [utilityMeterReadingReminderAgent.id]: utilityMeterReadingReminderAgent,
    [vacancyMarketerAgent.id]: vacancyMarketerAgent,
    [proactiveMaintenanceAlertAgent.id]: proactiveMaintenanceAlertAgent,
    [crossTenantChurnRiskAgent.id]: crossTenantChurnRiskAgent,
    [paymentPlanProposerAgent.id]: paymentPlanProposerAgent,
  });

/** Typed union of every agent id currently in the registry. */
export type TaskAgentId = keyof typeof TASK_AGENT_REGISTRY;

/** Flat list for UI enumeration. */
export const TASK_AGENTS: ReadonlyArray<TaskAgent> = Object.freeze(
  Object.values(TASK_AGENT_REGISTRY),
);
