/**
 * Portal-GenUI router.
 *
 * Mounted at `/api/v1/portal-genui`. Drives the dynamic-tab generator
 * end-to-end:
 *
 *   POST /v1/portal-genui/detect    — classify a user message
 *   POST /v1/portal-genui/generate  — draft a PortalTab from an intent
 *   POST /v1/portal-genui/tabs      — persist a generated tab
 *   GET  /v1/portal-genui/tabs      — list tabs for (tenant, user)
 *   GET  /v1/portal-genui/tabs/:id  — fetch one tab
 *   DELETE /v1/portal-genui/tabs/:id — delete one tab
 *
 * Tenant id + actor id come from `c.get('auth')` (JWT-derived). The
 * client never supplies these in the request body — that would let a
 * caller forge a tenant.
 *
 * Every state-changing route is wrapped in `withSecurityEvents` for
 * the SOC 2 audit trail (mirrors `ask.router.ts`). Brief said
 * `withSecurityEventsFastify`; the api-gateway is a Hono app so we
 * use the Hono variant of the same helper.
 *
 * The genUI engine is read off `c.get('services').portalGenUIEngine`
 * — the composition root wires it. When the engine is missing every
 * route returns 503 with a config-missing code rather than crashing.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { withSecurityEvents } from '@borjie/observability';
import {
  TabGenerationIntentSchema,
  RecordValidationError,
  type GenUIEngine,
  type RecordStore,
} from '@borjie/portal-genui';
import {
  tenantScopedPath,
  StorageAdapterError,
  type StorageAdapter,
} from '@borjie/storage-adapter';
import { authMiddleware } from '../../middleware/hono-auth.js';
import {
  createWidgetDataResolver,
  UnknownBindingError,
  type WidgetQueryPort,
} from '../../composition/portal-genui/widget-data-resolver.js';
import {
  subscribeCockpitEvents,
  type CockpitEvent,
} from '../../services/cockpit-events/index.js';
import { logger } from '../../utils/logger.js';

/**
 * The four chat-driven tab-CRUD events broadcast on the cockpit bus. The
 * `/tabs/subscribe` channel re-emits ONLY these (it is a narrow, decoupled
 * channel — not the full 30-kind cockpit multiplex) so a cockpit tab strip
 * stays in lockstep across every device the owner is signed in on, in
 * <2s, INDEPENDENTLY of the chat stream.
 */
const TAB_EVENT_KINDS = new Set<CockpitEvent['kind']>([
  'cockpit.tab.spawned',
  'cockpit.tab.updated',
  'cockpit.tab.removed',
  'cockpit.tab.proposed',
]);

/** SSE keep-alive cadence — mirrors `/api/v1/cockpit/stream`. */
const TAB_SUBSCRIBE_HEARTBEAT_MS = 25_000;

/**
 * The owning-user id every tab event carries. The cockpit bus is
 * tenant-scoped; this channel adds USER-scoping on top so one owner never
 * receives another user's (same-tenant) tab pulses.
 */
function eventUserId(event: CockpitEvent): string | null {
  return 'userId' in event
    ? (event as { userId?: unknown }).userId as string | null
    : null;
}

/**
 * The originating device id, when the event carries one. Proposals are
 * always server-originated and carry none.
 */
function eventOriginDeviceId(event: CockpitEvent): string | null {
  return 'originDeviceId' in event
    ? ((event as { originDeviceId?: unknown }).originDeviceId as string | null) ??
        null
    : null;
}

/** Accepted MIME types for tab file/image/audio uploads. */
const ALLOWED_UPLOAD_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

/** 50 MiB hard cap per upload. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Signed-URL TTL: 1 hour. */
const SIGNED_URL_EXPIRES_SECONDS = 3600;

type AnyCtx = any;

function getServices(c: AnyCtx): Record<string, unknown> {
  return c.get('services') ?? {};
}

function getEngine(c: AnyCtx): GenUIEngine | undefined {
  return getServices(c).portalGenUIEngine as GenUIEngine | undefined;
}

function getRecordStore(c: AnyCtx): RecordStore | undefined {
  return getServices(c).portalGenUIRecordStore as RecordStore | undefined;
}

/**
 * Optional tenant-scoped read port for mapped estate domains. The orchestrator
 * attaches it (built from the live Drizzle `$client`, same boundary the
 * record store uses). When unbound — dev/test/smoke — the resolver degrades
 * mapped reads to empty rows rather than crashing.
 */
function getQueryPort(c: AnyCtx): WidgetQueryPort | undefined {
  return getServices(c).portalGenUIQueryPort as WidgetQueryPort | undefined;
}

/**
 * Storage adapter for the tab-upload endpoint. Wired by
 * `portal-genui-wiring.ts` as `services.portalGenUIStorageAdapter`.
 * When absent the upload route returns a structured 501 rather than
 * crashing — the honest-degrade contract used by every optional service
 * in this router.
 */
