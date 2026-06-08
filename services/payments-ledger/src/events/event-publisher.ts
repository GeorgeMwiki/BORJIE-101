/**
 * Event Publisher
 * Publishes domain events to the message bus (outbox pattern)
 */
import { v4 as uuidv4 } from 'uuid';
import { TenantId } from '@borjie/domain-models';
import { DomainEvent, PaymentDomainEvent } from './payment-events';
import { logger } from '../logger.js';
import type { NewOutboxRow } from './outbox-row';

/**
 * Outbox entry for transactional event publishing
 */
export interface OutboxEntry {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: string;
  tenantId: TenantId;
  createdAt: Date;
  publishedAt?: Date;
  retryCount: number;
  lastError?: string;
}

/**
 * Event handler type
 */
export type EventHandler<T extends DomainEvent = DomainEvent> = (event: T) => Promise<void>;

/**
 * Event Publisher Interface
 */
export interface IEventPublisher {
  /**
   * Publish an event (adds to outbox for reliable delivery)
   */
  publish(event: PaymentDomainEvent): Promise<void>;

  /**
   * Publish multiple events atomically
   */
  publishBatch(events: PaymentDomainEvent[]): Promise<void>;

  /**
   * Subscribe to events (for in-process handling)
   */
  subscribe<T extends PaymentDomainEvent>(
    eventType: T['eventType'],
    handler: EventHandler<T>
  ): void;

  /**
   * Unsubscribe from events
   */
  unsubscribe(eventType: string, handler: EventHandler): void;

  /**
   * RSS-01 — serialise events into the minimal `NewOutboxRow[]` the
   * ledger's `postJournalAtomic` co-commits INSIDE its own transaction
   * (Borjie's repo-owns-tx shape). This is the "build rows → hand to the
   * atomic post → notify after commit" flow, NOT "enqueue on a tx". Pure
   * + side-effect-free: it does NOT touch the outbox or notify handlers.
   * Optional so the statement / disbursement / reconciliation /
   * payment-orchestration services (which call `publish` directly) need
   * not change.
   */
  serializeForTx?(events: PaymentDomainEvent[]): NewOutboxRow[];

  /**
   * RSS-01 — notify ONLY the in-process subscribers for events whose
   * durable outbox rows were already co-committed via `serializeForTx`
   * inside the ledger tx. Called AFTER the tx commits, so a rolled-back
   * post notifies nobody. Optional; paired with `serializeForTx`.
   */
  notifySubscribers?(events: PaymentDomainEvent[]): Promise<void>;
}

/**
 * Outbox Repository Interface
 */
export interface IOutboxRepository {
  /**
   * Add events to outbox
   */
  addToOutbox(entries: OutboxEntry[]): Promise<void>;

  /**
   * Get unpublished events
   */
  getUnpublished(limit: number): Promise<OutboxEntry[]>;

  /**
   * Mark event as published
   */
  markPublished(id: string): Promise<void>;

  /**
   * Record publish failure
   */
  recordFailure(id: string, error: string): Promise<void>;

  /**
   * Delete old published events
   */
  cleanup(olderThan: Date): Promise<number>;
}

/**
 * In-memory Event Publisher for testing and local development
 */
export class InMemoryEventPublisher implements IEventPublisher {
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private outbox: OutboxEntry[] = [];

  async publish(event: PaymentDomainEvent): Promise<void> {
    // Add to outbox
    const entry: OutboxEntry = {
      id: uuidv4(),
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      payload: JSON.stringify(event),
      tenantId: event.tenantId,
      createdAt: new Date(),
      retryCount: 0
    };
    this.outbox.push(entry);

    // Notify in-process handlers
    await this.notifyHandlers(event);
  }

  async publishBatch(events: PaymentDomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }

  subscribe<T extends PaymentDomainEvent>(
    eventType: T['eventType'],
    handler: EventHandler<T>
  ): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler as EventHandler);
  }

  unsubscribe(eventType: string, handler: EventHandler): void {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * RSS-01 — mirror the durable publisher's co-commit surface in dev/test
   * so the SAME `LedgerService` code path (serialise → hand to atomic post
   * → notify after commit) runs without a database. Pure: produces rows,
   * touches nothing.
   */
  serializeForTx(events: PaymentDomainEvent[]): NewOutboxRow[] {
    return events.map(toNewOutboxRow);
  }

  /** RSS-01 — notify in-process subscribers for already-committed events. */
  async notifySubscribers(events: PaymentDomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.notifyHandlers(event);
    }
  }

  private async notifyHandlers(event: PaymentDomainEvent): Promise<void> {
    const handlers = this.handlers.get(event.eventType);
    if (handlers) {
      for (const handler of handlers) {
        try {
          await handler(event);
        } catch (error) {
          logger.error(`Error in event handler for ${event.eventType}`, { error: error });
        }
      }
    }
  }

  // Test helpers
  getOutbox(): OutboxEntry[] {
    return [...this.outbox];
  }

  clearOutbox(): void {
    this.outbox = [];
  }
}

