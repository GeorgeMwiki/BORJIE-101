/**
 * Intelligence — daily cross-customer snapshot worker.
 *
 * Public surface for the api-gateway composition root so it can register
 * the worker as a background task alongside heartbeat + scheduler.
 */

export {
  IntelligenceHistoryWorker,
  createIntelligenceHistoryWorker,
  type IntelligenceSnapshot,
  type IntelligenceHistoryRepository,
  type CustomerCohortProvider,
  type CustomerSignalsProvider,
  type IntelligenceHistoryWorkerDeps,
  type IntelligenceWorkerRunResult,
} from './intelligence-history-worker.js';
