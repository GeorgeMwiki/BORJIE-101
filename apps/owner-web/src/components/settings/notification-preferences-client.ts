/**
 * notification-preferences-client — typed read/write client for the
 * dispatcher-consulted per-recipient preference table.
 *
 * Wires to the gateway's authenticated self endpoint:
 *
 *   GET  /api/v1/me/notification-preferences  -> { data: NotifPrefs }
 *   PUT  /api/v1/me/notification-preferences  -> { data: NotifPrefs }
 *
 * (Contract owner: services/api-gateway/src/routes/notification-preferences.router.ts
 * + the gateway composition in services/api-gateway/src/index.ts, backed by the
 * `notification_preferences` table.)
 *
 * SEMANTICS (must match the dispatcher's `shouldDeliver` gate):
 *   - `channels` is a partial opt-OUT map. A channel is BLOCKED only when its
 *     value is explicitly `false`. Absent / `true` ⇒ delivered.
 *   - `templates` is the same opt-out shape keyed by `template_key`.
 *   - `quietHoursStart` / `quietHoursEnd` are `HH:MM` strings and MUST be sent
 *     together (the PUT schema is `.strict()` and refuses a lone half).
 *
 * The PUT body is validated client-side against the exact zod shape the router
 * enforces so a bad payload surfaces a friendly error instead of a 400.
 */

import { z } from 'zod';

import { getCsrfHeaders } from '@/lib/csrf';

const ENDPOINT = '/api/v1/me/notification-preferences';

// The four channels the gateway's strict schema accepts. `in-app` is NOT part
// of the dispatcher's channel contract (the `.strict()` PUT schema rejects it),
// so the panel does not offer it — surfacing a toggle the backend would 400 on
// would be a lie.
export const NOTIFICATION_CHANNELS = ['email', 'sms', 'push', 'whatsapp'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

// Template keys are an OPEN, free-form `template_key` namespace on the backend —
// there is no closed enum. We curate the high-value owner-facing keys the
// dispatcher actually emits so the toggles are meaningful; any extra keys
// already present in the owner's saved prefs are merged in at render time so a
// previously-muted template stays visible and re-enable-able.
export const CURATED_TEMPLATE_KEYS = [
  'licence.expiry_warning',
  'licence.renewal_status_changed',
  'escalation.manager',
  'invoice.sent',
  'invoice.paid',
  'marketplace.inquiry.create',
] as const;
export type CuratedTemplateKey = (typeof CURATED_TEMPLATE_KEYS)[number];

const TIME_HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

// Mirrors UpdatePreferencesSchema in notification-preferences.router.ts. Kept
// `.strict()` so the panel never sends a field the gateway rejects.
export const putPreferencesSchema = z
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
    { message: 'quietHoursStart and quietHoursEnd must be provided together' },
  );

export type PutPreferencesBody = z.infer<typeof putPreferencesSchema>;

export interface NotifPrefs {
  readonly channels: Readonly<Record<string, boolean>>;
  readonly templates: Readonly<Record<string, boolean>>;
  readonly quietHoursStart: string | null;
  readonly quietHoursEnd: string | null;
}

const NOTIF_PREFS_DEFAULT: NotifPrefs = {
  channels: {},
  templates: {},
  quietHoursStart: null,
  quietHoursEnd: null,
};

// Tolerant parse of the GET/PUT envelope — the gateway returns `{ data: {...} }`.
const envelopeSchema = z.object({
  data: z
    .object({
      channels: z.record(z.string(), z.boolean()).nullish(),
      templates: z.record(z.string(), z.boolean()).nullish(),
      quietHoursStart: z.string().nullish(),
      quietHoursEnd: z.string().nullish(),
    })
    .nullish(),
});

function normalize(raw: unknown): NotifPrefs {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.data) return NOTIF_PREFS_DEFAULT;
  const d = parsed.data.data;
  return {
    channels: d.channels ?? {},
    templates: d.templates ?? {},
    quietHoursStart: d.quietHoursStart ?? null,
    quietHoursEnd: d.quietHoursEnd ?? null,
  };
}

async function readErrorMessage(res: Response): Promise<string> {
  const json = (await res.json().catch(() => null)) as
    | { error?: { message?: string } }
    | null;
  return json?.error?.message || `HTTP ${res.status}`;
}

/**
 * Fetch the owner's current notification preferences.
 * @throws Error with a friendly message on a non-2xx response or network error.
 */
export async function fetchNotificationPreferences(): Promise<NotifPrefs> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, { credentials: 'include' });
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Network error');
  }
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  return normalize(await res.json().catch(() => null));
}

/**
 * Persist a preferences patch. The body is validated against the router's
 * strict schema before the request leaves the browser.
 * @throws Error with a friendly message on validation, non-2xx, or network failure.
 */
export async function saveNotificationPreferences(
  body: PutPreferencesBody,
): Promise<NotifPrefs> {
  const parsed = putPreferencesSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join('; '));
  }
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
      body: JSON.stringify(parsed.data),
    });
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Network error');
  }
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  return normalize(await res.json().catch(() => null));
}

/**
 * Resolve the ordered, de-duplicated set of template keys to render: the
 * curated owner-facing set first, then any extra keys already present in the
 * saved prefs (so a previously-muted template stays visible).
 */
export function resolveTemplateKeys(
  saved: Readonly<Record<string, boolean>>,
): ReadonlyArray<string> {
  const extras = Object.keys(saved).filter(
    (k) => !(CURATED_TEMPLATE_KEYS as ReadonlyArray<string>).includes(k),
  );
  return [...CURATED_TEMPLATE_KEYS, ...extras.sort()];
}

/**
 * Opt-out read: a channel/template is enabled unless explicitly `false`.
 */
export function isEnabled(
  map: Readonly<Record<string, boolean>>,
  key: string,
): boolean {
  return map[key] !== false;
}
