/**
 * /api/v1/owner/tabs — owner-cockpit dynamic tab persistence.
 *
 * Wave OWNER-OS / OWNER-OS-DURABLE. The owner can spawn / pin / reorder /
 * close tabs in the cockpit home (Chat / Docs / Drafts / Reminders /
 * Insights / "Geita PML" / ...). The FE owns the schema of the `state`
 * jsonb document; this surface is a per-user key-value store that survives
 * a sign-out + sign-in AND syncs across every device the owner is signed
 * in on.
 *
 * Routes:
 *   GET    /            load the current user's tab state. Returns the
 *                       default empty layout when the row does not exist.
 *
 *   PUT    /            legacy replace-all of the whole `state` document.
 *                       Kept for FE clients that already call PUT.
 *
 *   POST   /            idempotent upsert of a SINGLE tab entry; bumps the
 *                       active tab unless `setActive=false`. When a tab with
 *                       the same id already exists the call AUGMENTS it in
 *                       place (merges `context`, keeps the +N badge). This is
 *                       the server-persisted "spawn / augment" path the
 *                       chat tool `mining.ui.tabs.spawn` drives, so a tab
 *                       op persists regardless of which device is listening.
 *
 *   PATCH  /:id         partial update of a single tab (rename, augment
 *                       context, set the +N `pendingUpdates` badge count,
 *                       bump `augmentedAt`). Backs `mining.ui.tabs.update`.
 *
 *   DELETE /:id         close (remove) a tab; pinned tabs refused with 409.
 *                       Backs `mining.ui.tabs.close`.
 *
 *   POST   /sync        bulk replace state — used after a local-only burst of
 *                       mutations is committed in one shot, or as the
 *                       "force-push my local state" path.
 *
 *   POST   /:id/close   chat-tool alias for DELETE /:id (the brain-tool
 *                       loopback HTTP client exposes get/post only).
 *   POST   /:id/update  chat-tool alias for PATCH /:id (same rationale).
 *
 *   GET    /recent-types  Wave OWNER-OS-DYNAMIC Phase 2. Returns the set of
 *                       tab-type ids the owner has spawned within the last N
 *                       days (default 30), ordered by recency. Derived from
 *                       `state.tabs[].lastOpenedAt`. Used by the "+ Tab"
 *                       dropdown to show ONLY recently-used types by default.
 *
 * Auth: Supabase JWT via `authMiddleware`. Tenant scope bound by
 *       `databaseMiddleware`'s `app.current_tenant_id` GUC for RLS.
 *
 * The jsonb `state` document is opaque to the gateway. The FE owns the
 * shape. We cap the document at 64 KB to keep accidental blobs out of the
 * table. Mining entity vocabulary the FE pins into a tab's `context`:
 *   - licence          { licenceId, siteId }
 *   - site             { siteId }
 *   - production_case  { caseId, siteId }
 *   - buyer            { buyerId, siteId }
 *
 * Companion files:
 *   - packages/database/src/migrations/0089_owner_reminders_and_tabs.sql
 *   - packages/database/src/migrations/0156_reminders_owner_tabs_rls_current_tenant.sql
 *   - packages/database/src/migrations/0277_owner_tabs_fresh_db_safety.sql
 *   - packages/database/src/schemas/owner-tabs.schema.ts
 *   - services/api-gateway/src/composition/brain-tools/owner-tabs-tools.ts
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';

import { ownerTabs } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('owner-tabs');

const MAX_STATE_BYTES = 64 * 1024;

interface PersistedTab {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly pinned?: boolean;
  readonly augmentedAt?: string;
  readonly pendingUpdates?: number;
}

interface PersistedState {
  readonly tabs: ReadonlyArray<PersistedTab>;
  readonly activeTabId: string | null;
}

const DEFAULT_STATE: PersistedState = Object.freeze({
  tabs: [],
  activeTabId: null,
});

const tabEntrySchema = z.object({
  id: z.string().min(1).max(200),
  kind: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  context: z.record(z.string(), z.unknown()).optional(),
  pinned: z.boolean().optional(),
  augmentedAt: z.string().datetime().optional(),
  pendingUpdates: z.number().int().nonnegative().max(999).optional(),
});

const upsertTabSchema = z.object({
  tab: tabEntrySchema,
  /** When true, the upserted tab becomes the active tab. Defaults true. */
  setActive: z.boolean().optional().default(true),
});

const patchTabSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  augmentedAt: z.string().datetime().optional(),
  pendingUpdates: z.number().int().nonnegative().max(999).optional(),
});

