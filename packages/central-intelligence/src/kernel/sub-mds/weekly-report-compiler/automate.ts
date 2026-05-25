/**
 * AUTOMATE — compiles a report redesign into a draft Skill.
 */

import { runAutomateStage } from '../shared/automate-stage.js';
import type {
  AutomationArtifact,
  RedesignProposal,
  SubMdBudget,
} from '../shared/sub-md-base.js';

export function automateReport(
  proposal: RedesignProposal,
  budget: SubMdBudget,
): AutomationArtifact {
  return runAutomateStage({
    proposal,
    skillNamespace: 'weekly-report-compiler',
    cronExpression: '0 7 * * 1', // Mondays 07:00
    monitorThresholds: {
      readThroughFloor: 0.55,
      citationCoverageFloor: 0.95,
      anomalyDetectionRecallFloor: 0.8,
    },
    hookNames: [
      'report.gather_kpis',
      'report.detect_anomalies',
      'report.draft_briefing',
      'report.cite_evidence',
    ],
    budget,
  });
}
