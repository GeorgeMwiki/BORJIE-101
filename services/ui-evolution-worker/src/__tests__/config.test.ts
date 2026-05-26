import { describe, expect, it } from 'vitest';
import { isOperational, loadConfig } from '../config.js';

describe('loadConfig', () => {
  it('uses defaults when env is empty', () => {
    const c = loadConfig({});
    expect(c.UI_EVO_CRON).toBe('0 2 * * *');
    expect(c.UI_EVO_SHORT_WINDOW_DAYS).toBe(14);
    expect(c.UI_EVO_LONG_WINDOW_DAYS).toBe(60);
    expect(c.UI_EVO_LOCK_SUSTAIN_DAYS).toBe(30);
    expect(c.UI_EVO_CONCURRENCY).toBe(4);
    expect(c.UI_EVO_DISABLE_LLM).toBeFalsy();
    expect(c.UI_EVO_ONESHOT).toBeFalsy();
  });

  it('coerces numeric env vars', () => {
    const c = loadConfig({
      UI_EVO_SHORT_WINDOW_DAYS: '7',
      UI_EVO_CONCURRENCY: '8',
    });
    expect(c.UI_EVO_SHORT_WINDOW_DAYS).toBe(7);
    expect(c.UI_EVO_CONCURRENCY).toBe(8);
  });

  it('interprets boolean-ish flag values', () => {
    expect(loadConfig({ UI_EVO_ONESHOT: '1' }).UI_EVO_ONESHOT).toBe(true);
    expect(loadConfig({ UI_EVO_ONESHOT: 'true' }).UI_EVO_ONESHOT).toBe(true);
    expect(loadConfig({ UI_EVO_ONESHOT: '0' }).UI_EVO_ONESHOT).toBe(false);
    expect(loadConfig({ UI_EVO_ONESHOT: 'no' }).UI_EVO_ONESHOT).toBe(false);
  });

  it('rejects negative concurrency', () => {
    expect(() => loadConfig({ UI_EVO_CONCURRENCY: '-1' })).toThrow(/invalid/);
  });
});

describe('isOperational', () => {
  it('returns false without DATABASE_URL', () => {
    expect(isOperational(loadConfig({}))).toBe(false);
  });
  it('returns true with DATABASE_URL', () => {
    expect(
      isOperational(loadConfig({ DATABASE_URL: 'postgres://localhost' })),
    ).toBe(true);
  });
});
