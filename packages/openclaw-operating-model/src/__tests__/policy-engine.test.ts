import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DECISION_BY_LEVEL,
  defineAgentPolicy,
  evaluateCondition,
  evaluatePolicy,
  InMemoryPolicyStore,
  parseCondition,
} from '../index.js';

describe('policy-engine / DSL parse + evaluate', () => {
  it('parses a simple equality condition', () => {
    const c = parseCondition('action.kind == "billing"');
    expect(evaluateCondition(c, { 'action.kind': 'billing' })).toBe(true);
    expect(evaluateCondition(c, { 'action.kind': 'read' })).toBe(false);
  });

  it('parses numeric comparisons', () => {
    const c = parseCondition('action.amount > 100');
    expect(evaluateCondition(c, { 'action.amount': 200 })).toBe(true);
    expect(evaluateCondition(c, { 'action.amount': 50 })).toBe(false);
  });

  it('parses "in" with list literal', () => {
    const c = parseCondition('tenant.tier in ["enterprise","sovereign"]');
    expect(evaluateCondition(c, { 'tenant.tier': 'enterprise' })).toBe(true);
    expect(evaluateCondition(c, { 'tenant.tier': 'starter' })).toBe(false);
  });

  it('parses "contains" on a string', () => {
    const c = parseCondition('action.tool contains "destroy"');
    expect(evaluateCondition(c, { 'action.tool': 'destroy_invoice' })).toBe(true);
    expect(evaluateCondition(c, { 'action.tool': 'list_invoices' })).toBe(false);
  });

  it('combines multiple comparisons with "and"', () => {
    const c = parseCondition(
      'action.kind == "billing" and action.amount > 100',
    );
    expect(
      evaluateCondition(c, {
        'action.kind': 'billing',
        'action.amount': 500,
      }),
    ).toBe(true);
    expect(
      evaluateCondition(c, {
        'action.kind': 'billing',
        'action.amount': 50,
      }),
    ).toBe(false);
  });

  it('evaluates unknown keys to false safely', () => {
    const c = parseCondition('action.missing == "x"');
    expect(evaluateCondition(c, {})).toBe(false);
  });

  it('throws on unparseable rule', () => {
    expect(() => parseCondition('garbage no operator')).toThrow();
  });
});

describe('policy-engine / defineAgentPolicy', () => {
  it('sorts rules by priority ascending', () => {
    const p = defineAgentPolicy({
      tenantId: 't',
      agentId: 'a',
      rules: [
        {
          id: 'r-late',
          when: 'action.amount > 100',
          then: 'allow',
          reason: 'low',
          priority: 10,
        },
        {
          id: 'r-early',
          when: 'action.amount > 1000',
          then: 'deny',
          reason: 'high',
          priority: 1,
        },
      ],
    });
    expect(p.rules[0]?.id).toBe('r-early');
    expect(p.rules[1]?.id).toBe('r-late');
  });

  it('validates every rule parses at define-time', () => {
    expect(() =>
      defineAgentPolicy({
        tenantId: 't',
        agentId: 'a',
        rules: [
          {
            id: 'bad',
            when: 'this is not a rule',
            then: 'deny',
            reason: 'x',
            priority: 1,
          },
        ],
      }),
    ).toThrow();
  });
});

describe('policy-engine / evaluatePolicy', () => {
  it('returns default for autonomy level when no policy + no overlay match', () => {
    const decision = evaluatePolicy({
      tenantId: 't',
      agentId: 'a',
      action: { kind: 'mutate' },
      autonomyLevel: 'L3',
      policy: null,
    });
    expect(decision.decision).toBe('allow');
    expect(decision.matchedRuleId).toBeNull();
    expect(decision.decision).toBe(DEFAULT_DECISION_BY_LEVEL.L3);
  });

  it('matches a tenant rule (highest priority wins)', () => {
    const policy = defineAgentPolicy({
      tenantId: 't',
      agentId: 'a',
      rules: [
        {
          id: 'r-high-amount-deny',
          when: 'action.amount > 100000',
          then: 'deny',
          reason: 'too expensive',
          priority: 1,
        },
      ],
    });
    const decision = evaluatePolicy({
      tenantId: 't',
      agentId: 'a',
      action: { kind: 'billing', amount: 500000 },
      autonomyLevel: 'L4',
      policy,
    });
    expect(decision.decision).toBe('deny');
    expect(decision.matchedRuleId).toBe('r-high-amount-deny');
  });

  it('jurisdiction overlay (TZ) intercepts large billing', () => {
    const decision = evaluatePolicy({
      tenantId: 't',
      agentId: 'a',
      action: { kind: 'billing', amount: 2_000_000 },
      autonomyLevel: 'L5',
      policy: null,
      jurisdiction: 'TZ',
    });
    expect(decision.decision).toBe('escalate');
    expect(decision.matchedRuleId).toBe('tz-bot-large-billing-escalate');
    expect(decision.reason).toContain('jurisdiction-overlay:TZ');
  });

  it('jurisdiction overlay takes priority over tenant rule', () => {
    const policy = defineAgentPolicy({
      tenantId: 't',
      agentId: 'a',
      rules: [
        {
          id: 'tenant-allow-billing',
          when: 'action.kind == "billing"',
          then: 'allow',
          reason: 'tenant says ok',
          priority: 1,
        },
      ],
    });
    const decision = evaluatePolicy({
      tenantId: 't',
      agentId: 'a',
      action: { kind: 'billing', amount: 2_000_000 },
      autonomyLevel: 'L5',
      policy,
      jurisdiction: 'TZ',
    });
    expect(decision.decision).toBe('escalate');
    expect(decision.matchedRuleId).toBe('tz-bot-large-billing-escalate');
  });

  it('falls back to tenant rule when no overlay matches', () => {
    const policy = defineAgentPolicy({
      tenantId: 't',
      agentId: 'a',
      rules: [
        {
          id: 'small-billing-allow',
          when: 'action.kind == "billing"',
          then: 'allow',
          reason: 'small amounts ok',
          priority: 5,
        },
      ],
    });
    const decision = evaluatePolicy({
      tenantId: 't',
      agentId: 'a',
      action: { kind: 'billing', amount: 5000 },
      autonomyLevel: 'L4',
      policy,
      jurisdiction: 'TZ',
    });
    expect(decision.decision).toBe('allow');
    expect(decision.matchedRuleId).toBe('small-billing-allow');
  });
});

describe('policy-engine / InMemoryPolicyStore', () => {
  it('stores + retrieves a policy', async () => {
    const store = new InMemoryPolicyStore();
    const policy = defineAgentPolicy({
      tenantId: 't1',
      agentId: 'agent-a',
      rules: [],
    });
    await store.putPolicy(policy);
    const fetched = await store.getPolicy({
      tenantId: 't1',
      agentId: 'agent-a',
    });
    expect(fetched).not.toBeNull();
  });

  it('returns null when no policy for (tenant, agent)', async () => {
    const store = new InMemoryPolicyStore();
    const fetched = await store.getPolicy({
      tenantId: 'unknown',
      agentId: 'agent-x',
    });
    expect(fetched).toBeNull();
  });
});