function getStorageAdapter(c: AnyCtx): StorageAdapter | undefined {
  return getServices(c).portalGenUIStorageAdapter as StorageAdapter | undefined;
}

function unavailable(c: AnyCtx, code: string, message: string) {
  return c.json({ success: false, error: { code, message } }, 503);
}

/**
 * Recursively materialise an object that omits keys with `undefined`
 * values. Required so the strict orgContext shape (which forbids
 * `tenantRegion: undefined`) accepts the zod-inferred type whose
 * optional fields are `string | undefined`.
 */
function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripUndefinedDeep(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = stripUndefinedDeep(v);
    }
    return out as T;
  }
  return value;
}

// ────────────────────────────────────────────────────────────────────
// Request schemas
// ────────────────────────────────────────────────────────────────────

const DetectBodySchema = z
  .object({
    message: z.string().min(1).max(4000),
    /**
     * Optional role-bias — defaults to the auth role from the JWT.
     * Callers MAY override (e.g. an admin role-switching) but the
     * value is never used to bypass tenant scope.
     */
    role: z
      .enum([
        'internal_admin',
        'property_manager',
        'estate_manager',
        'owner',
        'customer',
      ])
      .optional(),
  })
  .strict();

const GenerateBodySchema = z
  .object({
    intent: TabGenerationIntentSchema,
    orgContext: z
      .object({
        tenantName: z.string().max(120).optional(),
        tenantRegion: z.string().max(60).optional(),
        tenantCurrency: z.string().length(3).optional(),
        userPersona: z
          .enum([
            'internal_admin',
            'property_manager',
            'estate_manager',
            'owner',
            'customer',
          ])
          .optional(),
        existingTabKeys: z.array(z.string().min(1).max(120)).max(200).optional(),
      })
      .strict()
      .optional(),
    /**
     * Optional reference to the chat conversation that triggered
     * this generation — used for the audit-trail `sourceConversationId`.
     */
    sourceConversationId: z.string().max(200).optional(),
    /** When provided, persist the generated tab atomically. */
    persist: z.boolean().optional(),
  })
  .strict();

const SaveTabBodySchema = z
  .object({
    /** Full validated tab. The route revalidates server-side. */
    tab: z.record(z.unknown()),
    parentTabId: z.string().min(1).max(120).optional(),
  })
  .strict();

const ListTabsQuerySchema = z
  .object({
    userId: z.string().min(1).max(120).optional(),
    tenantDefault: z
      .enum(['true', 'false'])
      .optional(),
    persona: z
      .enum([
        'internal_admin',
        'property_manager',
        'estate_manager',
        'owner',
        'customer',
      ])
      .optional(),
    domain: z
      .enum([
        'hr',
        'finance',
        'compliance',
        'procurement',
        'operations',
        'sales',
        'marketing',
        'engineering',
        'legal',
        'sustainability',
        'custom',
      ])
      .optional(),
  })
  .strict();

/**
 * Record submission body. The payload is an opaque field-keyed object — the
 * route revalidates it against the OWNING tab's own fields (the generic
 * `validateRecordAgainstTab` inside the record store), so we only assert it is
 * a record here, never a per-tab shape.
 */
const SaveRecordBodySchema = z
  .object({
    payload: z.record(z.unknown()),
  })
  .strict();

const ListRecordsQuerySchema = z
  .object({
    limit: z
      .string()
      .regex(/^[0-9]{1,4}$/)
      .optional(),
  })
  .strict();

/**
 * Widget-data request body. The binding is the CANONICAL K1a shape
 * (`{ kind:'query', resource, filters? }` | `{ kind:'tool', toolId, args? }`)
 * — the SAME shape persisted on a widget and parsed by the schema. Kept
 * permissive here (loose `filters`/`args` records); the resolver re-validates
 * the resource/tool NAME against the capability registry, and a parse miss
 * (e.g. the legacy `{ ref, params }` shape) answers 400 rather than crashing.
 */
const BindingScalarSchema = z.union([
  z.string().max(500),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string().max(500), z.number(), z.boolean()])).max(50),
]);

const WidgetDataBindingSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('query'),
      resource: z.string().min(1).max(120),
      filters: z.record(BindingScalarSchema).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('tool'),
      toolId: z.string().min(1).max(120),
      args: z.record(BindingScalarSchema).optional(),
    })
    .strict(),
]);

const WidgetDataBodySchema = z
  .object({
    binding: WidgetDataBindingSchema,
  })
  .strict();

/**
 * `/tabs/subscribe` query. `deviceId` lets the server echo-filter the
 * caller's OWN broadcasts (a device that spawns a tab already applied it
 * optimistically; it must not receive its own pulse back). An
 * `EventSource` cannot set custom headers, so the id rides the query
 * string — never an auth-bearing value, only an opaque per-tab session id.
 */
