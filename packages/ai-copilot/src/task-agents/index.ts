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
export { royaltyReminderAgent } from './agents/royalty-reminder.agent.js';
export { lateFeeCalculatorAgent } from './agents/late-fee-calculator.agent.js';
export { offtakeRenewalSchedulerAgent } from './agents/offtake-renewal-scheduler.agent.js';
export { siteClosureNoticeAgent } from './agents/site-closure-notice.agent.js';
export { inspectionReminderAgent } from './agents/inspection-reminder.agent.js';
export { vendorInvoiceApproverAgent } from './agents/vendor-invoice-approver.agent.js';
export { buyerSentimentMonitorAgent } from './agents/buyer-sentiment-monitor.agent.js';
export { royaltyArrearsLadderTickAgent } from './agents/royalty-arrears-ladder-tick.agent.js';
export { insuranceExpiryMonitorAgent } from './agents/insurance-expiry-monitor.agent.js';
export { licenseExpiryMonitorAgent } from './agents/license-expiry-monitor.agent.js';
export { productionMeterReadingReminderAgent } from './agents/production-meter-reading-reminder.agent.js';
export { availableCapacityMarketerAgent } from './agents/available-capacity-marketer.agent.js';
export { proactiveMaintenanceAlertAgent } from './agents/proactive-maintenance-alert.agent.js';
export { crossBuyerChurnRiskAgent } from './agents/cross-buyer-churn-risk.agent.js';
export { paymentPlanProposerAgent } from './agents/payment-plan-proposer.agent.js';
