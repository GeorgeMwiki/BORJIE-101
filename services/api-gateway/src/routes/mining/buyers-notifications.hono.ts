/**
 * /api/v1/mining/buyers/profile/notifications — buyer notification prefs.
 *
 * Closes findings `buyer-mobile-4` (Save POSTed to a non-existent endpoint —
 * prefs never persisted) and `buyer-mobile-11` (screen had no GET to hydrate
 * saved prefs). The buyer-mobile Profile → Notifications screen now round-trips:
 *   GET  /   → load the saved prefs (or sensible defaults on first open)
 *   PUT  /   → persist the prefs and return the saved shape
 *
 * NO NEW TABLE — prefs live in `buyers.attributes.notificationPrefs` (JSONB),
 * exactly mirroring the existing PATCH /profile path that persists
 * `preferredLang` into the same `attributes` column. The four booleans the
 * buyer-mobile screen sends (newListings / bidUpdates / documentReady /
 * priceAlerts) are the core contract; the schema also tolerates optional
 * `channels` + `quietHours` so the surface stays generative for future prefs
 * without a migration.
 *
 * TENANT SCOPE: resolves the `buyers` row via (auth.tenantId,
 * buyers.linked_user_id) — identity comes from the JWT, NEVER the body. RLS
 * FORCE on `app.current_tenant_id` isolates tenants; the handler also
 * predicates on auth.tenantId. Immutable update: `attributes` is rebuilt, never
 * mutated in place.
 */

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { buyers } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('mining-buyers-notifications');

const TIME_HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const NotificationPrefsSchema = z
  .object({
    newListings: z.boolean(),
    bidUpdates: z.boolean(),
    documentReady: z.boolean(),
    priceAlerts: z.boolean(),
    // Optional, generative extensions — persisted when present.
    channels: z
      .object({
        email: z.boolean().optional(),
        sms: z.boolean().optional(),
        push: z.boolean().optional(),
        whatsapp: z.boolean().optional(),
      })
      .strict()
      .optional(),
    quietHoursStart: z.string().regex(TIME_HHMM).nullable().optional(),
    quietHoursEnd: z.string().regex(TIME_HHMM).nullable().optional(),
  })
  .strict()
  .refine(
    (v) =>
      (v.quietHoursStart === undefined || v.quietHoursStart === null) ===
      (v.quietHoursEnd === undefined || v.quietHoursEnd === null),
    { message: 'quietHoursStart and quietHoursEnd must be set together' },
  );

type NotificationPrefs = z.infer<typeof NotificationPrefsSchema>;

// Defaults match the buyer-mobile screen's `initialState()` so a first GET
// (before any save) hydrates the toggles identically to the client default.
const DEFAULT_PREFS: NotificationPrefs = Object.freeze({
  newListings: true,
  bidUpdates: true,
  documentReady: true,
  priceAlerts: false,
});

function readSavedPrefs(attributes: unknown): NotificationPrefs {
  const attrs = (attributes ?? {}) as Record<string, unknown>;
  const saved = attrs.notificationPrefs;
  const parsed = NotificationPrefsSchema.safeParse(saved);
  return parsed.success ? parsed.data : DEFAULT_PREFS;
}

function jsonError(
  code: string,
  message: string,
  status: 400 | 401 | 403 | 404 | 500 | 503,
) {
  return { status, body: { success: false as const, error: { code, message } } };
}

export function createMiningBuyersNotificationsRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);

  // GET / — hydrate saved prefs (or defaults).
  app.get('/', async (c: any) => {
    const { tenantId, userId } = c.get('auth') ?? {};
    if (!tenantId || !userId) {
      const err = jsonError('UNAUTHORIZED', 'Authentication required', 401);
      return c.json(err.body, err.status);
    }
    const db = c.get('db');
    if (!db) {
      const err = jsonError(
        'NOTIFICATIONS_UNAVAILABLE',
        'database is not configured on this gateway',
        503,
      );
      return c.json(err.body, err.status);
    }

    try {
      const [buyer] = await db
        .select({ attributes: buyers.attributes })
        .from(buyers)
        .where(
          and(eq(buyers.tenantId, tenantId), eq(buyers.linkedUserId, userId)),
        )
        .limit(1);
      // No KYC'd buyer row yet → return defaults so the screen still renders.
      const prefs = buyer ? readSavedPrefs(buyer.attributes) : DEFAULT_PREFS;
      return c.json({ data: prefs }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'read failed';
      moduleLogger.error('buyer notification prefs read failed', {
        evt: 'buyer_notif_prefs_read_failed',
        tenantId,
        reason: message,
      });
      const e = jsonError(
        'NOTIFICATIONS_READ_FAILED',
        'Failed to load preferences',
        500,
      );
      return c.json(e.body, e.status);
    }
  });

  // PUT / (and POST / for the buyer-mobile client, which posts) — persist
  // prefs into buyers.attributes.notificationPrefs. Both verbs share one
  // handler so the live FE (POST) and the REST-idiomatic PUT both resolve.
  const upsertHandler = async (c: any) => {
    const { tenantId, userId } = c.get('auth') ?? {};
    if (!tenantId || !userId) {
      const err = jsonError('UNAUTHORIZED', 'Authentication required', 401);
      return c.json(err.body, err.status);
    }

    const parsed = NotificationPrefsSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.issues
              .map((i) => `${i.path.join('.')}: ${i.message}`)
              .join('; '),
          },
        },
        400,
      );
    }

    const db = c.get('db');
    if (!db) {
      const err = jsonError(
        'NOTIFICATIONS_UNAVAILABLE',
        'database is not configured on this gateway',
        503,
      );
      return c.json(err.body, err.status);
    }

    try {
      const [existing] = await db
        .select()
        .from(buyers)
        .where(
          and(eq(buyers.tenantId, tenantId), eq(buyers.linkedUserId, userId)),
        )
        .limit(1);
      if (!existing) {
        const err = jsonError(
          'NO_KYC_ON_FILE',
          'Submit KYC at /api/v1/mining/buyers/kyc first',
          404,
        );
        return c.json(err.body, err.status);
      }

      // Immutability — rebuild attributes; never mutate the prior object.
      const priorAttributes =
        (existing.attributes as Record<string, unknown>) ?? {};
      const nextAttributes = {
        ...priorAttributes,
        notificationPrefs: parsed.data,
      };
      const [updated] = await db
        .update(buyers)
        .set({ attributes: nextAttributes })
        .where(and(eq(buyers.id, existing.id), eq(buyers.tenantId, tenantId)))
        .returning();

      const saved = readSavedPrefs((updated ?? existing).attributes);
      return c.json({ data: saved }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'save failed';
      moduleLogger.error('buyer notification prefs save failed', {
        evt: 'buyer_notif_prefs_save_failed',
        tenantId,
        reason: message,
      });
      const e = jsonError(
        'NOTIFICATIONS_SAVE_FAILED',
        'Failed to save preferences',
        500,
      );
      return c.json(e.body, e.status);
    }
  };
  app.put('/', upsertHandler);
  app.post('/', upsertHandler);

  return app;
}

export const miningBuyersNotificationsRouter =
  createMiningBuyersNotificationsRouter();
