/**
 * /api/v1/owner/tabs — owner-cockpit dynamic tab persistence.
 *
 * Wave OWNER-OS. The owner can spawn / pin / reorder / close tabs in
 * the cockpit home (Chat / Docs / Drafts / Reminders / Insights /
 * "Geita PML" / ...). The FE owns the schema of the `state` jsonb
 * document; this surface is a tiny per-user key-value store that
 * survives a sign-out + sign-in.
 *
 * Routes:
 *   GET /              — load the current user's tab state. Returns the
 *                        default single-tab layout when the row does not
 *                        exist yet.
 *
 *   PUT /              — replace the current user's tab state. Body is
 *                        whatever jsonb shape the FE store wants; capped
 *                        at 64 KB to keep accidental blobs out of the table.
 *
 *   GET /recent-types  — Wave OWNER-OS-DYNAMIC Phase 2. Returns the set of
 *                        tab-type ids the owner has spawned within the
 *                        last N days (default 30), ordered by recency.
 *                        Derived from `state.tabs[].lastOpenedAt`. Used
 *                        by the "+ Tab" dropdown to show ONLY recently-
 *                        used types by default (instead of the full
 *                        14-tab registry). The full registry remains
 *                        accessible via "Show all".
 *
 * Auth: Supabase JWT via `authMiddleware`. Tenant scope bound by
 *       `databaseMiddleware`'s `app.tenant_id` GUC for RLS.
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

const DEFAULT_STATE: { tabs: ReadonlyArray<unknown>; activeTabId: string | null } = {
  tabs: [],
  activeTabId: null,
};

const putSchema = z.object({
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

app.get('/', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'OWNER_TABS_DB_UNAVAILABLE', message: 'Database not configured' } },
      503,
    );
  }

  const [row] = await db
    .select()
    .from(ownerTabs)
    .where(
      and(eq(ownerTabs.tenantId, auth.tenantId), eq(ownerTabs.userId, auth.userId)),
    )
    .limit(1);

  if (!row) {
    return c.json(
      {
        success: true,
        data: { state: DEFAULT_STATE, updatedAt: null, hydratedFromDefault: true },
      },
      200,
    );
  }
  return c.json({
    success: true,
    data: { state: row.state, updatedAt: row.updatedAt, hydratedFromDefault: false },
  });
});

app.put('/', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'OWNER_TABS_DB_UNAVAILABLE', message: 'Database not configured' } },
      503,
    );
  }

  const raw = await c.req.json().catch(() => null);
  const parsed = putSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid tabs payload', issues: parsed.error.issues } },
      400,
    );
  }

  const stateJson = parsed.data.state;
  const now = new Date();
  // Upsert by composite PK (tenant_id, user_id). The DEFAULT for `state`
  // is overridden by the supplied jsonb document; updatedAt is bumped on
  // every save so the FE can sort tab history conservatively.
  await db.execute(
    sql`
      INSERT INTO owner_tabs (tenant_id, user_id, state, updated_at)
      VALUES (${auth.tenantId}, ${auth.userId}, ${JSON.stringify(stateJson)}::jsonb, ${now})
      ON CONFLICT (tenant_id, user_id)
      DO UPDATE SET state = EXCLUDED.state, updated_at = EXCLUDED.updated_at
    `,
  );

  moduleLogger.info('owner-tabs: state saved', {
    tenantId: auth.tenantId,
    userId: auth.userId,
    bytes: JSON.stringify(stateJson).length,
  });

  return c.json({ success: true, data: { state: stateJson, updatedAt: now } });
});

// ---------------------------------------------------------------------------
// GET /recent-types — Wave OWNER-OS-DYNAMIC Phase 2.
//
// The "+ Tab" dropdown defaults to showing ONLY the tab types the owner
// has spawned at least once in the last N days (default 30), ordered by
// most-recent first. The full 14-tab registry is shown only behind the
// "Show all" affordance.
//
// We DERIVE the type list from the owner's CURRENT state.tabs[] jsonb
// blob — for every tab whose `lastOpenedAt` falls within the window, we
// emit a `{ type, lastOpenedAt }` entry. Tabs without `lastOpenedAt`
// (legacy state pre-Phase 2) are still emitted at the back so the menu
// is never empty when the owner has tabs open.
//
// The brain's full awareness of all 14 types is INTENTIONALLY unaffected
// by this filter — see brain-teach prompt extension. The brain can still
// suggest any of the 14 types based on conversation; this endpoint
// only narrows the manual "+ Tab" affordance to recently-used.
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
  if (!db) {
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
  const parsed = recentTypesQuerySchema.safeParse({
    days: c.req.query('days'),
  });
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid days query',
          issues: parsed.error.issues,
        },
      },
      400,
    );
  }
  const days = parsed.data.days;

  const [row] = await db
    .select()
    .from(ownerTabs)
    .where(
      and(eq(ownerTabs.tenantId, auth.tenantId), eq(ownerTabs.userId, auth.userId)),
    )
    .limit(1);

  const types = row ? deriveRecentTypes(row.state, days) : [];
  return c.json({
    success: true,
    data: { types, windowDays: days, derivedAt: new Date().toISOString() },
  });
});

export const ownerTabsRouter = app;
export default ownerTabsRouter;
