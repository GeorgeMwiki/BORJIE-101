import { describe, expect, it } from 'vitest';
import { pickActiveBinding } from '../bindings/multi-binding-resolver.js';
import type { UserScopeBinding } from '../types.js';

function binding(
  id: string,
  scopeKind: UserScopeBinding['scope_kind'],
  tier: 0 | 1 | 2,
  grantedAt: string,
  overrides: Partial<UserScopeBinding> = {},
): UserScopeBinding {
  return {
    id,
    user_id: 'u-1',
    tenant_id: 't-borjie',
    scope_kind: scopeKind,
    org_unit_id: scopeKind === 'tenant_root' ? null : `unit-${id}`,
    role: 'admin',
    authority_tier_max: tier,
    granted_at: grantedAt,
    granted_by: 'owner',
    revoked_at: null,
    ...overrides,
  };
}

describe('pickActiveBinding', () => {
  it('returns explicit pick when preferredBindingId matches', () => {
    const b1 = binding('b-1', 'org_unit', 1, '2026-05-01T00:00:00.000Z');
    const b2 = binding('b-2', 'org_unit', 2, '2026-05-02T00:00:00.000Z');
    const out = pickActiveBinding({
      bindings: [b1, b2],
      preferredBindingId: 'b-1',
    });
    expect(out.strategy).toBe('explicit');
    expect(out.active?.id).toBe('b-1');
  });

  it('falls back to implicit when preferredBindingId not found', () => {
    const b1 = binding('b-1', 'org_unit', 1, '2026-05-01T00:00:00.000Z');
    const b2 = binding('b-2', 'org_unit', 2, '2026-05-02T00:00:00.000Z');
    const out = pickActiveBinding({
      bindings: [b1, b2],
      preferredBindingId: 'unknown',
    });
    expect(out.strategy).toBe('implicit');
    expect(out.active?.id).toBe('b-2'); // higher tier
  });

  it('picks highest tier on implicit', () => {
    const b1 = binding('b-1', 'org_unit', 1, '2026-05-01T00:00:00.000Z');
    const b2 = binding('b-2', 'org_unit', 2, '2026-04-01T00:00:00.000Z');
    const out = pickActiveBinding({ bindings: [b1, b2] });
    expect(out.active?.id).toBe('b-2');
  });

  it('prefers tenant_root over org_unit on equal tier', () => {
    const b1 = binding('b-root', 'tenant_root', 2, '2026-05-01T00:00:00.000Z');
    const b2 = binding('b-unit', 'org_unit', 2, '2026-05-10T00:00:00.000Z');
    const out = pickActiveBinding({ bindings: [b1, b2] });
    expect(out.active?.id).toBe('b-root');
  });

  it('breaks remaining ties by most-recently granted', () => {
    const b1 = binding('b-1', 'org_unit', 1, '2026-05-01T00:00:00.000Z');
    const b2 = binding('b-2', 'org_unit', 1, '2026-05-10T00:00:00.000Z');
    const out = pickActiveBinding({ bindings: [b1, b2] });
    expect(out.active?.id).toBe('b-2');
  });

  it('ignores revoked bindings', () => {
    const b1 = binding('b-1', 'tenant_root', 2, '2026-05-01T00:00:00.000Z', {
      revoked_at: '2026-05-05T00:00:00.000Z',
    });
    const b2 = binding('b-2', 'org_unit', 1, '2026-04-01T00:00:00.000Z');
    const out = pickActiveBinding({ bindings: [b1, b2] });
    expect(out.active?.id).toBe('b-2');
  });

  it('returns null+none when no bindings', () => {
    const out = pickActiveBinding({ bindings: [] });
    expect(out.active).toBeNull();
    expect(out.strategy).toBe('none');
  });
});
