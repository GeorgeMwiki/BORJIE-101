/**
 * /api/v1/cockpit/stream — Roadmap R6.
 *
 * Server-Sent Events channel for the owner-web cockpit. Multiplexes
 * six event kinds onto a single per-tenant stream:
 *
 *   - decision.recorded
 *   - reminder.fired
 *   - opportunity.scan_completed
 *   - risk.changed
 *   - workforce.shift_event
 *   - compliance.deadline_approaching
 *
 * Auth: any signed-in tenant user. The stream is auto-scoped to
 * `auth.tenantId` — no path / query parameter is required. A user
 * cannot subscribe to a tenant they don't belong to.
 *
 * Wire format: standard SSE — one `event: <kind>` + `data: <json>` pair
 * per push, plus a 25-second heartbeat comment to keep proxies from
 * idling the socket.
 *
 * Lifecycle:
 *   - On connect: emit `event: connected` + the current ISO timestamp
 *     so the client can render a green dot immediately.
 *   - The request's AbortSignal drives the cleanup (close the stream,
 *     unsubscribe from the bus, clear the heartbeat).
 *
 * No buffering: if the client disconnects mid-publish the event is
 * dropped on the floor (consumers are read-only views).
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import { authMiddleware } from '../middleware/hono-auth';
import {
  subscribeCockpitEvents,
  type CockpitEvent,
} from '../services/cockpit-events';

const HEARTBEAT_MS = 25_000;

export const cockpitStreamRouter = new Hono();
cockpitStreamRouter.use('*', authMiddleware);

cockpitStreamRouter.get('/stream', (c) => {
  const auth = c.get('auth') as { tenantId?: string } | undefined;
  const tenantId = auth?.tenantId;
  if (!tenantId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'TENANT_REQUIRED',
          message: 'auth.tenantId missing — cockpit stream requires a tenant scope',
        },
      },
      401,
    );
  }

  return streamSSE(c, async (stream) => {
    // Opening packet so the client knows the connection is live.
    await stream.writeSSE({
      event: 'connected',
      data: JSON.stringify({ tenantId, openedAt: new Date().toISOString() }),
    });

    // Bridge bus events into the SSE wire. Push errors are caught
    // so a single slow client never crashes the bus emit loop.
    const queue: CockpitEvent[] = [];
    let flushScheduled = false;
    const scheduleFlush = (): void => {
      if (flushScheduled) return;
      flushScheduled = true;
      queueMicrotask(async () => {
        flushScheduled = false;
        while (queue.length > 0) {
          const next = queue.shift();
          if (!next) break;
          try {
            await stream.writeSSE({
              event: next.kind,
              data: JSON.stringify(next),
            });
          } catch {
            // client gone; drop the rest. The abort signal will
            // unsubscribe us in a moment.
            queue.length = 0;
            return;
          }
        }
      });
    };

    const unsubscribe = subscribeCockpitEvents(tenantId, (event) => {
      queue.push(event);
      scheduleFlush();
    });

    // Heartbeat — comment-only frame so the client sees no payload.
    const heartbeat = setInterval(() => {
      stream
        .writeSSE({ event: 'heartbeat', data: JSON.stringify({ at: new Date().toISOString() }) })
        .catch(() => {
          // client disconnected; the abort signal will tear down below.
        });
    }, HEARTBEAT_MS);

    const cleanup = (): void => {
      clearInterval(heartbeat);
      unsubscribe();
    };

    // Hold the connection open until the client aborts.
    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        cleanup();
        resolve();
      });
    });
  });
});

export default cockpitStreamRouter;
