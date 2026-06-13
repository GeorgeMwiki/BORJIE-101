/**
 * detect-onboarding-gaps — the onboarding / growth driver.
 *
 * Covers:
 *   - writes a Mr. Mwikila inbox nudge for each MISSING core entity (no
 *     sites / no workers / no licences) for an incomplete tenant.
 *   - writes NOTHING for entities that already exist (no false nudge).
 *   - is IDEMPOTENT: when an open `proposed` row already exists for a gap,
 *     the guarded INSERT ... WHERE NOT EXISTS writes 0 rows → no spam.
 *   - skips a tenant with no active owner (FK would fail).
 *   - never throws on a per-gap DB error.
 */

import { describe, expect, it, vi } from 'vitest';

import { detectOnboardingGaps } from '../onboarding/detect-onboarding-gaps.js';

const TENANT = '22222222-2222-2222-2222-222222222222';

function fakeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as never;
}

function sqlText(query: unknown): string {
  if (typeof query === 'string') return query;
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  return chunks
    .map((c) => {
      if (typeof c === 'string') return c;
      const v = (c as { value?: unknown }).value;
      if (Array.isArray(v)) return v.join(' ');
      return '';
    })
    .join(' ');
}

/**
 * Build a fake DB.
 *
 * @param presence    which core tables already have rows for the tenant
 * @param openGaps    action_kinds that already have an OPEN proposed row
 *                    (drives the WHERE NOT EXISTS idempotency branch)
 * @param hasOwner    whether the tenant has an active owner
 */
function makeDb(opts: {
  presence: { sites: boolean; employees: boolean; licences: boolean };
  openGaps?: ReadonlySet<string>;
  hasOwner?: boolean;
}) {
  const openGaps = opts.openGaps ?? new Set<string>();
  const hasOwner = opts.hasOwner ?? true;
  const insertedActionKinds: string[] = [];

  const db = {
    execute: vi.fn(async (q: unknown) => {
      const text = sqlText(q);

      // owner lookup
      if (text.includes('FROM users') && text.includes('is_owner')) {
        return hasOwner ? { rows: [{ id: 'owner-1' }] } : { rows: [] };
      }
      // presence probes
      if (text.includes('FROM sites')) {
        return { rows: opts.presence.sites ? [{ '?column?': 1 }] : [] };
      }
      if (text.includes('FROM employees')) {
        return { rows: opts.presence.employees ? [{ '?column?': 1 }] : [] };
      }
      if (text.includes('FROM licences') && text.includes('LIMIT')) {
        return { rows: opts.presence.licences ? [{ '?column?': 1 }] : [] };
      }
      // guarded insert: INSERT ... SELECT ... WHERE NOT EXISTS
      if (text.includes('INSERT INTO mwikila_actions_inbox')) {
        // Recover the action_kind from the bound params. In drizzle's
        // `queryChunks`, static SQL is a StringChunk object (.value is an
        // array) while bound params are plain JS strings — so the params
        // are exactly the `typeof === 'string'` chunks.
        const chunks = (q as { queryChunks?: unknown[] }).queryChunks ?? [];
        const actionKind = chunks.find(
          (c): c is string =>
            typeof c === 'string' && c.startsWith('onboarding.'),
        );
        if (actionKind && !openGaps.has(actionKind)) {
          insertedActionKinds.push(actionKind);
          return { rows: [{ id: `row-${actionKind}` }] };
        }
        // WHERE NOT EXISTS suppressed the row (already open) → 0 rows.
        return { rows: [] };
      }
      return { rows: [] };
    }),
  };

  return { db, insertedActionKinds };
}

