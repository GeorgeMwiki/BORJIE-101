import { describe, it, expect } from 'vitest';
import {
  createListTenantsTool,
  type ListTenantsOutput,
  type TenantsServicePort,
} from '../platform.list_tenants.js';
import {
  buildCtx,
  makeInMemoryOtel,
  TENANT_SCOPED_SCOPES,
} from './test-rig.js';

function makeStubService(rows: ListTenantsOutput['rows']): TenantsServicePort {
  return {
    async listTenants(args) {
      const filtered = rows.filter((r) =>
        args.filter === 'all' ? true : r.status === args.filter,
      );
      return {
        rows: filtered.slice(0, args.limit),
        nextCursor: filtered.length > args.limit ? `cur:${filtered.length}` : null,
        totalReturned: Math.min(filtered.length, args.limit),
      };
    },
  };
}

const SEED_ROWS: ListTenantsOutput['rows'] = [
  {
    tenantId: 't-alpha',
    slug: 'alpha',
    name: 'Alpha Estates',
    status: 'active',
    mrrUsdCents: 120_000,
    lastActiveAt: '2026-05-14T12:00:00.000Z',
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    tenantId: 't-beta',
    slug: 'beta',
    name: 'Beta Properties',
    status: 'active',
    mrrUsdCents: 240_000,
    lastActiveAt: '2026-05-14T08:00:00.000Z',
    createdAt: '2024-06-01T00:00:00.000Z',
  },
  {
    tenantId: 't-gamma',
    slug: 'gamma',
    name: 'Gamma Holdings',
    status: 'churned',
    mrrUsdCents: 0,
    lastActiveAt: '2025-12-01T08:00:00.000Z',
    createdAt: '2024-03-15T00:00:00.000Z',
  },
];

describe('platform.list_tenants', () => {
  it('happy path — platform admin sees all active tenants', async () => {
    const tool = createListTenantsTool({ tenantsService: makeStubService(SEED_ROWS) });
    const ctx = buildCtx();
    const out = await tool.execute({ filter: 'active', limit: 10 }, ctx);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.rows).toHaveLength(2);
    expect(out.output.rows.map((r) => r.tenantId).sort()).toEqual([
      't-alpha',
      't-beta',
    ]);
  });

  it('auth-gated — caller missing platform scope is refused', async () => {
    const tool = createListTenantsTool({ tenantsService: makeStubService(SEED_ROWS) });
    const ctx = buildCtx({ scopes: ['tenant:foo'] });
    const out = await tool.execute({}, ctx);
    expect(out.kind).toBe('refused');
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('OUT_OF_SCOPE');
  });

  it('identity-scoped — tenant-scoped caller only sees their own tenants', async () => {
    const tool = createListTenantsTool({ tenantsService: makeStubService(SEED_ROWS) });
    const ctx = buildCtx({ scopes: TENANT_SCOPED_SCOPES('t-alpha') });
    // The caller has no platform:tenants:read so the first gate refuses.
    // To exercise filtering, add the required scope but only tenant-prefixed
    // access:
    const allowedCtx = buildCtx({
      scopes: ['platform:tenants:read', ...TENANT_SCOPED_SCOPES('t-alpha')],
    });
    const refused = await tool.execute({ filter: 'all', limit: 10 }, ctx);
    expect(refused.kind).toBe('refused');
    const out = await tool.execute({ filter: 'all', limit: 10 }, allowedCtx);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.rows.map((r) => r.tenantId)).toEqual(['t-alpha']);
    expect(out.output.totalReturned).toBe(1);
  });

  it('validates input — limit > 100 fails the schema', () => {
    const result = createListTenantsTool({
      tenantsService: makeStubService(SEED_ROWS),
    }).inputSchema.safeParse({ limit: 500 });
    expect(result.success).toBe(false);
  });

  it('emits OTel span with read-tier attributes', async () => {
    const otel = makeInMemoryOtel();
    const tool = createListTenantsTool({ tenantsService: makeStubService(SEED_ROWS) });
    const ctx = buildCtx({ otel });
    await tool.execute({}, ctx);
    expect(otel.spans).toHaveLength(1);
    expect(otel.spans[0].name).toBe('tool.platform.list_tenants');
    expect(otel.spans[0].attributes['bn.tool.riskTier']).toBe('read');
    expect(otel.spans[0].attributes['bn.tool.approvalRequired']).toBe(false);
    expect(otel.spans[0].status).toBe('ok');
  });

  it('validates output schema — happy-path returns valid rows', async () => {
    const tool = createListTenantsTool({ tenantsService: makeStubService(SEED_ROWS) });
    const ctx = buildCtx();
    const out = await tool.execute({ filter: 'all' }, ctx);
    if (out.kind !== 'ok') throw new Error('expected ok');
    const parsed = tool.outputSchema.safeParse(out.output);
    expect(parsed.success).toBe(true);
  });
});
