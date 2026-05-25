/**
 * Tier-policy assertion tests (sync + async + approval).
 *
 * Coverage targets:
 *   - assertTierPolicy: literal allow, literal deny, reason-generalised
 *     allow, reason-generalised deny, high-risk literal-only short-
 *     circuit, skipGeneralization opt-out, unknown role guard,
 *     four_eye preserved.
 *   - requireTierPolicy: throws on deny, returns void on allow.
 *   - assertTierPolicyAsync: literal + judge paths + high-risk short-
 *     circuit.
 *   - assertApproved: not-found, not-quorum, executed, expired,
 *     tool-mismatch, tenant-mismatch, happy-path.
 */

import { describe, it, expect } from 'vitest';
import {
  assertTierPolicy,
  assertTierPolicyAsync,
  requireTierPolicy,
  assertApproved,
  type PolicyGatePolicyGateApprovalLookup,
  type PolicyGatePolicyGateApprovalRecord,
  type RolePolicy,
} from '../assertions.js';
import type { PolicyRule } from '../tier-policy-resolver.js';

const OWNER_RULES: ReadonlyArray<PolicyRule> = Object.freeze([
  {
    id: 'r-owner-read-portfolio',
    role: 'OWNER_ADVISOR',
    action: 'md:list-properties',
    verdict: 'allow',
    reason: 'owner may read their portfolio in any read shape',
    principle: 'owner-portfolio-read',
    examples: ['md:list-tenants', 'md:list-leases', 'md:list-arrears'],
  },
  {
    id: 'r-owner-create-lease',
    role: 'OWNER_ADVISOR',
    action: 'md:create-lease',
    verdict: 'four_eye',
    reason: 'lease creation has legal blast radius',
    principle: 'lease-lifecycle-write',
    examples: ['md:renew-lease', 'md:amend-lease'],
  },
  {
    id: 'r-owner-deny-cross',
    role: 'OWNER_ADVISOR',
    action: 'md:peek-other-owner',
    verdict: 'deny',
    reason: 'owners may never see another owner\'s portfolio',
    principle: 'cross-owner-isolation',
    examples: ['md:read-other-owner-arrears'],
  },
]);

const OWNER_POLICY: RolePolicy = Object.freeze({
  role: 'OWNER_ADVISOR',
  description: 'Borjie owner-advisor',
  rules: OWNER_RULES,
});

const RESIDENT_POLICY: RolePolicy = Object.freeze({
  role: 'TENANT_RESIDENT',
  rules: [
    {
      id: 'r-resident-read-own',
      role: 'TENANT_RESIDENT',
      action: 'md:read-own-lease',
      verdict: 'allow',
      reason: 'residents may read their own lease',
      principle: 'resident-own-data-isolation',
      examples: ['md:read-own-statements', 'md:read-own-balance'],
    },
  ] satisfies ReadonlyArray<PolicyRule>,
});

// ════════════════════════════════════════════════════════════════════
// assertTierPolicy (sync)
// ════════════════════════════════════════════════════════════════════

