import { describe, expect, test } from 'vitest';
import { compileDsl } from '../compiler.js';
import { evaluate, type EvaluationActionStep } from '../evaluator.js';
import type { CompiledRule } from '../grammar.js';

const TRC_RENT_LOW = `
  RULE 'trc_rent_below_500k'
  WHEN module = 'estate'
    AND step = 'POST_LEDGER'
    AND amount < 500000 TZS
    AND category = 'rent'
  THEN approve_by role_group = 'emu_officer' min = 1
  PRIORITY 200
`;

const TRC_RENT_HIGH = `
  RULE 'trc_rent_500k_plus'
  WHEN module = 'estate'
    AND step = 'POST_LEDGER'
    AND amount >= 500000 TZS
    AND category = 'rent'
  THEN approve_by role_group = 'director_general' min = 1
  PRIORITY 210
`;

const TRC_RAILWAY = `
  RULE 'trc_railway_reserve_notify'
  WHEN module = 'estate'
    AND step = 'MUTATE_ENTITY'
    AND landKind = 'railway_reserve'
  THEN approve_by role_group = 'director_general' min = 1
  NOTIFY role_group = 'civil_engineering'
  PRIORITY 300
`;

const DEFAULT_KILL_SWITCH = `
  RULE 'default_kill_switch_unblock'
  WHEN step = 'MUTATE_ENTITY' AND actionPrefix startswith 'kill_switch.'
  THEN approve_by role_group = 'four_eye_council' min = 2
  PRIORITY 500
`;

function buildRules(): ReadonlyArray<CompiledRule> {
  return [
    compileDsl(TRC_RENT_LOW, { tenantId: 'trc' }),
    compileDsl(TRC_RENT_HIGH, { tenantId: 'trc' }),
    compileDsl(TRC_RAILWAY, { tenantId: 'trc' }),
    compileDsl(DEFAULT_KILL_SWITCH, { tenantId: null }),
  ];
}

