import { describe, expect, test } from 'vitest';
import {
  compileDsl,
  compileParsedRule,
  renderCompiledRule,
  ApprovalMatrixDslCompileError,
} from '../compiler.js';

const TRC_RENT_LOW = `
  RULE 'trc_rent_below_500k'
  WHEN module = 'estate'
    AND step = 'POST_LEDGER'
    AND amount < 500000 TZS
    AND category = 'rent'
  THEN approve_by role_group = 'emu_officer' min = 1
  PRIORITY 200
`;

describe('approval-matrix-dsl compiler', () => {
  test('compiles a complete TRC rule', () => {
    const compiled = compileDsl(TRC_RENT_LOW, { tenantId: 'trc' });
    expect(compiled.id).toBe('amdc_trc_trc_rent_below_500k');
    expect(compiled.tenantId).toBe('trc');
    expect(compiled.ruleSlug).toBe('trc_rent_below_500k');
    expect(compiled.requiredRoleGroup).toBe('emu_officer');
    expect(compiled.quorum).toBe(1);
    expect(compiled.priority).toBe(200);
    expect(compiled.active).toBe(true);
    expect(compiled.predicate.amountCmp?.valueMicros).toBe(500_000_000_000);
    expect(compiled.predicate.currency).toBe('TZS');
  });

  test('uses custom id when provided', () => {
    const compiled = compileDsl(TRC_RENT_LOW, {
      id: 'amdc_custom',
      tenantId: 'trc',
    });
    expect(compiled.id).toBe('amdc_custom');
  });

  test('refuses rules with no clauses', () => {
    expect(() =>
      compileParsedRule(
        {
          ruleSlug: 'empty',
          predicate: {},
          requiredRoleGroup: 'compliance',
          quorum: 1,
          priority: 100,
        },
        { tenantId: null },
      ),
    ).toThrow(ApprovalMatrixDslCompileError);
  });

  test('parses platform-default (NULL tenant_id)', () => {
    const compiled = compileDsl(TRC_RENT_LOW, { tenantId: null });
    expect(compiled.tenantId).toBeNull();
    expect(compiled.id).toBe('amdc_trc_rent_below_500k');
  });

  test('round-trips compile → render → compile', () => {
    const first = compileDsl(TRC_RENT_LOW, { tenantId: 'trc' });
    const rendered = renderCompiledRule(first);
    const second = compileDsl(rendered, { tenantId: 'trc' });
    expect(second.predicate).toEqual(first.predicate);
    expect(second.requiredRoleGroup).toBe(first.requiredRoleGroup);
    expect(second.quorum).toBe(first.quorum);
    expect(second.priority).toBe(first.priority);
  });

  test('renders NOTIFY clause', () => {
    const rendered = renderCompiledRule({
      id: 'r1',
      tenantId: null,
      ruleSlug: 'railway',
      predicate: {
        module: 'estate',
        stepKind: 'MUTATE_ENTITY',
        attributes: { landKind: 'railway_reserve' },
      },
      requiredRoleGroup: 'director_general',
      quorum: 1,
      notifyRoleGroup: 'civil_engineering',
      priority: 300,
      active: true,
    });
    expect(rendered).toContain(`NOTIFY role_group = 'civil_engineering'`);
  });

  test('throws on parse error wrapped as compile error', () => {
    expect(() =>
      compileDsl('RULE not_quoted', { tenantId: null }),
    ).toThrow(ApprovalMatrixDslCompileError);
  });

  test('renders prefix attribute back to startswith', () => {
    const rendered = renderCompiledRule({
      id: 'r1',
      tenantId: null,
      ruleSlug: 'kill',
      predicate: {
        stepKind: 'MUTATE_ENTITY',
        attributes: { actionPrefix: { __prefix__: 'kill_switch.' } },
      },
      requiredRoleGroup: 'four_eye_council',
      quorum: 2,
      notifyRoleGroup: null,
      priority: 500,
      active: true,
    });
    expect(rendered).toContain(`actionPrefix startswith 'kill_switch.'`);
  });
});
