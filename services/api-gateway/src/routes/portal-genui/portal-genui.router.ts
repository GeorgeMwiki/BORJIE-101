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
import { logger } from '../../utils/logger.js';

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

export default router;