describe('approval-matrix-dsl evaluator', () => {
  test('routes rent < 500k to EMU officer', () => {
    const step: EvaluationActionStep = {
      tenantId: 'trc',
      module: 'estate',
      stepKind: 'POST_LEDGER',
      currency: 'TZS',
      amountMicros: 100_000_000_000, // 100k TZS
      attributes: { category: 'rent' },
    };
    const result = evaluate(step, buildRules());
    expect(result.requiredRoleGroup).toBe('emu_officer');
    if (result.requiredRoleGroup) {
      expect(result.winningRuleSlug).toBe('trc_rent_below_500k');
      expect(result.notifyRoleGroup).toBeNull();
    }
  });

  test('routes rent >= 500k to DG', () => {
    const step: EvaluationActionStep = {
      tenantId: 'trc',
      module: 'estate',
      stepKind: 'POST_LEDGER',
      currency: 'TZS',
      amountMicros: 750_000_000_000, // 750k TZS
      attributes: { category: 'rent' },
    };
    const result = evaluate(step, buildRules());
    expect(result.requiredRoleGroup).toBe('director_general');
    if (result.requiredRoleGroup) {
      expect(result.winningRuleSlug).toBe('trc_rent_500k_plus');
    }
  });

  test('routes railway-reserve mutation to DG with Civil Eng notify', () => {
    const step: EvaluationActionStep = {
      tenantId: 'trc',
      module: 'estate',
      stepKind: 'MUTATE_ENTITY',
      attributes: { landKind: 'railway_reserve' },
    };
    const result = evaluate(step, buildRules());
    expect(result.requiredRoleGroup).toBe('director_general');
    if (result.requiredRoleGroup) {
      expect(result.notifyRoleGroup).toBe('civil_engineering');
    }
  });

  test('platform-default rules match across tenants', () => {
    const step: EvaluationActionStep = {
      tenantId: 'somecorp',
      stepKind: 'MUTATE_ENTITY',
      attributes: { actionPrefix: 'kill_switch.reactivate' },
    };
    const result = evaluate(step, buildRules());
    expect(result.requiredRoleGroup).toBe('four_eye_council');
    if (result.requiredRoleGroup) {
      expect(result.quorum).toBe(2);
    }
  });

  test('returns no_matching_rule when nothing applies', () => {
    const step: EvaluationActionStep = {
      tenantId: 'trc',
      module: 'hr',
      stepKind: 'SEND_EMAIL',
    };
    const result = evaluate(step, buildRules());
    expect(result.requiredRoleGroup).toBeNull();
    if (!result.requiredRoleGroup) {
      expect(result.reason).toBe('no_matching_rule');
    }
  });

  test('honours priority — highest wins', () => {
    const rules: CompiledRule[] = [
      compileDsl(
        `RULE 'low' WHEN step = 'POST_LEDGER' THEN approve_by role_group = 'compliance' min = 1 PRIORITY 50`,
        { tenantId: 'acme' },
      ),
      compileDsl(
        `RULE 'high' WHEN step = 'POST_LEDGER' THEN approve_by role_group = 'cfo' min = 1 PRIORITY 500`,
        { tenantId: 'acme' },
      ),
    ];
    const step: EvaluationActionStep = {
      tenantId: 'acme',
      stepKind: 'POST_LEDGER',
    };
    const result = evaluate(step, rules);
    expect(result.requiredRoleGroup).toBe('cfo');
    if (result.requiredRoleGroup) {
      expect(result.additionalMatches).toHaveLength(1);
      expect(result.additionalMatches[0]?.ruleSlug).toBe('low');
    }
  });

  test('ignores inactive rules', () => {
    const rules: CompiledRule[] = [
      {
        ...compileDsl(
          `RULE 'inactive' WHEN step = 'POST_LEDGER' THEN approve_by role_group = 'compliance' min = 1 PRIORITY 999`,
          { tenantId: null },
        ),
        active: false,
      },
    ];
    const step: EvaluationActionStep = {
      tenantId: 't',
      stepKind: 'POST_LEDGER',
    };
    expect(evaluate(step, rules).requiredRoleGroup).toBeNull();
  });

  test('cross-tenant rules do not leak (other-tenant rule ignored)', () => {
    const rules: CompiledRule[] = [
      compileDsl(
        `RULE 'tenant_a_only' WHEN step = 'POST_LEDGER' THEN approve_by role_group = 'compliance' min = 1`,
        { tenantId: 'tenant_a' },
      ),
    ];
    const step: EvaluationActionStep = {
      tenantId: 'tenant_b',
      stepKind: 'POST_LEDGER',
    };
    expect(evaluate(step, rules).requiredRoleGroup).toBeNull();
  });

  test('all step kinds are matchable', () => {
    const rules: CompiledRule[] = [
      compileDsl(
        `RULE 'visit' WHEN step = 'SCHEDULE_FIELD_VISIT' THEN approve_by role_group = 'compliance' min = 1`,
        { tenantId: null },
      ),
      compileDsl(
        `RULE 'webhook' WHEN step = 'EMIT_WEBHOOK' THEN approve_by role_group = 'compliance' min = 1`,
        { tenantId: null },
      ),
      compileDsl(
        `RULE 'whatsapp' WHEN step = 'SEND_WHATSAPP' THEN approve_by role_group = 'compliance' min = 1`,
        { tenantId: null },
      ),
    ];
    for (const stepKind of ['SCHEDULE_FIELD_VISIT', 'EMIT_WEBHOOK', 'SEND_WHATSAPP'] as const) {
      const step: EvaluationActionStep = { tenantId: 't', stepKind };
      expect(evaluate(step, rules).requiredRoleGroup).toBe('compliance');
    }
  });

  test('amount equality and inequality', () => {
    const rules: CompiledRule[] = [
      compileDsl(
        `RULE 'eq' WHEN step = 'POST_LEDGER' AND amount == 100 USD THEN approve_by role_group = 'r1' min = 1 PRIORITY 200`,
        { tenantId: null },
      ),
      compileDsl(
        `RULE 'neq' WHEN step = 'POST_LEDGER' AND amount != 0 USD THEN approve_by role_group = 'r2' min = 1 PRIORITY 100`,
        { tenantId: null },
      ),
    ];
    const step: EvaluationActionStep = {
      tenantId: 't',
      stepKind: 'POST_LEDGER',
      currency: 'USD',
      amountMicros: 100_000_000,
    };
    expect(evaluate(step, rules).requiredRoleGroup).toBe('r1');
  });

  test('actorPersonaTier predicate', () => {
    const rules: CompiledRule[] = [
      compileDsl(
        `RULE 'tier1' WHEN step = 'CALL_EXTERNAL_API' AND actor_tier == 1 THEN approve_by role_group = 'compliance' min = 1`,
        { tenantId: null },
      ),
    ];
    const tier1: EvaluationActionStep = {
      tenantId: 't',
      stepKind: 'CALL_EXTERNAL_API',
      actorPersonaTier: 1,
    };
    expect(evaluate(tier1, rules).requiredRoleGroup).toBe('compliance');
    const tier3: EvaluationActionStep = {
      tenantId: 't',
      stepKind: 'CALL_EXTERNAL_API',
      actorPersonaTier: 3,
    };
    expect(evaluate(tier3, rules).requiredRoleGroup).toBeNull();
  });
});