const TabSubscribeQuerySchema = z
  .object({
    deviceId: z.string().min(1).max(120).optional(),
  })
  .strict();

// ────────────────────────────────────────────────────────────────────
// Router
// ────────────────────────────────────────────────────────────────────

const router = new Hono();
router.use('*', authMiddleware);

// ─── POST /v1/portal-genui/detect ──────────────────────────────
router.post(
  '/detect',
  withSecurityEvents(
    {
      action: 'portal-genui.detect',
      resource: 'portal-genui',
      severity: 'info',
    },
    async (c: AnyCtx) => {
      const engine = getEngine(c);
      if (!engine) {
        return unavailable(
          c,
          'PORTAL_GENUI_ENGINE_MISSING',
          'portal-genui engine is not wired in this environment',
        );
      }
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json(
          {
            success: false,
            error: { code: 'INVALID_JSON', message: 'invalid JSON body' },
          },
          400,
        );
      }
      const parsed = DetectBodySchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          {
            success: false,
            error: { code: 'BAD_REQUEST', message: parsed.error.message },
          },
          400,
        );
      }
      const auth = c.get('auth');
      const intent = await engine.detectIntent({
        message: parsed.data.message,
        role: parsed.data.role ?? (auth?.role as never),
      });
      return c.json({ success: true, data: { intent } });
    },
  ),
);

// ─── POST /v1/portal-genui/generate ────────────────────────────
router.post(
  '/generate',
  withSecurityEvents(
    {
      action: 'portal-genui.generate',
      resource: 'portal-genui',
      severity: 'info',
    },
    async (c: AnyCtx) => {
      const engine = getEngine(c);
      if (!engine) {
        return unavailable(
          c,
          'PORTAL_GENUI_ENGINE_MISSING',
          'portal-genui engine is not wired in this environment',
        );
      }
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json(
          {
            success: false,
            error: { code: 'INVALID_JSON', message: 'invalid JSON body' },
          },
          400,
        );
      }
      const parsed = GenerateBodySchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          {
            success: false,
            error: { code: 'BAD_REQUEST', message: parsed.error.message },
          },
          400,
        );
      }
      const auth = c.get('auth');
      if (!auth?.tenantId || !auth?.userId) {
        return c.json(
          {
            success: false,
            error: {
              code: 'MISSING_TENANT_OR_USER',
              message: 'auth context missing tenantId/userId',
            },
          },
          401,
        );
      }
      try {
        const generateInput: Parameters<typeof engine.generate>[0] = {          intent: parsed.data.intent,
          tenantId: auth.tenantId,
          userId: auth.userId,
          actorId: auth.userId,
        };
        if (parsed.data.orgContext !== undefined) {
          (generateInput as { orgContext?: unknown }).orgContext = stripUndefinedDeep(
            parsed.data.orgContext,
          );
        }
        if (parsed.data.sourceConversationId !== undefined) {
          (generateInput as { sourceConversationId?: string }).sourceConversationId =
            parsed.data.sourceConversationId;
        }
        // W3d — owner ACTIVE locale → the brain AUTHORS every generated label in
        // that single language (CLAUDE.md EN/SW absolute separation). The header
        // is authoritative; default en.
        const acceptLang = c.req.header('accept-language') ?? '';
        (generateInput as { locale?: 'en' | 'sw' }).locale = /\bsw\b/i.test(
          acceptLang,
        )
          ? 'sw'
          : 'en';
        const result = await engine.generate(generateInput);        if (parsed.data.persist) {
          await engine.persist({ tab: result.tab });
        }
        return c.json({
          success: true,
          data: {
            tab: result.tab,
            source: result.source,
            llmModelId: result.llmModelId,
            latencyMs: result.latencyMs,
            persisted: parsed.data.persist === true,
          },
        });
      } catch (err) {
        if ((err as { code?: unknown })?.code === 'TAB_ADMISSION_FAILED') {
          return c.json(
            {
              success: false,
              error: {
                code: 'TAB_ADMISSION_FAILED',
                message: err instanceof Error ? err.message : 'admission failed',
                violations: (err as { violations?: unknown }).violations ?? [],
              },
            },
            422,
          );
        }
        return c.json(
          {
            success: false,
            error: {
              code: 'GENERATION_FAILED',
              message:
                err instanceof Error ? err.message : 'unknown error',
            },
          },
          500,
        );
      }
    },
  ),
);

