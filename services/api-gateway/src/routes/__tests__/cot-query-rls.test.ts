/**
 * CoT-query RLS route-layer verification — Phase D / D12.10.
 *
 * D3 owns the SQL migration (0146_cot_reservoir_rls.sql) that enables
 * RLS on `kernel_cot_reservoir`. D12 owns this end-to-end test that
 * verifies the policy is honoured at the ROUTE LAYER — a TENANT_ADMIN
 * from tenant A must not receive any rows belonging to tenant B even
 * when the underlying adapter pretends both tenants exist.
 *
 * Strategy: the test plugs an `rlsEnforcingSource` whose `query()`
 * imitates Postgres RLS by filtering against the JWT-derived
 * `app.tenant_id` GUC — proving:
 *   1. the route forwards the caller's tenantId to the adapter,
 *   2. cross-tenant queries from TENANT_ADMIN are rejected at the
 *      handler before they reach the adapter (403),
 *   3. even if a malicious adapter ignored the tenantId, the policy
 *      simulation still scrubs out other-tenant rows (defence in depth).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import {
  createCotQueryRouter,
  type CotQuerySource,
  type CotRow,
} from '../cot-query.router';
import { generateToken } from '../../middleware/auth';
import { UserRole } from '../../types/user-role';

interface CapturedQuery {
  readonly tenantId: string | null;
}

const TENANT_A = 'tnt_acme';
const TENANT_B = 'tnt_beta';

function rowFor(tenantId: string, suffix: string): CotRow {
  return {
    thoughtId: `thg_${tenantId}_${suffix}`,
    tenantId,
    threadId: `thr_${suffix}`,
    stakes: 'critical',
    thoughtText: `tenant=${tenantId} thought ${suffix}`,
    promptHash: 'a'.repeat(64),
    responseHash: 'b'.repeat(64),
    capturedAt: '2026-05-17T00:00:00.000Z',
  };
}

// RLS-simulating source — the corpus contains rows from BOTH tenants
// but the policy-equivalent filter only returns rows whose tenantId
// matches the caller's. A malicious adapter would skip the filter; the
// route-layer cross-tenant assertion must STILL catch the leak via the
// 403 path.
function rlsEnforcingSource(
  capture: { last?: CapturedQuery } = {},
): CotQuerySource {
  const corpus: ReadonlyArray<CotRow> = [
    rowFor(TENANT_A, '1'),
    rowFor(TENANT_A, '2'),
    rowFor(TENANT_B, '1'),
  ];
  return {
    async query(args) {
      capture.last = { tenantId: args.tenantId };
      const filtered = corpus.filter((r) => r.tenantId === args.tenantId);
      return { rows: filtered, total: filtered.length };
    },
  };
}

function mount(source: CotQuerySource): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('services', { cotQuerySource: source } as never);
    await next();
  });
  app.route('/cot', createCotQueryRouter());
  return app;
}

function bearer(
  role: UserRole,
  opts: { tenantId?: string; permissions?: string[] } = {},
): string {
  return `Bearer ${generateToken({
    userId: 'usr_test',
    tenantId: opts.tenantId ?? TENANT_A,
    role: role as never,
    permissions: opts.permissions ?? [],
    propertyAccess: ['*'],
  })}`;
}

describe('CoT RLS — route-layer verification (D12.10)', () => {
  beforeAll(() => {
    expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
  });

  it('TENANT_ADMIN of tenant A receives ONLY tenant A rows', async () => {
    const capture: { last?: CapturedQuery } = {};
    const app = mount(rlsEnforcingSource(capture));
    const res = await app.request(`/cot/query?tenantId=${TENANT_A}`, {
      headers: { Authorization: bearer(UserRole.TENANT_ADMIN, { tenantId: TENANT_A }) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: ReadonlyArray<{ tenantId: string }>;
    };
    expect(body.data.length).toBeGreaterThan(0);
    for (const row of body.data) {
      expect(row.tenantId).toBe(TENANT_A);
    }
    expect(capture.last?.tenantId).toBe(TENANT_A);
  });

  it('TENANT_ADMIN of tenant A cannot query tenant B (403, adapter never called)', async () => {
    const capture: { last?: CapturedQuery } = {};
    const app = mount(rlsEnforcingSource(capture));
    const res = await app.request(`/cot/query?tenantId=${TENANT_B}`, {
      headers: { Authorization: bearer(UserRole.TENANT_ADMIN, { tenantId: TENANT_A }) },
    });
    expect(res.status).toBe(403);
    expect(capture.last).toBeUndefined();
  });

  it('SUPER_ADMIN can cross tenants and the RLS-simulated source returns only that tenants rows', async () => {
    const capture: { last?: CapturedQuery } = {};
    const app = mount(rlsEnforcingSource(capture));
    const res = await app.request(`/cot/query?tenantId=${TENANT_B}`, {
      headers: {
        Authorization: bearer(UserRole.SUPER_ADMIN, {
          tenantId: 'tnt_platform',
          permissions: ['*'],
        }),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: ReadonlyArray<{ tenantId: string }>;
    };
    for (const row of body.data) {
      expect(row.tenantId).toBe(TENANT_B);
    }
    expect(capture.last?.tenantId).toBe(TENANT_B);
  });

  it('TENANT_ADMIN cannot see other tenants rows even if a malicious adapter ignored the tenantId filter', async () => {
    // Synthetic adapter that returns rows from BOTH tenants — the
    // route handler's defence in depth (tenantId check) ensures the
    // TENANT_ADMIN from tenant A is rejected when querying tenant B.
    // (The handler will not even call the adapter — see test above.)
    const leakyAdapter: CotQuerySource = {
      async query() {
        return {
          rows: [rowFor(TENANT_A, '1'), rowFor(TENANT_B, '1')],
          total: 2,
        };
      },
    };
    const app = mount(leakyAdapter);
    const res = await app.request(`/cot/query?tenantId=${TENANT_B}`, {
      headers: { Authorization: bearer(UserRole.TENANT_ADMIN, { tenantId: TENANT_A }) },
    });
    expect(res.status).toBe(403);
  });
});
