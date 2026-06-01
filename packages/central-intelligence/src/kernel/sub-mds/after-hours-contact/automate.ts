/**
 * AUTOMATE — compiles the after-hours redesign into a draft Skill. All
 * artefacts run in draft state; the four-eye approval flow decides
 * whether to promote.
 */

import { runAutomateStage } from '../shared/automate-stage.js';
import type {
  AutomationArtifact,
  RedesignProposal,
  SubMdBudget,
} from '../shared/sub-md-base.js';

export function automateAfterHours(
  proposal: RedesignProposal,
  budget: SubMdBudget,
): AutomationArtifact {
  return runAutomateStage({
    proposal,
    skillNamespace: 'after-hours-contact',
    cronExpression: '*/5 18-23,0-7 * * *',
    monitorThresholds: {
      draftAcceptanceFloor: 0.6,
      replyLatencySecondsCeiling: 600,
      classificationAccuracyFloor: 0.85,
    },
    hookNames: [
      'after_hours.classify_inquiry',
      'after_hours.fetch_lot_match',
      'after_hours.draft_response',
      'after_hours.schedule_inspection_draft',
    ],
    budget,
  });
}