// ─── POST /v1/portal-genui/tabs ────────────────────────────────
router.post(
  '/tabs',
  withSecurityEvents(
    {
      action: 'portal-genui.save-tab',
      resource: 'portal-genui',
      severity: 'notice',
    },
    async (c: AnyCtx) => {
      const engine = getEngine(c);
      if (!engine) {
        return unavailable(
          c,
          'PORTAL_GENUI_ENGINE_MISSING',
          'portal-genui engine is not wired in this environment',
        );
      }
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json(
          {
            success: false,
            error: { code: 'INVALID_JSON', message: 'invalid JSON body' },
          },
          400,
        );
      }
      const parsed = SaveTabBodySchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          {
            success: false,
            error: { code: 'BAD_REQUEST', message: parsed.error.message },
          },
          400,
        );
      }
      const auth = c.get('auth');
      if (!auth?.tenantId) {
        return c.json(
          {
            success: false,
            error: { code: 'MISSING_TENANT', message: 'auth missing tenantId' },
          },
          401,
        );
      }
      // Enforce tenant + actor server-side — never trust the body.
      const tabAny = parsed.data.tab as Record<string, unknown>;
      const enforced = {
        ...tabAny,
        tenantId: auth.tenantId,
      };
      try {
        const saved = await engine.persist({
          tab: enforced as never,
          ...(parsed.data.parentTabId !== undefined
            ? { parentTabId: parsed.data.parentTabId }
            : {}),
        });
        return c.json({ success: true, data: saved }, 201);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown';
        if ((err as { code?: unknown })?.code === 'TAB_ADMISSION_FAILED') {
          return c.json(
            {
              success: false,
              error: {
                code: 'TAB_ADMISSION_FAILED',
                message: msg,
                violations:
                  (err as { violations?: unknown }).violations ?? [],
              },
            },
            422,
          );
        }
        if (msg.includes('tab_key_already_exists')) {
          return c.json(
            {
              success: false,
              error: { code: 'TAB_KEY_CONFLICT', message: msg },
            },
            409,
          );
        }
        return c.json(
          {
            success: false,
            error: { code: 'INVALID_TAB', message: msg },
          },
          400,
        );
      }
    },
  ),
);

// ─── GET /v1/portal-genui/tabs ─────────────────────────────────
router.get('/tabs', async (c: AnyCtx) => {
  const engine = getEngine(c);
  if (!engine) {
    return unavailable(
      c,
      'PORTAL_GENUI_ENGINE_MISSING',
      'portal-genui engine is not wired in this environment',
    );
  }
  const auth = c.get('auth');
  if (!auth?.tenantId) {
    return c.json(
      {
        success: false,
        error: { code: 'MISSING_TENANT', message: 'auth missing tenantId' },
      },
      401,
    );
  }
  const rawQuery = c.req.query();
  const parsed = ListTabsQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: { code: 'BAD_REQUEST', message: parsed.error.message },
      },
      400,
    );
  }
  const tenantDefault = parsed.data.tenantDefault === 'true';
  const userId = tenantDefault
    ? null
    : parsed.data.userId ?? auth.userId ?? null;
  const tabs = await engine.list({
    tenantId: auth.tenantId,
    userId,
    ...(parsed.data.persona !== undefined ? { personaId: parsed.data.persona } : {}),
    ...(parsed.data.domain !== undefined ? { domain: parsed.data.domain } : {}),
  });
  return c.json({ success: true, data: { tabs } });
});