/**
 * Durable, outbox-backed Event Publisher (RSS-01).
 *
 * The production publisher. Two surfaces:
 *
 *   - `publish` / `publishBatch` (used by the statement / disbursement /
 *     reconciliation / payment-orchestration services): persist the event
 *     to `event_outbox` via `IOutboxRepository` THEN notify in-process
 *     handlers. Durable — survives restarts and a relay delivers
 *     at-least-once — but written on the top-level client (a separate tx
 *     from the producer's business write).
 *
 *   - `serializeForTx` + `notifySubscribers` (used by `LedgerService`):
 *     the CO-COMMIT path. `LedgerService` serialises its events to
 *     `NewOutboxRow[]` and hands them into `postJournalAtomic`, which
 *     inserts them in the SAME `db.transaction` as the ledger entries +
 *     balance CAS. After that tx commits, `LedgerService` calls
 *     `notifySubscribers` so live subscribers fire. A rolled-back post
 *     therefore writes no outbox row AND notifies nobody — the exact
 *     no-loss / no-leak guarantee.
 *
 * A throwing in-process handler is isolated; the durable outbox row is the
 * delivery source of truth, so a bad subscriber never undoes the write.
 */
export class DurableEventPublisher implements IEventPublisher {
  private handlers: Map<string, Set<EventHandler>> = new Map();

  constructor(private readonly outbox: IOutboxRepository) {}

  async publish(event: PaymentDomainEvent): Promise<void> {
    await this.outbox.addToOutbox([toOutboxEntry(event)]);
    await this.notifyHandlers(event);
  }

  async publishBatch(events: PaymentDomainEvent[]): Promise<void> {
    if (events.length === 0) return;
    // Single batched write so the relay sees them together.
    await this.outbox.addToOutbox(events.map(toOutboxEntry));
    for (const event of events) {
      await this.notifyHandlers(event);
    }
  }

  subscribe<T extends PaymentDomainEvent>(
    eventType: T['eventType'],
    handler: EventHandler<T>,
  ): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler as EventHandler);
  }

  unsubscribe(eventType: string, handler: EventHandler): void {
    this.handlers.get(eventType)?.delete(handler);
  }

  /**
   * RSS-01 — serialise events into the co-commit row shape. No outbox
   * write and no handler notification happen here; `LedgerService` hands
   * the result into `postJournalAtomic` (co-commit) then calls
   * `notifySubscribers` after the tx commits.
   */
  serializeForTx(events: PaymentDomainEvent[]): NewOutboxRow[] {
    return events.map(toNewOutboxRow);
  }

  /** RSS-01 — notify in-process subscribers for committed events. */
  async notifySubscribers(events: PaymentDomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.notifyHandlers(event);
    }
  }

  private async notifyHandlers(event: PaymentDomainEvent): Promise<void> {
    const handlers = this.handlers.get(event.eventType);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (error) {
        // Isolate handler failures — the durable outbox row already
        // guarantees the event will be delivered by the relay.
        logger.error(`Error in event handler for ${event.eventType}`, { error });
      }
    }
  }
}

/**
 * Map a domain event onto an `OutboxEntry`. The full event is serialised
 * into `payload` (string) so the relay reconstructs and dispatches it
 * verbatim. `id` is the stable consumer-idempotency `message_id`.
 */
export function toOutboxEntry(event: PaymentDomainEvent): OutboxEntry {
  return {
    id: uuidv4(),
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    eventType: event.eventType,
    payload: JSON.stringify(event),
    tenantId: event.tenantId,
    createdAt: new Date(),
    retryCount: 0,
  };
}

/**
 * Map a domain event onto the co-commit `NewOutboxRow` shape (RSS-01). The
 * `payload` here is the event OBJECT (not stringified) since it lands in a
 * jsonb column directly via the atomic post. `metadata` mirrors the
 * event's own metadata (the money path stamps `journalId` on it upstream).
 */
export function toNewOutboxRow(event: PaymentDomainEvent): NewOutboxRow {
  return {
    id: uuidv4(),
    tenantId: event.tenantId ? String(event.tenantId) : null,
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    payload: event,
    metadata: event.metadata ?? {},
  };
}

/**
 * Create a domain event helper
 */
export function createEvent<T extends PaymentDomainEvent>(
  eventType: T['eventType'],
  aggregateType: T['aggregateType'],
  aggregateId: string,
  tenantId: TenantId,
  payload: T['payload'],
  options?: {
    correlationId?: string;
    causationId?: string;
    metadata?: Record<string, unknown>;
  }
): T {
  return {
    eventId: uuidv4(),
    eventType,
    aggregateType,
    aggregateId,
    tenantId,
    timestamp: new Date(),
    version: 1,
    payload,
    correlationId: options?.correlationId,
    causationId: options?.causationId,
    metadata: options?.metadata
  } as T;
}
