/**
 * AOP registry tests — register, version-bump, lookup, activation.
 *
 * Closes audit/09-closed-loop-company-os.md Decagon pattern: a versioned
 * AOP catalogue is the *foundation* of regression-gated rollouts.
 */

import { describe, expect, it } from 'vitest';
import {
  createAOPRegistry,
  createInMemoryAOPRegistryStore,
  type AOPRegistry,
} from '../aop-registry.js';
import type { AOPSpec, RegressionSet } from '../aop-spec.js';

function regSet(id: string): RegressionSet {
  return {
    id,
    transcripts: [],
  } as RegressionSet;
}

function spec(id: string, version: string, regId: string): AOPSpec {
  return {
    id,
    version,
    systemPrompt: `You are AOP ${id}@${version}. Be precise.`,
    tools: ['lookupArrears'],
    model: { provider: 'anthropic', name: 'claude-opus-4-7', temperature: 0.2 },
    regressionSetId: regId,
    ownedBy: 'platform-brain-team',
    createdAt: new Date(0).toISOString(),
  } as AOPSpec;
}

async function freshRegistry(): Promise<AOPRegistry> {
  return createAOPRegistry({ store: createInMemoryAOPRegistryStore() });
}

describe('AOPRegistry — register + version-bump', () => {
  it('registers a spec and reads it back by (id, version)', async () => {
    const reg = await freshRegistry();
    await reg.registerRegressionSet(regSet('rs-1'));
    const created = await reg.registerAOP(spec('maintenance-triage', 'v1', 'rs-1'));
    expect(created.id).toBe('maintenance-triage');
    expect(reg.getAOP('maintenance-triage', 'v1')?.version).toBe('v1');
  });

  it('rejects unknown regressionSetId at register time', async () => {
    const reg = await freshRegistry();
    await expect(
      reg.registerAOP(spec('maintenance-triage', 'v1', 'rs-missing')),
    ).rejects.toThrow(/unknown regressionSetId/);
  });

  it('throws on duplicate (id, version)', async () => {
    const reg = await freshRegistry();
    await reg.registerRegressionSet(regSet('rs-1'));
    await reg.registerAOP(spec('a', 'v1', 'rs-1'));
    await expect(reg.registerAOP(spec('a', 'v1', 'rs-1'))).rejects.toThrow(/duplicate/);
  });

  it('allows multiple versions of the same id and preserves insertion order', async () => {
    const reg = await freshRegistry();
    await reg.registerRegressionSet(regSet('rs-1'));
    await reg.registerAOP(spec('triage', 'v1', 'rs-1'));
    await reg.registerAOP(spec('triage', 'v2', 'rs-1'));
    await reg.registerAOP(spec('triage', 'v3', 'rs-1'));
    const versions = reg.listVersions('triage').map((v) => v.version);
    expect(versions).toEqual(['v1', 'v2', 'v3']);
  });

  it('getAOP() with no version returns the active version, or null when none', async () => {
    const reg = await freshRegistry();
    await reg.registerRegressionSet(regSet('rs-1'));
    await reg.registerAOP(spec('triage', 'v1', 'rs-1'));
    expect(reg.getAOP('triage')).toBeNull();
    await reg.setActiveVersion('triage', 'v1');
    expect(reg.getAOP('triage')?.version).toBe('v1');
  });

  it('setActiveVersion(null) deactivates an AOP without removing rows', async () => {
    const reg = await freshRegistry();
    await reg.registerRegressionSet(regSet('rs-1'));
    await reg.registerAOP(spec('triage', 'v1', 'rs-1'));
    await reg.setActiveVersion('triage', 'v1');
    await reg.setActiveVersion('triage', null);
    expect(reg.activeVersion('triage')).toBeNull();
    expect(reg.getAOP('triage', 'v1')?.version).toBe('v1');
  });

  it('setActiveVersion rejects unknown versions', async () => {
    const reg = await freshRegistry();
    await reg.registerRegressionSet(regSet('rs-1'));
    await reg.registerAOP(spec('triage', 'v1', 'rs-1'));
    await expect(reg.setActiveVersion('triage', 'v99')).rejects.toThrow(/cannot activate/);
  });

  it('listAOPs returns every (id, version) row, insertion order', async () => {
    const reg = await freshRegistry();
    await reg.registerRegressionSet(regSet('rs-1'));
    await reg.registerAOP(spec('a', 'v1', 'rs-1'));
    await reg.registerAOP(spec('b', 'v1', 'rs-1'));
    await reg.registerAOP(spec('a', 'v2', 'rs-1'));
    expect(reg.listAOPs().map((s) => `${s.id}@${s.version}`)).toEqual([
      'a@v1',
      'a@v2',
      'b@v1',
    ]);
  });

  it('refresh() rehydrates from store, restoring active flag', async () => {
    const store = createInMemoryAOPRegistryStore();
    const reg = await createAOPRegistry({ store });
    await reg.registerRegressionSet(regSet('rs-1'));
    await reg.registerAOP(spec('triage', 'v1', 'rs-1'));
    await reg.setActiveVersion('triage', 'v1');

    const fresh = await createAOPRegistry({ store });
    expect(fresh.activeVersion('triage')).toBe('v1');
    expect(fresh.listVersions('triage').length).toBe(1);
  });
});
