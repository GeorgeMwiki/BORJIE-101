/**
 * Brain Event Bus — in-memory implementation.
 *
 * Default bus used in dev/test and as the production fan-out before a
 * durable broker (Redis Streams / Kafka / SQS) is wired. The
 * composition root swaps this for a durable implementation when
 * `BRAIN_EVENT_BUS_BACKEND=redis-streams` (or similar) is set; until
 * then, the in-memory bus is intentionally the only shipped backend so
 * the surface stays small and the contract stays auditable.
 *
 * Semantics:
 *   - Handlers are invoked **asynchronously** after `publish` resolves.
 *     This matches the observability bus and the WhatsApp router's
 *     fire-and-forget pattern (the router responds 200 OK to Meta
 *     immediately and processes messages on a microtask).
 *   - Handlers are isolated: one handler throwing does NOT prevent
 *     other handlers from running, and does NOT propagate back to the
 *     publisher. Errors go to the optional `onHandlerError` callback.
 *   - Tenant-id strictness is enforced: an event with an empty
 *     `tenantId` is REJECTED with a thrown `Error` (publisher-side
 *     contract violation — tenant isolation is non-negotiable).
 *   - ACL is NOT enforced at publish time. ACL is a **read-time**
 *     contract: the bus delivers every event to every subscribed
 *     handler regardless of the ACL envelope, and the consumer is
 *     responsible for honouring ACL when it surfaces the event to a
 *     human or LLM. (Glean/Onyx pattern: the retriever is the gate,
 *     not the broker.)
 */

import { randomUUID } from 'node:crypto';
import type {
  BrainEvent,
  BrainEventBus,
  BrainEventHandler,
  BrainEventSubscription,
} from './types.js';

/** Optional logger contract — matches the consolidation-worker logger. */
export interface InMemoryBrainBusLogger {
  warn(obj: Record<string, unknown>, msg?: string): void;
  error?(obj: Record<string, unknown>, msg?: string): void;
}

/** Options for the in-memory bus. */
export interface InMemoryBrainEventBusOptions {
  /**
   * Optional logger. When omitted, errors are silently swallowed (the
   * publisher already wraps `publish` in a try/catch in production —
   * this matches the existing WhatsApp router pattern).
   */
  readonly logger?: InMemoryBrainBusLogger;
  /**
   * Optional callback fired when a subscribed handler throws. Useful
   * for routing handler failures to a dead-letter queue or to a
   * Prometheus counter without coupling the bus to either.
   */
  readonly onHandlerError?: (error: Error, event: BrainEvent, subscriptionId: string) => void;
}

interface InternalRegistration {
  readonly id: string;
  readonly type: string;
  readonly handler: BrainEventHandler;
}

export class InMemoryBrainEventBus implements BrainEventBus {
  private readonly subs = new Map<string, InternalRegistration[]>();
  private readonly logger?: InMemoryBrainBusLogger;
  private readonly onHandlerError?: (
    error: Error,
    event: BrainEvent,
    subscriptionId: string,
  ) => void;

  constructor(options: InMemoryBrainEventBusOptions = {}) {
    if (options.logger) {
      this.logger = options.logger;
    }
    if (options.onHandlerError) {
      this.onHandlerError = options.onHandlerError;
    }
  }

  async publish(event: BrainEvent): Promise<void> {
    if (typeof event.tenantId !== 'string' || event.tenantId.length === 0) {
      // Tenant isolation contract violation. Throwing here is correct
      // — the publisher is buggy and silent-dropping would mask it.
      throw new Error(
        `brain-event-bus: refusing to publish event with empty tenantId (type=${event.type})`,
      );
    }

    const registrations = this.subs.get(event.type);
    if (!registrations || registrations.length === 0) {
      // No subscribers — return immediately. This is NOT an error.
      // The brain bus is a fan-out primitive; a tenant may have
      // connectors emitting events that no consumer is wired for yet.
      return;
    }

    // Fan-out on a microtask. We DON'T await handlers — `publish`
    // returns as soon as the event is dispatched, so the connector's
    // happy path stays decoupled from consumer latency.
    //
    // Errors are caught per-handler and routed via `onHandlerError`.
    // Promise.allSettled would force an await; we explicitly want
    // fire-and-forget so the WhatsApp webhook can return 200 OK before
    // any consumer (DB write, brain index, etc.) completes.
    for (const registration of registrations) {
      void this.runHandler(registration, event);
    }
  }

  subscribe(type: string, handler: BrainEventHandler): BrainEventSubscription {
    if (typeof type !== 'string' || type.length === 0) {
      throw new Error('brain-event-bus: subscribe requires a non-empty event type');
    }

    const registration: InternalRegistration = {
      id: randomUUID(),
      type,
      handler,
    };

    const existing = this.subs.get(type) ?? [];
    existing.push(registration);
    this.subs.set(type, existing);

    return {
      id: registration.id,
      type,
      unsubscribe: () => {
        const current = this.subs.get(type);
        if (!current) return;
        const next = current.filter((r) => r.id !== registration.id);
        if (next.length === 0) {
          this.subs.delete(type);
        } else {
          this.subs.set(type, next);
        }
      },
    };
  }

  /**
   * Internal: invoke a single registration with isolation.
   *
   * Pulled out of `publish` so the await-or-not decision lives in one
   * place. Errors are routed through `onHandlerError` (when provided)
   * and the logger (when provided); we deliberately do NOT throw —
   * publishers expect `publish` to be non-throwing for handler
   * failures.
   */
  private async runHandler(
    registration: InternalRegistration,
    event: BrainEvent,
  ): Promise<void> {
    try {
      await registration.handler(event);
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error(String(caught));
      try {
        this.onHandlerError?.(error, event, registration.id);
      } catch {
        // The error-handler itself threw. Swallow — we'd loop otherwise.
      }
      this.logger?.warn?.(
        {
          subscriptionId: registration.id,
          eventType: event.type,
          tenantId: event.tenantId,
          err: error.message,
        },
        'brain-event-bus: handler failed',
      );
    }
  }
}

/**
 * Convenience factory. Mirrors the observability bus's `getEventBus`
 * pattern but does NOT cache a singleton — the brain bus's wiring is
 * always explicit at the composition root.
 */
export function createInMemoryBrainEventBus(
  options: InMemoryBrainEventBusOptions = {},
): InMemoryBrainEventBus {
  return new InMemoryBrainEventBus(options);
}
