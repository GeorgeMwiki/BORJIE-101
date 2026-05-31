/**
 * /api/v1/me/persons/links + /api/v1/brain/personal-kb/search — Roadmap R8.
 *
 * Owner-web UI surfaces for the unified personal-KB. Three endpoints:
 *
 *   GET  /me/persons/links            — list this user's person-links
 *                                       (all "hats" the human wears)
 *   GET  /me/persons/:personId/cells  — list the person's memory cells
 *                                       (preferences, context, recurring
 *                                       facts, calibration, sentiment)
 *   GET  /brain/personal-kb/search    — full-text search across the
 *                                       caller's personal memory cells
 *
 * Tenant boundary: links + cells are person-scoped, not tenant-scoped
 * — they cross the tenant boundary by design (Docs/research/
 * unified-personal-kb.md §6). The caller's Supabase user id resolves
 * to the canonical `person_id` via `person_links`, then everything
 * keys off that.
 *
 * Consent gate: a user without `consent_unified_kb_at` set still sees
 * their links but cannot query cells — returns 403 with an explicit
 * `CONSENT_REQUIRED` error code so the UI can prompt the user.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';

interface DbExec {
  execute(query: unknown): Promise<unknown>;
}

interface PersonLinkRow {
  readonly id: string;
  readonly personId: string;
  readonly tenantId: string;
  readonly roleInTenant: string;
  readonly linkedAt: string;
  readonly unlinkedAt: string | null;
  readonly displayName: string;
  readonly preferredLanguage: string;
  readonly consentGranted: boolean;
}

interface MemoryCellRow {
  readonly id: string;
  readonly personId: string;
  readonly cellKind: string;
  readonly key: string;
  readonly value: unknown;
  readonly confidence: string;
  readonly sourceTenantId: string | null;
  readonly capturedAt: string;
}

async function resolvePersonId(
  db: DbExec,
  supabaseUserId: string,
): Promise<string | null> {
  try {
    const rows = (await db.execute(sql`
      SELECT person_id
        FROM person_links
       WHERE supabase_user_id = ${supabaseUserId}::uuid
         AND unlinked_at IS NULL
       LIMIT 1
    `)) as unknown as Array<{ person_id?: string }>;
    return rows[0]?.person_id ?? null;
  } catch {
    return null;
  }
}

async function resolveConsent(
  db: DbExec,
  personId: string,
): Promise<boolean> {
  try {
    const rows = (await db.execute(sql`
      SELECT consent_unified_kb_at, consent_unified_kb_revoked_at
        FROM persons
       WHERE id = ${personId}::uuid
       LIMIT 1
    `)) as unknown as Array<{
      consent_unified_kb_at?: string | null;
      consent_unified_kb_revoked_at?: string | null;
    }>;
    const row = rows[0];
    if (!row) return false;
    return Boolean(
      row.consent_unified_kb_at && !row.consent_unified_kb_revoked_at,
    );
  } catch {
    return false;
  }
}

export const personalKbRouter = new Hono();
personalKbRouter.use('*', authMiddleware);
personalKbRouter.use('*', databaseMiddleware);

personalKbRouter.get('/me/persons/links', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db') as DbExec | null;
  if (!db) {
    return c.json(
      {
        success: false,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database client is not initialized',
        },
      },
      503,
    );
  }
  try {
    const rows = (await db.execute(sql`
      SELECT
        pl.id,
        pl.person_id,
        pl.tenant_id,
        pl.role_in_tenant,
        pl.linked_at,
        pl.unlinked_at,
        p.display_name,
        p.preferred_language,
        p.consent_unified_kb_at,
        p.consent_unified_kb_revoked_at
      FROM person_links pl
      JOIN persons p ON p.id = pl.person_id
      WHERE pl.supabase_user_id = ${auth.userId}::uuid
      ORDER BY pl.linked_at DESC
      LIMIT 100
    `)) as unknown as Array<Record<string, unknown>>;
    const data: ReadonlyArray<PersonLinkRow> = rows.map((r) => ({
      id: String(r.id),
      personId: String(r.person_id),
      tenantId: String(r.tenant_id),
      roleInTenant: String(r.role_in_tenant ?? 'unknown'),
      linkedAt: String(r.linked_at ?? new Date(0).toISOString()),
      unlinkedAt: r.unlinked_at ? String(r.unlinked_at) : null,
      displayName: String(r.display_name ?? ''),
      // English default per CLAUDE.md (flipped 2026-05).
      preferredLanguage: String(r.preferred_language ?? 'en'),
      consentGranted: Boolean(
        r.consent_unified_kb_at && !r.consent_unified_kb_revoked_at,
      ),
    }));
    return c.json({ success: true, data });
  } catch (err) {
    return c.json(
      {
        success: false,
        error: {
          code: 'PERSON_LINKS_QUERY_FAILED',
          message: err instanceof Error ? err.message : 'unknown',
        },
      },
      500,
    );
  }
});

personalKbRouter.get('/me/persons/:personId/cells', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db') as DbExec | null;
  if (!db) {
    return c.json(
      {
        success: false,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database client is not initialized',
        },
      },
      503,
    );
  }
  const personId = c.req.param('personId');
  const callerPersonId = await resolvePersonId(db, auth.userId);
  if (!callerPersonId || callerPersonId !== personId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'FORBIDDEN_PERSON',
          message: 'You can only read your own personal-KB cells.',
        },
      },
      403,
    );
  }
  const consented = await resolveConsent(db, personId);
  if (!consented) {
    return c.json(
      {
        success: false,
        error: {
          code: 'CONSENT_REQUIRED',
          message:
            'Affirmative consent required before personal-KB cells are returned.',
        },
      },
      403,
    );
  }
  try {
    const rows = (await db.execute(sql`
      SELECT id, person_id, cell_kind, key, value, confidence,
             source_tenant_id, captured_at
        FROM personal_memory_cells
       WHERE person_id = ${personId}::uuid
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY captured_at DESC
       LIMIT 200
    `)) as unknown as Array<Record<string, unknown>>;
    const data: ReadonlyArray<MemoryCellRow> = rows.map((r) => ({
      id: String(r.id),
      personId: String(r.person_id),
      cellKind: String(r.cell_kind),
      key: String(r.key),
      value: r.value,
      confidence: String(r.confidence ?? '1.00'),
      sourceTenantId: r.source_tenant_id ? String(r.source_tenant_id) : null,
      capturedAt: String(r.captured_at ?? new Date(0).toISOString()),
    }));
    return c.json({ success: true, data });
  } catch (err) {
    return c.json(
      {
        success: false,
        error: {
          code: 'PERSONAL_KB_QUERY_FAILED',
          message: err instanceof Error ? err.message : 'unknown',
        },
      },
      500,
    );
  }
});

const SearchQuery = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().positive().max(50).default(20),
});

personalKbRouter.get(
  '/brain/personal-kb/search',
  zValidator('query', SearchQuery),
  async (c) => {
    const auth = c.get('auth');
    const db = c.get('db') as DbExec | null;
    if (!db) {
      return c.json(
        {
          success: false,
          error: {
            code: 'DATABASE_UNAVAILABLE',
            message: 'Database client is not initialized',
          },
        },
        503,
      );
    }
    const { q, limit } = c.req.valid('query');
    const personId = await resolvePersonId(db, auth.userId);
    if (!personId) {
      return c.json({ success: true, data: [] });
    }
    const consented = await resolveConsent(db, personId);
    if (!consented) {
      return c.json(
        {
          success: false,
          error: {
            code: 'CONSENT_REQUIRED',
            message:
              'Affirmative consent required before personal-KB search.',
          },
        },
        403,
      );
    }
    try {
      const needle = `%${q.replace(/[%_]/g, '')}%`;
      const rows = (await db.execute(sql`
        SELECT id, person_id, cell_kind, key, value, confidence,
               source_tenant_id, captured_at
          FROM personal_memory_cells
         WHERE person_id = ${personId}::uuid
           AND (expires_at IS NULL OR expires_at > NOW())
           AND (key ILIKE ${needle} OR value::text ILIKE ${needle})
         ORDER BY captured_at DESC
         LIMIT ${limit}
      `)) as unknown as Array<Record<string, unknown>>;
      const data: ReadonlyArray<MemoryCellRow> = rows.map((r) => ({
        id: String(r.id),
        personId: String(r.person_id),
        cellKind: String(r.cell_kind),
        key: String(r.key),
        value: r.value,
        confidence: String(r.confidence ?? '1.00'),
        sourceTenantId: r.source_tenant_id ? String(r.source_tenant_id) : null,
        capturedAt: String(r.captured_at ?? new Date(0).toISOString()),
      }));
      return c.json({ success: true, data });
    } catch (err) {
      return c.json(
        {
          success: false,
          error: {
            code: 'PERSONAL_KB_SEARCH_FAILED',
            message: err instanceof Error ? err.message : 'unknown',
          },
        },
        500,
      );
    }
  },
);
