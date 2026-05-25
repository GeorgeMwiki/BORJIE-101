/**
 * AUTOMATE — compiles a complaint-triage redesign into a draft Skill
 * with monitor thresholds and hook list.
 */

import { runAutomateStage } from '../shared/automate-stage.js';
import type {
  AutomationArtifact,
  RedesignProposal,
  SubMdBudget,
} from '../shared/sub-md-base.js';

export function automateComplaints(
  proposal: RedesignProposal,
  budget: SubMdBudget,
): AutomationArtifact {
  return runAutomateStage({
    proposal,
    skillNamespace: 'complaint-triage',
    cronExpression: '*/10 * * * *',
    monitorThresholds: {
      timeToAcknowledgeMinutes: 30,
      firstAttemptRoutingAccuracy: 0.9,
      escalationFalsePositiveRate: 0.05,
    },
    hookNames: [
      'complaint.classify',
      'complaint.route',
      'complaint.empathize_response',
      'complaint.escalate_when_needed',
    ],
    budget,
  });
}
