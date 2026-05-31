/**
 * Owner Identity Resolver — Wave OWNER-CONTACT-RESOLVER.
 *
 * Given `(tenantId, ownerId)` returns a `ResolvedOwnerContact` shape
 * carrying every channel the reminders dispatcher and daily-brief
 * cron can use to reach the owner:
 *
 *   - email           — from `owner_contact_prefs.email_override` or
 *                       falling back to `users.email`.
 *   - phone           — E.164 from `owner_contact_prefs.phone`
 *                       falling back to `users.phone`.
 *   - slackHandle     — `@handle` from `owner_contact_prefs.slack_handle`.
 *   - preferredChannel — owner-chosen default channel for ambiguous
 *                        reminders.
 *   - locale / timezone — UI + dispatch locale + tz.
 *
 * Replaces the `BORJIE_OWNER_FALLBACK_EMAIL` env-var crutch the
 * reminders worker used to depend on. The dispatcher now calls this
 * resolver per row; cold-cache misses go to the DB once per owner per
 * tenant and are then memoised inside the dispatcher's tick.
 *
 * No mock data. If neither the prefs row nor the user row exists, we
 * return `null` per channel so the dispatcher can decide whether to
 * mark the reminder failed or fall back to a different channel.
 *
 * Tenant-bound through the canonical `app.tenant_id` GUC so RLS
 * filters every read.
 */

import { and, eq } from 'drizzle-orm';
import {
  ownerContactPrefs,
  users,
} from '@borjie/database';

// Re-declared locally — the `@borjie/database` exports surface these
// as `type` but the workspace resolver currently misreads them as
// namespaces (the schema source file is consumed via the package's
// `exports."."` types path while the .js sibling lacks the same
// declaration). Mirror the literal-union shape here so the resolver
// stays type-safe without depending on the upstream barrel.
type OwnerContactChannel = 'email' | 'sms' | 'slack' | 'whatsapp';
type OwnerContactLocale = 'sw' | 'en';

export interface ResolvedOwnerContact {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly slackHandle: string | null;
  readonly preferredChannel: OwnerContactChannel;
  readonly locale: OwnerContactLocale;
  readonly timezone: string;
  readonly hasContactPrefRow: boolean;
}

export interface OwnerIdentityResolverDb {
  select(projection?: unknown): {
    from(table: unknown): {
      where(filter: unknown): {
        limit(n: number): Promise<ReadonlyArray<Record<string, unknown>>>;
      };
    };
  };
}

const DEFAULT_PREFERRED_CHANNEL: OwnerContactChannel = 'email';
// English default per CLAUDE.md "English default · bilingual sw/en"
// (flipped 2026-05 from `sw`). Owners can switch to Swahili from
// the settings panel; toggle is absolute.
const DEFAULT_LOCALE: OwnerContactLocale = 'en';
const DEFAULT_TIMEZONE = 'Africa/Dar_es_Salaam';

function emptyResult(
  tenantId: string,
  ownerId: string,
): ResolvedOwnerContact {
  return {
    tenantId,
    ownerId,
    email: null,
    phone: null,
    slackHandle: null,
    preferredChannel: DEFAULT_PREFERRED_CHANNEL,
    locale: DEFAULT_LOCALE,
    timezone: DEFAULT_TIMEZONE,
    hasContactPrefRow: false,
  };
}

function pickString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pickChannel(value: unknown): OwnerContactChannel | null {
  if (typeof value !== 'string') return null;
  if (
    value === 'email' ||
    value === 'sms' ||
    value === 'slack' ||
    value === 'whatsapp'
  ) {
    return value;
  }
  return null;
}

function pickLocale(value: unknown): OwnerContactLocale | null {
  if (value === 'sw' || value === 'en') return value;
  return null;
}

/**
 * Resolve a single owner's contact preferences. Returns a fully
 * populated `ResolvedOwnerContact` even when the prefs row is missing
 * (falls back to the `users` row + sensible defaults). NEVER throws on
 * a missing row — callers want a deterministic shape.
 */