const stateSchema = z
  .object({
    tabs: z.array(tabEntrySchema).max(50),
    activeTabId: z.string().min(1).max(200).nullable(),
  })
  .refine(
    (s) => JSON.stringify(s).length <= MAX_STATE_BYTES,
    `state must be <=${MAX_STATE_BYTES} bytes when JSON-stringified`,
  );

const syncSchema = z.object({
  state: stateSchema,
});

// Legacy PUT body — pre-Wave OWNER-OS clients sent a free-form record.
const putLegacySchema = z.object({
  state: z
    .record(z.string(), z.unknown())
    .refine(
      (s) => JSON.stringify(s).length <= MAX_STATE_BYTES,
      `state must be <=${MAX_STATE_BYTES} bytes when JSON-stringified`,
    ),
});

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

function dbUnavailable(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'OWNER_TABS_DB_UNAVAILABLE',
        message: 'Database not configured',
      },
    },
    503,
  );
}

function validationError(c: any, message: string, issues?: unknown) {
  return c.json(
    {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message,
        ...(issues !== undefined && { issues }),
      },
    },
    400,
  );
}

function notFound(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'OWNER_TABS_NOT_FOUND',
        message: 'Tab not found in current state',
      },
    },
    404,
  );
}

function isObjectRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function readState(raw: unknown): PersistedState {
  if (!isObjectRecord(raw)) return { ...DEFAULT_STATE };
  const tabsRaw = raw.tabs;
  const activeRaw = raw.activeTabId;
  const tabs = Array.isArray(tabsRaw)
    ? (tabsRaw.filter(isObjectRecord) as unknown as ReadonlyArray<PersistedTab>)
    : [];
  const activeTabId =
    typeof activeRaw === 'string' && activeRaw.length > 0 ? activeRaw : null;
  return { tabs, activeTabId };
}

function mergeContext(
  prev: Readonly<Record<string, unknown>> | undefined,
  next: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> | undefined {
  if (!prev && !next) return undefined;
  if (!prev) return { ...next } as Record<string, unknown>;
  if (!next) return { ...prev } as Record<string, unknown>;
  return { ...prev, ...next };
}

/**
 * exactOptional-friendly projection from the zod output (which carries
 * `?: undefined` keys) into the narrower PersistedTab shape. Dropping the
 * undefined keys keeps `JSON.stringify` lean and the type exact.
 */
function projectTab(input: z.infer<typeof tabEntrySchema>): PersistedTab {
  const out: { -readonly [K in keyof PersistedTab]: PersistedTab[K] } = {
    id: input.id,
    kind: input.kind,
    title: input.title,
  };
  if (input.context !== undefined) out.context = input.context;
  if (input.pinned !== undefined) out.pinned = input.pinned;
  if (input.augmentedAt !== undefined) out.augmentedAt = input.augmentedAt;
  if (input.pendingUpdates !== undefined) {
    out.pendingUpdates = input.pendingUpdates;
  }
  return out;
}

function patchTab(
  prev: PersistedTab,
  patch: z.infer<typeof patchTabSchema>,
): PersistedTab {
  // Build via explicit conditional assignment (mirrors projectTab) so the
  // result stays exactOptionalPropertyTypes-exact — conditional spreads widen
  // optional keys to `T | undefined` and trip TS2375.
  const out: { -readonly [K in keyof PersistedTab]: PersistedTab[K] } = {
    ...prev,
  };
  if (patch.title !== undefined) out.title = patch.title;
  if (patch.augmentedAt !== undefined) out.augmentedAt = patch.augmentedAt;
  if (patch.pendingUpdates !== undefined) out.pendingUpdates = patch.pendingUpdates;
  if (patch.context !== undefined) {
    // mergeContext only returns undefined when BOTH inputs are undefined;
    // patch.context is defined here, so the guard always holds at runtime —
    // it just narrows away the `| undefined` for the exact-optional target.
    const merged = mergeContext(prev.context, patch.context);
    if (merged !== undefined) out.context = merged;
  }
  return out;
}

async function loadState(
  db: any,
  tenantId: string,
  userId: string,
): Promise<{ state: PersistedState; updatedAt: Date | null }> {
  const [row] = await db
    .select()
    .from(ownerTabs)
    .where(
      and(eq(ownerTabs.tenantId, tenantId), eq(ownerTabs.userId, userId)),
    )
    .limit(1);
  if (!row) return { state: { ...DEFAULT_STATE }, updatedAt: null };
  return { state: readState(row.state), updatedAt: row.updatedAt };
}

async function writeState(
  db: any,
  tenantId: string,
  userId: string,
  state: PersistedState | Record<string, unknown>,
): Promise<Date> {
  const now = new Date();
  // Upsert by composite PK (tenant_id, user_id). The DEFAULT for `state` is
  // overridden by the supplied jsonb document; updatedAt is bumped on every
  // save so the FE can sort tab history conservatively and cross-device
  // clients detect a newer write on focus.
  await db.execute(
    sql`
      INSERT INTO owner_tabs (tenant_id, user_id, state, updated_at)
      VALUES (${tenantId}, ${userId}, ${JSON.stringify(state)}::jsonb, ${now})
      ON CONFLICT (tenant_id, user_id)
      DO UPDATE SET state = EXCLUDED.state, updated_at = EXCLUDED.updated_at
    `,
  );
  return now;
}

// ─── GET / — load current state ─────────────────────────────────────────
app.get('/', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) return dbUnavailable(c);
  const { state, updatedAt } = await loadState(db, auth.tenantId, auth.userId);
  return c.json({
    success: true,
    data: {
      state,
      updatedAt: updatedAt ? updatedAt.toISOString() : null,
      hydratedFromDefault: updatedAt === null,
    },
  });
});

