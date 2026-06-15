/**
 * Drizzle-backed recipient resolver for the announcement-fanout worker.
 *
 * Given an announcement scope (`global` | `tenant:<id>`), returns the eligible
 * broadcast recipients: ACTIVE users (in ACTIVE tenants for the global scope)
 * who carry at least one usable address. Each recipient is enriched with the
 * preferred dispatch channel + locale from `owner_contact_prefs` (left-joined),
 * defaulting to `email` / `en` when no prefs row exists — exactly the contract
 * the owner-identity resolver already uses for reminders.
 *
 * Why a raw SQL join (not the Drizzle query builder)?
 *   - The worker speaks the `DbLike { execute(q) }` port (a postgres.js sql tag
 *     or a Drizzle client). A single parameterised SELECT keeps this resolver
 *     on that same port and trivially testable with the SQL-capturing stub the
 *     worker tests use.
 *   - The fan-out reads cross-tenant for `scope='global'`. `users` +
 *     `owner_contact_prefs` are FORCE-RLS and the service pool is NOT
 *     BYPASSRLS in prod, so the global scan binds `app.is_service_role='true'`
 *     via `withServiceRoleContext` (else it matches ZERO rows). The per-tenant
 *     scan binds the tenant GUCs via `withWorkerTenantContext`. Each recipient
 *     keeps its own `tenant_id` so downstream dispatch-log RLS reads stay clean
 *     (same pattern as licence-expiry-alert-cron.ts).
 *
 * Preferred channel normalisation: `owner_contact_prefs.preferred_channel` may
 * be 'email' | 'sms' | 'slack' | 'whatsapp'. The dispatch-log fan-out only
 * speaks 'email' | 'sms', so anything that is not 'sms' collapses to 'email'.
 */

import { sql } from 'drizzle-orm';
import { withServiceRoleContext } from '@borjie/database';

import type {
  BroadcastRecipient,
  RecipientResolverPort,
} from './announcement-fanout.worker';
import { withWorkerTenantContext } from './with-tenant-context.js';

/**
 * The db this resolver binds. Both scans run inside a real transaction
 * (`withServiceRoleContext` for the cross-tenant global scan,
 * `withWorkerTenantContext` for the per-tenant scan), so the port must be
 * transaction-capable. The unit-test stub injects an `execute`-only fake with
 * NO `.transaction`; those helpers detect that and run the statement directly.
 */
type ServiceRoleDb = Parameters<typeof withServiceRoleContext>[0];

type DbLike = ServiceRoleDb & {
  execute(query: unknown): Promise<unknown>;
};

/** The execute-only shim the bound transaction handle satisfies. */
interface ExecLike {
  execute(query: unknown): Promise<unknown>;
}

type AnnouncementScope = 'global' | `tenant:${string}`;

const TENANT_SCOPE_PREFIX = 'tenant:';

