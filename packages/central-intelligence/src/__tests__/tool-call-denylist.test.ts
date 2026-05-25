/**
 * Tool-call denylist — D9 tests.
 */

import { describe, it, expect } from 'vitest';
import {
  assertToolCallAllowed,
  checkToolCallDenylist,
  createInMemoryToolCallDenylist,
  ToolCallDeniedError,
} from '../kernel/tool-spec/tool-call-denylist.js';

describe('tool-call denylist', () => {
  it('returns null when no rule matches', async () => {
    const store = createInMemoryToolCallDenylist();
    const r = await checkToolCallDenylist(store, 'tnt_A', 'lookupTenantArrears');
    expect(r).toBeNull();
  });

  it('returns the entry when a tenant-specific rule matches', async () => {
    const store = createInMemoryToolCallDenylist();
    await store.add({
      tenantId: 'tnt_A',
      toolName: 'computeKraMri',
      reason: 'regulator hold',
    });
    const r = await checkToolCallDenylist(store, 'tnt_A', 'computeKraMri');
    expect(r?.reason).toBe('regulator hold');
  });

  it('ignores expired rules', async () => {
    const store = createInMemoryToolCallDenylist();
    await store.add({
      tenantId: 'tnt_A',
      toolName: 'computeKraMri',
      reason: 'temporary',
      expiresAt: '2000-01-01T00:00:00Z',
    });
    const r = await checkToolCallDenylist(store, 'tnt_A', 'computeKraMri');
    expect(r).toBeNull();
  });

  it('assertToolCallAllowed throws ToolCallDeniedError', async () => {
    const store = createInMemoryToolCallDenylist();
    await store.add({
      tenantId: 'tnt_A',
      toolName: 'computeKraMri',
      reason: 'regulator hold',
    });
    await expect(
      assertToolCallAllowed(store, 'tnt_A', 'computeKraMri'),
    ).rejects.toBeInstanceOf(ToolCallDeniedError);
  });

  it('does not throw for unmatched pairs', async () => {
    const store = createInMemoryToolCallDenylist();
    await assertToolCallAllowed(store, 'tnt_A', 'lookupTenantArrears');
  });

  it('remove() clears a previously-added rule', async () => {
    const store = createInMemoryToolCallDenylist();
    await store.add({
      tenantId: 'tnt_A',
      toolName: 'computeKraMri',
      reason: 'r',
    });
    await store.remove('tnt_A', 'computeKraMri');
    const r = await checkToolCallDenylist(store, 'tnt_A', 'computeKraMri');
    expect(r).toBeNull();
  });
});