describe('detectOnboardingGaps', () => {
  it('writes a nudge for every missing core entity (fully empty tenant)', async () => {
    const { db, insertedActionKinds } = makeDb({
      presence: { sites: false, employees: false, licences: false },
    });
    const written = await detectOnboardingGaps({
      db,
      tenantId: TENANT,
      logger: fakeLogger(),
    });
    expect(written).toBe(3);
    expect(insertedActionKinds.sort()).toEqual([
      'onboarding.add_first_licence',
      'onboarding.add_first_site',
      'onboarding.add_first_worker',
    ]);
  });

  it('writes only for the missing entity (sites + workers exist, no licence)', async () => {
    const { db, insertedActionKinds } = makeDb({
      presence: { sites: true, employees: true, licences: false },
    });
    const written = await detectOnboardingGaps({
      db,
      tenantId: TENANT,
      logger: fakeLogger(),
    });
    expect(written).toBe(1);
    expect(insertedActionKinds).toEqual(['onboarding.add_first_licence']);
  });

  it('writes nothing when fully onboarded', async () => {
    const { db, insertedActionKinds } = makeDb({
      presence: { sites: true, employees: true, licences: true },
    });
    const written = await detectOnboardingGaps({
      db,
      tenantId: TENANT,
      logger: fakeLogger(),
    });
    expect(written).toBe(0);
    expect(insertedActionKinds).toEqual([]);
  });

  it('is idempotent — an already-open gap is NOT re-written (no spam)', async () => {
    const { db, insertedActionKinds } = makeDb({
      presence: { sites: false, employees: false, licences: false },
      // The site nudge is already open → WHERE NOT EXISTS suppresses it.
      openGaps: new Set(['onboarding.add_first_site']),
    });
    const written = await detectOnboardingGaps({
      db,
      tenantId: TENANT,
      logger: fakeLogger(),
    });
    // Only worker + licence written; the open site gap is skipped.
    expect(written).toBe(2);
    expect(insertedActionKinds.sort()).toEqual([
      'onboarding.add_first_licence',
      'onboarding.add_first_worker',
    ]);
  });

  it('skips a tenant with no active owner', async () => {
    const { db, insertedActionKinds } = makeDb({
      presence: { sites: false, employees: false, licences: false },
      hasOwner: false,
    });
    const written = await detectOnboardingGaps({
      db,
      tenantId: TENANT,
      logger: fakeLogger(),
    });
    expect(written).toBe(0);
    expect(insertedActionKinds).toEqual([]);
  });

  it('binds tenant_id as TEXT — never casts ::uuid (regression: 22P02)', async () => {
    // mwikila_actions_inbox.tenant_id is TEXT (FKs tenants.id, a TEXT PK), and
    // tenant ids like "borjie-demo" are not UUID-shaped. The original code cast
    // `${tenantId}::uuid`, which threw `22P02 invalid input syntax for type
    // uuid` on EVERY tick. Guard the SQL so the cast can never silently return.
    const seenSql: string[] = [];
    const db = {
      execute: vi.fn(async (q: unknown) => {
        seenSql.push(sqlText(q));
        const text = sqlText(q);
        if (text.includes('FROM users') && text.includes('is_owner')) {
          return { rows: [{ id: 'owner-1' }] };
        }
        if (text.includes('INSERT INTO mwikila_actions_inbox')) {
          return { rows: [{ id: 'row-x' }] };
        }
        return { rows: [] }; // every presence probe → empty → gap exists
      }),
    };
    await detectOnboardingGaps({ db, tenantId: TENANT, logger: fakeLogger() });
    const insertSql = seenSql.filter((s) =>
      s.includes('INSERT INTO mwikila_actions_inbox'),
    );
    expect(insertSql.length).toBeGreaterThan(0);
    for (const s of insertSql) {
      expect(s).not.toContain('::uuid');
      expect(s).toContain('tenant_id');
    }
  });

  it('never throws on a per-gap DB error', async () => {
    const db = {
      execute: vi.fn(async (q: unknown) => {
        const text = sqlText(q);
        if (text.includes('FROM users') && text.includes('is_owner')) {
          return { rows: [{ id: 'owner-1' }] };
        }
        if (text.includes('FROM sites')) throw new Error('boom');
        return { rows: [] };
      }),
    };
    await expect(
      detectOnboardingGaps({ db, tenantId: TENANT, logger: fakeLogger() }),
    ).resolves.toBeTypeOf('number');
  });
});
