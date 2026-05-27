import { describe, expect, it } from 'vitest';
import { buildSessionScope } from '../scope/session-scope-builder.js';
import { planScopePicker } from '../scope/scope-picker-contract.js';
import type { UserBindingLike } from '../types.js';

const TENANT_BINDING: UserBindingLike = {
  id: 'b1',
  user_id: 'u1',
  tenant_id: 't1',
  scope_kind: 'tenant_root',
  org_unit_id: null,
  role: 'admin',
  authority_tier_max: 2,
  granted_at: '2026-01-01T00:00:00.000Z',
  revoked_at: null,
  last_used_at: '2026-05-25T10:00:00.000Z',
};

const DSM_BINDING: UserBindingLike = {
  id: 'b2',
  user_id: 'u1',
  tenant_id: 't1',
  scope_kind: 'org_unit',
  org_unit_id: 'unit-dsm',
  role: 'admin',
  authority_tier_max: 1,
  granted_at: '2026-02-01T00:00:00.000Z',
  revoked_at: null,
  display_name: 'Dar es Salaam District',
  last_used_at: '2026-05-26T09:00:00.000Z',
};

const REVOKED_BINDING: UserBindingLike = {
  id: 'b3',
  user_id: 'u1',
  tenant_id: 't1',
  scope_kind: 'org_unit',
  org_unit_id: 'unit-old',
  role: 'admin',
  authority_tier_max: 1,
  granted_at: '2026-02-01T00:00:00.000Z',
  revoked_at: '2026-04-01T00:00:00.000Z',
};

describe('planScopePicker', () => {
  it('auto-resolves when the user holds a single active binding', () => {
    const { outcome } = planScopePicker({ bindings: [DSM_BINDING] });
    expect(outcome.requires_picker).toBe(false);
    expect(outcome.resolved_option?.scope_id).toBe('unit-dsm');
    expect(outcome.origin).toBe('auto_single_binding');
  });

  it('requires the picker when the user holds multiple active bindings', () => {
    const { outcome, input } = planScopePicker({
      bindings: [TENANT_BINDING, DSM_BINDING],
    });
    expect(outcome.requires_picker).toBe(true);
    expect(input.options).toHaveLength(2);
    // Most recently used first.
    expect(input.options[0]?.scope_id).toBe('unit-dsm');
  });

  it('honours a remembered default that still matches an active binding', () => {
    const { outcome } = planScopePicker({
      bindings: [TENANT_BINDING, DSM_BINDING],
      remembered_default_scope_id: 'unit-dsm',
    });
    expect(outcome.requires_picker).toBe(false);
    expect(outcome.resolved_option?.scope_id).toBe('unit-dsm');
    expect(outcome.origin).toBe('remembered_default');
  });

  it('excludes revoked bindings from the picker', () => {
    const { outcome } = planScopePicker({
      bindings: [DSM_BINDING, REVOKED_BINDING],
    });
    expect(outcome.requires_picker).toBe(false);
    expect(outcome.resolved_option?.scope_id).toBe('unit-dsm');
  });
});

describe('buildSessionScope', () => {
  it('builds a SessionScope row with the binding fields propagated', () => {
    const s = buildSessionScope({
      session_id: 'sess-1',
      tenant_id: 't1',
      user_id: 'u1',
      chosen_binding: DSM_BINDING,
      origin: 'picker_selection',
      nowIso: '2026-05-26T12:00:00.000Z',
      expiresAtIso: '2026-05-27T12:00:00.000Z',
    });
    expect(s.active_scope_id).toBe('unit-dsm');
    expect(s.role_at_active_scope).toBe('admin');
    expect(s.authority_tier_max).toBe(1);
    expect(s.origin).toBe('picker_selection');
    expect(s.audit_hash.length).toBeGreaterThan(10);
  });

  it('represents tenant_root as a null active_scope_id', () => {
    const s = buildSessionScope({
      session_id: 'sess-2',
      tenant_id: 't1',
      user_id: 'u1',
      chosen_binding: TENANT_BINDING,
      origin: 'auto_single_binding',
      nowIso: '2026-05-26T12:00:00.000Z',
      expiresAtIso: '2026-05-27T12:00:00.000Z',
    });
    expect(s.active_scope_id).toBeNull();
  });
});
