/**
 * Unit tests for createPersonaBrandingService.
 *
 * Mocks the Drizzle DatabaseClient with a script-driven stub that
 * tracks the (tenantId, surface) the service queries for, so we can
 * assert:
 *   - get returns null when no row
 *   - upsert + get round-trip
 *   - get with specific surface returns surface-specific override
 *   - get falls back to surface='' when surface-specific row absent
 *   - upsert dispatches an insert with onConflictDoUpdate
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPersonaBrandingService } from './persona-branding.service.js';
import type { DatabaseClient } from '../client.js';

interface StoredRow {
  tenantId: string;
  surface: string;
  displayName: string | null;
  openingPreamble: string | null;
  voiceProfileId: string | null;
  updatedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────
// Stub DatabaseClient — backs a tiny in-memory table; supports the
// narrow surface used by the service: select().from().where().limit().
// insert().values().onConflictDoUpdate().
// ─────────────────────────────────────────────────────────────────────

interface StubDb {
  client: DatabaseClient;
  rows: StoredRow[];
  // Captured args from the most recent select chain — used to assert
  // which (tenantId, surface) the service queried for.
  lastWhereTenantId: string | null;
  lastWhereSurface: string | null;
  whereCalls: Array<{ tenantId: string | null; surface: string | null }>;
}

function makeStubDb(initialRows: ReadonlyArray<StoredRow> = []): StubDb {
  const state: StubDb = {
    client: null as unknown as DatabaseClient,
    rows: [...initialRows],
    lastWhereTenantId: null,
    lastWhereSurface: null,
    whereCalls: [],
  };

  // The service builds an `and(eq(tenantId,...), eq(surface,...))`
  // predicate, then calls .where(predicate). We can't introspect the
  // SQL operators, so we use a sentinel WhereContext: the service
  // calls `.where(predicate)` then awaits the chain. The stub captures
  // the predicate by stringifying it best-effort; the simpler approach
  // is to track filtration via the most recent (eq) call in a small
  // shim. Instead, we run the predicate against each row by exposing
  // tenantId+surface filtering through a state we set in `eq` mocks.
  //
  // Practical approach: hijack drizzle-orm's `eq` would require module
  // mocking. Simpler still: the service queries with limit(1), so we
  // emulate by reading state.lastWhereTenantId/Surface from the
  // service-side state. Since we can't intercept eq() calls without
  // mocking drizzle-orm, we instead match by running the predicate
  // against every row — by virtue of tracking the LAST tenantId and
  // surface values seen via a simple "post-where filter" attached to
  // the chain. To set them, our chain accepts an `_args` array we
  // feed from an outer-state writer (`whereSet`). Tests use a higher-
  // level harness: we expose `whereSet(tenantId, surface)` that the
  // chain reads when resolving. Instead of trying to introspect, the
  // service's own logic calls `.where(predicate)` *once per query*
  // and we KNOW the order: (1) specific surface, (2) fallback to ''.
  // We track which call we're on with a counter and use the test-
  // configured tenant/surface from a script.
  //
  // Concretely the cleanest solution is: the chain returns ALL rows
  // matching (tenantId === captured.tenantId && surface === captured.surface).
  // We capture tenantId/surface NOT from the predicate, but from the
  // service's behaviour: it always passes (tenantId, surface) as an
  // arg-pair we pre-stash.
  //
  // We use vitest's mock for drizzle-orm's `and` / `eq` to capture
  // values. See the doMock at the top of this file.

  const makeChain = (
    /** Mode of the chain — 'select' returns rows; 'insert' resolves with no value. */
    mode: 'select' | 'insert',
  ): unknown => {
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: (predicate: unknown) => {
        // The predicate is a tagged op tree. We extract tenantId &
        // surface from our captured state (set via `eq` mocks below).
        const captured = capturedEqValues.shift() ?? null;
        const tenantId = captured?.tenantId ?? null;
        const surface = captured?.surface ?? null;
        state.lastWhereTenantId = tenantId;
        state.lastWhereSurface = surface;
        state.whereCalls.push({ tenantId, surface });
        // Reset for the next query.
        capturedEqValues.length = 0;
        // Pre-filter the rows to those matching this query so .limit
        // / await both work the same.
        chain._filtered = state.rows.filter(
          (r) =>
            (tenantId === null || r.tenantId === tenantId) &&
            (surface === null || r.surface === surface),
        );
        // Touch the predicate so vitest doesn't tree-shake it.
        void predicate;
        return chain;
      },
      limit: (_n: number) => chain,
      values: (vals: Partial<StoredRow>) => {
        chain._values = vals;
        return chain;
      },
      onConflictDoUpdate: (cfg: { set: Partial<StoredRow> }) => {
        // Apply the upsert immediately so subsequent get() calls see it.
        const v = (chain._values ?? {}) as Partial<StoredRow>;
        const tenantId = String(v.tenantId);
        const surface = String(v.surface ?? '');
        const existing = state.rows.find(
          (r) => r.tenantId === tenantId && r.surface === surface,
        );
        if (existing) {
          Object.assign(existing, cfg.set, { updatedAt: new Date() });
        } else {
          state.rows.push({
            tenantId,
            surface,
            displayName: v.displayName ?? null,
            openingPreamble: v.openingPreamble ?? null,
            voiceProfileId: v.voiceProfileId ?? null,
            updatedAt: new Date(),
          });
        }
        return chain;
      },
      then: (
        resolve: (value: unknown) => unknown,
        _reject?: (reason: unknown) => unknown,
      ) => {
        if (mode === 'select') {
          const filtered = (chain._filtered as StoredRow[] | undefined) ?? [];
          return resolve(filtered);
        }
        return resolve(undefined);
      },
      catch: () => chain,
      finally: () => chain,
      // Internal scratch.
      _filtered: [] as StoredRow[],
      _values: undefined as Partial<StoredRow> | undefined,
    };
    return chain;
  };

  const db: Record<string, unknown> = {
    select: () => makeChain('select'),
    insert: () => makeChain('insert'),
  };
  state.client = db as unknown as DatabaseClient;
  return state;
}

