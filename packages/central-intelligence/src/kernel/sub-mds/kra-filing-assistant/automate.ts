/**
 * AUTOMATE — compiles the KRA redesign into a draft Skill.
 */

import { runAutomateStage } from '../shared/automate-stage.js';
import type {
  AutomationArtifact,
  RedesignProposal,
  SubMdBudget,
} from '../shared/sub-md-base.js';

export function automateKraFiling(
  proposal: RedesignProposal,
  budget: SubMdBudget,
): AutomationArtifact {
  return runAutomateStage({
    proposal,
    skillNamespace: 'kra-filing-assistant',
    // Compile every business day at 06:00 during MRI window (1-20 of month).
    cronExpression: '0 6 1-20 * *',
    monitorThresholds: {
      onTimeByDay15RateFloor: 0.85,
      rejectionRateCeiling: 0.05,
      ownerReviewTimeSecondsCeiling: 1800,
    },
    hookNames: [
      'kra.compile_mri_batch',
      'kra.validate_pre_filing',
      'kra.draft_filing',
      'kra.fetch_filing_status',
    ],
    budget,
  });
}
