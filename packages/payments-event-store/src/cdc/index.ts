/**
 * `@borjie/payments-event-store/cdc` — CDC projection router surface (LP-20b).
 *
 * Transport-agnostic change-data-capture fan-out. Inject a subscription
 * transport (Supabase realtime / pg LISTEN-NOTIFY) and register typed
 * consumers; the router dispatches matching events with per-consumer
 * error isolation. Pure + testable without Postgres.
 */

export {
  createProjectionRouter,
  startProjectionStream,
  type ProjectionRouter,
  type ProjectionStreamDeps,
  type CdcLogger,
} from './projection-router.js';

export {
  eventMatches,
  parseCdcPayload,
  DEFAULT_WATCHED_TABLES,
  type CdcEvent,
  type CdcConsumer,
  type CdcOperation,
  type CdcWatchedTable,
  type CdcListenerHandle,
  type CdcStats,
} from './types.js';