// ─────────────────────────────────────────────────────────────────────
// drizzle-orm `eq` mock — captures the column → value pairs the
// service feeds in so the chain can filter by (tenantId, surface).
//
// We ONLY need column-name detection; the service uses the pgTable
// objects from `personaBranding`, which expose `name` on each column.
// ─────────────────────────────────────────────────────────────────────

const capturedEqValues: Array<{ tenantId?: string; surface?: string }> = [];

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  // Buffer eq pairs until the next `and(...)` flushes them as a single
  // captured entry.
  let pending: { tenantId?: string; surface?: string } = {};
  return {
    ...actual,
    eq: (column: { name?: string }, value: unknown) => {
      const colName = String(column?.name ?? '');
      if (colName === 'tenant_id') pending.tenantId = String(value);
      else if (colName === 'surface') pending.surface = String(value);
      return { _op: 'eq', col: colName, value };
    },
    and: (...args: unknown[]) => {
      capturedEqValues.push({ ...pending });
      pending = {};
      return { _op: 'and', args };
    },
  };
});

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('createPersonaBrandingService', () => {
  let errorSpy = vi.spyOn(console, 'error');

  beforeEach(() => {
    capturedEqValues.length = 0;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('get returns null when no row exists', async () => {
    const stub = makeStubDb([]);
    const svc = createPersonaBrandingService(stub.client);

    const out = await svc.get('t_demo', 'owner-portal');

    expect(out).toBeNull();
  });

  it('upsert + get round-trip surfaces the persisted row', async () => {
    const stub = makeStubDb([]);
    const svc = createPersonaBrandingService(stub.client);

    await svc.upsert({
      tenantId: 't_demo',
      surface: 'owner-portal',
      displayName: 'Acme Brain',
      openingPreamble: 'Welcome to Acme',
      voiceProfileId: 'voice-warm',
    });

    const out = await svc.get('t_demo', 'owner-portal');

    expect(out).not.toBeNull();
    expect(out?.tenantId).toBe('t_demo');
    expect(out?.surface).toBe('owner-portal');
    expect(out?.displayName).toBe('Acme Brain');
    expect(out?.openingPreamble).toBe('Welcome to Acme');
    expect(out?.voiceProfileId).toBe('voice-warm');
    expect(typeof out?.updatedAt).toBe('string');
  });

  it('get with a specific surface returns the surface-specific override', async () => {
    const stub = makeStubDb([
      {
        tenantId: 't_demo',
        surface: '',
        displayName: 'Acme Default',
        openingPreamble: null,
        voiceProfileId: null,
        updatedAt: new Date('2025-01-01T00:00:00Z'),
      },
      {
        tenantId: 't_demo',
        surface: 'owner-portal',
        displayName: 'Acme Owner Brain',
        openingPreamble: null,
        voiceProfileId: null,
        updatedAt: new Date('2025-01-02T00:00:00Z'),
      },
    ]);
    const svc = createPersonaBrandingService(stub.client);

    const out = await svc.get('t_demo', 'owner-portal');

    expect(out?.displayName).toBe('Acme Owner Brain');
    expect(out?.surface).toBe('owner-portal');
  });

  it('get falls back to the surface-agnostic row when the specific surface is absent', async () => {
    const stub = makeStubDb([
      {
        tenantId: 't_demo',
        surface: '',
        displayName: 'Acme Default',
        openingPreamble: null,
        voiceProfileId: null,
        updatedAt: new Date('2025-01-01T00:00:00Z'),
      },
    ]);
    const svc = createPersonaBrandingService(stub.client);

    const out = await svc.get('t_demo', 'tenant-app');

    expect(out?.displayName).toBe('Acme Default');
    expect(out?.surface).toBe('');
  });

  it('get returns null when tenantId is empty', async () => {
    const stub = makeStubDb([]);
    const svc = createPersonaBrandingService(stub.client);

    const out = await svc.get('', 'owner-portal');

    expect(out).toBeNull();
  });

  it('upsert with empty-string surface persists as the surface-agnostic row', async () => {
    const stub = makeStubDb([]);
    const svc = createPersonaBrandingService(stub.client);

    await svc.upsert({
      tenantId: 't_demo',
      surface: '',
      displayName: 'Acme Default',
      openingPreamble: null,
      voiceProfileId: null,
    });

    expect(stub.rows).toHaveLength(1);
    expect(stub.rows[0]?.surface).toBe('');
    expect(stub.rows[0]?.displayName).toBe('Acme Default');
  });

  it('upsert called twice for the same key updates rather than duplicating', async () => {
    const stub = makeStubDb([]);
    const svc = createPersonaBrandingService(stub.client);

    await svc.upsert({
      tenantId: 't_demo',
      surface: 'owner-portal',
      displayName: 'V1',
      openingPreamble: null,
      voiceProfileId: null,
    });
    await svc.upsert({
      tenantId: 't_demo',
      surface: 'owner-portal',
      displayName: 'V2',
      openingPreamble: null,
      voiceProfileId: null,
    });

    expect(stub.rows).toHaveLength(1);
    expect(stub.rows[0]?.displayName).toBe('V2');
  });
});
