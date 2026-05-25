/**
 * AUTOMATE — compiles the lease redesign into a draft Skill.
 */

import { runAutomateStage } from '../shared/automate-stage.js';
import type {
  AutomationArtifact,
  RedesignProposal,
  SubMdBudget,
} from '../shared/sub-md-base.js';

export function automateLease(
  proposal: RedesignProposal,
  budget: SubMdBudget,
): AutomationArtifact {
  return runAutomateStage({
    proposal,
    skillNamespace: 'lease-coordinator',
    cronExpression: '0 8 * * *',
    monitorThresholds: {
      onTimeRenewalRateFloor: 0.6,
      retentionForecastMaeCeiling: 0.15,
      vacancyGapDaysCeiling: 30,
    },
    hookNames: [
      'lease.detect_renewal_window',
      'lease.draft_renewal',
      'lease.classify_termination_request',
      'lease.draft_termination_response',
    ],
    budget,
  });
}
