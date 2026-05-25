import { describe, expect, it } from 'vitest';
import {
  createExpiredTokenCleanupPass,
  createInMemoryTokenAdapter,
} from '../index.js';

const now = () => new Date('2026-05-25T10:00:00.000Z');
const signal = new AbortController().signal;

describe('expired-token-cleanup pass', () => {
  it('purges expired tokens only', async () => {
    const adapter = createInMemoryTokenAdapter([
      { id: 'old', kind: 'session', expiresAt: '2020-01-01T00:00:00.000Z' },
      { id: 'future', kind: 'session', expiresAt: '2099-01-01T00:00:00.000Z' },
    ]);
    const pass = createExpiredTokenCleanupPass(adapter);
    const result = await pass.run({ abortSignal: signal, now });
    expect(adapter.purged()).toEqual(['old']);
    expect(result.itemsEmitted).toBe(1);
  });

  it('handles empty token table', async () => {
    const adapter = createInMemoryTokenAdapter([]);
    const pass = createExpiredTokenCleanupPass(adapter);
    const result = await pass.run({ abortSignal: signal, now });
    expect(result.itemsEmitted).toBe(0);
  });
});
