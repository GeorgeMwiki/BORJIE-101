/**
 * /api/v1/owner/contact-prefs — owner contact-preference write path.
 *
 * Wave OWNER-CONTACT-RESOLVER (K5). Closes the audit gap where
 * `owner_contact_prefs` carried a single frozen `preferred_channel` and NO
 * owner write path — the owner could never set HOW they want to be reached.
 *
 * The owner now expresses an ORDERED `channelPriority` ranking (highest-priority
 * first). The reminders-dispatch worker + the chat action-executor
 * (`services/api-gateway/src/services/action-executor/handlers/reminders.ts`)
 * walk that list and pick the FIRST channel with a resolvable destination, so
 * the owner's stated intent drives delivery. The legacy `preferred_channel`
 * column is kept for back-compat and is derived from the head of the list.
 *
 * Routes:
 *   GET  /   read the caller's prefs (or sensible defaults when no row exists)
 *   PUT  /   upsert the caller's prefs on (tenant_id, user_id)
 *
 * Auth: Supabase JWT via `authMiddleware`. Tenant scope bound by
 *       `databaseMiddleware`'s GUC for RLS. Identity (tenant + user) is taken
 *       from `c.get('auth')` ONLY — the body is NEVER trusted for identity.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';

import {
  ownerContactPrefs,
  OWNER_CONTACT_CHANNELS,
} from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('owner-contact-prefs');

// English default per CLAUDE.md "English default · bilingual sw/en".
const DEFAULT_LOCALE = 'en' as const;
const DEFAULT_TIMEZONE = 'Africa/Dar_es_Salaam';
const DEFAULT_PREFERRED_CHANNEL = 'email' as const;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const channelEnum = z.enum(OWNER_CONTACT_CHANNELS);

const putSchema = z
  .object({
    /**
     * ORDERED list of channels, highest-priority first. Max 4 (one per
     * channel), unique — a channel may not appear twice. May be empty (the
     * owner clears their ranking and falls back to deliverable order).
     */
    channelPriority: z
      .array(channelEnum)
      .max(OWNER_CONTACT_CHANNELS.length)
      .refine(
        (list) => new Set(list).size === list.length,
        { message: 'channelPriority entries must be unique' },
      ),
    emailOverride: z.string().email().max(320).optional(),
    phone: z.string().trim().min(1).max(32).optional(),
    slackHandle: z.string().trim().min(1).max(80).optional(),
    locale: z.enum(['sw', 'en']).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// ---------------------------------------------------------------------------
// GET / — read current prefs (or sensible defaults)
// ---------------------------------------------------------------------------

app.get('/', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) {
    return c.json(
      {
        success: false,
        error: {
          code: 'CONTACT_PREFS_DB_UNAVAILABLE',
          message: 'Database not configured',
        },
      },
      503,
    );
  }

  const rows = await db
    .select()
    .from(ownerContactPrefs)
    .where(
      and(
        eq(ownerContactPrefs.tenantId, auth.tenantId),
        eq(ownerContactPrefs.userId, auth.userId),
      ),
    )
    .limit(1);

  const row = rows[0] ?? null;
  if (!row) {
    return c.json({
      success: true,
      data: {
        prefs: {
          tenantId: auth.tenantId,
          userId: auth.userId,
          channelPriority: [] as ReadonlyArray<
            (typeof OWNER_CONTACT_CHANNELS)[number]
          >,
          preferredChannel: DEFAULT_PREFERRED_CHANNEL,
          emailOverride: null,
          phone: null,
          slackHandle: null,
          locale: DEFAULT_LOCALE,
          timezone: DEFAULT_TIMEZONE,
        },
        isDefault: true,
      },
    });
  }

  return c.json({ success: true, data: { prefs: row, isDefault: false } });
});

// ---------------------------------------------------------------------------
// PUT / — upsert prefs on (tenant_id, user_id)
// ---------------------------------------------------------------------------

app.put('/', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };

  // Validate the body FIRST — a malformed request is a 400 regardless of DB
  // state (validation is a pure check that does not need the database).
  const parsed = putSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid contact-prefs payload',
          issues: parsed.error.issues,
        },
      },
      400,
    );
  }
  const input = parsed.data;

  const db = c.get('db');
  if (!db) {
    return c.json(
      {
        success: false,
        error: {
          code: 'CONTACT_PREFS_DB_UNAVAILABLE',
          message: 'Database not configured',
        },
      },
      503,
    );
  }

  // Keep `preferred_channel` consistent for back-compat: it is the head of the
  // owner's ranking, or the existing default when the list is empty.
  const preferredChannel =
    input.channelPriority[0] ?? DEFAULT_PREFERRED_CHANNEL;

  // Identity ALWAYS comes from the authenticated principal — never the body.
  const values = {
    tenantId: auth.tenantId,
    userId: auth.userId,
    channelPriority: input.channelPriority,
    preferredChannel,
    emailOverride: input.emailOverride ?? null,
    phone: input.phone ?? null,
    slackHandle: input.slackHandle ?? null,
    locale: input.locale ?? DEFAULT_LOCALE,
    timezone: input.timezone ?? DEFAULT_TIMEZONE,
  };

  try {
    const [row] = await db
      .insert(ownerContactPrefs)
      .values(values)
      .onConflictDoUpdate({
        target: [ownerContactPrefs.tenantId, ownerContactPrefs.userId],
        set: {
          channelPriority: values.channelPriority,
          preferredChannel: values.preferredChannel,
          emailOverride: values.emailOverride,
          phone: values.phone,
          slackHandle: values.slackHandle,
          locale: values.locale,
          timezone: values.timezone,
          updatedAt: new Date(),
        },
      })
      .returning();

    moduleLogger.info('owner-contact-prefs: upserted', {
      tenantId: auth.tenantId,
      userId: auth.userId,
      channelPriority: values.channelPriority,
      preferredChannel,
    });

    return c.json({ success: true, data: { prefs: row } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    moduleLogger.error('owner-contact-prefs: upsert failed', {
      tenantId: auth.tenantId,
      error: message,
    });
    return c.json(
      {
        success: false,
        error: { code: 'CONTACT_PREFS_UPSERT_FAILED', message },
      },
      500,
    );
  }
});

export const ownerContactPrefsRouter = app;
export default ownerContactPrefsRouter;
