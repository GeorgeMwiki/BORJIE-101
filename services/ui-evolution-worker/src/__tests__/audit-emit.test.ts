import { describe, expect, it } from 'vitest';
import {
  computeRowHash,
  createAuditEmitter,
  createInMemoryChainStore,
} from '../audit/audit-emit.js';

describe('audit-emit', () => {
  it('writes to a global chain when tenantId is omitted', async () => {
    const store = createInMemoryChainStore();
    const emitter = createAuditEmitter({ store });
    await emitter.append({
      kind: 'recipe.locked',
      payload: { tabRecipeId: 'r', tabRecipeVersion: 1 },
    });
    expect([...store.entries.keys()]).toEqual(['global']);
  });

  it('separates per-tenant chains', async () => {
    const store = createInMemoryChainStore();
    const emitter = createAuditEmitter({ store });
    await emitter.append({
      kind: 'proposal.created',
      tenantId: 't1',
      payload: { id: 'p1' },
    });
    await emitter.append({
      kind: 'proposal.created',
      tenantId: 't2',
      payload: { id: 'p2' },
    });
    const keys = [...store.entries.keys()].sort();
    expect(keys).toEqual(['tenant:t1', 'tenant:t2']);
  });

  it('links entries via prev → cur on the same chain', async () => {
    const store = createInMemoryChainStore();
    const emitter = createAuditEmitter({ store });
    const first = await emitter.append({
      kind: 'recipe.locked',
      payload: { v: 1 },
    });
    const second = await emitter.append({
      kind: 'recipe.locked',
      payload: { v: 2 },
    });
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toBe(second);
    const chain = store.entries.get('global') ?? [];
    expect(chain).toHaveLength(2);
    expect(chain[0]?.prevHash).toBe('GENESIS');
    expect(chain[1]?.prevHash).toBe(chain[0]?.rowHash);
  });

  it('honours a supplied secretId / secretValue', async () => {
    const store = createInMemoryChainStore();
    const emitter = createAuditEmitter({
      store,
      secretId: 'rotor-1',
      secretValue: 'deadbeef',
    });
    await emitter.append({
      kind: 'recipe.locked',
      payload: { v: 1 },
    });
    const chain = store.entries.get('global');
    expect(chain?.[0]?.secretId).toBe('rotor-1');
  });

  it('computeRowHash is deterministic for the same input', () => {
    const a = computeRowHash({
      prev: 'GENESIS',
      payload: { kind: 'x', y: 1 },
    });
    const b = computeRowHash({
      prev: 'GENESIS',
      payload: { kind: 'x', y: 1 },
    });
    expect(a).toBe(b);
  });
});
