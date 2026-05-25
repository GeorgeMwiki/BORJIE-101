/**
 * AUTOMATE — compiles a maintenance redesign into a draft Skill plus
 * monitor thresholds and hook list.
 */

import { runAutomateStage } from '../shared/automate-stage.js';
import type {
  AutomationArtifact,
  RedesignProposal,
  SubMdBudget,
} from '../shared/sub-md-base.js';

export function automateMaintenance(
  proposal: RedesignProposal,
  budget: SubMdBudget,
): AutomationArtifact {
  return runAutomateStage({
    proposal,
    skillNamespace: 'maintenance-dispatch',
    cronExpression: '*/15 * * * *',
    monitorThresholds: {
      emergencyResponseSeconds: 600,
      slaComplianceFloor: 0.9,
      costPerTicketCeilingUsd: 120,
    },
    hookNames: [
      'maintenance.classify_ticket',
      'maintenance.pick_vendor',
      'maintenance.dispatch_work_order',
      'maintenance.follow_up',
    ],
    budget,
  });
}
