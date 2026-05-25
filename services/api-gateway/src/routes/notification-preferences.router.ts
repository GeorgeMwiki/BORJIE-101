/**
 * Notification Preferences Router — SCAFFOLDED 8 + NEW 21
 *
 * Authenticated endpoints for a user to read and update their own
 * notification preferences.
 *
 * Mounted by the gateway at /api/v1/me/notification-preferences — so
 * this router registers at `/` only. Do NOT prepend `/v1/me/...` here;
 * the outer mount already provides the prefix.
 *
 *   GET  /                 -> current prefs (full path: /api/v1/me/notification-preferences)
 *   PUT  /                 -> upsert prefs
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../middleware/hono-auth';

import { withSecurityEvents } from '@borjie/observability';
// ---------------------------------------------------------------------------
// Deps — inject the preference service so the gateway doesn't import the
// notifications package directly (keeps service boundaries crisp).
// ---------------------------------------------------------------------------

export interface PreferencesApi {
  getPreferences(userId: string, tenantId: string): unknown;
  upsertPreferences(userId: string, tenantId: string, input: unknown): unknown;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const TIME_HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const UpdatePreferencesSchema = z
  .object({
    channels: z
      .object({
        email: z.boolean().optional(),
        sms: z.boolean().optional(),
        push: z.boolean().optional(),
        whatsapp: z.boolean().optional(),
      })
      .optional(),
    templates: z.record(z.string(), z.boolean()).optional(),
    quietHoursStart: z.string().regex(TIME_HHMM).optional(),
    quietHoursEnd: z.string().regex(TIME_HHMM).optional(),
  })
  .strict()
  .refine(
    (v) =>
      (v.quietHoursStart === undefined) === (v.quietHoursEnd === undefined),
    {
      message: 'quietHoursStart and quietHoursEnd must be provided together',
    }
  );

export type UpdatePreferencesBody = z.infer<typeof UpdatePreferencesSchema>;

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createNotificationPreferencesRouter(api: PreferencesApi): Hono {
  const app = new Hono();

  app.use('*', authMiddleware);

  app.get('/', (c) => {
    const auth = c.get('auth');
    if (!auth) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
    }
    const prefs = api.getPreferences(auth.userId, auth.tenantId);
    return c.json({ data: prefs });
  });

  app.put('/', withSecurityEvents({ action: 'notification-preference.update', resource: 'notification-preference', severity: 'info' }, async (c) => {
    const auth = c.get('auth');
    if (!auth) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { code: 'INVALID_BODY', message: 'Malformed JSON' } }, 400);
    }
    const parsed = UpdatePreferencesSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid preferences payload',
            details: parsed.error.issues,
          },
        },
        400
      );
    }
    const updated = api.upsertPreferences(auth.userId, auth.tenantId, parsed.data);
    return c.json({ data: updated });
  }));

  return app;
}

export const notificationPreferencesSchemas = {
  UpdatePreferencesSchema,
};
