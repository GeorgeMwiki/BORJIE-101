/**
 * Person-context middleware.
 *
 * Wave-UPKB companion to migration 0088 (`persons` + `person_links` +
 * `personal_memory_cells`) and `Docs/research/unified-personal-kb.md`
 * §10.4. Runs AFTER `authMiddleware` + `tenantContextMiddleware` and
 * BEFORE any handler that queries the brain's recall path. Its sole
 * job:
 *
 *   1. Look up `person_links` for (supabase_user_id, tenant_id).
 *   2. If found, fetch the `persons` row.
 *   3. If `persons.consent_unified_kb_at` is non-null AND
 *      `persons.consent_unified_kb_revoked_at` is null, set:
 *        • `c.set('personId', personId)` so the brain reads it cheaply
 *        • `SET LOCAL app.current_person_id = ...` so any future RLS
 *          policy bound to that GUC can fire (parity with the existing
 *          `app.current_tenant_id` posture).
 *   4. Otherwise (no link, no consent, or revoked) — do NOT set
 *      `personId`. The brain falls back to tenant-only recall.
 *
 * The middleware is FAIL-OPEN-WITHOUT-ENABLEMENT: any DB error, any
 * absent row, any revocation results in the personLayer being
 * disabled for this request. Per CLAUDE.md "kill-switch fail-closed"
 * is about HIGH-risk policy — this middleware is purely additive
 * permission gating for an enrichment layer, so its failure mode is
 * "degraded mode banner" not "request denial".
 *
 * No raw console statements — pino via the shared logger.
 */

// @ts-nocheck — same Hono v4 status-literal limitation tracked at
// hono-dev/hono#3891 as the sibling tenant-context middleware. The
// middleware emits no JSON responses, so the typed-response union
// never narrows; this pragma is precautionary against the same
// composition-root drift the other middlewares carry.

import { createMiddleware } from 'hono/factory';
import { sql } from 'drizzle-orm';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types — kept structural so this file does not pull schema types from
// `@borjie/database` (would create the same TS2709 namespace-vs-type drift
// the database.ts middleware works around with @ts-nocheck).
// ============================================================================

export interface PersonContext {
  /** persons.id — UUID. */
  readonly id: string;
  /** persons.preferred_language — 'sw' or 'en'. */
  readonly preferredLanguage: string;
  /** ISO timestamp the consent was granted. */
  readonly consentUnifiedKbAt: string;
  /** Set on un-link; presence means the federation is OFF. */
  readonly consentUnifiedKbRevokedAt: string | null;
}

/** Minimal driver surface we need; supports postgres.js + node-postgres. */
interface PersonContextDb {
  execute(query: unknown): Promise<unknown>;
}

interface AuthLike {
  readonly userId?: string;
}

interface TenantLike {
  readonly id?: string;
}

// ============================================================================
// Row coercion helpers — drivers return slightly different shapes.
// ============================================================================

function extractRows(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as ReadonlyArray<Record<string, unknown>>;
  }
  if (result && typeof result === 'object') {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) {
      return rows as ReadonlyArray<Record<string, unknown>>;
    }
  }
  return [];
}

