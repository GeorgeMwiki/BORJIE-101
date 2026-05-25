import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TASK_BUDGET_CENTS,
  EXECUTE_PHASE_CONFIG,
  PLAN_PHASE_CONFIG,
  ULTRAREVIEW_CONFIG,
} from './types.js';
import {
  OpusParityConfigViolation,
  capTaskBudget,
  validateOpusParityConfig,
} from './validate-config.js';

describe('opus-parity-config — presets', () => {
  it('DEFAULT_TASK_BUDGET_CENTS = 100000 ($1000)', () => {
    expect(DEFAULT_TASK_BUDGET_CENTS).toBe(100_000);
  });

  it('PLAN preset is Opus + plan + read-only', () => {
    expect(PLAN_PHASE_CONFIG.model).toBe('claude-opus-4-7');
    expect(PLAN_PHASE_CONFIG.permissionMode).toBe('plan');
    expect(PLAN_PHASE_CONFIG.adaptiveThinking).toBe(true);
    expect(PLAN_PHASE_CONFIG.disallowedTools).toContain('Write');
    expect(PLAN_PHASE_CONFIG.disallowedTools).toContain('Edit');
    expect(PLAN_PHASE_CONFIG.disallowedTools).toContain('Bash');
  });

  it('EXECUTE preset is Sonnet + acceptEdits + interleaved-on', () => {
    expect(EXECUTE_PHASE_CONFIG.model).toBe('claude-sonnet-4-7');
    expect(EXECUTE_PHASE_CONFIG.permissionMode).toBe('acceptEdits');
    expect(EXECUTE_PHASE_CONFIG.interleavedThinking).toBe(true);
  });

  it('ULTRAREVIEW preset is Opus xhigh + plan', () => {
    expect(ULTRAREVIEW_CONFIG.model).toBe('claude-opus-4-7');
    expect(ULTRAREVIEW_CONFIG.extendedThinkingEffort).toBe('xhigh');
  });
});

describe('opus-parity-config — validateOpusParityConfig', () => {
  it('accepts the three documented presets', () => {
    expect(() => validateOpusParityConfig({ ...PLAN_PHASE_CONFIG })).not.toThrow();
    expect(() => validateOpusParityConfig({ ...EXECUTE_PHASE_CONFIG })).not.toThrow();
    expect(() => validateOpusParityConfig({ ...ULTRAREVIEW_CONFIG })).not.toThrow();
  });

  it('rejects bypassPermissions (HARD NEVER)', () => {
    expect(() =>
      validateOpusParityConfig({ ...EXECUTE_PHASE_CONFIG, permissionMode: 'bypassPermissions' }),
    ).toThrow(OpusParityConfigViolation);
  });

  it('rejects auto mode (TS-only prompt-injection surface)', () => {
    expect(() =>
      validateOpusParityConfig({ ...EXECUTE_PHASE_CONFIG, permissionMode: 'auto' }),
    ).toThrow(OpusParityConfigViolation);
  });

  it('rejects negative or zero task budgets', () => {
    expect(() =>
      validateOpusParityConfig({ ...EXECUTE_PHASE_CONFIG, taskBudgetCents: 0 }),
    ).toThrow();
    expect(() =>
      validateOpusParityConfig({ ...EXECUTE_PHASE_CONFIG, taskBudgetCents: -1 }),
    ).toThrow();
  });

  it('rejects configs where allowed and disallowed tools overlap', () => {
    expect(() =>
      validateOpusParityConfig({
        ...EXECUTE_PHASE_CONFIG,
        allowedTools: ['Read', 'Edit'],
        disallowedTools: ['Edit'],
      }),
    ).toThrow(/both allowedTools/);
  });

  it('rejects unknown extendedThinkingEffort', () => {
    expect(() =>
      validateOpusParityConfig({
        ...EXECUTE_PHASE_CONFIG,
        extendedThinkingEffort: 'extreme' as never,
      }),
    ).toThrow();
  });
});

describe('opus-parity-config — capTaskBudget', () => {
  it('caps requested budget at the hard ceiling', () => {
    expect(capTaskBudget(500_000)).toBe(100_000);
    expect(capTaskBudget(50_000)).toBe(50_000);
  });

  it('throws on non-finite or non-positive', () => {
    expect(() => capTaskBudget(0)).toThrow();
    expect(() => capTaskBudget(-1)).toThrow();
    expect(() => capTaskBudget(Number.NaN)).toThrow();
    expect(() => capTaskBudget(Number.POSITIVE_INFINITY)).toThrow();
  });

  it('respects custom hard cap', () => {
    expect(capTaskBudget(20_000, 10_000)).toBe(10_000);
  });
});
