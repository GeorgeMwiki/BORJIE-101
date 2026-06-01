/**
 * Composition wiring for the owner CALENDAR integration (Wave CALENDAR-SYNC).
 *
 * Assembles, from env + a Drizzle handle:
 *   - the `calendar` delivery channel (token cipher + OAuth config + Google/MS
 *     event providers + connection store + delivery service)
 *   - the owner-calendar OAuth router (/api/v1/owner/calendar/*)
 *   - the calendar-sync worker (claims channel='calendar' reminders → events)
 *
 * The orchestrator calls `createCalendarWiring(...)` and then:
 *
 *   api.route('/owner/calendar', wiring.router);   // mount the OAuth flow
 *   wiring.worker.start();                          // arm the sync poller
 *   // on shutdown: wiring.worker.stop();
 *
 * NO edit to services/api-gateway/src/index.ts is required from this module —
 * index.ts only adds the two lines above.
 *
 * Degraded mode: when no token-encryption key is configured
 * (CALENDAR_TOKEN_KEY / ENCRYPTION_MASTER_KEY) the channel is `null` (tokens
 * must never be plaintext), the router answers 503 on the connect/callback
 * paths, and the worker is a no-op. When the key is present but OAuth client
 * credentials are absent, the channel still constructs (status works) and the
 * connect route 503s per provider until the credentials land.
 */

import type { Hono } from 'hono';
import type { Logger } from 'pino';

import {
  createCalendarChannelFromEnv,
  type CalendarChannel,
} from '../services/notification-dispatch/calendar-providers';
import { createCalendarRouter } from '../routes/owner/calendar.hono';
import {
  createCalendarSyncWorker,
  type CalendarSyncHandle,
} from '../workers/calendar-sync.worker';

export interface CalendarWiringInput {
  /**
   * Drizzle handle (postgres-js). May be null in degraded mode (DATABASE_URL
   * unset) — the router then answers 503 and the worker is a no-op.
   */
  readonly db: unknown | null;
  readonly logger: Logger;
  readonly env?: NodeJS.ProcessEnv;
  /** Worker poll cadence (ms). Defaults to 60s inside the worker. */
  readonly intervalMs?: number;
  /** Disable the poller (tests / staged rollout). */
  readonly workerEnabled?: boolean;
}

export interface CalendarWiring {
  /** Mount under '/owner/calendar'. Always present (503s when disabled). */
  readonly router: Hono;
  /** Sync poller. start()/stop()/tickOnce(); no-op when disabled. */
  readonly worker: CalendarSyncHandle;
  /** The composed channel, or null when token encryption is not configured. */
  readonly channel: CalendarChannel | null;
}

const NOOP_WORKER: CalendarSyncHandle = {
  start() {},
  stop() {},
  async tickOnce() {
    return { claimed: 0, synced: 0, skipped: 0, failed: 0 };
  },
};

export function createCalendarWiring(
  input: CalendarWiringInput,
): CalendarWiring {
  const env = input.env ?? process.env;

  const channel = input.db
    ? createCalendarChannelFromEnv({
        db: input.db as Parameters<
          typeof createCalendarChannelFromEnv
        >[0]['db'],
        logger: input.logger,
        env,
      })
    : null;

  const router = createCalendarRouter({ channel, env });

  const worker: CalendarSyncHandle =
    input.db && channel
      ? createCalendarSyncWorker({
          db: input.db as { execute(q: unknown): Promise<unknown> },
          logger: input.logger,
          delivery: channel.delivery,
          ...(input.intervalMs !== undefined
            ? { intervalMs: input.intervalMs }
            : {}),
          enabled:
            input.workerEnabled !== undefined
              ? input.workerEnabled
              : env.NODE_ENV !== 'test' &&
                env.BORJIE_CALENDAR_WORKER_DISABLED !== 'true',
        })
      : NOOP_WORKER;

  if (!input.db) {
    input.logger.warn(
      { channel: 'calendar' },
      'calendar wiring: no database — router will 503, worker is a no-op',
    );
  }

  return { router, worker, channel };
}