// ─── GET /v1/portal-genui/tabs/subscribe ───────────────────────────
// DECOUPLED chat→tab live-linkage channel.
//
// A dedicated SSE channel that re-emits the four chat-driven tab-CRUD
// events (`cockpit.tab.{spawned,updated,removed,proposed}`) the cockpit
// bus broadcasts whenever the brain or owner mutates the tab strip. It is
// INDEPENDENT of the chat stream: a stalled chat turn never stops tab
// sync, so owner-spawned tabs reach every signed-in device in <2s (the
// Figma/Linear decoupled-pub/sub bar).
//
// REGISTERED BEFORE `/tabs/:id` so Hono matches the literal `subscribe`
// segment ahead of the `:id` param (otherwise the engine-gated `/tabs/:id`
// handler would shadow it and answer 503 in engine-less environments).
//
// Why a separate channel from `/api/v1/cockpit/stream`:
//   - It is NARROW — only the 4 tab kinds, so the cockpit tab shell
//     subscribes to exactly what it needs (no 30-kind multiplex).
//   - It is USER-scoped on top of the bus's tenant-scope: every frame is
//     filtered to `auth.userId`, so one owner never sees another (same-
//     tenant) user's tab pulses.
//   - It echo-filters the caller's OWN device server-side (`?deviceId=`)
//     so the spawning device — which already applied the change
//     optimistically — never double-applies its own broadcast.
//
// Transport: the SAME in-process cockpit event bus
// (`subscribeCockpitEvents`) the rest of the stack uses — NOT a parallel
// transport. Cross-replica fan-out (Redis, when wired) rides along for
// free because the bus is replica-aware.
//
// Wire shape: each tab event is translated into the SAME SSE event name +
// `{ payload }` envelope the owner-web `handleTabSseFrame` parser already
// understands (`tab_spawn` / `tab_update` / `tab_remove` /
// `tab_proposal`), so the client reuses one dispatcher for both the
// in-band fast path and this cross-device path.
router.get('/tabs/subscribe', async (c: AnyCtx) => {
  const auth = c.get('auth');
  const tenantId = auth?.tenantId as string | undefined;
  const userId = auth?.userId as string | undefined;
  if (!tenantId || !userId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'MISSING_TENANT_OR_USER',
          message: 'auth context missing tenantId/userId',
        },
      },
      401,
    );
  }

  const parsedQuery = TabSubscribeQuerySchema.safeParse(c.req.query());
  if (!parsedQuery.success) {
    return c.json(
      {
        success: false,
        error: { code: 'BAD_REQUEST', message: parsedQuery.error.message },
      },
      400,
    );
  }
  const callerDeviceId = parsedQuery.data.deviceId ?? null;

  return streamSSE(c, async (stream) => {
    // Opening packet so the client can render a live indicator immediately.
    await stream.writeSSE({
      event: 'connected',
      data: JSON.stringify({ userId, openedAt: new Date().toISOString() }),
    });

    // Bounded fan-out queue — a single slow client never blocks the bus
    // emit loop (the bus is fire-and-forget; we own our own backpressure).
    const queue: Array<{ readonly event: string; readonly data: string }> = [];
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
            await stream.writeSSE({ event: next.event, data: next.data });
          } catch {
            // Client gone — drop the rest; the abort signal unsubscribes us.
            queue.length = 0;
            return;
          }
        }
      });
    };

    const unsubscribe = subscribeCockpitEvents(tenantId, (event) => {
      if (!TAB_EVENT_KINDS.has(event.kind)) return;
      // USER-scope: only this owner's tab events cross the channel.
      if (eventUserId(event) !== userId) return;
      // Echo-filter: never replay the caller's own device's broadcast.
      const origin = eventOriginDeviceId(event);
      if (callerDeviceId !== null && origin !== null && origin === callerDeviceId) {
        return;
      }
      const frame = toTabSseFrame(event);
      if (!frame) return;
      queue.push(frame);
      scheduleFlush();
    });

    const heartbeat = setInterval(() => {
      stream
        .writeSSE({
          event: 'heartbeat',
          data: JSON.stringify({ at: new Date().toISOString() }),
        })
        .catch(() => {
          // Client disconnected; the abort signal tears us down below.
        });
    }, TAB_SUBSCRIBE_HEARTBEAT_MS);

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

// ─── GET /v1/portal-genui/tabs/:id ─────────────────────────────
router.get('/tabs/:id', async (c: AnyCtx) => {
  const engine = getEngine(c);
  if (!engine) {
    return unavailable(
      c,
      'PORTAL_GENUI_ENGINE_MISSING',
      'portal-genui engine is not wired in this environment',
    );
  }
  const auth = c.get('auth');
  const id = c.req.param('id');
  const tab = await engine.get(id);
  if (!tab) {
    return c.json(
      {
        success: false,
        error: { code: 'TAB_NOT_FOUND', message: `tab ${id} not found` },
      },
      404,
    );
  }
  if (tab.tenantId !== auth?.tenantId) {
    return c.json(
      {
        success: false,
        error: { code: 'TAB_NOT_FOUND', message: `tab ${id} not found` },
      },
      404,
    );
  }
  return c.json({ success: true, data: { tab } });
});

// ─── POST /v1/portal-genui/tabs/:id/records ────────────────────
// Submit a record into a generated tab. Loads the tab (404 if not in the
// caller's tenant), validates the payload against the tab's OWN fields, and
// inserts. 422 on validation failure carrying the failing field keys.
router.post(
  '/tabs/:id/records',
  withSecurityEvents(
    {
      action: 'portal-genui.create-record',
      resource: 'portal-genui',
      severity: 'notice',
    },
    async (c: AnyCtx) => {
      const engine = getEngine(c);
      if (!engine) {
        return unavailable(
          c,
          'PORTAL_GENUI_ENGINE_MISSING',
          'portal-genui engine is not wired in this environment',
        );
      }
      const store = getRecordStore(c);
      if (!store) {
        return unavailable(
          c,
          'PORTAL_GENUI_RECORD_STORE_MISSING',
          'portal-genui record store is not wired in this environment',
        );
      }
      const auth = c.get('auth');
      if (!auth?.tenantId || !auth?.userId) {
        return c.json(
          {
            success: false,
            error: {
              code: 'MISSING_TENANT_OR_USER',
              message: 'auth context missing tenantId/userId',
            },
          },
          401,
        );
      }
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json(
          {
            success: false,
            error: { code: 'INVALID_JSON', message: 'invalid JSON body' },
          },
          400,
        );
      }
      const parsed = SaveRecordBodySchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          {
            success: false,
            error: { code: 'BAD_REQUEST', message: parsed.error.message },
          },
          400,
        );
      }
      const id = c.req.param('id');
      const tab = await engine.get(id);
      // Tenant-scoped 404: a missing tab AND another tenant's tab look identical.
      if (!tab || tab.tenantId !== auth.tenantId) {
        return c.json(
          {
            success: false,
            error: { code: 'TAB_NOT_FOUND', message: `tab ${id} not found` },
          },
          404,
        );
      }
      try {
        const record = await store.saveRecord({
          tenantId: auth.tenantId,
          tab,
          payload: parsed.data.payload,
          userId: auth.userId,
        });
        return c.json({ success: true, data: { id: record.id } }, 201);
      } catch (err) {
        if (err instanceof RecordValidationError) {
          return c.json(
            {
              success: false,
              error: {
                code: 'RECORD_VALIDATION_FAILED',
                message: err.message,
                invalidFieldKeys: err.invalidFieldKeys,
              },
            },
            422,
          );
        }
        return c.json(
          {
            success: false,
            error: {
              code: 'RECORD_SAVE_FAILED',
              message: err instanceof Error ? err.message : 'unknown error',
            },
          },
          500,
        );
      }
    },
  ),
);

