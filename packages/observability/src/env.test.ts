import { afterEach, describe, expect, it } from 'vitest';
import { envFlag, optionalEnv, requireEnv } from './env.js';

const KEYS = ['__OBS_ENV_TEST_KEY__', '__OBS_ENV_TEST_FLAG__'] as const;

afterEach(() => {
  for (const key of KEYS) {
    delete process.env[key];
  }
});

describe('requireEnv', () => {
  it('returns the value when set', () => {
    process.env.__OBS_ENV_TEST_KEY__ = 'hello';
    expect(requireEnv('__OBS_ENV_TEST_KEY__')).toBe('hello');
  });

  it('throws when unset', () => {
    expect(() => requireEnv('__OBS_ENV_TEST_KEY__')).toThrow(
      /__OBS_ENV_TEST_KEY__ is not set/,
    );
  });

  it('throws when empty string', () => {
    process.env.__OBS_ENV_TEST_KEY__ = '';
    expect(() => requireEnv('__OBS_ENV_TEST_KEY__')).toThrow();
  });

  it('throws when whitespace-only', () => {
    process.env.__OBS_ENV_TEST_KEY__ = '   ';
    expect(() => requireEnv('__OBS_ENV_TEST_KEY__')).toThrow();
  });
});

describe('optionalEnv', () => {
  it('returns the value when set', () => {
    process.env.__OBS_ENV_TEST_KEY__ = 'value';
    expect(optionalEnv('__OBS_ENV_TEST_KEY__')).toBe('value');
  });

  it('returns undefined when unset', () => {
    expect(optionalEnv('__OBS_ENV_TEST_KEY__')).toBeUndefined();
  });

  it('returns undefined for empty / whitespace', () => {
    process.env.__OBS_ENV_TEST_KEY__ = '   ';
    expect(optionalEnv('__OBS_ENV_TEST_KEY__')).toBeUndefined();
  });
});

describe('envFlag', () => {
  it('returns defaultValue when unset', () => {
    expect(envFlag('__OBS_ENV_TEST_FLAG__')).toBe(false);
    expect(envFlag('__OBS_ENV_TEST_FLAG__', true)).toBe(true);
  });

  it('parses truthy values case-insensitively', () => {
    for (const truthy of ['1', 'true', 'TRUE', 'yes', 'YES', 'True']) {
      process.env.__OBS_ENV_TEST_FLAG__ = truthy;
      expect(envFlag('__OBS_ENV_TEST_FLAG__')).toBe(true);
    }
  });

  it('returns false for any non-truthy value', () => {
    for (const other of ['0', 'false', 'no', 'off', 'something-else']) {
      process.env.__OBS_ENV_TEST_FLAG__ = other;
      expect(envFlag('__OBS_ENV_TEST_FLAG__')).toBe(false);
    }
  });
});
