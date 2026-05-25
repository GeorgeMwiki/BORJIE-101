/**
 * AUTOMATE — compiles the leasing redesign into a draft Skill. All
 * artefacts run in draft state; the four-eye approval flow decides
 * whether to promote.
 */

import { runAutomateStage } from '../shared/automate-stage.js';
import type {
  AutomationArtifact,
  RedesignProposal,
  SubMdBudget,
} from '../shared/sub-md-base.js';

export function automateLeasing(
  proposal: RedesignProposal,
  budget: SubMdBudget,
): AutomationArtifact {
  return runAutomateStage({
    proposal,
    skillNamespace: 'leasing-after-hours-contact',
    cronExpression: '*/5 18-23,0-7 * * *',
    monitorThresholds: {
      draftAcceptanceFloor: 0.6,
      replyLatencySecondsCeiling: 600,
      classificationAccuracyFloor: 0.85,
    },
    hookNames: [
      'leasing.classify_inquiry',
      'leasing.fetch_unit_match',
      'leasing.draft_response',
      'leasing.schedule_viewing_draft',
    ],
    budget,
  });
}
