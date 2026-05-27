import { describe, expect, it } from 'vitest';
import { buildSessionScope } from '../scope/session-scope-builder.js';
import {
  ScopeSwitchDenied,
  switchScope,
} from '../scope/scope-switcher-audit.js';
import { applyAdminOverride, applyCustomerOverride } from '../routing/override-handler.js';
import type { CustomerLocation, UserBindingLike } from '../types.js';

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
};

const REVOKED: UserBindingLike = {
  ...DSM_BINDING,
  id: 'b3',
  org_unit_id: 'unit-old',
  revoked_at: '2026-04-01T00:00:00.000Z',
};

const previous = buildSessionScope({
  session_id: 'sess-1',
  tenant_id: 't1',
  user_id: 'u1',
  chosen_binding: TENANT_BINDING,
  origin: 'picker_selection',
  nowIso: '2026-05-26T11:00:00.000Z',
  expiresAtIso: '2026-05-27T11:00:00.000Z',
});

describe('switchScope', () => {
  it('switches to a held binding and records the previous scope', () => {
    const switched = switchScope({
      previous_session: previous,
      target_scope_id: 'unit-dsm',
      target_binding: DSM_BINDING,
      nowIso: '2026-05-26T11:30:00.000Z',
    });
    expect(switched.active_scope_id).toBe('unit-dsm');
    expect(switched.switched_from_scope_id).toBeNull();
    expect(switched.origin).toBe('mid_session_switch');
    expect(switched.expires_at).toBe(previous.expires_at);
  });

  it('throws ScopeSwitchDenied when the binding is missing', () => {
    expect(() =>
      switchScope({
        previous_session: previous,
        target_scope_id: 'unit-dsm',
        target_binding: undefined,
      }),
    ).toThrow(ScopeSwitchDenied);
  });

  it('throws ScopeSwitchDenied when the binding has been revoked', () => {
    try {
      switchScope({
        previous_session: previous,
        target_scope_id: 'unit-old',
        target_binding: REVOKED,
      });
      throw new Error('expected ScopeSwitchDenied');
    } catch (e) {
      expect(e).toBeInstanceOf(ScopeSwitchDenied);
      expect((e as ScopeSwitchDenied).code).toBe('binding_revoked');
    }
  });

  it('throws ScopeSwitchDenied on cross-tenant attempts', () => {
    const otherTenant: UserBindingLike = {
      ...DSM_BINDING,
      tenant_id: 't2',
    };
    try {
      switchScope({
        previous_session: previous,
        target_scope_id: 'unit-dsm',
        target_binding: otherTenant,
      });
      throw new Error('expected ScopeSwitchDenied');
    } catch (e) {
      expect((e as ScopeSwitchDenied).code).toBe('cross_tenant');
    }
  });
});

const CUSTOMER: CustomerLocation = {
  customer_id: 'c-1',
  tenant_id: 't1',
  source: 'self_declared',
  city: 'Dar es Salaam',
  recorded_at: '2026-05-26T12:00:00.000Z',
};

describe('override handlers', () => {
  it('applyCustomerOverride produces a customer_override assignment', () => {
    const a = applyCustomerOverride({
      customer: CUSTOMER,
      preferred_org_unit_id: 'unit-arusha',
      reason: 'I prefer Arusha office',
      nowIso: '2026-05-26T12:00:00.000Z',
    });
    expect(a.assignment_kind).toBe('customer_override');
    expect(a.assigned_org_unit_id).toBe('unit-arusha');
    expect(a.reasoning).toContain('customer override');
  });

  it('applyAdminOverride stamps the actor in the reasoning', () => {
    const a = applyAdminOverride({
      customer: CUSTOMER,
      assigned_org_unit_id: 'unit-arusha',
      actor_user_id: 'u-owner',
      reason: 'flagship reassignment',
      nowIso: '2026-05-26T12:00:00.000Z',
    });
    expect(a.assignment_kind).toBe('admin_override');
    expect(a.reasoning).toContain('u-owner');
  });
});