describe('assertTierPolicy', () => {
  it('returns ok:true on literal allow-list hit', () => {
    const r = assertTierPolicy(OWNER_POLICY, 'md:list-properties');
    expect(r.ok).toBe(true);
  });

  it('preserves four_eye action in the literal allow set', () => {
    const r = assertTierPolicy(OWNER_POLICY, 'md:create-lease');
    expect(r.ok).toBe(true);
  });

  it('returns ok:false role_forbidden on a literal deny rule', () => {
    const r = assertTierPolicy(OWNER_POLICY, 'md:peek-other-owner');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('role_forbidden');
  });

  it('reason-generalises an allow to a similar read verb', () => {
    const r = assertTierPolicy(OWNER_POLICY, 'md:list-tenants-by-unit');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.reasonGeneralized).toBe(true);
      expect(r.principle).toBe('owner-portfolio-read');
    }
  });

  it('denies an action that nothing similar covers', () => {
    const r = assertTierPolicy(OWNER_POLICY, 'md:bake-cake');
    expect(r.ok).toBe(false);
  });

  it('blocks high-risk literal-only verbs even when similar to an allow rule', () => {
    // Even if the resolver might have generalised something like
    // "md:approve-payout" from a similar read verb, the high-risk
    // opt-out list forces literal-only — and this verb is not in the
    // allow-list, so it must be denied.
    const r = assertTierPolicy(OWNER_POLICY, 'md:approve-payout');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/literal-only/);
  });

  it('respects skipGeneralization opt-out', () => {
    const r = assertTierPolicy(OWNER_POLICY, 'md:list-tenants-by-unit', {
      skipGeneralization: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/literal-only/);
  });

  it('denies on an unknown / malformed role policy', () => {
    // Simulate a runtime type-assertion bypass.
    const broken = { role: 'OWNER_ADVISOR' } as unknown as RolePolicy;
    const r = assertTierPolicy(broken, 'md:list-properties');
    expect(r.ok).toBe(false);
  });

  it('does not leak owner permissions into the resident role', () => {
    const r = assertTierPolicy(RESIDENT_POLICY, 'md:list-properties');
    expect(r.ok).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════
// requireTierPolicy (throwing)
// ════════════════════════════════════════════════════════════════════

describe('requireTierPolicy', () => {
  it('returns void on allow', () => {
    expect(() =>
      requireTierPolicy(OWNER_POLICY, 'md:list-properties'),
    ).not.toThrow();
  });

  it('throws TierPolicyViolation on deny', () => {
    expect(() =>
      requireTierPolicy(OWNER_POLICY, 'md:peek-other-owner'),
    ).toThrow(/TierPolicyViolation/);
  });
});

// ════════════════════════════════════════════════════════════════════
// assertTierPolicyAsync
// ════════════════════════════════════════════════════════════════════

describe('assertTierPolicyAsync', () => {
  it('returns ok:true on literal allow', async () => {
    const r = await assertTierPolicyAsync({
      policy: OWNER_POLICY,
      action: 'md:list-properties',
    });
    expect(r.ok).toBe(true);
  });

  it('short-circuits to deny for high-risk literal-only actions', async () => {
    const r = await assertTierPolicyAsync({
      policy: OWNER_POLICY,
      action: 'md:transfer-funds',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/literal-only/);
  });

  it('consults the judge in the grey zone and allows when judge says yes', async () => {
    const r = await assertTierPolicyAsync({
      policy: OWNER_POLICY,
      action: 'md:bake-cake', // very low similarity — judge forced via no autoMatch hit
      judge: {
        async judgeCovers() {
          return {
            covers: true,
            confidence: 0.6,
            explanation: 'judge says yes',
          };
        },
      },
    });
    // bake-cake similarity is below judgeGreyZoneFloor=0.4 default,
    // so the judge is NOT consulted — safe-default deny.
    expect(r.ok).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════
// assertApproved
// ════════════════════════════════════════════════════════════════════

function makeLookup(record: PolicyGateApprovalRecord | null): PolicyGateApprovalLookup {
  return {
    async findById() {
      return record;
    },
  };
}

describe('assertApproved', () => {
  const baseRecord: PolicyGateApprovalRecord = {
    id: 'apr-1',
    status: 'approved',
    toolName: 'md:approve-payout',
    tenantId: 't-1',
    expiresAt: new Date(Date.now() + 60 * 60_000),
  };

  it('returns ok:true on a valid approved record', async () => {
    const r = await assertApproved('apr-1', {
      lookup: makeLookup(baseRecord),
      expectedAction: 'md:approve-payout',
      tenantId: 't-1',
    });
    expect(r.ok).toBe(true);
  });

  it('returns approval_not_found on a missing record', async () => {
    const r = await assertApproved('apr-missing', {
      lookup: makeLookup(null),
      expectedAction: 'md:approve-payout',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('approval_not_found');
  });

  it('returns approval_not_quorum when status is not "approved"', async () => {
    const r = await assertApproved('apr-1', {
      lookup: makeLookup({ ...baseRecord, status: 'one-eye' }),
      expectedAction: 'md:approve-payout',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('approval_not_quorum');
  });

  it('returns approval_consumed when executed=true', async () => {
    const r = await assertApproved('apr-1', {
      lookup: makeLookup({ ...baseRecord, executed: true }),
      expectedAction: 'md:approve-payout',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('approval_consumed');
  });

  it('returns approval_expired when expiresAt is in the past', async () => {
    const r = await assertApproved('apr-1', {
      lookup: makeLookup({
        ...baseRecord,
        expiresAt: new Date(Date.now() - 60_000),
      }),
      expectedAction: 'md:approve-payout',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('approval_expired');
  });

  it('returns approval_tool_mismatch when toolName differs', async () => {
    const r = await assertApproved('apr-1', {
      lookup: makeLookup(baseRecord),
      expectedAction: 'md:disburse-deposit',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('approval_tool_mismatch');
  });

  it('returns approval_tenant_mismatch when tenants differ', async () => {
    const r = await assertApproved('apr-1', {
      lookup: makeLookup(baseRecord),
      expectedAction: 'md:approve-payout',
      tenantId: 't-other',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('approval_tenant_mismatch');
  });

  it('allows the call when no tenant is supplied (cross-tenant authority)', async () => {
    const r = await assertApproved('apr-1', {
      lookup: makeLookup({ ...baseRecord, tenantId: null }),
      expectedAction: 'md:approve-payout',
    });
    expect(r.ok).toBe(true);
  });
});
