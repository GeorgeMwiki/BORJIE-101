/**
 * Owner-spawn → workforce tab-projection bridge tests.
 *
 * Locks the bridge contract end-to-end through Hono's `app.request()`
 * (mirrors tab-configs.test.ts):
 *
 *   1. An ACTIVE owner-spawned tab of the SAME tenant with a projectable
 *      kind appears in `projectedTabs`.
 *   2. Another tenant's tab NEVER appears (tenant isolation absolute).
 *   3. A removed (soft-deleted) tab never appears.
 *   4. With no spawned tabs the base contract is intact and
 *      `projectedTabs` is `[]` (additive — old clients unaffected).
 *   5. Role-restricted projections are hidden from non-matching roles.
 *   6. A structural-read failure degrades honestly to `[]` with 200.
 *
 * Plus pure-function units for kind/role resolution and the builder.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../middleware/hono-auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    const ctx = (globalThis as any).__BORJIE_TEST_AUTH__;
    if (!ctx) {
      return c.json({ success: false, error: { code: 'UNAUTHORIZED' } }, 401);
    }
    c.set('auth', ctx);
    await next();
  },
}));

vi.mock('../../../middleware/database', () => ({
  databaseMiddleware: async (c: any, next: any) => {
    const db = (globalThis as any).__BORJIE_TEST_DB__;
    c.set('db', db);
    await next();
  },
}));

import { workforceTabConfigWorkerRouter } from '../tab-configs.hono';
import {
  buildProjectedTabs,
  resolveProjectedKind,
  resolveProjectionRoles,
  MAX_PROJECTED_TABS,
} from '../tab-projection';

// ---------------------------------------------------------------------------
// In-memory drizzle stand-in.
//
// `owner_tabs_structural` selects are filtered by the ACTUAL bound values of
// the drizzle WHERE condition (tenant_id + status + kind eq params), so a
// dropped tenant/status/kind predicate in the route breaks the positive test
// — the isolation assertions are real, not vacuous.
// ---------------------------------------------------------------------------

interface StructuralRow {
  tenantId: string;
  userId: string;
  tabId: string;
  label: string;
  position: number;
  kind: string;
  status: string;
  config: Record<string, unknown>;
}

function makeStore() {
  return {
    structural: [] as StructuralRow[],
    structuralThrows: false,
  };
}

type Store = ReturnType<typeof makeStore>;

function matchTableName(table: any): 'structural' | 'configs' | null {
  if (!table) return null;
  for (const sym of Object.getOwnPropertySymbols(table)) {
    const name = String((table as any)[sym] ?? '');
    if (name.includes('owner_tabs_structural')) return 'structural';
    if (name.includes('workforce_role_tab_configs')) return 'configs';
  }
  return null;
}

/**
 * Walk a drizzle condition tree (`and(eq(), ...)`) and collect every bound
 * parameter value. Name/StringChunk fragments carry `value: string[]`
 * (skipped); `Param` wrappers carry the scalar bound value.
 */
function collectConditionParams(cond: unknown, out: string[] = []): string[] {
  if (!cond || typeof cond !== 'object') return out;
  const chunks = (cond as { queryChunks?: unknown }).queryChunks;
  if (!Array.isArray(chunks)) return out;
  for (const ch of chunks) {
    if (!ch || typeof ch !== 'object') continue;
    if (Array.isArray((ch as { queryChunks?: unknown }).queryChunks)) {
      collectConditionParams(ch, out);
      continue;
    }
    const v = (ch as { value?: unknown }).value;
    if (
      typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean'
    ) {
      out.push(String(v));
    }
  }
  return out;
}

