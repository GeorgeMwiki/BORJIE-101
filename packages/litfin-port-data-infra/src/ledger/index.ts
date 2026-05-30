/**
 * @borjie/litfin-port-data-infra/ledger — append-only mining-ops event store.
 *
 * Entry-point exports. Consumers should import from here, never from
 * the sub-modules directly, so the public surface stays observable.
 *
 * NOTE: This is the OPERATIONAL ledger (shift / production / royalty /
 * payout intent + chain-of-custody). Borjie's money path of record
 * remains `services/payments-ledger/LedgerService.post()` (the
 * immutable double-entry invariant). The two cooperate via projector
 * read-models, not by overriding each other.
 */

export type {
  EventEnvelope,
  EventHandler,
  EventStore,
  SubscriptionFilter,
  Unsubscribe,
  AppendOptions,
} from "./types";
export { OptimisticConcurrencyError, TenantBoundaryViolation } from "./types";

export type {
  MiningEvent,
  MiningEventType,
  ShiftStarted,
  ShiftPaused,
  ShiftResumed,
  ShiftEnded,
  ProductionRecorded,
  ProductionReversed,
  SampleAssayed,
  ConsignmentSealed,
  ConsignmentDispatched,
  ConsignmentReceived,
  RoyaltyAssessed,
  RoyaltyPaid,
  PayoutScheduled,
  PayoutDisbursed,
  PayoutReversed,
  IncidentLogged,
  IncidentResolved,
  OperationClosed,
} from "./events";
export { MINING_EVENT_TYPES } from "./events";

export { createInMemoryEventStore } from "./in-memory-store";

export type { DBClient, PostgresEventStoreOptions } from "./postgres-store";
export { createPostgresEventStore, isEventType } from "./postgres-store";

export type { Reducer, ReducerMap } from "./projector";
export { project } from "./projector";
