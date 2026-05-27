import { describe, it, expect } from 'vitest';
import {
  capabilityNameFor,
  createInMemoryCapabilityRegistryPort,
  registerBlackboardCapabilities,
} from '../capability/register-blackboard-capabilities.js';

let counter = 0;
const uuid = (): string => {
  counter += 1;
  return `cap-${counter}`;
};

describe('registerBlackboardCapabilities', () => {
  it('creates three rows — junior, connector, tool — with canonical names', async () => {
    counter = 0;
    const registry = createInMemoryCapabilityRegistryPort({ uuid });
    const result = await registerBlackboardCapabilities('tenant-1', registry);
    expect(result).toHaveLength(3);
    const names = result.map((r) => r.name);
    expect(names).toEqual([
      capabilityNameFor('junior'),
      capabilityNameFor('connector'),
      capabilityNameFor('tool'),
    ]);
    // Distinct capability IDs.
    expect(new Set(result.map((r) => r.capabilityId)).size).toBe(3);
  });

  it('is idempotent — a second register call returns the same IDs', async () => {
    counter = 0;
    const registry = createInMemoryCapabilityRegistryPort({ uuid });
    const first = await registerBlackboardCapabilities('tenant-1', registry);
    const second = await registerBlackboardCapabilities('tenant-1', registry);
    expect(second.map((r) => r.capabilityId)).toEqual(
      first.map((r) => r.capabilityId),
    );
  });

  it('scopes registrations per tenant', async () => {
    counter = 0;
    const registry = createInMemoryCapabilityRegistryPort({ uuid });
    const a = await registerBlackboardCapabilities('tenant-a', registry);
    const b = await registerBlackboardCapabilities('tenant-b', registry);
    // No ID is shared.
    const aIds = new Set(a.map((r) => r.capabilityId));
    for (const r of b) expect(aIds.has(r.capabilityId)).toBe(false);
  });
});
