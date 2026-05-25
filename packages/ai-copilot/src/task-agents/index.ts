/**
 * Public barrel for the task-agents subsystem. Exports everything the
 * api-gateway needs: the TaskAgent contract, the registry, the executor,
 * and each agent by name for direct composition.
 */

export * from './types.js';
export * from './registry.js';
export * from './executor.js';

// Re-export each agent so callers who want one specific agent can import
// directly (e.g. for targeted tests / wiring).
export { rentReminderAgent } from './agents/rent-reminder.agent.js';
export { lateFeeCalculatorAgent } from './agents/late-fee-calculator.agent.js';
export { leaseRenewalSchedulerAgent } from './agents/lease-renewal-scheduler.agent.js';
export { moveOutNoticeAgent } from './agents/move-out-notice.agent.js';
export { inspectionReminderAgent } from './agents/inspection-reminder.agent.js';
export { vendorInvoiceApproverAgent } from './agents/vendor-invoice-approver.agent.js';
export { tenantSentimentMonitorAgent } from './agents/tenant-sentiment-monitor.agent.js';
export { arrearsLadderTickAgent } from './agents/arrears-ladder-tick.agent.js';
export { insuranceExpiryMonitorAgent } from './agents/insurance-expiry-monitor.agent.js';
export { licenseExpiryMonitorAgent } from './agents/license-expiry-monitor.agent.js';
export { utilityMeterReadingReminderAgent } from './agents/utility-meter-reading-reminder.agent.js';
export { vacancyMarketerAgent } from './agents/vacancy-marketer.agent.js';
export { proactiveMaintenanceAlertAgent } from './agents/proactive-maintenance-alert.agent.js';
export { crossTenantChurnRiskAgent } from './agents/cross-tenant-churn-risk.agent.js';
export { paymentPlanProposerAgent } from './agents/payment-plan-proposer.agent.js';
