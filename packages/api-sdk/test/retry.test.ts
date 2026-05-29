import { describe, expect, it } from 'vitest';
import { retry, defaultShouldRetry } from '../src/index.js';
import { ApiSdkError } from '../src/client.js';

describe('retry', () => {
  it('returns immediately when the call succeeds', async () => {
    let calls = 0;
    const out = await retry(async () => {
      calls += 1;
      return 'ok';
    });
    expect(out).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries transient errors using the supplied schedule', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const result = await retry(
      async () => {
        calls += 1;
        if (calls < 3) {
          throw new ApiSdkError({
            status: 503,
            url: '/x',
            message: 'down',
            code: 'SERVER_ERROR',
          });
        }
        return 'recovered';
      },
      {
        attempts: 4,
        delaysMs: [10, 20, 30],
        sleepFn: (ms) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
      },
    );
    expect(result).toBe('recovered');
    expect(calls).toBe(3);
    expect(sleeps).toEqual([10, 20]);
  });

  it('does not retry a 400 (validation)', async () => {
    let calls = 0;
    await expect(
      retry(
        async () => {
          calls += 1;
          throw new ApiSdkError({
            status: 400,
            url: '/x',
            message: 'bad',
            code: 'VALIDATION_ERROR',
          });
        },
        { attempts: 3, sleepFn: () => Promise.resolve() },
      ),
    ).rejects.toBeInstanceOf(ApiSdkError);
    expect(calls).toBe(1);
  });

  it('defaultShouldRetry returns true for 429 / 500 / NETWORK_ERROR', () => {
    expect(
      defaultShouldRetry(
        new ApiSdkError({ status: 429, url: '/x', message: 'slow', code: 'RATE_LIMITED' }),
      ),
    ).toBe(true);
    expect(
      defaultShouldRetry(
        new ApiSdkError({ status: 500, url: '/x', message: 'oops', code: 'SERVER_ERROR' }),
      ),
    ).toBe(true);
    expect(
      defaultShouldRetry(
        new ApiSdkError({ status: 0, url: '/x', message: 'no net', code: 'NETWORK_ERROR' }),
      ),
    ).toBe(true);
  });

  it('defaultShouldRetry returns false for 400 / 404', () => {
    expect(
      defaultShouldRetry(
        new ApiSdkError({ status: 400, url: '/x', message: 'bad', code: 'V' }),
      ),
    ).toBe(false);
    expect(
      defaultShouldRetry(
        new ApiSdkError({ status: 404, url: '/x', message: 'gone', code: 'N' }),
      ),
    ).toBe(false);
  });
});
