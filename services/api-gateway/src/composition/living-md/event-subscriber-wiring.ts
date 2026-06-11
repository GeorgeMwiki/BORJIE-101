/**
 * event-subscriber-wiring.ts — the INJECTED in-process event bus that flips
 * waiting commitments due the moment a real signal fires (the LIVING-MD organ's
 * immediate-trigger seam).
 *
 * WHY THIS REPLACES THE `global` ANTI-PATTERN (adversarial correction #3)
 * ----------------------------------------------------------------------
 * The naive design reached for `(global as any).__mdEventSubscriberWiring` so a
 * ledger post / settlement webhook could flip a waiting commitment. That breaks
 * the project's dependency-injection rule AND the no-reading-global-state
 * discipline. Instead this module owns a tiny TYPED emitter (`MdEventBus`) that
 * the composition root injects: the ledger/webhook seams call
 * `mdEventBus.emit('ledger.credit', { tenantId })`, the bus invokes
 * `eventSubscriber.onEvent` (the already-built WaitFor flip), and the reconcile
 * sweep resurfaces the now-due commitment on its next tick.
 *
 * MODULAR-MONOLITH IMPORT DISCIPLINE (CLAUDE.md hard rule): the
 * `payments-ledger` package NEVER imports the gateway. Instead the existing
 * `event_outbox` relay carries a `ledger.credit` / `offtake.settled` event, the
 * api-gateway's domain-event bus drains it, and `registerMdEventBridge` (below)
 * subscribes a thin handler that translates the drained domain event into a
 * `mdEventBus.emit`. The bus is the in-process injection point; the outbox is
 * the cross-service carrier — neither is a global.
 *
 * IDEMPOTENCY (felt-plan rail): the bus dedupes on
 * `tenantId:eventKey:occurredAtMs` (the felt-plan key, minus the per-commitment
 * fan-out which `onEvent` itself handles idempotently by re-flipping an
 * already-overdue row to overdue — a no-op). A re-delivered at-least-once event
 * with the same key within the dedupe window is dropped, so a webhook/ledger
 * retry never double-fires the flip.
 *
 * FAIL-SAFE: `emit` NEVER throws back into the event source (a ledger post must
 * never fail because a commitment flip faulted). No `console.*` (Pino shim).
 */

import type { WaitForEventSubscriber } from '../md-commitments/wait-for.js';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';
import { createPinoLikeLogger } from '../../utils/pino-shim.js';

/** The canonical event keys a commitment can wait on (matches wait-for.ts). */
export type MdEventKey =
  | 'ledger.credit'
  | 'offtake.settled'
  | 'slot.stale'
  | string;

export interface MdEventInput {
  readonly tenantId: string;
  /** Event time (ms) — drives the idempotency key. Defaults to now. */
  readonly occurredAtMs?: number;
  /** Optional commitment id the source already knows (forensic only). */
  readonly commitmentId?: string;
}

export interface MdEventBus {
  /**
   * Fire all waiting commitments for (tenant, eventKey). Returns the count
   * flipped (0 when none waiting / deduped / faulted). Never throws.
   */
  emit(eventKey: MdEventKey, input: MdEventInput): Promise<number>;
}

/** A thin subscribable-bus surface (the gateway's domain-event bus). */
export interface SubscribableBusLike {
  subscribe(
    pattern: string,
    handler: (event: DomainEventLike) => Promise<void> | void,
    opts?: { id?: string },
  ): string | void;
}

export interface DomainEventLike {
  type?: string;
  eventType?: string;
  payload?: Record<string, unknown>;
  metadata?: { tenantId?: string; [k: string]: unknown };
}

/** Idempotency dedupe window — a retry within this never double-fires. */
const DEDUPE_TTL_MS = 5 * 60 * 1000;
/** Cap on remembered idempotency keys (bounded memory). */
const MAX_DEDUPE_KEYS = 5000;

/**
 * Build the injected MD event bus over the WaitFor event subscriber. `clock`
 * injectable for tests.
 */
