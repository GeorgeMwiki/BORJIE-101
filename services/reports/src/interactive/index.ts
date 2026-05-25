/**
 * Interactive Reports (NEW 17) — public barrel
 */

export * from './types.js';
export { ActionPlanHandler } from './action-plan-handler.js';
export {
  InteractiveReportService,
  InteractiveReportServiceError,
  InteractiveReportServiceException,
  type InteractiveReportServiceDeps,
  type InteractiveReportServiceErrorCode,
} from './interactive-report-service.js';
export { InteractiveHtmlGenerator } from '../generators/interactive-html-generator.js';
