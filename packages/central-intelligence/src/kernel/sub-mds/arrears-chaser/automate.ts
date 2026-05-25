/**
 * AUTOMATE — compiles the arrears redesign into a draft Skill.
 */

import { runAutomateStage } from '../shared/automate-stage.js';
import type {
  AutomationArtifact,
  RedesignProposal,
  SubMdBudget,
} from '../shared/sub-md-base.js';

export function automateArrears(
  proposal: RedesignProposal,
  budget: SubMdBudget,
): AutomationArtifact {
  return runAutomateStage({
    proposal,
    skillNamespace: 'arrears-chaser',
    cronExpression: '0 9 * * *',
    monitorThresholds: {
      day7CureRateFloor: 0.45,
      day30CureRateFloor: 0.75,
      churnAttributionCeiling: 0.05,
    },
    hookNames: [
      'arrears.classify_severity',
      'arrears.send_reminder',
      'arrears.escalate_to_call',
      'arrears.draft_notice',
    ],
    budget,
  });
}
