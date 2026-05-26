import { describe, it, expect } from 'vitest';

import {
  CapabilityCatalogueError,
  createInMemoryCapabilityRegistry,
  META_CAPABILITY_NAME,
  registerAtomicCapabilities,
  registerAllSeeds,
  registerMetaCapabilities,
  SEED_TENANT_ID,
} from '../index.js';

describe('compose_anything_v1 meta-dispatcher seed', () => {
  it('requires the five atomic capabilities to exist first', async () => {
    const reg = createInMemoryCapabilityRegistry();
    await expect(registerMetaCapabilities(reg)).rejects.toBeInstanceOf(
      CapabilityCatalogueError,
    );
  });

  it('registers compose_anything_v1 with the five atomics as dependencies', async () => {
    const reg = createInMemoryCapabilityRegistry();
    const { atomics, meta } = await registerAllSeeds(
      reg,
      registerAtomicCapabilities,
    );

    expect(meta.kind).toBe('meta');
    expect(meta.name).toBe(META_CAPABILITY_NAME);
    expect(meta.tenantId).toBe(SEED_TENANT_ID);
    expect(meta.dependencies).toHaveLength(5);

    const atomicIds = new Set(atomics.map((a) => a.id));
    for (const depId of meta.dependencies) {
      expect(atomicIds.has(depId)).toBe(true);
    }
  });
});
