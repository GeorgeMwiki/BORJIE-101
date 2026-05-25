/**
 * Skill compiler — unit tests.
 *
 * Coverage:
 *   1. compileSkill — extracts a parameterised tool sequence from a
 *      3-tool successful trace.
 *   2. compileSkill — refuses an all-fail trace.
 *   3. compileSkill — refuses an empty trace.
 *   4. compileSkill — requires a non-empty name.
 *   5. compileSkill — drops failed steps from the sequence.
 *   6. compileSkill — templatises matching param values, leaves others.
 *   7. compileSkill — humanReviewed defaults to false.
 *   8. compileSkill — paramSchema rejects unknown keys (strict).
 *   9. autoSuggestSkill — returns null on empty registry.
 *  10. autoSuggestSkill — returns null on empty intent.
 *  11. autoSuggestSkill — matches by name token overlap.
 *  12. autoSuggestSkill — skips unreviewed skills.
 *  13. autoSuggestSkill — picks highest-overlap skill on tie-break.
 */

import { describe, it, expect } from 'vitest';
import {
  compileSkill,
  autoSuggestSkill,
  SkillCompileError,
  type CompiledSkill,
  type SessionTraceStep,
} from '../skill-compiler.js';

const FIXED_TS = new Date('2026-01-01T00:00:00.000Z');
const now = (): Date => FIXED_TS;
let idCounter = 0;
const idGen = (): string => {
  idCounter += 1;
  return `test-id-${idCounter}`;
};

function happyTrace(): ReadonlyArray<SessionTraceStep> {
  return [
    {
      tool: 'lookupTenant',
      args: { tenantId: 'T-7' },
      success: true,
    },
    {
      tool: 'getArrearsBalance',
      args: { tenantId: 'T-7', currency: 'TZS' },
      success: true,
    },
    {
      tool: 'sendSms',
      args: { phone: '+255700000000', body: 'Hi tenant T-7, your arrears…' },
      success: true,
    },
  ];
}

describe('compileSkill', () => {
  it('extracts a parameterised tool sequence from a 3-tool trace', () => {
    const skill = compileSkill(
      happyTrace(),
      'monthly-arrears-chase',
      { tenantId: 'T-7' },
      { sourceSessionId: 'sess-42', now, idGen },
    );

    expect(skill.name).toBe('monthly-arrears-chase');
    expect(skill.sourceSessionId).toBe('sess-42');
    expect(skill.toolSequence).toHaveLength(3);
    expect(skill.toolSequence[0]).toEqual({
      tool: 'lookupTenant',
      argsTemplate: { tenantId: '{{tenantId}}' },
    });
    expect(skill.toolSequence[1]).toEqual({
      tool: 'getArrearsBalance',
      argsTemplate: { tenantId: '{{tenantId}}', currency: 'TZS' },
    });
    expect(skill.toolSequence[2]?.tool).toBe('sendSms');
  });

  it('refuses an all-fail trace', () => {
    const trace: ReadonlyArray<SessionTraceStep> = [
      { tool: 'a', args: {}, success: false },
      { tool: 'b', args: {}, success: false },
    ];
    expect(() => compileSkill(trace, 'doomed', {})).toThrow(SkillCompileError);
  });

  it('refuses an empty trace', () => {
    expect(() => compileSkill([], 'x', {})).toThrow(SkillCompileError);
  });

  it('requires a non-empty name', () => {
    expect(() => compileSkill(happyTrace(), '  ', { tenantId: 'T-7' })).toThrow(
      SkillCompileError,
    );
  });

  it('drops failed steps from the sequence', () => {
    const mixed: ReadonlyArray<SessionTraceStep> = [
      { tool: 'good', args: {}, success: true },
      { tool: 'bad', args: {}, success: false },
      { tool: 'also-good', args: {}, success: true },
    ];
    const skill = compileSkill(mixed, 'partial', {}, { now, idGen });
    expect(skill.toolSequence.map((s) => s.tool)).toEqual([
      'good',
      'also-good',
    ]);
  });

  it('templatises matching param values, leaves non-matching primitives', () => {
    const trace: ReadonlyArray<SessionTraceStep> = [
      {
        tool: 'mix',
        args: { a: 'X', b: 'Y', c: 42, d: true, e: null },
        success: true,
      },
    ];
    const skill = compileSkill(trace, 'mix', { a: 'X' }, { now, idGen });
    expect(skill.toolSequence[0]?.argsTemplate).toEqual({
      a: '{{a}}',
      b: 'Y',
      c: 42,
      d: true,
      e: null,
    });
  });

  it('humanReviewed defaults to false', () => {
    const skill = compileSkill(happyTrace(), 's', {}, { now, idGen });
    expect(skill.humanReviewed).toBe(false);
  });

  it('paramSchema rejects unknown keys (strict)', () => {
    const skill = compileSkill(
      happyTrace(),
      'arrears',
      { tenantId: 'T-7' },
      { now, idGen },
    );
    const ok = skill.paramSchema.safeParse({ tenantId: 'T-9' });
    expect(ok.success).toBe(true);
    const bad = skill.paramSchema.safeParse({
      tenantId: 'T-9',
      hijacked: 'oops',
    });
    expect(bad.success).toBe(false);
  });
});

describe('autoSuggestSkill', () => {
  function stub(name: string, reviewed: boolean): CompiledSkill {
    return {
      id: `id-${name}`,
      name,
      paramSchema: { _typeName: 'mock' } as unknown as CompiledSkill['paramSchema'],
      toolSequence: [],
      sourceSessionId: '',
      compiledAt: FIXED_TS.toISOString(),
      humanReviewed: reviewed,
    };
  }

  it('returns null on empty registry', () => {
    expect(autoSuggestSkill('anything', [])).toBeNull();
  });

  it('returns null on empty intent', () => {
    expect(autoSuggestSkill('   ', [stub('a-b', true)])).toBeNull();
  });

  it('matches by name token overlap', () => {
    const reg = [stub('monthly-arrears-chase', true), stub('budget-forecast', true)];
    const hit = autoSuggestSkill('please run arrears chase for T-7', reg);
    expect(hit?.name).toBe('monthly-arrears-chase');
  });

  it('skips unreviewed skills', () => {
    const reg = [stub('arrears-chase', false), stub('budget-forecast', true)];
    expect(autoSuggestSkill('run arrears chase', reg)).toBeNull();
  });

  it('picks highest-overlap skill on tie-break candidates', () => {
    const reg = [
      stub('arrears-thing', true),
      stub('arrears-chase-monthly', true),
    ];
    const hit = autoSuggestSkill('monthly arrears chase', reg);
    expect(hit?.name).toBe('arrears-chase-monthly');
  });
});
