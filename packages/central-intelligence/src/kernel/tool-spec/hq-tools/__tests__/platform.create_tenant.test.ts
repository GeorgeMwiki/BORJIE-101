import { describe, it, expect } from 'vitest';
import {
  createCreateTenantTool,
  type CreateTenantOutput,
  type CreateTenantPort,
} from '../platform.create_tenant.js';
import { buildCtx, makeInMemoryOtel } from './test-rig.js';

function stub(opts: { takenSlugs?: ReadonlyArray<string> } = {}): {
  port: CreateTenantPort;
  rollbacks: Array<{ tenantId: string; ownerUserId: string }>;
} {
  const rollbacks: Array<{ tenantId: string; ownerUserId: string }> = [];
  return {
    rollbacks,
    port: {
      async slugExists(slug) {
        return (opts.takenSlugs ?? []).includes(slug);
      },
      async provisionTenant(args): Promise<CreateTenantOutput> {
        return {
          tenantId: `t-${args.slug}`,
          slug: args.slug,
          name: args.name,
          plan: args.plan,
          ownerUserId: `u-${args.slug}-owner`,
          ownerEmail: args.ownerEmail,
          createdAt: '2026-05-15T09:00:00.000Z',
        };
      },
      async rollbackTenantProvision(args) {
        rollbacks.push(args);
      },
    },
  };
}

describe('platform.create_tenant', () => {
  it('happy path — provisions tenant + owner', async () => {
    const { port } = stub();
    const tool = createCreateTenantTool({ tenantsService: port });
    const out = await tool.execute(
      {
        slug: 'omega',
        name: 'Omega Estates',
        ownerEmail: 'owner@omega.test',
        plan: 'pro',
      },
      buildCtx(),
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.tenantId).toBe('t-omega');
    expect(out.output.plan).toBe('pro');
  });

  it('auth-gated — caller missing tenants:write refused', async () => {
    const { port } = stub();
    const tool = createCreateTenantTool({ tenantsService: port });
    const out = await tool.execute(
      { slug: 'omega', name: 'Omega', ownerEmail: 'x@y.test' },
      buildCtx({ scopes: ['platform:tenants:read'] }),
    );
    expect(out.kind).toBe('refused');
  });

  it('refuses if slug already exists', async () => {
    const { port } = stub({ takenSlugs: ['omega'] });
    const tool = createCreateTenantTool({ tenantsService: port });
    const out = await tool.execute(
      { slug: 'omega', name: 'Omega', ownerEmail: 'x@y.test' },
      buildCtx(),
    );
    expect(out.kind).toBe('refused');
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('ALREADY_APPLIED');
  });

  it('input validation — slug regex rejects underscores', () => {
    const { port } = stub();
    const tool = createCreateTenantTool({ tenantsService: port });
    expect(
      tool.inputSchema.safeParse({
        slug: 'bad_slug',
        name: 'X',
        ownerEmail: 'x@y.test',
      }).success,
    ).toBe(false);
  });

  it('rollback compensation deactivates the tenant', async () => {
    const { port, rollbacks } = stub();
    const tool = createCreateTenantTool({ tenantsService: port });
    const out = await tool.execute(
      { slug: 'omega', name: 'Omega', ownerEmail: 'x@y.test' },
      buildCtx(),
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    await tool.rollback?.(out.output, buildCtx());
    expect(rollbacks).toEqual([
      { tenantId: 't-omega', ownerUserId: 'u-omega-owner' },
    ]);
  });

  it('emits OTel span with mutate-tier riskTier', async () => {
    const { port } = stub();
    const otel = makeInMemoryOtel();
    const tool = createCreateTenantTool({ tenantsService: port });
    await tool.execute(
      { slug: 'omega', name: 'Omega', ownerEmail: 'x@y.test' },
      buildCtx({ otel }),
    );
    expect(otel.spans[0].attributes['bn.tool.riskTier']).toBe('mutate');
  });
});