function makeFakeDb(store: Store) {
  return {
    select: () => ({
      from: (table: any) => {
        const target = matchTableName(table);
        if (target === 'structural') {
          if (store.structuralThrows) {
            throw new Error('structural read exploded');
          }
          let filtered: StructuralRow[] = [...store.structural];
          const chain: any = {
            where: (cond: unknown) => {
              const params = collectConditionParams(cond);
              filtered = filtered.filter(
                (r) =>
                  params.includes(r.tenantId) &&
                  params.includes(r.status) &&
                  params.includes(r.kind),
              );
              return chain;
            },
            orderBy: () => chain,
            limit: () => Promise.resolve(filtered),
            then: (resolve: (r: StructuralRow[]) => unknown) =>
              Promise.resolve(filtered).then(resolve),
          };
          return chain;
        }
        // workforce_role_tab_configs — no rows seeded: the GET takes the
        // hydratedFromDefault path, which is all the bridge tests need.
        const empty: any = {
          where: () => empty,
          orderBy: () => empty,
          limit: () => Promise.resolve([]),
          then: (resolve: (r: unknown[]) => unknown) =>
            Promise.resolve([]).then(resolve),
        };
        return empty;
      },
    }),
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([]) }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([]),
          then: (resolve: (r: unknown) => unknown) =>
            Promise.resolve(undefined).then(resolve),
        }),
      }),
    }),
    execute: async () => [],
  };
}

function setWorkerAuth(role = 'pit_operator', tenantId = 'tnt_test') {
  (globalThis as any).__BORJIE_TEST_AUTH__ = {
    userId: 'usr_worker',
    tenantId,
    role: 'RESIDENT',
    permissions: [role],
  };
}

function structuralRow(overrides: Partial<StructuralRow>): StructuralRow {
  return {
    tenantId: 'tnt_test',
    userId: 'usr_owner',
    tabId: 'tab-mkt-1',
    label: 'Gold marketplace',
    position: 0,
    kind: 'custom',
    status: 'active',
    config: { kind: 'marketplace' },
    ...overrides,
  };
}

let store: Store;

beforeEach(() => {
  store = makeStore();
  (globalThis as any).__BORJIE_TEST_DB__ = makeFakeDb(store);
});

async function getTabConfig(query = ''): Promise<any> {
  const res = await workforceTabConfigWorkerRouter.request(
    `/tab-config${query}`,
    { method: 'GET' },
  );
  expect(res.status).toBe(200);
  return res.json();
}

// ---------------------------------------------------------------------------
// Route-level bridge contract
// ---------------------------------------------------------------------------

describe('owner-spawn → workforce tab projection (route)', () => {
  it('projects an active same-tenant owner-spawned marketplace tab', async () => {
    store.structural.push(structuralRow({}));
    setWorkerAuth('pit_operator');

    const json = await getTabConfig();
    expect(json.success).toBe(true);
    expect(json.data.projectedTabs).toEqual([
      {
        id: 'tab-mkt-1',
        kind: 'marketplace',
        label: 'Gold marketplace',
        origin: 'owner-spawned',
      },
    ]);
  });

  it('NEVER projects another tenant\'s tabs (tenant isolation)', async () => {
    store.structural.push(
      structuralRow({ tenantId: 'tnt_other', tabId: 'tab-foreign' }),
    );
    setWorkerAuth('pit_operator', 'tnt_test');

    const json = await getTabConfig();
    expect(json.data.projectedTabs).toEqual([]);
  });

  it('does not project removed (soft-deleted) tabs', async () => {
    store.structural.push(structuralRow({ status: 'removed' }));
    setWorkerAuth('pit_operator');

    const json = await getTabConfig();
    expect(json.data.projectedTabs).toEqual([]);
  });

  it('keeps the base contract intact when nothing is spawned (additive)', async () => {
    setWorkerAuth('pit_operator');

    const json = await getTabConfig();
    expect(json.success).toBe(true);
    expect(json.data.role).toBe('pit_operator');
    expect(Array.isArray(json.data.enabledTabIds)).toBe(true);
    expect(json.data.enabledTabIds).toContain('chat');
    expect(json.data.layoutDensity).toBe('comfortable');
    expect(json.data.hydratedFromDefault).toBe(true);
    expect(json.data.projectedTabs).toEqual([]);
  });

  it('hides a role-restricted projection from non-matching roles', async () => {
    store.structural.push(
      structuralRow({
        config: {
          workforceProjection: { kind: 'marketplace', roles: ['manager'] },
        },
      }),
    );

    setWorkerAuth('pit_operator');
    const asOperator = await getTabConfig();
    expect(asOperator.data.projectedTabs).toEqual([]);

    setWorkerAuth('manager');
    const asManager = await getTabConfig('?role=manager');
    expect(asManager.data.projectedTabs).toHaveLength(1);
    expect(asManager.data.projectedTabs[0].kind).toBe('marketplace');
  });

  it('skips tabs without a projectable semantic kind', async () => {
    store.structural.push(
      structuralRow({ tabId: 'tab-blueprint', config: { kind: 'blueprint' } }),
      structuralRow({ tabId: 'tab-bare', config: {} }),
    );
    setWorkerAuth('pit_operator');

    const json = await getTabConfig();
    expect(json.data.projectedTabs).toEqual([]);
  });

  it('degrades honestly to [] when the structural read fails', async () => {
    store.structural.push(structuralRow({}));
    store.structuralThrows = true;
    setWorkerAuth('pit_operator');

    const json = await getTabConfig();
    expect(json.success).toBe(true);
    expect(json.data.projectedTabs).toEqual([]);
    // Base contract still served.
    expect(json.data.enabledTabIds).toContain('chat');
  });
});

