// @ts-nocheck — Hono v4 streamSSE return type and status-literal-union
// widen c.json branches. Same convention as jarvis-router-factory.ts.

/**
 * Cross-portal subscribe router — Central Command Phase A (C6 gap #8).
 *
 * `GET /api/v1/cross-portal/subscribe` opens an SSE stream that fans
 * out cross-portal events to ANY authenticated user, regardless of
 * portal. Each subscriber is auto-subscribed to:
 *
 *   - The global topic `borjie:cross-portal:global:event` —
 *     everyone receives.
 *   - The caller's per-tenant topic
 *     `borjie:cross-portal:tenant:${auth.tenantId}:event` —
 *     scoped to that tenant only.
 *
 * Tenant isolation is structural: the SSE handler reads `tenantId`
 * from the JWT (`auth.tenantId`), NEVER from query / body. A caller
 * cannot subscribe to another tenant's topic.
 *
 * Events flow as:
 *
 *   event: announcement | notification | state-mutation | wake-trigger
 *   data: <JSON-encoded CrossPortalEventShape>
 *
 * Plus a heartbeat:
 *
 *   event: heartbeat
 *   data: {"ts":"<iso>"}
 *
 * The router pulls a `crossPortalBus` from the request context. When
 * the bus is unwired (composition root didn't bind it — e.g. tests),
 * the route returns 503 immediately with `CROSS_PORTAL_UNAVAILABLE`.
 *
 * Disconnect lifecycle:
 *   - On client abort (the SSE stream-close), the handler calls
 *     both `offTenant()` and `offGlobal()` so the bus stops
 *     publishing to a dead handler.
 *   - The heartbeat interval is unref'd so it never keeps the
 *     process alive after the stream tears down.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { authMiddleware } from '../middleware/hono-auth';
import {
  globalTopic,
  tenantTopic,
  type CrossPortalBus,
  type CrossPortalEventShape,
} from '../composition/cross-portal-bus';

/** Heartbeat cadence in ms. 15s matches the cadence used by the
 *  /admin/jarvis/stream router so client reconnect logic stays
 *  uniform across surfaces. */
const HEARTBEAT_MS = 15_000;

/** Variable map: the api-gateway's service-context middleware sets
 *  `services` on the Hono ctx. We pull `crossPortalBus` off it. */
declare module 'hono' {
  interface ContextVariableMap {
    // Existing `services` already declared by service-context.middleware.ts.
    // We rely on the `services.crossPortalBus` slot at runtime.
  }
}

const app = new Hono();

app.get('/subscribe', authMiddleware, async (c) => {
  const auth = c.get('auth');
  if (!auth || !auth.tenantId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'AUTH_REQUIRED',
          message: 'cross-portal subscribe requires an authenticated user',
        },
      },
      401,
    );
  }
  const services = (c.get('services') ?? {}) as Record<string, unknown>;
  const bus = services.crossPortalBus as CrossPortalBus | undefined;
  if (!bus) {
    return c.json(
      {
        success: false,
        error: {
          code: 'CROSS_PORTAL_UNAVAILABLE',
          message:
            'cross-portal-bus not wired — composition root did not bind crossPortalBus',
        },
      },
      503,
    );
  }

  const tenantId = String(auth.tenantId);
  const userId = String(auth.userId ?? auth.sub ?? 'unknown-user');
  const tenantChannel = tenantTopic(tenantId);
  const globalChannel = globalTopic();

  return streamSSE(c, async (stream) => {
    // Buffer events that arrive between the subscribe call and the
    // first writeSSE — keeps ordering guarantees even on slow
    // network start-up. ioredis subscribe is fast but never zero.
    const queue: Array<{ event: string; data: string }> = [];
    let dispatching = false;

    const enqueue = (event: string, data: string): void => {
      queue.push({ event, data });
      if (dispatching) return;
      dispatching = true;
      void (async () => {
        while (queue.length > 0) {
          const msg = queue.shift();
          if (!msg) continue;
          try {
            await stream.writeSSE(msg);
          } catch {
            // Client disconnected mid-write — silent. The abort
            // handler tears down subscriptions below.
            queue.length = 0;
            break;
          }
        }
        dispatching = false;
      })();
    };

    let offTenant: (() => Promise<void>) | null = null;
    let offGlobal: (() => Promise<void>) | null = null;
    let heartbeatHandle: ReturnType<typeof setInterval> | null = null;
    let teardown = async (): Promise<void> => {
      // Re-assigned below once we wire the off-handles. Keeping a
      // stable name lets us reference it from the abort listener
      // before the unsubscribe calls return.
    };

    try {
      // Subscribe to per-tenant and global topics in parallel.
      const handler = (event: CrossPortalEventShape): void => {
        // The wire's `event:` lane is the kind — the SSE consumer
        // reduces by kind to keep its switch statement tidy.
        enqueue(event.kind, JSON.stringify(event));
      };
      [offTenant, offGlobal] = await Promise.all([
        bus.subscribe(tenantChannel, handler),
        bus.subscribe(globalChannel, handler),
      ]);

      // Initial ready event so the client knows it's connected.
      await stream.writeSSE({
        event: 'ready',
        data: JSON.stringify({
          tenantId,
          userId,
          channels: [tenantChannel, globalChannel],
        }),
      });

      // Heartbeat — keeps mid-box NAT timers happy and gives the
      // client a signal that the brain is alive even when no events
      // are flowing.
      heartbeatHandle = setInterval(() => {
        enqueue(
          'heartbeat',
          JSON.stringify({ ts: new Date().toISOString() }),
        );
      }, HEARTBEAT_MS);
      if (typeof heartbeatHandle.unref === 'function') {
        heartbeatHandle.unref();
      }

      teardown = async (): Promise<void> => {
        if (heartbeatHandle) {
          clearInterval(heartbeatHandle);
          heartbeatHandle = null;
        }
        const promises: Array<Promise<unknown>> = [];
        if (offTenant) promises.push(offTenant().catch(() => undefined));
        if (offGlobal) promises.push(offGlobal().catch(() => undefined));
        await Promise.all(promises);
        offTenant = null;
        offGlobal = null;
      };

      // streamSSE doesn't expose a clean per-client abort hook in all
      // adapters; the Hono streamSSE callback ends when the client
      // disconnects (the writer throws) OR when we return.
      // Wait on the abort signal so we hold the stream open.
      await new Promise<void>((resolve) => {
        const signal = (c.req.raw as Request).signal;
        if (signal?.aborted) {
          resolve();
          return;
        }
        signal?.addEventListener(
          'abort',
          () => {
            resolve();
          },
          { once: true },
        );
      });
    } finally {
      await teardown();
    }
  });
});

export const crossPortalSubscribeRouter = app;
export default app;
