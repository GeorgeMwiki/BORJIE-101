/**
 * Background intelligence \u2014 barrel.
 */
export * from './types.js';
export {
  InMemoryInsightStore,
  PostgresInsightStore,
  type SqlRunner,
} from './intelligence-store.js';
export {
  buildTaskCatalogue,
  type BackgroundTaskData,
  type PortfolioProperty,
  type ArrearsCase,
  type LeaseNearExpiry,
  type InspectionDue,
  type ComplianceNotice,
  type MonthlyCostSummary,
  type VendorPerformance,
  type TenantHealth5Ps,
} from './tasks.js';
export {
  BackgroundTaskScheduler,
  shouldRun,
  type SchedulerDeps,
} from './background-task-scheduler.js';
export {
  IntelligenceSyncService,
  type IntelligenceSyncPayload,
} from './sync-service.js';