// ─── PUT / — legacy bulk replace (pre-Wave OWNER-OS clients) ──────────────
app.put('/', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) return dbUnavailable(c);
  const raw = await c.req.json().catch(() => null);
  const parsed = putLegacySchema.safeParse(raw);
  if (!parsed.success) {
    return validationError(c, 'Invalid tabs payload', parsed.error.issues);
  }
  const updatedAt = await writeState(
    db,
    auth.tenantId,
    auth.userId,
    parsed.data.state,
  );
  moduleLogger.info('owner-tabs: legacy PUT state saved', {
    tenantId: auth.tenantId,
    userId: auth.userId,
    bytes: JSON.stringify(parsed.data.state).length,
  });
  return c.json({
    success: true,
    data: { state: parsed.data.state, updatedAt },
  });
});

// ─── POST / — idempotent upsert of a single tab entry (spawn / augment) ───
app.post('/', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) return dbUnavailable(c);
  const raw = await c.req.json().catch(() => null);
  const parsed = upsertTabSchema.safeParse(raw);
  if (!parsed.success) {
    return validationError(c, 'Invalid tab payload', parsed.error.issues);
  }
  const { tab, setActive } = parsed.data;
  const { state } = await loadState(db, auth.tenantId, auth.userId);

  const projected = projectTab(tab);
  const existingIndex = state.tabs.findIndex((t) => t.id === tab.id);
  const mergedContext = mergeContext(
    state.tabs[existingIndex]?.context,
    projected.context,
  );
  const mergedBase: { -readonly [K in keyof PersistedTab]: PersistedTab[K] } =
    existingIndex >= 0
      ? { ...state.tabs[existingIndex], ...projected }
      : { ...projected };
  if (mergedContext !== undefined) mergedBase.context = mergedContext;
  const merged: PersistedTab = mergedBase;
  const nextTabs =
    existingIndex >= 0
      ? state.tabs.map((t, i) => (i === existingIndex ? merged : t))
      : [...state.tabs, merged];
  const nextState: PersistedState = {
    tabs: nextTabs,
    activeTabId: setActive ? tab.id : state.activeTabId,
  };

  if (JSON.stringify(nextState).length > MAX_STATE_BYTES) {
    return c.json(
      {
        success: false,
        error: {
          code: 'OWNER_TABS_STATE_TOO_LARGE',
          message: `state would exceed ${MAX_STATE_BYTES} bytes`,
        },
      },
      413,
    );
  }

  const updatedAt = await writeState(db, auth.tenantId, auth.userId, nextState);
  moduleLogger.info('owner-tabs: tab upserted', {
    tenantId: auth.tenantId,
    userId: auth.userId,
    tabId: tab.id,
    kind: tab.kind,
    isNew: existingIndex < 0,
  });
  return c.json({
    success: true,
    data: {
      tab: merged,
      isNew: existingIndex < 0,
      state: nextState,
      updatedAt: updatedAt.toISOString(),
    },
  });
});