export async function resolveOwnerContact(
  db: OwnerIdentityResolverDb,
  args: { readonly tenantId: string; readonly ownerId: string },
): Promise<ResolvedOwnerContact> {
  const { tenantId, ownerId } = args;
  if (!tenantId || !ownerId) {
    return emptyResult(tenantId, ownerId);
  }

  // Read both rows in parallel — RLS enforces tenant scoping on both
  // tables, so the WHERE-by-id is defence in depth.
  const [prefRows, userRows] = await Promise.all([
    db
      .select()
      .from(ownerContactPrefs)
      .where(
        and(
          eq(ownerContactPrefs.tenantId, tenantId),
          eq(ownerContactPrefs.userId, ownerId),
        ),
      )
      .limit(1)
      .catch(() => [] as ReadonlyArray<Record<string, unknown>>),
    db
      .select()
      .from(users)
      .where(
        and(eq(users.tenantId, tenantId), eq(users.id, ownerId)),
      )
      .limit(1)
      .catch(() => [] as ReadonlyArray<Record<string, unknown>>),
  ]);

  const prefRow = prefRows[0] ?? null;
  const userRow = userRows[0] ?? null;

  const emailOverride = prefRow ? pickString(prefRow.emailOverride) : null;
  const userEmail = userRow ? pickString(userRow.email) : null;
  const email = emailOverride ?? userEmail;

  const phonePref = prefRow ? pickString(prefRow.phone) : null;
  const userPhone = userRow ? pickString(userRow.phone) : null;
  const phone = phonePref ?? userPhone;

  const slackHandle = prefRow ? pickString(prefRow.slackHandle) : null;

  const preferredChannel =
    (prefRow ? pickChannel(prefRow.preferredChannel) : null) ??
    DEFAULT_PREFERRED_CHANNEL;

  const locale =
    (prefRow ? pickLocale(prefRow.locale) : null) ??
    (userRow ? pickLocale(userRow.preferredLang) : null) ??
    DEFAULT_LOCALE;

  const timezone =
    (prefRow ? pickString(prefRow.timezone) : null) ??
    (userRow ? pickString(userRow.timezone) : null) ??
    DEFAULT_TIMEZONE;

  return {
    tenantId,
    ownerId,
    email,
    phone,
    slackHandle,
    preferredChannel,
    locale,
    timezone,
    hasContactPrefRow: prefRow != null,
  };
}

/**
 * Convenience wrapper used by the reminders dispatch worker: returns
 * just the email or null. Memoises through the existing resolver so
 * worker tick boundaries do not double-pay the DB round-trip.
 */
export function makeEmailForOwner(
  db: OwnerIdentityResolverDb,
): (tenantId: string, ownerId: string) => Promise<string | null> {
  const cache = new Map<string, string | null>();
  return async (tenantId, ownerId) => {
    const key = `${tenantId}:${ownerId}`;
    if (cache.has(key)) return cache.get(key) ?? null;
    const resolved = await resolveOwnerContact(db, { tenantId, ownerId });
    cache.set(key, resolved.email);
    return resolved.email;
  };
}

/** Same shape for the SMS phone resolver. */
export function makePhoneForOwner(
  db: OwnerIdentityResolverDb,
): (tenantId: string, ownerId: string) => Promise<string | null> {
  const cache = new Map<string, string | null>();
  return async (tenantId, ownerId) => {
    const key = `${tenantId}:${ownerId}`;
    if (cache.has(key)) return cache.get(key) ?? null;
    const resolved = await resolveOwnerContact(db, { tenantId, ownerId });
    cache.set(key, resolved.phone);
    return resolved.phone;
  };
}

/** Resolver returning the Slack handle for an owner — null if unset. */
export function makeSlackHandleForOwner(
  db: OwnerIdentityResolverDb,
): (tenantId: string, ownerId: string) => Promise<string | null> {
  const cache = new Map<string, string | null>();
  return async (tenantId, ownerId) => {
    const key = `${tenantId}:${ownerId}`;
    if (cache.has(key)) return cache.get(key) ?? null;
    const resolved = await resolveOwnerContact(db, { tenantId, ownerId });
    cache.set(key, resolved.slackHandle);
    return resolved.slackHandle;
  };
}