export function createMdEventBus(deps: {
  readonly eventSubscriber: WaitForEventSubscriber;
  readonly logger?: PinoLikeLogger;
  readonly clock?: () => Date;
}): MdEventBus {
  const logger = deps.logger ?? createPinoLikeLogger('md-event-bus');
  const clock = deps.clock ?? (() => new Date());
  // Idempotency: key → first-seen ms. Pruned by TTL + a hard size cap.
  const seen = new Map<string, number>();

  function prune(nowMs: number): void {
    if (seen.size < MAX_DEDUPE_KEYS) {
      // Cheap TTL sweep only when we have keys to consider stale.
      for (const [key, ts] of seen) {
        if (nowMs - ts > DEDUPE_TTL_MS) seen.delete(key);
      }
      return;
    }
    // Over the cap — clear the oldest half to stay bounded.
    let removed = 0;
    const target = Math.ceil(MAX_DEDUPE_KEYS / 2);
    for (const key of seen.keys()) {
      seen.delete(key);
      removed += 1;
      if (removed >= target) break;
    }
  }

  return {
    async emit(eventKey: MdEventKey, input: MdEventInput): Promise<number> {
      const nowMs = clock().getTime();
      const occurredAtMs = input.occurredAtMs ?? nowMs;
      // felt-plan idempotency key: tenantId:eventKey:occurredAtMs (commitment
      // fan-out is handled idempotently inside onEvent's re-flip).
      const key = `${input.tenantId}:${eventKey}:${occurredAtMs}`;
      const prior = seen.get(key);
      if (prior !== undefined && nowMs - prior <= DEDUPE_TTL_MS) {
        // A retry within the window — already fired; drop (no double-flip).
        return 0;
      }
      seen.set(key, nowMs);
      prune(nowMs);
      try {
        const flipped = await deps.eventSubscriber.onEvent({
          tenantId: input.tenantId,
          eventKey,
          nowMs: occurredAtMs,
        });
        if (flipped > 0) {
          logger.info(
            { wiring: 'md-event-bus', tenantId: input.tenantId, eventKey, flipped },
            'md-event-bus: signal flipped waiting commitments → due',
          );
        }
        return flipped;
      } catch (err) {
        // Fail-safe: never break the event source (ledger post / webhook).
        logger.warn(
          {
            wiring: 'md-event-bus',
            tenantId: input.tenantId,
            eventKey,
            err: err instanceof Error ? err.message : String(err),
          },
          'md-event-bus: emit failed (swallowed — event source unaffected)',
        );
        return 0;
      }
    },
  };
}

/**
 * Map a drained domain-event `eventType` onto the canonical MD event key. The
 * outbox carries the cross-service producer's own event name; this is the ONE
 * place the gateway translates it (so the producer never knows the MD vocab).
 * Generative-friendly: any unknown ledger-credit / settlement alias falls
 * through to the literal key when it already matches; otherwise null (ignored).
 */
export function mdEventKeyForDomainType(eventType: string): MdEventKey | null {
  const t = eventType.trim();
  switch (t) {
    case 'ledger.credit':
    case 'LedgerCredit':
    case 'LedgerCredited':
    case 'PaymentReceived':
    case 'PaymentSucceeded':
    case 'PAYMENT_SUCCEEDED':
      return 'ledger.credit';
    case 'offtake.settled':
    case 'OfftakeSettled':
    case 'SettlementCompleted':
    case 'DISBURSEMENT_COMPLETED':
      return 'offtake.settled';
    case 'slot.stale':
    case 'SlotStale':
      return 'slot.stale';
    default:
      return null;
  }
}

/**
 * Subscribe the MD event bridge onto the gateway's domain-event bus. Called
 * ONCE at composition time next to `registerDomainEventSubscribers`. For each
 * carried producer event type it registers a thin, fail-safe handler that
 * resolves the tenant from the envelope and calls `mdEventBus.emit`. The
 * `payments-ledger` package is never imported — the outbox relay is the carrier.
 */
export function registerMdEventBridge(deps: {
  readonly bus: SubscribableBusLike;
  readonly mdEventBus: MdEventBus;
  readonly logger?: PinoLikeLogger;
}): void {
  const logger = deps.logger ?? createPinoLikeLogger('md-event-bridge');

  // The producer event types the outbox relay carries that should flip an MD
  // waiting commitment. Each maps (via mdEventKeyForDomainType) to an MD key.
  const CARRIED_TYPES: ReadonlyArray<string> = [
    'ledger.credit',
    'LedgerCredit',
    'LedgerCredited',
    'PaymentReceived',
    'PAYMENT_SUCCEEDED',
    'offtake.settled',
    'OfftakeSettled',
    'SettlementCompleted',
    'DISBURSEMENT_COMPLETED',
    'slot.stale',
    'SlotStale',
  ];

  for (const producerType of CARRIED_TYPES) {
    deps.bus.subscribe(
      producerType,
      async (event: DomainEventLike) => {
        const tenantId =
          event.metadata?.tenantId ??
          (event.payload?.['tenantId'] as string | undefined);
        if (!tenantId) {
          // No tenant to scope the flip onto — honest skip (never a global flip).
          return;
        }
        const eventKey = mdEventKeyForDomainType(
          event.eventType ?? event.type ?? producerType,
        );
        if (!eventKey) return;
        const occurredAtMs =
          typeof event.payload?.['occurredAtMs'] === 'number'
            ? (event.payload['occurredAtMs'] as number)
            : undefined;
        await deps.mdEventBus.emit(eventKey, {
          tenantId,
          ...(occurredAtMs !== undefined ? { occurredAtMs } : {}),
        });
      },
      { id: `md-event-bridge.${producerType}` },
    );
  }

  logger.info(
    { wiring: 'md-event-bridge', carriedTypes: CARRIED_TYPES.length },
    'md-event-bridge: subscribed ledger.credit / offtake.settled / slot.stale carriers → mdEventBus.emit',
  );
}
