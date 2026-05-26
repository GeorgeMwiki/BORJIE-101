import { describe, it, expect } from 'vitest';

import {
  CapabilityCatalogueError,
  createInMemoryCapabilityRegistry,
  SEED_TENANT_ID,
  type CapabilityAuthorInput,
} from '../index.js';

function makeInput(
  partial: Partial<CapabilityAuthorInput> = {},
): CapabilityAuthorInput {
  return {
    tenantId: 'mining-ltd-01',
    name: 'compose_buyer_brief',
    version: '0.1.0',
    kind: 'tenant',
    owner: 'tenant:mining-ltd-01',
    dependencies: [],
    contract: {
      inputSchema: {},
      outputSchema: {},
      costClass: 'tier_1',
      latencyBudgetMs: 5000,
    },
    provenanceClass: 'tenant_authored',
    ...partial,
  };
}

describe('CapabilityRegistry — in-memory', () => {
  it('authors a tenant capability in `draft`', async () => {
    const reg = createInMemoryCapabilityRegistry();
    const row = await reg.author(makeInput());
    expect(row.lifecycleState).toBe('draft');
    expect(row.tenantId).toBe('mining-ltd-01');
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(row.auditHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.prevHash).toBeNull();
  });

  it('rejects duplicate (tenant, name, version)', async () => {
    const reg = createInMemoryCapabilityRegistry();
    await reg.author(makeInput());
    await expect(reg.author(makeInput())).rejects.toBeInstanceOf(
      CapabilityCatalogueError,
    );
  });

  it('rejects non-seed atomic authoring', async () => {
    const reg = createInMemoryCapabilityRegistry();
    await expect(
      reg.author(
        makeInput({
          kind: 'atomic',
          provenanceClass: 'tenant_authored',
        }),
      ),
    ).rejects.toMatchObject({ code: 'ATOMIC_RESERVED_FOR_SEED' });
  });

  it('transitions draft → shadow and appends a chained hash', async () => {
    const reg = createInMemoryCapabilityRegistry();
    const r1 = await reg.author(makeInput());
    const r2 = await reg.transitionLifecycle({
      id: r1.id,
      nextState: 'shadow',
    });
    expect(r2.lifecycleState).toBe('shadow');
    expect(r2.prevHash).toBe(r1.auditHash);
    expect(r2.auditHash).not.toBe(r1.auditHash);
  });

  it('rejects invalid lifecycle transitions', async () => {
    const reg = createInMemoryCapabilityRegistry();
    const r = await reg.author(makeInput());
    await expect(
      reg.transitionLifecycle({ id: r.id, nextState: 'live' }),
    ).rejects.toMatchObject({ code: 'INVALID_LIFECYCLE_TRANSITION' });
  });

  it('lists seed capabilities cross-tenant and tenant ones only locally', async () => {
    const reg = createInMemoryCapabilityRegistry();
    await reg.author(
      makeInput({
        tenantId: SEED_TENANT_ID,
        name: 'seed_x',
        kind: 'atomic',
        provenanceClass: 'seed',
      }),
    );
    await reg.author(
      makeInput({ tenantId: 'tenantA', name: 'pa', version: '1.0.0' }),
    );
    await reg.author(
      makeInput({ tenantId: 'tenantB', name: 'pb', version: '1.0.0' }),
    );

    const aList = await reg.list({ tenantId: 'tenantA' });
    expect(aList.map((c) => c.name).sort()).toEqual(['pa', 'seed_x']);

    const bList = await reg.list({ tenantId: 'tenantB' });
    expect(bList.map((c) => c.name).sort()).toEqual(['pb', 'seed_x']);
  });
});