// ─── GET /v1/portal-genui/tabs/:id/records ─────────────────────
router.get('/tabs/:id/records', async (c: AnyCtx) => {
  const engine = getEngine(c);
  if (!engine) {
    return unavailable(
      c,
      'PORTAL_GENUI_ENGINE_MISSING',
      'portal-genui engine is not wired in this environment',
    );
  }
  const store = getRecordStore(c);
  if (!store) {
    return unavailable(
      c,
      'PORTAL_GENUI_RECORD_STORE_MISSING',
      'portal-genui record store is not wired in this environment',
    );
  }
  const auth = c.get('auth');
  if (!auth?.tenantId) {
    return c.json(
      {
        success: false,
        error: { code: 'MISSING_TENANT', message: 'auth missing tenantId' },
      },
      401,
    );
  }
  const parsed = ListRecordsQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: { code: 'BAD_REQUEST', message: parsed.error.message },
      },
      400,
    );
  }
  const id = c.req.param('id');
  const tab = await engine.get(id);
  if (!tab || tab.tenantId !== auth.tenantId) {
    return c.json(
      {
        success: false,
        error: { code: 'TAB_NOT_FOUND', message: `tab ${id} not found` },
      },
      404,
    );
  }
  const records = await store.listRecords({
    tenantId: auth.tenantId,
    tabId: id,
    ...(parsed.data.limit !== undefined
      ? { limit: Number(parsed.data.limit) }
      : {}),
  });
  return c.json({ success: true, data: { records } });
});

// ─── POST /v1/portal-genui/tabs/:id/widget-data ────────────────
// Resolve ONE generated widget's LIVE data from its schema-declared `binding`.
// Loads the tab (tenant-scoped 404), then dispatches the canonical K1a binding
// through the generic widget-data resolver — `kind:'query'` reads tenant-scoped
// rows (the tab's own records, or a mapped estate domain); `kind:'tool'` is
// vetted + returns empty rows (read-only tool dispatch is a later seam). The
// response is the loose shape the renderer reads ({ rows?, value?, items?,
// columns? }). An unknown resource/tool answers 400; a known-but-unmapped
// resource degrades to empty rows — never a 500.
router.post('/tabs/:id/widget-data', async (c: AnyCtx) => {
  const engine = getEngine(c);
  if (!engine) {
    return unavailable(
      c,
      'PORTAL_GENUI_ENGINE_MISSING',
      'portal-genui engine is not wired in this environment',
    );
  }
  const store = getRecordStore(c);
  if (!store) {
    return unavailable(
      c,
      'PORTAL_GENUI_RECORD_STORE_MISSING',
      'portal-genui record store is not wired in this environment',
    );
  }
  const auth = c.get('auth');
  if (!auth?.tenantId) {
    return c.json(
      {
        success: false,
        error: { code: 'MISSING_TENANT', message: 'auth missing tenantId' },
      },
      401,
    );
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_JSON', message: 'invalid JSON body' },
      },
      400,
    );
  }
  const parsed = WidgetDataBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: { code: 'BAD_REQUEST', message: parsed.error.message },
      },
      400,
    );
  }
  const id = c.req.param('id');
  const tab = await engine.get(id);
  // Tenant-scoped 404 — a missing tab AND another tenant's tab look identical.
  if (!tab || tab.tenantId !== auth.tenantId) {
    return c.json(
      {
        success: false,
        error: { code: 'TAB_NOT_FOUND', message: `tab ${id} not found` },
      },
      404,
    );
  }
  const queryPort = getQueryPort(c);
  const resolver = createWidgetDataResolver({
    recordStore: store,
    ...(queryPort !== undefined ? { query: queryPort } : {}),
    logger,
  });
  try {
    const data = await resolver.resolve(parsed.data.binding, {
      tenantId: auth.tenantId,
      tabId: id,
    });
    return c.json({ success: true, data });
  } catch (err) {
    if (err instanceof UnknownBindingError) {
      return c.json(
        {
          success: false,
          error: { code: 'UNKNOWN_BINDING', message: err.message },
        },
        400,
      );
    }
    return c.json(
      {
        success: false,
        error: {
          code: 'WIDGET_DATA_FAILED',
          message: err instanceof Error ? err.message : 'unknown error',
        },
      },
      500,
    );
  }
});

