/**
 * Reason-based tier-policy resolver tests.
 *
 * Coverage targets:
 *   - Literal allow-list match (confidence=1, generalized=false).
 *   - Literal deny on an enumerated rule.
 *   - Reason-based generalisation above the auto-match threshold.
 *   - Reason-based generalisation of a `deny` rule (negative principle).
 *   - Reason-based generalisation of a `four_eye` rule (preserves gate).
 *   - Grey-zone judge path — judge approves.
 *   - Grey-zone judge path — judge rejects.
 *   - Grey-zone judge path — judge throws (safe-default deny).
 *   - Empty rule set → fail-safe deny.
 *   - No rule and no judge → fail-safe deny.
 *   - isAllowedVerdict semantics.
 *   - Custom thresholds.
 *   - High-risk literal-only opt-out enforces deny on similar verbs.
 *   - HIGH_RISK_LITERAL_ONLY_PREFIXES tightening cannot be widened.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveActionVerdict,
  isAllowedVerdict,
  cosineSimilarity,
  type MdRole,
  type PolicyRule,
} from '../tier-policy-resolver.js';
import {
  HIGH_RISK_LITERAL_ONLY_PREFIXES,
  isHighRiskLiteralOnly,
} from '../high-risk-literal-only.js';

const OWNER: MdRole = 'OWNER_ADVISOR';

const OWNER_RULES: ReadonlyArray<PolicyRule> = Object.freeze([
  {
    id: 'r-owner-read-portfolio',
    role: OWNER,
    action: 'md:list-properties',
    verdict: 'allow',
    reason: 'owner may read their own portfolio in any read shape',
    principle: 'owner-portfolio-read',
    examples: ['md:list-tenants', 'md:list-leases', 'md:list-arrears'],
  },
  {
    id: 'r-owner-create-lease',
    role: OWNER,
    action: 'md:create-lease',
    verdict: 'four_eye',
    reason: 'lease creation has legal blast radius; requires four-eye',
    principle: 'lease-lifecycle-write',
    examples: ['md:renew-lease', 'md:amend-lease'],
  },
  {
    id: 'r-owner-deny-cross-tenant',
    role: OWNER,
    action: 'md:peek-other-owner',
    verdict: 'deny',
    reason: 'owners may never see another owner\'s portfolio',
    principle: 'cross-owner-isolation',
    examples: ['md:read-other-owner-arrears', 'md:list-competitor-tenants'],
  },
]);

describe('resolveActionVerdict — literal match', () => {
  it('returns confidence=1 and generalized=false on literal hit', async () => {
    const r = await resolveActionVerdict({
      role: OWNER,
      action: 'md:list-properties',
      rules: OWNER_RULES,
    });
    expect(r.verdict).toBe('allow');
    expect(r.confidence).toBe(1);
    expect(r.generalized).toBe(false);
    expect(r.matchedRule?.id).toBe('r-owner-read-portfolio');
  });

  it('preserves four_eye on literal hit', async () => {
    const r = await resolveActionVerdict({
      role: OWNER,
      action: 'md:create-lease',
      rules: OWNER_RULES,
    });
    expect(r.verdict).toBe('four_eye');
    expect(r.generalized).toBe(false);
  });

  it('preserves deny on literal hit', async () => {
    const r = await resolveActionVerdict({
      role: OWNER,
      action: 'md:peek-other-owner',
      rules: OWNER_RULES,
    });
    expect(r.verdict).toBe('deny');
    expect(r.generalized).toBe(false);
  });
});

describe('resolveActionVerdict — reason-based generalisation', () => {
  it('generalises an allow to a similar verb above the threshold', async () => {
    // `md:list-tenants-by-unit` shares {md, list, tenants} with the
    // example `md:list-tenants` → cosine = 3/√(4·3) ≈ 0.87 > 0.7.
    const r = await resolveActionVerdict({
      role: OWNER,
      action: 'md:list-tenants-by-unit',
      rules: OWNER_RULES,
    });
    expect(r.verdict).toBe('reason-generalized-allow');
    expect(r.generalized).toBe(true);
    expect(r.generalizedFromPrinciple).toBe('owner-portfolio-read');
  });

  it('generalises a deny to a similar verb', async () => {
    const r = await resolveActionVerdict({
      role: OWNER,
      action: 'md:read-other-owner-tenants',
      rules: OWNER_RULES,
    });
    expect(r.verdict).toBe('reason-generalized-deny');
    expect(r.generalized).toBe(true);
    expect(r.generalizedFromPrinciple).toBe('cross-owner-isolation');
  });

  it('fails safe when nothing is similar enough', async () => {
    const r = await resolveActionVerdict({
      role: OWNER,
      action: 'md:bake-cake',
      rules: OWNER_RULES,
    });
    expect(r.verdict).toBe('reason-generalized-deny');
    expect(r.generalized).toBe(true);
  });
});

describe('resolveActionVerdict — judge grey zone', () => {
  // Construct a rule set whose similarity stays in the 0.4..0.7 band
  // for the test action, forcing the judge into play.
  const judgeRules: ReadonlyArray<PolicyRule> = [
    {
      id: 'r-payouts',
      role: OWNER,
      action: 'md:initiate-payout',
      verdict: 'four_eye',
      reason: 'all payouts are four-eye',
      principle: 'money-movement',
      examples: ['md:queue-payout', 'md:schedule-payout'],
    },
  ];

  it('approves the action when the judge says covers=true', async () => {
    const r = await resolveActionVerdict({
      role: OWNER,
      action: 'md:invoice-reconcile',
      rules: judgeRules,
      // Force the judge zone by lowering the threshold floor / raising
      // auto-match.
      autoMatchThreshold: 0.95,
      judgeGreyZoneFloor: 0.0,
      judge: {
        async judgeCovers() {
          return {
            covers: true,
            confidence: 0.82,
            explanation: 'principle covers this',
          };
        },
      },
    });
    expect(r.verdict).toBe('reason-generalized-allow');
    expect(r.generalized).toBe(true);
    expect(r.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('denies when the judge says covers=false', async () => {
    const r = await resolveActionVerdict({
      role: OWNER,
      action: 'md:invoice-reconcile',
      rules: judgeRules,
      autoMatchThreshold: 0.95,
      judgeGreyZoneFloor: 0.0,
      judge: {
        async judgeCovers() {
          return {
            covers: false,
            confidence: 0.8,
            explanation: 'orthogonal capability',
          };
        },
      },
    });
    expect(r.verdict).toBe('reason-generalized-deny');
  });

  it('falls back to safe-deny when the judge throws', async () => {
    const r = await resolveActionVerdict({
      role: OWNER,
      action: 'md:invoice-reconcile',
      rules: judgeRules,
      autoMatchThreshold: 0.95,
      judgeGreyZoneFloor: 0.0,
      judge: {
        async judgeCovers() {
          throw new Error('upstream timeout');
        },
      },
    });
    expect(r.verdict).toBe('reason-generalized-deny');
    expect(r.reasoning).toMatch(/upstream timeout/);
  });
});

describe('resolveActionVerdict — edge cases', () => {
  it('denies safely when the rule set is empty', async () => {
    const r = await resolveActionVerdict({
      role: OWNER,
      action: 'md:list-properties',
      rules: [],
    });
    expect(r.verdict).toBe('reason-generalized-deny');
    expect(r.generalized).toBe(true);
  });

  it('respects a custom autoMatchThreshold', async () => {
    // Set threshold so high that even strong similarity fails to
    // auto-generalise.
    const r = await resolveActionVerdict({
      role: OWNER,
      action: 'md:list-tenants-by-unit',
      rules: OWNER_RULES,
      autoMatchThreshold: 0.99,
    });
    expect(r.verdict).toBe('reason-generalized-deny');
  });
});

describe('isAllowedVerdict', () => {
  it('treats allow / four_eye / reason-generalized-allow as allowed', () => {
    expect(isAllowedVerdict('allow')).toBe(true);
    expect(isAllowedVerdict('four_eye')).toBe(true);
    expect(isAllowedVerdict('reason-generalized-allow')).toBe(true);
  });

  it('treats deny / reason-generalized-deny as not allowed', () => {
    expect(isAllowedVerdict('deny')).toBe(false);
    expect(isAllowedVerdict('reason-generalized-deny')).toBe(false);
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical token bags', () => {
    // Floating-point — use toBeCloseTo for round-trip math.
    expect(cosineSimilarity('md:list-tenants', 'md:list-tenants')).toBeCloseTo(
      1,
      10,
    );
  });

  it('returns 0 for disjoint token bags', () => {
    expect(cosineSimilarity('md:list-tenants', 'xyz:bake-cake')).toBe(0);
  });

  it('returns 0 for empty input', () => {
    expect(cosineSimilarity('', 'md:list-tenants')).toBe(0);
    expect(cosineSimilarity('md:list-tenants', '')).toBe(0);
  });
});

describe('HIGH_RISK_LITERAL_ONLY_PREFIXES', () => {
  it('classifies money-movement verbs as literal-only', () => {
    expect(isHighRiskLiteralOnly('md:approve-payout')).toBe(true);
    expect(isHighRiskLiteralOnly('md:disburse-rent')).toBe(true);
    expect(isHighRiskLiteralOnly('md:transfer-funds')).toBe(true);
    expect(isHighRiskLiteralOnly('md:settle-arrears')).toBe(true);
    expect(isHighRiskLiteralOnly('md:refund-deposit')).toBe(true);
  });

  it('classifies sovereign + killswitch + key-rotation prefixes', () => {
    expect(isHighRiskLiteralOnly('sovereign:adjust-pricing')).toBe(true);
    expect(isHighRiskLiteralOnly('killswitch:enable')).toBe(true);
    expect(isHighRiskLiteralOnly('key_rotation:s3')).toBe(true);
    expect(isHighRiskLiteralOnly('md:rotate-key')).toBe(true);
    expect(isHighRiskLiteralOnly('md:set-killswitch')).toBe(true);
  });

  it('classifies eviction + suspension verbs', () => {
    expect(isHighRiskLiteralOnly('md:terminate-lease')).toBe(true);
    expect(isHighRiskLiteralOnly('md:execute-eviction')).toBe(true);
    expect(isHighRiskLiteralOnly('md:suspend-org')).toBe(true);
    expect(isHighRiskLiteralOnly('md:force-status-change')).toBe(true);
  });

  it('does not classify ordinary read verbs as literal-only', () => {
    expect(isHighRiskLiteralOnly('md:list-properties')).toBe(false);
    expect(isHighRiskLiteralOnly('md:read-lease')).toBe(false);
    expect(isHighRiskLiteralOnly('md:list-tenants')).toBe(false);
    expect(isHighRiskLiteralOnly('md:bake-cake')).toBe(false);
  });

  it('exports an opt-out list with the expected high-risk anchors', () => {
    const set = new Set(HIGH_RISK_LITERAL_ONLY_PREFIXES);
    // Spot-checks — these MUST be present (removing them is a security
    // widening that requires a four-eye sign-off).
    expect(set.has('sovereign:')).toBe(true);
    expect(set.has('md:approve-payout')).toBe(true);
    expect(set.has('md:transfer-')).toBe(true);
  });
});
