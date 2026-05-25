/**
 * `@borjie/payments-event-store` — public surface.
 *
 * LITFIN-parity item 4. Append-only event store scoped to the
 * rent + arrears critical paths (full payments-ledger event-sourcing
 * is a future iteration).
 *
 * Two adapters: in-memory for tests/dev, Drizzle for prod. Projector
 * helper builds read models from streams. The schema lives in
 * `packages/database/src/migrations/0273_payment_event_store.sql`.
 */

export type {
  BaseEvent,
  PaymentEvent,
  PaymentEventType,
  RentDueRecorded,
  PaymentInitiated,
  PaymentConfirmed,
  PaymentFailed,
  ArrearsAccrued,
  ArrearsForgiven,
  RentReconciled,
} from "./events.js";
export {
  OptimisticConcurrencyError,
  type EventEnvelope,
  type EventHandler,
  type EventStore,
  type SubscriptionFilter,
  type Unsubscribe,
} from "./types.js";
export { createInMemoryEventStore } from "./in-memory-store.js";
export {
  createDrizzleEventStore,
  type DBClient,
  type DrizzleEventStoreOptions,
} from "./drizzle-store.js";
export {
  project,
  type Reducer,
  type ReducerMap,
} from "./projector.js";
