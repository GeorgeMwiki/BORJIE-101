/**
 * VP department-heads — public barrel.
 *
 * Five VPs, all reporting to the Owner. Each VP orchestrates a small
 * set of line-worker sub-MDs and drafts a weekly report rendered as
 * KPI cards in the owner-portal via genui.
 *
 * VPs DO NOT have their own tool-belt; the only way for a VP to take
 * an action is to spawn a line-worker. When a VP repeatedly needs a
 * line-worker that does not exist, it records a `VpCapabilityGap`,
 * which feeds the MD's self-extension keystone
 * (`proposeNewSubMd`).
 */

export {
  createVpOperations,
  VP_OPERATIONS_PERSONA,
  VP_OPERATIONS_LINE_WORKERS,
  VP_OPERATIONS_REPORT_CARDS,
  draftOpsWeeklyReport,
  routeOpsIntent,
  type VpOperationsReportCardKey,
} from './vp-operations/index.js';

export {
  createVpFinance,
  VP_FINANCE_PERSONA,
  VP_FINANCE_LINE_WORKERS,
  VP_FINANCE_REPORT_CARDS,
  draftFinanceWeeklyReport,
  routeFinanceIntent,
  type VpFinanceReportCardKey,
} from './vp-finance/index.js';

export {
  createVpGrowth,
  VP_GROWTH_PERSONA,
  VP_GROWTH_LINE_WORKERS,
  VP_GROWTH_REPORT_CARDS,
  draftGrowthWeeklyReport,
  routeGrowthIntent,
  type VpGrowthReportCardKey,
} from './vp-growth/index.js';

export {
  createVpPeople,
  VP_PEOPLE_PERSONA,
  VP_PEOPLE_LINE_WORKERS,
  VP_PEOPLE_REPORT_CARDS,
  draftPeopleWeeklyReport,
  routePeopleIntent,
  type VpPeopleReportCardKey,
} from './vp-people/index.js';

export {
  createVpRiskCompliance,
  VP_RISK_COMPLIANCE_PERSONA,
  VP_RISK_COMPLIANCE_LINE_WORKERS,
  VP_RISK_COMPLIANCE_REPORT_CARDS,
  draftRiskComplianceWeeklyReport,
  routeRiskComplianceIntent,
  type VpRiskComplianceReportCardKey,
} from './vp-risk-compliance/index.js';

export {
  buildLineWorkerSpawn,
  rollupSeverity,
  type OwnerIntent,
  type OwnerIntentKind,
  type VpCapabilityGap,
  type VpDepartmentHead,
  type VpDeps,
  type VpLineWorkerCatalogue,
  type VpLineWorkerRollup,
  type VpOrchestrationPlan,
  type VpReportCard,
  type VpWeeklyReport,
} from './shared/vp-base.js';