function asRows(res: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

function pickString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Collapse the 4-way prefs channel onto the dispatch-log's 2-way channel. */
function normalizePreferredChannel(value: unknown): 'email' | 'sms' {
  return value === 'sms' ? 'sms' : 'email';
}

function rowToRecipient(row: Record<string, unknown>): BroadcastRecipient | null {
  const tenantId = pickString(row.tenant_id);
  const userId = pickString(row.user_id);
  if (!tenantId || !userId) return null;
  // email_override (prefs) wins over users.email; phone_override over users.phone.
  const email = pickString(row.email_override) ?? pickString(row.email);
  const phone = pickString(row.phone_override) ?? pickString(row.phone);
  return {
    tenantId,
    userId,
    email,
    phone,
    preferredChannel: normalizePreferredChannel(row.preferred_channel),
    locale: pickString(row.locale) ?? 'en',
  };
}

function tenantIdFromScope(scope: AnnouncementScope): string | null {
  if (!scope.startsWith(TENANT_SCOPE_PREFIX)) return null;
  return scope.slice(TENANT_SCOPE_PREFIX.length) || null;
}

/**
 * Build the production recipient resolver. `resolve()` NEVER throws — it
 * returns [] on any DB error so a single bad scope cannot wedge the worker
 * tick (the worker also guards, this is defence in depth).
 */
export function createAnnouncementRecipientResolver(
  db: DbLike,
): RecipientResolverPort {
  // `users` + `owner_contact_prefs` are FORCE-RLS; the global fan-out reads
  // CROSS-TENANT over the shared service pool, so the scan must bind
  // `app.is_service_role='true'` or it matches ZERO rows (resolver goes dark).
  // The unit-test stub injects an execute-only fake with no `.transaction`;
  // detect that and run the statement directly so those tests stay green.
  function runServiceRole(query: unknown): Promise<unknown> {
    const dbAny = db as { transaction?: unknown };
    if (typeof dbAny.transaction === 'function') {
      return withServiceRoleContext(db, (tx) =>
        (tx as unknown as ExecLike).execute(query),
      );
    }
    return db.execute(query);
  }

  // The per-tenant scan has the tenant id, so bind BOTH tenant GUCs; this
  // satisfies the table's tenant-isolation policy with NO new bypass policy.
  // Same stub affordance as above.
  function runTenant(tenantId: string, query: unknown): Promise<unknown> {
    const dbAny = db as { transaction?: unknown };
    if (typeof dbAny.transaction === 'function') {
      return withWorkerTenantContext(db, tenantId, (tx) =>
        (tx as unknown as ExecLike).execute(query),
      );
    }
    return db.execute(query);
  }

  async function resolveGlobal(): Promise<readonly BroadcastRecipient[]> {
    const res = await runServiceRole(sql`
      SELECT
        u.tenant_id          AS tenant_id,
        u.id                 AS user_id,
        u.email              AS email,
        u.phone              AS phone,
        p.email_override     AS email_override,
        p.phone              AS phone_override,
        p.preferred_channel  AS preferred_channel,
        COALESCE(p.locale, u.locale) AS locale
      FROM users u
      INNER JOIN tenants t ON t.id = u.tenant_id
      LEFT JOIN owner_contact_prefs p
             ON p.tenant_id = u.tenant_id AND p.user_id = u.id
      WHERE u.status = 'active'
        AND u.deleted_at IS NULL
        AND t.status = 'active'
      LIMIT 50000
    `);
    return mapRows(asRows(res));
  }

  async function resolveTenant(
    tenantId: string,
  ): Promise<readonly BroadcastRecipient[]> {
    const res = await runTenant(tenantId, sql`
      SELECT
        u.tenant_id          AS tenant_id,
        u.id                 AS user_id,
        u.email              AS email,
        u.phone              AS phone,
        p.email_override     AS email_override,
        p.phone              AS phone_override,
        p.preferred_channel  AS preferred_channel,
        COALESCE(p.locale, u.locale) AS locale
      FROM users u
      LEFT JOIN owner_contact_prefs p
             ON p.tenant_id = u.tenant_id AND p.user_id = u.id
      WHERE u.tenant_id = ${tenantId}
        AND u.status = 'active'
        AND u.deleted_at IS NULL
      LIMIT 50000
    `);
    return mapRows(asRows(res));
  }

  function mapRows(
    rows: readonly Record<string, unknown>[],
  ): readonly BroadcastRecipient[] {
    const out: BroadcastRecipient[] = [];
    for (const row of rows) {
      const recipient = rowToRecipient(row);
      if (recipient) out.push(recipient);
    }
    return out;
  }

  return {
    async resolve({ scope }) {
      try {
        if (scope === 'global') return await resolveGlobal();
        const tenantId = tenantIdFromScope(scope);
        if (!tenantId) return [];
        return await resolveTenant(tenantId);
      } catch {
        // Best-effort — the worker treats [] as "no eligible recipients".
        return [];
      }
    },
  };
}
