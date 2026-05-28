/**
 * Workforce tab-config router tests — Wave WORKFORCE-FIXED-TABS.
 *
 * Smoke-tests the contract end-to-end through Hono's `app.request()`
 * (the in-process equivalent of curl against a running gateway).
 * Confirms:
 *
 *   1. Owner PUT → 200 + hash-chain id returned.
 *   2. Worker GET → 200 + reflects the saved config.
 *   3. Worker POSTs a change request → 201 + audit id returned.
 *   4. Owner is forbidden from disabling the mandatory `chat` tab.
 *   5. Non-owner is forbidden from PUT or PATCH.
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

import {
  workforceTabConfigOwnerRouter,
  workforceTabConfigWorkerRouter,
} from '../tab-configs.hono';

// ---------------------------------------------------------------------------
// Lightweight in-memory drizzle stand-in
// ---------------------------------------------------------------------------

interface ConfigRow {
  id: string;
  tenantId: string;
  role: string;
  siteScope: string;
  enabledTabIds: string[];
  layoutDensity: string;
  updatedByUserId: string;
  updatedAt: Date;
  hashChainId: string | null;
}

interface RequestRow {
  id: string;
  tenantId: string;
  requesterUserId: string;
  requesterRole: string;
  siteId: string | null;
  reason: string;
  requestedChanges: Record<string, unknown>;
  status: string;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  auditHashId: string | null;
  createdAt: Date;
}

function makeStore() {
  return {
    configs: [] as ConfigRow[],
    requests: [] as RequestRow[],
    auditCount: 0,
    auditActions: [] as string[],
    lastAuditHash: '',
  };
}

function matchTableName(table: any): 'configs' | 'requests' | null {
  if (!table) return null;
  for (const sym of Object.getOwnPropertySymbols(table)) {
    const name = String((table as any)[sym] ?? '');
    if (name.includes('workforce_role_tab_configs')) return 'configs';
    if (name.includes('workforce_tab_change_requests')) return 'requests';
  }
  const str = JSON.stringify(table);
  if (str.includes('workforce_role_tab_configs')) return 'configs';
  if (str.includes('workforce_tab_change_requests')) return 'requests';
  return null;
}

function makeFakeDb(store: ReturnType<typeof makeStore>) {
  function chainSelect(target: 'configs' | 'requests') {
    const rowsRef = () =>
      target === 'configs' ? store.configs : (store.requests as any[]);
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(rowsRef()),
      then: (resolve: (r: any[]) => unknown) =>
        Promise.resolve(rowsRef()).then(resolve),
    };
    return chain;
  }
  return {
    select: () => ({
      from: (table: any) => {
        const target = matchTableName(table);
        if (!target) return Promise.resolve([]);
        return chainSelect(target);
      },
    }),
    insert: (table: any) => ({
      values: (val: any) => ({
        returning: () => {
          const target = matchTableName(table);
          if (target === 'configs') {
            const row: ConfigRow = {
              id: `cfg_${store.configs.length + 1}`,
              tenantId: val.tenantId,
              role: val.role,
              siteScope: val.siteScope,
              enabledTabIds: val.enabledTabIds,
              layoutDensity: val.layoutDensity,
              updatedByUserId: val.updatedByUserId,
              updatedAt: val.updatedAt ?? new Date(),
              hashChainId: null,
            };
            store.configs.push(row);
            return Promise.resolve([row]);
          }
          if (target === 'requests') {
            const row: RequestRow = {
              id: `req_${store.requests.length + 1}`,
              tenantId: val.tenantId,
              requesterUserId: val.requesterUserId,
              requesterRole: val.requesterRole,
              siteId: val.siteId ?? null,
              reason: val.reason,
              requestedChanges: val.requestedChanges,
              status: val.status ?? 'pending',
              decidedByUserId: null,
              decidedAt: null,
              decisionNote: null,
              auditHashId: null,
              createdAt: new Date(),
            };
            store.requests.push(row);
            return Promise.resolve([row]);
          }
          return Promise.resolve([]);
        },
      }),
    }),
    update: (table: any) => ({
      set: (patch: any) => ({
        where: () => ({
          returning: () => {
            const target = matchTableName(table);
            if (target === 'configs') {
              const last = store.configs[store.configs.length - 1];
              if (last) Object.assign(last, patch);
              return Promise.resolve(last ? [last] : []);
            }
            if (target === 'requests') {
              const last = store.requests[store.requests.length - 1];
              if (last) Object.assign(last, patch);
              return Promise.resolve(last ? [last] : []);
            }
            return Promise.resolve([]);
          },
          then: (resolve: (r: unknown) => unknown) =>
            Promise.resolve(undefined).then(resolve),
        }),
      }),
    }),
    execute: async (q: any) => {
      // Walk the sql template's `queryChunks` to recover (a) the literal
      // string fragments and (b) the interpolated parameter values.
      const chunks: ReadonlyArray<unknown> = q?.queryChunks ?? [];
      const literals: string[] = [];
      const params: unknown[] = [];
      for (const ch of chunks) {
        if (!ch || typeof ch !== 'object') continue;
        const val = (ch as { value?: unknown }).value;
        if (Array.isArray(val)) {
          for (const part of val) {
            if (typeof part === 'string') literals.push(part);
          }
        } else if (typeof val === 'string') {
          literals.push(val);
        } else if (val !== undefined) {
          params.push(val);
        }
      }
      const text = literals.join(' ');
      if (text.includes('MAX(sequence_id)')) {
        return [
          {
            max_seq: store.auditCount,
            last_hash: store.lastAuditHash,
          },
        ];
      }
      if (text.includes('INSERT INTO ai_audit_chain')) {
        const action = String(params[4] ?? '');
        const thisHash = String(params[6] ?? '');
        store.auditCount += 1;
        store.auditActions.push(action);
        store.lastAuditHash = thisHash;
        return [];
      }
      return [];
    },
  };
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function setOwnerAuth() {
  (globalThis as any).__BORJIE_TEST_AUTH__ = {
    userId: 'usr_owner',
    tenantId: 'tnt_test',
    role: 'OWNER',
    permissions: ['owner'],
  };
}

function setWorkerAuth(role = 'pit_operator') {
  (globalThis as any).__BORJIE_TEST_AUTH__ = {
    userId: 'usr_worker',
    tenantId: 'tnt_test',
    role: 'RESIDENT',
    permissions: [role],
  };
}

beforeEach(() => {
  const store = makeStore();
  (globalThis as any).__BORJIE_TEST_DB__ = makeFakeDb(store);
  (globalThis as any).__BORJIE_TEST_STORE__ = store;
});

describe('workforce tab-configs router (smoke)', () => {
  it('owner PUT then worker GET reflects the saved config', async () => {
    setOwnerAuth();
    const putRes = await workforceTabConfigOwnerRouter.request(
      '/tab-configs/supervisor/global',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabledTabIds: ['shift', 'tasks', 'crew', 'chat', 'profile'],
          layoutDensity: 'comfortable',
        }),
      },
    );
    expect(putRes.status).toBe(200);
    const putJson = (await putRes.json()) as any;
    expect(putJson.success).toBe(true);
    expect(putJson.data.role).toBe('supervisor');
    expect(putJson.data.enabledTabIds).toContain('chat');
    expect(putJson.data.hashChainId).toMatch(/^[0-9a-f-]+$/);

    setWorkerAuth('supervisor');
    const getRes = await workforceTabConfigWorkerRouter.request(
      '/tab-config?role=supervisor',
      { method: 'GET' },
    );
    expect(getRes.status).toBe(200);
    const getJson = (await getRes.json()) as any;
    expect(getJson.success).toBe(true);
    expect(getJson.data.enabledTabIds).toEqual(
      expect.arrayContaining(['shift', 'tasks', 'crew', 'chat', 'profile']),
    );
  });

  it('worker POSTs a change request — server records audit', async () => {
    setWorkerAuth('supervisor');
    const postRes = await workforceTabConfigWorkerRouter.request(
      '/tab-change-requests',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: 'I need the crew tab to dispatch my shift.',
          requestedChanges: { addTabs: ['crew'] },
        }),
      },
    );
    expect(postRes.status).toBe(201);
    const postJson = (await postRes.json()) as any;
    expect(postJson.success).toBe(true);
    expect(postJson.data.id).toMatch(/^req_/);
    expect(postJson.data.auditHashId).toMatch(/^[0-9a-f-]+$/);

    const store = (globalThis as any).__BORJIE_TEST_STORE__ as ReturnType<
      typeof makeStore
    >;
    expect(store.auditActions).toContain(
      'workforce_tab.change_request.create',
    );
    expect(store.auditCount).toBeGreaterThan(0);
  });

  it('owner cannot disable the mandatory chat tab', async () => {
    setOwnerAuth();
    const putRes = await workforceTabConfigOwnerRouter.request(
      '/tab-configs/supervisor/global',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabledTabIds: ['shift', 'tasks', 'profile'],
          layoutDensity: 'comfortable',
        }),
      },
    );
    expect(putRes.status).toBe(400);
    const json = (await putRes.json()) as any;
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('INVALID_TAB_SET');
  });

  it('non-owner is forbidden from PUT and PATCH', async () => {
    setWorkerAuth('supervisor');
    const putRes = await workforceTabConfigOwnerRouter.request(
      '/tab-configs/supervisor/global',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabledTabIds: ['chat', 'profile'],
          layoutDensity: 'comfortable',
        }),
      },
    );
    expect(putRes.status).toBe(403);

    const patchRes = await workforceTabConfigOwnerRouter.request(
      '/tab-change-requests/00000000-0000-0000-0000-000000000000',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'reject' }),
      },
    );
    expect(patchRes.status).toBe(403);
  });
});
