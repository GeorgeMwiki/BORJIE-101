import { describe, expect, it } from 'vitest';
import { isStdinSentinel, resolveStdinArg } from '../src/stdin.js';

describe('stdin helpers', () => {
  it('detects the `-` sentinel', () => {
    expect(isStdinSentinel('-')).toBe(true);
    expect(isStdinSentinel('--')).toBe(false);
    expect(isStdinSentinel('hello')).toBe(false);
    expect(isStdinSentinel(undefined)).toBe(false);
  });

  it('resolveStdinArg passes through non-sentinel values', async () => {
    const out = await resolveStdinArg('hello');
    expect(out).toBe('hello');
  });

  it('resolveStdinArg returns undefined when called interactively with `-`', async () => {
    // In a TTY environment, readStdin returns '' → resolveStdinArg returns undefined.
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    const out = await resolveStdinArg('-');
    expect(out).toBeUndefined();
  });
});