// ---------------------------------------------------------------------------
// Pure resolution units
// ---------------------------------------------------------------------------

describe('resolveProjectedKind', () => {
  it('prefers the explicit workforceProjection.kind', () => {
    expect(
      resolveProjectedKind({
        kind: 'treasury',
        workforceProjection: { kind: 'marketplace' },
      }),
    ).toBe('marketplace');
  });

  it('falls back through config.kind / type / template', () => {
    expect(resolveProjectedKind({ kind: 'marketplace' })).toBe('marketplace');
    expect(resolveProjectedKind({ type: 'procurement' })).toBe('procurement');
    expect(resolveProjectedKind({ template: 'safety' })).toBe('safety');
  });

  it('normalizes case + whitespace', () => {
    expect(resolveProjectedKind({ kind: ' Marketplace ' })).toBe('marketplace');
  });

  it('returns null for unknown / missing kinds (no guessing)', () => {
    expect(resolveProjectedKind({ kind: 'blueprint' })).toBeNull();
    expect(resolveProjectedKind({})).toBeNull();
    expect(resolveProjectedKind(null)).toBeNull();
    expect(resolveProjectedKind('marketplace')).toBeNull();
  });
});

describe('resolveProjectionRoles', () => {
  it('returns null (visible to all) when no restriction is declared', () => {
    expect(resolveProjectionRoles({ kind: 'marketplace' })).toBeNull();
    expect(resolveProjectionRoles(null)).toBeNull();
  });

  it('keeps only valid workforce role ids', () => {
    const roles = resolveProjectionRoles({
      workforceProjection: { roles: ['manager', 'not-a-role', 42] },
    });
    expect(roles).not.toBeNull();
    expect([...(roles ?? [])]).toEqual(['manager']);
  });

  it('treats an all-invalid roles array as unrestricted', () => {
    expect(
      resolveProjectionRoles({ workforceProjection: { roles: ['nope'] } }),
    ).toBeNull();
  });
});

describe('buildProjectedTabs', () => {
  it('orders by position then label and dedupes tab ids', () => {
    const rows = [
      {
        tabId: 'b',
        label: 'Bravo',
        position: 1,
        config: { kind: 'marketplace' },
      },
      {
        tabId: 'a',
        label: 'Alpha',
        position: 0,
        config: { kind: 'marketplace' },
      },
      {
        tabId: 'a',
        label: 'Alpha duplicate',
        position: 2,
        config: { kind: 'marketplace' },
      },
    ];
    const out = buildProjectedTabs(rows, 'pit_operator');
    expect(out.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('caps the projection list', () => {
    const rows = Array.from({ length: MAX_PROJECTED_TABS + 5 }, (_, i) => ({
      tabId: `tab-${i}`,
      label: `Tab ${i}`,
      position: i,
      config: { kind: 'marketplace' },
    }));
    expect(buildProjectedTabs(rows, 'manager')).toHaveLength(
      MAX_PROJECTED_TABS,
    );
  });

  it('skips rows whose payload fails validation', () => {
    const rows = [
      { tabId: '', label: 'No id', position: 0, config: { kind: 'marketplace' } },
      {
        tabId: 'ok',
        label: 'Fine',
        position: 1,
        config: { kind: 'marketplace' },
      },
    ];
    const out = buildProjectedTabs(rows, 'manager');
    expect(out.map((t) => t.id)).toEqual(['ok']);
  });
});