// ─── POST /v1/portal-genui/tabs/:id/upload ─────────────────────
// Accept multipart/form-data (fields: `file` + optional `fieldKey`).
// Validates the tab exists + belongs to the caller's tenant (RLS-scoped
// via JWT). Stores bytes via the `portalGenUIStorageAdapter` (Supabase
// tenant-uploads bucket in production; in-memory degrade in dev/test).
// Returns { success: true, data: { url } } — a time-limited signed URL
// the client stores as the field value. If the storage adapter is not
// wired (SUPABASE env absent AND in-memory adapter missing) returns a
// structured 501 rather than crashing.
router.post(
  '/tabs/:id/upload',
  withSecurityEvents(
    {
      action: 'portal-genui.tab-upload',
      resource: 'portal-genui',
      severity: 'notice',
    },
    async (c: AnyCtx) => {
      const engine = getEngine(c);
      if (!engine) {
        return unavailable(
          c,
          'PORTAL_GENUI_ENGINE_MISSING',
          'portal-genui engine is not wired in this environment',
        );
      }

      const storageAdapter = getStorageAdapter(c);
      if (!storageAdapter) {
        return c.json(
          {
            success: false,
            error: {
              code: 'UPLOAD_NOT_CONFIGURED',
              message:
                'File uploads are not yet configured in this environment. Contact the platform team to provision the Supabase storage bucket.',
            },
          },
          501,
        );
      }

      const auth = c.get('auth');
      if (!auth?.tenantId || !auth?.userId) {
        return c.json(
          {
            success: false,
            error: {
              code: 'MISSING_TENANT_OR_USER',
              message: 'auth context missing tenantId/userId',
            },
          },
          401,
        );
      }

      const id = c.req.param('id');

      // ── Tenant-scoped tab ownership check ──────────────────────
      const tab = await engine.get(id);
      if (!tab || tab.tenantId !== auth.tenantId) {
        return c.json(
          {
            success: false,
            error: {
              code: 'TAB_NOT_FOUND',
              message: `tab ${id} not found`,
            },
          },
          404,
        );
      }

      // ── Parse multipart form ────────────────────────────────────
      let formData: Record<string, string | File | (string | File)[]>;
      try {
        formData = await c.req.parseBody({ all: true });
      } catch {
        return c.json(
          {
            success: false,
            error: {
              code: 'INVALID_MULTIPART',
              message: 'could not parse multipart/form-data body',
            },
          },
          400,
        );
      }

      const fileField = formData['file'];
      const fileEntry =
        fileField instanceof File
          ? fileField
          : Array.isArray(fileField) && fileField[0] instanceof File
            ? fileField[0]
            : null;

      if (!fileEntry) {
        return c.json(
          {
            success: false,
            error: {
              code: 'FILE_REQUIRED',
              message: 'multipart field "file" is required and must be a file',
            },
          },
          400,
        );
      }

      // ── Type validation ─────────────────────────────────────────
      const contentType = fileEntry.type || 'application/octet-stream';
      if (!ALLOWED_UPLOAD_TYPES.has(contentType)) {
        return c.json(
          {
            success: false,
            error: {
              code: 'UNSUPPORTED_FILE_TYPE',
              message: `file type '${contentType}' is not permitted for tab uploads`,
            },
          },
          415,
        );
      }

      // ── Size validation ─────────────────────────────────────────
      const bytes = new Uint8Array(await fileEntry.arrayBuffer());
      if (bytes.byteLength > MAX_UPLOAD_BYTES) {
        return c.json(
          {
            success: false,
            error: {
              code: 'FILE_TOO_LARGE',
              message: `file exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MiB limit`,
            },
          },
          413,
        );
      }

      // ── Build tenant-scoped storage path ────────────────────────
      const fieldKey = typeof formData['fieldKey'] === 'string'
        ? formData['fieldKey'].replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
        : 'upload';
      const ext = fileEntry.name?.split('.').pop()?.toLowerCase() ?? 'bin';
      const fileId = `portal-genui/${id}/${fieldKey}-${randomUUID()}.${ext}`;
      const storagePath = tenantScopedPath(auth.tenantId, fileId);

      // ── Upload + get signed URL ─────────────────────────────────
      try {
        await storageAdapter.upload(
          'tenant-uploads',
          storagePath,
          bytes,
          contentType,
        );
        const signed = await storageAdapter.getUrl(
          'tenant-uploads',
          storagePath,
          SIGNED_URL_EXPIRES_SECONDS,
        );

        logger.info(
          {
            tenantId: auth.tenantId,
            tabId: id,
            fieldKey,
            storagePath,
            bytes: bytes.byteLength,
          },
          'portal-genui: tab file upload complete',
        );

        return c.json({ success: true, data: { url: signed.url } });
      } catch (err) {
        if (err instanceof StorageAdapterError) {
          logger.warn(
            {
              tenantId: auth.tenantId,
              tabId: id,
              error: err.message,
            },
            'portal-genui: storage upload failed',
          );
          return c.json(
            {
              success: false,
              error: {
                code: 'UPLOAD_FAILED',
                message: 'file could not be stored — please try again',
              },
            },
            502,
          );
        }
        logger.warn(
          {
            tenantId: auth.tenantId,
            tabId: id,
            error: err instanceof Error ? err.message : String(err),
          },
          'portal-genui: unexpected upload error',
        );
        return c.json(
          {
            success: false,
            error: {
              code: 'UPLOAD_ERROR',
              message: err instanceof Error ? err.message : 'unknown error',
            },
          },
          500,
        );
      }
    },
  ),
);

