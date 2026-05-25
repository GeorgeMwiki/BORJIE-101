/**
 * Per-kind action + approval copy.
 *
 * Each detector kind maps to a `suggestedAction` (imperative — what
 * the MD would do) and an `approvalAsk` (the chat-side one-line
 * question). Keeping copy in one file lets PMs adjust phrasing
 * without touching detection logic.
 */
import type { AnomalyKind, OpportunityKind } from '../contracts/events.js';

export interface ActionCopy {
  readonly suggestedAction: string;
  readonly approvalAsk: string;
  readonly approveLabel: string;
  readonly declineLabel: string;
  readonly estimatedDuration?: string;
}

const ANOMALY_COPY: Readonly<Record<AnomalyKind, ActionCopy>> = {
  'cashflow-dip': {
    suggestedAction:
      'Send STK push payment reminders to top 5 arrears tenants',
    approvalAsk: 'Want me to send the reminders now?',
    approveLabel: 'Send reminders',
    declineLabel: 'Not now',
    estimatedDuration: '3 minutes',
  },
  'arrears-spike': {
    suggestedAction:
      'Draft arrears-recovery messages to tenants in this week\'s spike',
    approvalAsk: 'Want me to draft the messages for your review?',
    approveLabel: 'Draft messages',
    declineLabel: 'Skip',
    estimatedDuration: '5 minutes',
  },
  'churn-risk': {
    suggestedAction:
      'Open a check-in conversation with this customer-owner',
    approvalAsk: 'Want me to schedule a check-in call request?',
    approveLabel: 'Schedule check-in',
    declineLabel: 'Not now',
  },
  'cost-anomaly': {
    suggestedAction: 'Show me the top AI cost drivers this week',
    approvalAsk: 'Want a breakdown of what\'s driving the surge?',
    approveLabel: 'Show breakdown',
    declineLabel: 'Dismiss',
  },
  'slo-breach': {
    suggestedAction:
      'Quarantine the drifting forecaster and route work to fallback',
    approvalAsk: 'Want me to quarantine the forecaster?',
    approveLabel: 'Quarantine',
    declineLabel: 'Keep watching',
  },
  'compliance-deadline-near': {
    suggestedAction:
      'Begin the filing/renewal workflow for the upcoming deadline',
    approvalAsk: 'Want me to start the workflow now?',
    approveLabel: 'Start workflow',
    declineLabel: 'Not yet',
    estimatedDuration: '10 minutes',
  },
  'vendor-reliability-drop': {
    suggestedAction:
      'Send a service-quality message to the vendor and queue a backup quote',
    approvalAsk: 'Want me to message the vendor and gather backup quotes?',
    approveLabel: 'Do both',
    declineLabel: 'Just gather quotes',
  },
};

const OPPORTUNITY_COPY: Readonly<Record<OpportunityKind, ActionCopy>> = {
  'vendor-rate-arbitrage': {
    suggestedAction:
      'Draft a switch-vendor plan and queue the contract for review',
    approvalAsk: 'Want me to draft the switch and put it in your inbox?',
    approveLabel: 'Draft switch',
    declineLabel: 'Not now',
    estimatedDuration: '15 minutes',
  },
  'policy-tightening': {
    suggestedAction:
      'Propose a tighter autonomy cap policy for HQ-admin sign-off',
    approvalAsk: 'Want me to draft the tightened cap for you to review?',
    approveLabel: 'Draft tightening',
    declineLabel: 'Leave as is',
  },
  'rent-vs-market': {
    suggestedAction: 'Draft a rent-adjustment plan for next renewal',
    approvalAsk: 'Want me to draft the adjustment for renewal?',
    approveLabel: 'Draft adjustment',
    declineLabel: 'Not now',
  },
};

export function copyForAnomaly(kind: AnomalyKind): ActionCopy {
  return ANOMALY_COPY[kind];
}

export function copyForOpportunity(kind: OpportunityKind): ActionCopy {
  return OPPORTUNITY_COPY[kind];
}
