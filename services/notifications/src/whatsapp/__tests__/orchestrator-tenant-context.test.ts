/**
 * Round-3 audit C4 regression — conversation-orchestrator tenant-context guard.
 */

import { describe, it, expect } from 'vitest';
import {
  assertTenantContext,
  isUnboundTenant,
  TenantContextMissingError,
  InMemorySessionStore,
} from '../conversation-orchestrator.js';
import type { ConversationSession } from '../types.js';

function makeSession(tenantId: string): ConversationSession {
  return {
    id: 's1',
    tenantId,
    phoneNumber: '+254712345678',
    state: 'idle',
    language: 'en',
    context: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    messageHistory: [],
  };
}

describe('assertTenantContext (C4)', () => {
  it('throws when tenantId is empty string', () => {
    expect(() => assertTenantContext(makeSession(''), 'findById')).toThrow(
      TenantContextMissingError
    );
  });

  it('throws when tenantId is whitespace only', () => {
    expect(() => assertTenantContext(makeSession('   '), 'findById')).toThrow(
      TenantContextMissingError
    );
  });

  it('throws on the unbound:<phone> synthetic prefix', () => {
    expect(() =>
      assertTenantContext(makeSession('unbound:+254712345678'), 'findById')
    ).toThrow(TenantContextMissingError);
  });

  it('returns the trimmed tenantId when bound', () => {
    expect(assertTenantContext(makeSession('  tenant-A  '), 'findById')).toBe(
      'tenant-A'
    );
  });
});

describe('isUnboundTenant', () => {
  it('detects the synthetic prefix', () => {
    expect(isUnboundTenant('unbound:+254')).toBe(true);
  });
  it('returns true for empty / null / undefined', () => {
    expect(isUnboundTenant('')).toBe(true);
    expect(isUnboundTenant(undefined)).toBe(true);
    expect(isUnboundTenant(null)).toBe(true);
  });
  it('returns false for real ids', () => {
    expect(isUnboundTenant('tenant-A')).toBe(false);
  });
});

describe('InMemorySessionStore tenant index (audit 2.8)', () => {
  it('does NOT index unbound sessions under a shared empty slot', async () => {
    const store = new InMemorySessionStore();
    await store.set(makeSession('unbound:+254700000001'));
    await store.set(makeSession('unbound:+254700000002'));
    // Even with two unbound sessions, getByTenantId('') returns null.
    expect(await store.getByTenantId('')).toBeNull();
    expect(await store.getByTenantId('unbound:+254700000001')).toBeNull();
  });

  it('indexes bound sessions normally', async () => {
    const store = new InMemorySessionStore();
    const s = makeSession('tenant-A');
    await store.set(s);
    const fetched = await store.getByTenantId('tenant-A');
    expect(fetched?.id).toBe('s1');
  });
});