// ─── DELETE /v1/portal-genui/tabs/:id ──────────────────────────
router.delete(
  '/tabs/:id',
  withSecurityEvents(
    {
      action: 'portal-genui.delete-tab',
      resource: 'portal-genui',
      severity: 'notice',
    },
    async (c: AnyCtx) => {
      const engine = getEngine(c);
      if (!engine) {
        return unavailable(
          c,
          'PORTAL_GENUI_ENGINE_MISSING',
          'portal-genui engine is not wired in this environment',
        );
      }
      const auth = c.get('auth');
      if (!auth?.tenantId) {
        return c.json(
          {
            success: false,
            error: { code: 'MISSING_TENANT', message: 'auth missing tenantId' },
          },
          401,
        );
      }
      const id = c.req.param('id');
      const out = await engine.delete({
        tabId: id,
        requesterId: auth.userId ?? 'system',
        tenantId: auth.tenantId,
      });
      if (!out.deleted) {
        return c.json(
          {
            success: false,
            error: { code: 'TAB_NOT_FOUND', message: `tab ${id} not found` },
          },
          404,
        );
      }
      return c.json({ success: true, data: { deleted: true } });
    },
  ),
);

/**
 * Translate a `cockpit.tab.*` bus event into the SSE event-name +
 * `{ payload }` envelope the owner-web `handleTabSseFrame` parser reads.
 * Returns null for any non-tab event (defensive — the caller already
 * filtered, but this keeps the mapping total). Pure + immutable.
 */
function toTabSseFrame(
  event: CockpitEvent,
): { readonly event: string; readonly data: string } | null {
  const at = event.emittedAt;
  switch (event.kind) {
    case 'cockpit.tab.spawned': {
      const ev = event as Extract<CockpitEvent, { kind: 'cockpit.tab.spawned' }>;
      return {
        event: 'tab_spawn',
        data: JSON.stringify({
          at,
          payload: {
            tagKind: 'tab_spawn',
            tabId: ev.tabId,
            tabType: ev.tabType,
            title: ev.title,
            config: ev.config,
            droppedKeys: [],
            source: ev.source,
          },
        }),
      };
    }
    case 'cockpit.tab.updated': {
      const ev = event as Extract<CockpitEvent, { kind: 'cockpit.tab.updated' }>;
      return {
        event: 'tab_update',
        data: JSON.stringify({
          at,
          payload: {
            tagKind: 'tab_update',
            tabId: ev.tabId,
            patch: ev.patch,
            source: ev.source,
          },
        }),
      };
    }
    case 'cockpit.tab.removed': {
      const ev = event as Extract<CockpitEvent, { kind: 'cockpit.tab.removed' }>;
      return {
        event: 'tab_remove',
        data: JSON.stringify({
          at,
          payload: {
            tagKind: 'tab_remove',
            tabId: ev.tabId,
            source: ev.source,
          },
        }),
      };
    }
    case 'cockpit.tab.proposed': {
      const ev = event as Extract<CockpitEvent, { kind: 'cockpit.tab.proposed' }>;
      return {
        event: 'tab_proposal',
        data: JSON.stringify({
          at,
          payload: {
            tagKind: 'tab_proposal',
            proposalId: ev.proposalId,
            tabType: ev.tabType,
            title: ev.title,
            reasonEn: ev.reasonEn,
            reasonSw: ev.reasonSw,
            evidenceIds: ev.evidenceIds,
            confidence: ev.confidence,
            config: {},
          },
        }),
      };
    }
    default:
      return null;
  }
}

export default router;