// ─── PATCH /:id — partial update of a single tab ──────────────────────────
app.patch('/:id', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) return dbUnavailable(c);
  const id = c.req.param('id');
  if (!id) return validationError(c, 'Missing tab id');
  const raw = await c.req.json().catch(() => null);
  const parsed = patchTabSchema.safeParse(raw);
  if (!parsed.success) {
    return validationError(c, 'Invalid patch payload', parsed.error.issues);
  }
  const { state } = await loadState(db, auth.tenantId, auth.userId);
  const existingIndex = state.tabs.findIndex((t) => t.id === id);
  if (existingIndex < 0) return notFound(c);
  const prev = state.tabs[existingIndex]!;
  const next = patchTab(prev, parsed.data);
  const nextTabs = state.tabs.map((t, i) => (i === existingIndex ? next : t));
  const nextState: PersistedState = { ...state, tabs: nextTabs };
  const updatedAt = await writeState(db, auth.tenantId, auth.userId, nextState);
  moduleLogger.info('owner-tabs: tab patched', {
    tenantId: auth.tenantId,
    userId: auth.userId,
    tabId: id,
  });
  return c.json({
    success: true,
    data: { tab: next, state: nextState, updatedAt: updatedAt.toISOString() },
  });
});

// ─── DELETE /:id — close (remove) a tab; pinned tabs cannot be closed ─────
async function closeTab(c: any) {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) return dbUnavailable(c);
  const id = c.req.param('id');
  if (!id) return validationError(c, 'Missing tab id');
  const { state } = await loadState(db, auth.tenantId, auth.userId);
  const existing = state.tabs.find((t) => t.id === id);
  if (!existing) return notFound(c);
  if (existing.pinned) {
    return c.json(
      {
        success: false,
        error: {
          code: 'OWNER_TABS_PINNED',
          message: 'Pinned tabs cannot be closed',
        },
      },
      409,
    );
  }
  const nextTabs = state.tabs.filter((t) => t.id !== id);
  const nextActive =
    state.activeTabId === id ? nextTabs[0]?.id ?? null : state.activeTabId;
  const nextState: PersistedState = { tabs: nextTabs, activeTabId: nextActive };
  const updatedAt = await writeState(db, auth.tenantId, auth.userId, nextState);
  moduleLogger.info('owner-tabs: tab closed', {
    tenantId: auth.tenantId,
    userId: auth.userId,
    tabId: id,
  });
  return c.json({
    success: true,
    data: {
      closedTabId: id,
      state: nextState,
      updatedAt: updatedAt.toISOString(),
    },
  });
}

app.delete('/:id', closeTab);

// ─── POST /sync — bulk replace state (client-burst commit) ────────────────
app.post('/sync', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) return dbUnavailable(c);
  const raw = await c.req.json().catch(() => null);
  const parsed = syncSchema.safeParse(raw);
  if (!parsed.success) {
    return validationError(c, 'Invalid sync payload', parsed.error.issues);
  }
  const nextState: PersistedState = {
    tabs: parsed.data.state.tabs.map(projectTab),
    activeTabId: parsed.data.state.activeTabId,
  };
  const updatedAt = await writeState(db, auth.tenantId, auth.userId, nextState);
  moduleLogger.info('owner-tabs: bulk sync applied', {
    tenantId: auth.tenantId,
    userId: auth.userId,
    tabCount: nextState.tabs.length,
  });
  return c.json({
    success: true,
    data: { state: nextState, updatedAt: updatedAt.toISOString() },
  });
});

// ─── POST /:id/close — chat-tool alias for DELETE /:id ────────────────────
// The brain-tool loopback HTTP client surface exposes get/post only. This
// POST alias lets `mining.ui.tabs.close` drive the same close logic without
// the dispatcher needing a DELETE verb. Same auth + RLS + audit guards fire.
app.post('/:id/close', closeTab);

// ─── POST /:id/update — chat-tool alias for PATCH /:id ─────────────────────
app.post('/:id/update', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) return dbUnavailable(c);
  const id = c.req.param('id');
  if (!id) return validationError(c, 'Missing tab id');
  const raw = await c.req.json().catch(() => null);
  const parsed = patchTabSchema.safeParse(raw);
  if (!parsed.success) {
    return validationError(c, 'Invalid patch payload', parsed.error.issues);
  }
  const { state } = await loadState(db, auth.tenantId, auth.userId);
  const existingIndex = state.tabs.findIndex((t) => t.id === id);
  if (existingIndex < 0) return notFound(c);
  const prev = state.tabs[existingIndex]!;
  const next = patchTab(prev, parsed.data);
  const nextTabs = state.tabs.map((t, i) => (i === existingIndex ? next : t));
  const nextState: PersistedState = { ...state, tabs: nextTabs };
  const updatedAt = await writeState(db, auth.tenantId, auth.userId, nextState);
  moduleLogger.info('owner-tabs: tab patched via chat tool', {
    tenantId: auth.tenantId,
    userId: auth.userId,
    tabId: id,
  });
  return c.json({
    success: true,
    data: { tab: next, state: nextState, updatedAt: updatedAt.toISOString() },
  });
});