function pickString(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

function pickTimestamp(
  row: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const k of keys) {
    const v = row[k];
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

// ============================================================================
// Person resolution
// ============================================================================

interface ResolvePersonArgs {
  readonly db: PersonContextDb;
  readonly supabaseUserId: string;
  readonly tenantId: string;
}

/**
 * Single round-trip resolver: JOIN person_links to persons, filter by
 * (supabase_user_id, tenant_id, not unlinked). Returns the consent-
 * gated person context or `null` when:
 *   - no row matches
 *   - the link is unlinked (`unlinked_at` is not null)
 *   - the user never granted unified-kb consent
 *   - the user revoked consent
 *   - any query error fires (logged, swallowed)
 *   - the tables don't exist yet (pre-migration 0088)
 */
export async function resolvePersonContext(
  args: ResolvePersonArgs,
): Promise<PersonContext | null> {
  try {
    const result = await args.db.execute(sql`
      SELECT
        p.id AS person_id,
        p.preferred_language,
        p.consent_unified_kb_at,
        p.consent_unified_kb_revoked_at
      FROM person_links pl
      JOIN persons p ON p.id = pl.person_id
      WHERE pl.supabase_user_id = ${args.supabaseUserId}::uuid
        AND pl.tenant_id = ${args.tenantId}::uuid
        AND pl.unlinked_at IS NULL
        AND p.consent_unified_kb_at IS NOT NULL
        AND p.consent_unified_kb_revoked_at IS NULL
      LIMIT 1
    `);
    const rows = extractRows(result);
    if (rows.length === 0) return null;
    const row = rows[0];
    if (!row) return null;
    const id = pickString(row, 'person_id', 'personId');
    const language = pickString(
      row,
      'preferred_language',
      'preferredLanguage',
    );
    const grantedAt = pickTimestamp(
      row,
      'consent_unified_kb_at',
      'consentUnifiedKbAt',
    );
    if (!id || !grantedAt) return null;
    return Object.freeze({
      id,
      preferredLanguage: language ?? 'sw',
      consentUnifiedKbAt: grantedAt,
      consentUnifiedKbRevokedAt: pickTimestamp(
        row,
        'consent_unified_kb_revoked_at',
        'consentUnifiedKbRevokedAt',
      ),
    });
  } catch (error) {
    logger.warn(
      'person-context: resolution failed; person-layer disabled for this request',
      {
        err: error instanceof Error ? error.message : String(error),
        supabaseUserId: args.supabaseUserId,
        tenantId: args.tenantId,
      },
    );
    return null;
  }
}

// ============================================================================
// GUC binding — mirrors database.ts pattern
// ============================================================================

async function bindPersonGuc(
  db: PersonContextDb,
  personId: string,
): Promise<boolean> {
  try {
    await db.execute(
      sql`SELECT set_config('app.current_person_id', ${personId}, false)`,
    );
    return true;
  } catch (error) {
    logger.warn(
      'person-context: failed to bind app.current_person_id GUC',
      {
        err: error instanceof Error ? error.message : String(error),
        personId,
      },
    );
    return false;
  }
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Wires `personId` + `personContext` into the Hono context when, and
 * only when, the user has affirmatively consented to the unified KB
 * for this tenant. Pure additive — when no consent / link is found,
 * NOTHING is set and downstream handlers see the existing behaviour.
 *
 * Order requirement: MUST run after `authMiddleware` and
 * `tenantContextMiddleware`. Order is enforced by the composition
 * root in `services/api-gateway/src/index.ts`.
 */
export const personContextMiddleware = createMiddleware(async (c, next) => {
  const auth = c.get('auth') as AuthLike | undefined;
  const tenant = c.get('tenant') as TenantLike | undefined;

  if (!auth?.userId || !tenant?.id) {
    // No auth / tenant — middleware order violation or unauth
    // endpoint. Personal layer requires both. Skip silently.
    await next();
    return;
  }

  const db = c.get('db') as PersonContextDb | undefined | null;
  if (!db) {
    // Mock-mode request — no DB to query. Skip silently.
    await next();
    return;
  }

  const person = await resolvePersonContext({
    db,
    supabaseUserId: auth.userId,
    tenantId: tenant.id,
  });

  if (!person) {
    // No link / no consent / revoked. Personal layer disabled.
    await next();
    return;
  }

  const bound = await bindPersonGuc(db, person.id);
  if (!bound) {
    // GUC failed — fail-open without enablement: the brain falls
    // back to tenant-only recall. We do NOT set personId / personContext
    // so downstream queries cannot accidentally read federated data
    // without the GUC set.
    await next();
    return;
  }

  c.set('personId', person.id);
  c.set('personContext', person);
  c.header('X-Person-Layer', 'on');

  await next();
});

// ============================================================================
// Hono context map extension
// ============================================================================

declare module 'hono' {
  interface ContextVariableMap {
    personId: string;
    personContext: PersonContext;
  }
}
