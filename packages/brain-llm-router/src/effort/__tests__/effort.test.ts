import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  coerceEffort,
  resolveEffortModel,
  selectEffort,
  effortLabel,
  DEFAULT_EFFORT,
} from '../index.js';

const ENV_KEYS = ['BORJIE_MODEL_FAST', 'BORJIE_MODEL_STANDARD', 'BORJIE_MODEL_DEEP'] as const;

function clearEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k];
}

beforeEach(clearEnv);
afterEach(clearEnv);

describe('coerceEffort', () => {
  it('accepts the three valid tokens', () => {
    expect(coerceEffort('fast')).toBe('fast');
    expect(coerceEffort('standard')).toBe('standard');
    expect(coerceEffort('deep')).toBe('deep');
  });

  it('is case-insensitive and trims', () => {
    expect(coerceEffort('  DEEP  ')).toBe('deep');
    expect(coerceEffort('Fast')).toBe('fast');
  });

  it('coerces malformed / missing input to standard', () => {
    expect(coerceEffort('turbo')).toBe(DEFAULT_EFFORT);
    expect(coerceEffort('')).toBe('standard');
    expect(coerceEffort(undefined)).toBe('standard');
    expect(coerceEffort(null)).toBe('standard');
    expect(coerceEffort(42)).toBe('standard');
    expect(coerceEffort({})).toBe('standard');
  });
});

describe('resolveEffortModel', () => {
  it('maps each effort to its canonical tier', () => {
    expect(resolveEffortModel('fast')).toContain('haiku');
    expect(resolveEffortModel('standard')).toContain('sonnet');
    expect(resolveEffortModel('deep')).toContain('opus');
  });

  it('honours an env override when set + non-empty', () => {
    process.env.BORJIE_MODEL_DEEP = 'openai/gpt-5-pro';
    expect(resolveEffortModel('deep')).toBe('openai/gpt-5-pro');
  });

  it('ignores a blank env override', () => {
    process.env.BORJIE_MODEL_FAST = '   ';
    expect(resolveEffortModel('fast')).toContain('haiku');
  });
});

describe('selectEffort', () => {
  it('coerces and resolves in one shot', () => {
    expect(selectEffort('deep').effort).toBe('deep');
    expect(selectEffort('garbage')).toEqual({
      effort: 'standard',
      model: resolveEffortModel('standard'),
    });
  });
});

describe('effortLabel', () => {
  it('returns a stable label equal to the token', () => {
    expect(effortLabel('fast')).toBe('fast');
    expect(effortLabel('deep')).toBe('deep');
  });
});