// ---------------------------------------------------------------------------
// GET /recent-types — Wave OWNER-OS-DYNAMIC Phase 2.
//
// The "+ Tab" dropdown defaults to showing ONLY the tab types the owner has
// spawned at least once in the last N days (default 30), ordered by most-
// recent first. The full tab registry is shown only behind "Show all".
//
// We DERIVE the type list from the owner's CURRENT state.tabs[] jsonb blob —
// for every tab whose `lastOpenedAt` falls within the window, we emit a
// `{ type, lastOpenedAt }` entry. Tabs without `lastOpenedAt` (legacy state
// pre-Phase 2) are still emitted at the back so the menu is never empty.
//
// The brain's full awareness of all tab types is INTENTIONALLY unaffected by
// this filter — the brain can still suggest any type based on conversation;
// this endpoint only narrows the manual "+ Tab" affordance to recently-used.
// ---------------------------------------------------------------------------

const recentTypesQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

const RECENT_TYPES_CAP = 14;

interface PersistedTabLite {
  readonly type?: string;
  readonly kind?: string;
  readonly id?: string;
  readonly lastOpenedAt?: string;
  readonly augmentedAt?: string;
}

export function deriveRecentTypes(
  stateJson: unknown,
  days: number,
): ReadonlyArray<{ readonly type: string; readonly lastOpenedAt: string | null }> {
  if (!stateJson || typeof stateJson !== 'object') return [];
  const tabs = (stateJson as { tabs?: unknown }).tabs;
  if (!Array.isArray(tabs)) return [];
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const seen = new Map<string, string | null>();
  for (const raw of tabs as ReadonlyArray<PersistedTabLite>) {
    if (!raw || typeof raw !== 'object') continue;
    // Tab type identifier — the FE stores it under either `type` (new
    // registry) or `kind` (legacy store). Prefer `type`, fall back to
    // `kind`, then a last-resort parse of the literal id prefix.
    const type =
      (typeof raw.type === 'string' && raw.type) ||
      (typeof raw.kind === 'string' && raw.kind) ||
      (typeof raw.id === 'string' && raw.id.split('|')[0]) ||
      null;
    if (!type) continue;
    const recencyIso =
      (typeof raw.lastOpenedAt === 'string' && raw.lastOpenedAt) ||
      (typeof raw.augmentedAt === 'string' && raw.augmentedAt) ||
      null;
    const recencyMs = recencyIso ? Date.parse(recencyIso) : null;
    // If a timestamp is present, drop entries outside the window.
    if (recencyMs !== null && Number.isFinite(recencyMs) && recencyMs < cutoff) {
      continue;
    }
    // Keep the MOST RECENT timestamp per type.
    const previous = seen.get(type);
    if (previous === undefined) {
      seen.set(type, recencyIso);
    } else if (
      recencyIso &&
      (!previous || Date.parse(recencyIso) > Date.parse(previous))
    ) {
      seen.set(type, recencyIso);
    }
  }
  const entries = Array.from(seen.entries(), ([type, lastOpenedAt]) => ({
    type,
    lastOpenedAt,
  }));
  // Sort by recency desc; tabs without a timestamp sink to the back.
  entries.sort((a, b) => {
    if (a.lastOpenedAt && b.lastOpenedAt) {
      return Date.parse(b.lastOpenedAt) - Date.parse(a.lastOpenedAt);
    }
    if (a.lastOpenedAt) return -1;
    if (b.lastOpenedAt) return 1;
    return 0;
  });
  return entries.slice(0, RECENT_TYPES_CAP);
}

app.get('/recent-types', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) return dbUnavailable(c);
  const parsed = recentTypesQuerySchema.safeParse({
    days: c.req.query('days'),
  });
  if (!parsed.success) {
    return validationError(c, 'Invalid days query', parsed.error.issues);
  }
  const days = parsed.data.days;

  const { state } = await loadState(db, auth.tenantId, auth.userId);
  const types = deriveRecentTypes(state, days);
  return c.json({
    success: true,
    data: { types, windowDays: days, derivedAt: new Date().toISOString() },
  });
});

export const ownerTabsRouter = app;
export default ownerTabsRouter;
