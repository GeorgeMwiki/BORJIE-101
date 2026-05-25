/**
 * EventStore port. Append-only, per-stream-versioned, with replay.
 *
 * `streamId` is the aggregate root id — typically `lease:<leaseId>`
 * for the rent-and-arrears paths in scope. Version is monotonic per
 * stream; concurrent appends with the same `expectedVersion` fail
 * with `OptimisticConcurrencyError`.
 *
 * `subscribe` is fire-and-forget — the in-memory adapter delivers
 * synchronously, Drizzle delivers via LISTEN/NOTIFY (out of scope
 * this pass; the table + trigger are ready in the migration).
 */

import type { PaymentEvent, PaymentEventType } from "./events.js";

export interface EventEnvelope {
  readonly streamId: string;
  readonly version: number;
  readonly globalSeq: number;
  readonly event: PaymentEvent;
  readonly recordedAt: string;
}

export interface SubscriptionFilter {
  readonly streamId?: string;
  readonly eventTypes?: readonly PaymentEventType[];
}

export type EventHandler = (envelope: EventEnvelope) => void | Promise<void>;

export interface Unsubscribe {
  (): void;
}

export interface EventStore {
  append(
    streamId: string,
    event: PaymentEvent,
    expectedVersion: number
  ): Promise<EventEnvelope>;
  read(
    streamId: string,
    fromVersion?: number
  ): Promise<readonly EventEnvelope[]>;
  subscribe(filter: SubscriptionFilter, handler: EventHandler): Unsubscribe;
}

export class OptimisticConcurrencyError extends Error {
  public readonly code = "OPTIMISTIC_CONCURRENCY" as const;
  public readonly streamId: string;
  public readonly expectedVersion: number;
  public readonly actualVersion: number;

  constructor(
    streamId: string,
    expectedVersion: number,
    actualVersion: number
  ) {
    super(
      `Stream ${streamId}: expected v${expectedVersion}, actual v${actualVersion}`
    );
    this.name = "OptimisticConcurrencyError";
    this.streamId = streamId;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}
