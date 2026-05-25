import { describe, expect, test } from 'vitest';
import { parseRule, ApprovalMatrixDslParseError } from '../parser.js';

describe('approval-matrix-dsl parser', () => {
  test('parses a TRC rent < 500k rule', () => {
    const src = `
      RULE 'trc_rent_below_500k'
      WHEN module = 'estate'
        AND step = 'POST_LEDGER'
        AND amount < 500000 TZS
        AND category = 'rent'
      THEN approve_by role_group = 'emu_officer' min = 1
      PRIORITY 200
    `;
    const parsed = parseRule(src);
    expect(parsed.ruleSlug).toBe('trc_rent_below_500k');
    expect(parsed.predicate.module).toBe('estate');
    expect(parsed.predicate.stepKind).toBe('POST_LEDGER');
    expect(parsed.currency).toBe('TZS');
    expect(parsed.predicate.amountCmp).toEqual({
      op: '<',
      valueMicros: 500_000_000_000,
    });
    expect(parsed.predicate.attributes).toEqual({ category: 'rent' });
    expect(parsed.requiredRoleGroup).toBe('emu_officer');
    expect(parsed.quorum).toBe(1);
    expect(parsed.priority).toBe(200);
  });

  test('parses a NOTIFY clause', () => {
    const src = `
      RULE 'trc_railway_reserve_notify'
      WHEN module = 'estate' AND step = 'MUTATE_ENTITY' AND landKind = 'railway_reserve'
      THEN approve_by role_group = 'director_general' min = 1
      NOTIFY role_group = 'civil_engineering'
      PRIORITY 300
    `;
    const parsed = parseRule(src);
    expect(parsed.notifyRoleGroup).toBe('civil_engineering');
  });

  test('parses startswith prefix matcher', () => {
    const src = `
      RULE 'sovereign_kill'
      WHEN step = 'MUTATE_ENTITY' AND actionPrefix startswith 'kill_switch.'
      THEN approve_by role_group = 'four_eye_council' min = 2
      PRIORITY 500
    `;
    const parsed = parseRule(src);
    expect(parsed.predicate.attributes).toEqual({
      actionPrefix: { __prefix__: 'kill_switch.' },
    });
    expect(parsed.quorum).toBe(2);
  });

  test('throws on missing THEN clause', () => {
    const src = `
      RULE 'broken'
      WHEN module = 'estate'
    `;
    expect(() => parseRule(src)).toThrow(ApprovalMatrixDslParseError);
  });

  test('throws on missing RULE header', () => {
    const src = `
      WHEN module = 'estate'
      THEN approve_by role_group = 'emu_officer' min = 1
    `;
    expect(() => parseRule(src)).toThrow(ApprovalMatrixDslParseError);
  });

  test('throws on unknown step kind', () => {
    const src = `
      RULE 'bad'
      WHEN step = 'NOT_A_KIND'
      THEN approve_by role_group = 'emu_officer' min = 1
    `;
    expect(() => parseRule(src)).toThrow(ApprovalMatrixDslParseError);
  });

  test('throws on quorum out of range', () => {
    const src = `
      RULE 'bad'
      WHEN module = 'estate'
      THEN approve_by role_group = 'emu_officer' min = 99
    `;
    expect(() => parseRule(src)).toThrow(ApprovalMatrixDslParseError);
  });

  test('throws on unrecognised clause', () => {
    const src = `
      RULE 'bad'
      WHEN nonsense
      THEN approve_by role_group = 'x' min = 1
    `;
    expect(() => parseRule(src)).toThrow(ApprovalMatrixDslParseError);
  });

  test('throws on empty input', () => {
    expect(() => parseRule('')).toThrow(ApprovalMatrixDslParseError);
  });

  test('parses actor_tier == clause', () => {
    const src = `
      RULE 'sovereign_tier1'
      WHEN step = 'CALL_EXTERNAL_API' AND actor_tier == 1
      THEN approve_by role_group = 'compliance' min = 1
      PRIORITY 250
    `;
    const parsed = parseRule(src);
    expect(parsed.predicate.actorPersonaTier).toBe(1);
  });

  test('ignores comments and blank lines', () => {
    const src = `
      -- a comment
      RULE 'simple'
      -- another comment
      WHEN module = 'finance'
      THEN approve_by role_group = 'compliance' min = 1
    `;
    const parsed = parseRule(src);
    expect(parsed.ruleSlug).toBe('simple');
  });
});
