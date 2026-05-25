/**
 * AUTOMATE — compiles the vendor-onboarding redesign into a draft Skill.
 */

import { runAutomateStage } from '../shared/automate-stage.js';
import type {
  AutomationArtifact,
  RedesignProposal,
  SubMdBudget,
} from '../shared/sub-md-base.js';

export function automateVendor(
  proposal: RedesignProposal,
  budget: SubMdBudget,
): AutomationArtifact {
  return runAutomateStage({
    proposal,
    skillNamespace: 'vendor-onboarding',
    cronExpression: '0 9 * * 1-5', // weekdays 09:00
    monitorThresholds: {
      timeToActiveHoursCeiling: 96,
      kycFirstAttemptPassRateFloor: 0.7,
      capabilityCoverageFloor: 0.8,
    },
    hookNames: [
      'vendor.verify_kyc',
      'vendor.classify_capabilities',
      'vendor.draft_msa',
      'vendor.setup_payment_rail',
    ],
    budget,
  });
}
