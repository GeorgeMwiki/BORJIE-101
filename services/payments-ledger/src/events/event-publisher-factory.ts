/**
 * Selects the event publisher (RSS-01) with the same fail-loud-in-prod
 * discipline as the repository + webhook-dedupe-store factories:
 *
 *   1. DB client present → durable, outbox-backed publisher. The money
 *      path co-commits its `event_outbox` rows inside the ledger tx (see
 *      `LedgerService` + `postJournalAtomic` step 6); the other services'
 *      `publish` calls persist durably on the top-level client. Events
 *      survive restarts and a relay delivers them at-least-once.
 *   2. else in production → THROW. The in-memory publisher drops events on
 *      restart and never leaves the process — that is the exact P0 we are
 *      fixing, so we refuse to start.
 *   3. else (dev/test) → in-memory publisher (same `serializeForTx` /
 *      `notifySubscribers` shape, so the LedgerService code path is
 *      identical to production).
 */
import type { DatabaseClient } from '@borjie/database';
import {
  DurableEventPublisher,
  InMemoryEventPublisher,
  type IEventPublisher,
} from './event-publisher';
import { DrizzleOutboxRepository } from '../repositories/drizzle-outbox.repository';

export interface EventPublisherFactoryDeps {
  /** Drizzle client or null when DATABASE_URL is unset / init failed. */
  db: DatabaseClient | null;
  isProduction: boolean;
  logger: {
    warn: (obj: object, msg: string) => void;
    info?: (obj: object, msg: string) => void;
  };
}

export function createEventPublisher(
  deps: EventPublisherFactoryDeps,
): IEventPublisher {
  if (deps.db) {
    deps.logger.info?.(
      { publisher: 'durable-outbox' },
      'event publisher: durable, outbox-backed (event_outbox)',
    );
    return new DurableEventPublisher(new DrizzleOutboxRepository(deps.db));
  }

  if (deps.isProduction) {
    deps.logger.warn(
      { publisher: 'none', reason: 'no_database_url' },
      'event publisher: refusing to start with the in-memory publisher in production',
    );
    throw new Error(
      'Cannot start payments-ledger: no durable event publisher (DATABASE_URL required). ' +
        'The in-memory publisher loses events on restart and never reaches the relay.',
    );
  }

  deps.logger.warn(
    { publisher: 'in-memory', reason: 'dev_or_test_fallback' },
    'event publisher: using in-memory publisher (events NOT durable — dev/test only)',
  );
  return new InMemoryEventPublisher();
}
