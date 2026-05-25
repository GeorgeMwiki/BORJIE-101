import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';

import { createHibpChecker } from '../credential-checks/hibp.js';
import {
  createCredentialStuffingDetector,
  createInMemoryStuffingStore,
} from '../credential-checks/stuffing.js';

function fakeFetchReturning(body: string, ok = true, status = 200) {
  return async (_url: string) => ({
    ok,
    status,
    async text() {
      return body;
    },
  });
}

describe('HIBP k-anonymity password breach checker', () => {
  it('detects a known-breached password (the suffix matches the prefix response)', async () => {
    const plaintext = 'P@ssw0rd123';
    const sha1 = createHash('sha1')
      .update(plaintext, 'utf8')
      .digest('hex')
      .toUpperCase();
    const suffix = sha1.slice(5);
    const fakeBody = [
      `${suffix}:42`,
      `0000000000000000000000000000000000A:1`,
    ].join('\n');
    const checker = createHibpChecker({
      fetch: fakeFetchReturning(fakeBody),
    });
    const result = await checker.check(plaintext);
    expect(result.breached).toBe(true);
    expect(result.count).toBe(42);
    expect(result.source).toBe('hibp');
  });

  it('passes a non-breached password through cleanly', async () => {
    const fakeBody = `0000000000000000000000000000000000A:1`;
    const checker = createHibpChecker({
      fetch: fakeFetchReturning(fakeBody),
    });
    const result = await checker.check('correct horse battery staple');
    expect(result.breached).toBe(false);
    expect(result.source).toBe('hibp');
  });

  it('returns unknown-source when the network is unhealthy', async () => {
    const checker = createHibpChecker({
      fetch: fakeFetchReturning('', false, 503),
    });
    const result = await checker.check('anything');
    expect(result.breached).toBe(false);
    expect(result.source).toBe('unknown');
  });

  it('checkSha1 works without exposing the plaintext', async () => {
    const sha1 = createHash('sha1')
      .update('plaintext', 'utf8')
      .digest('hex')
      .toUpperCase();
    const suffix = sha1.slice(5);
    const checker = createHibpChecker({
      fetch: fakeFetchReturning(`${suffix}:7`),
    });
    const result = await checker.checkSha1(sha1);
    expect(result.breached).toBe(true);
    expect(result.count).toBe(7);
  });

  it('throws when no fetch is available + none provided', () => {
    const original = (globalThis as { fetch?: unknown }).fetch;
    try {
      (globalThis as { fetch?: unknown }).fetch = undefined;
      expect(() => createHibpChecker()).toThrow();
    } finally {
      (globalThis as { fetch?: unknown }).fetch = original;
    }
  });
});

describe('credential-stuffing detector', () => {
  it('flags too-many failures from a single IP', async () => {
    let t = 1_000;
    const detector = createCredentialStuffingDetector({
      store: createInMemoryStuffingStore(),
      windowMs: 60_000,
      failuresPerIpThreshold: 5,
      failuresPerAccountThreshold: 999,
      now: () => t,
    });
    let last;
    for (let i = 0; i < 5; i++) {
      last = await detector.recordAuthAttempt({
        ip: '1.2.3.4',
        accountKey: `user-${i}`,
        success: false,
        at: t,
      });
      t += 1_000;
    }
    expect(last?.verdict).toBe('flag');
    if (last?.verdict === 'flag') {
      expect(last.reason).toBe('too_many_failures_per_ip');
      expect(last.failures).toBe(5);
    }
  });

  it('flags too-many failures against a single account', async () => {
    let t = 1_000;
    const detector = createCredentialStuffingDetector({
      store: createInMemoryStuffingStore(),
      windowMs: 60_000,
      failuresPerIpThreshold: 999,
      failuresPerAccountThreshold: 3,
      now: () => t,
    });
    let last;
    for (let i = 0; i < 3; i++) {
      last = await detector.recordAuthAttempt({
        ip: `1.2.3.${i}`,
        accountKey: 'alice@example.com',
        success: false,
        at: t,
      });
      t += 1_000;
    }
    expect(last?.verdict).toBe('flag');
    if (last?.verdict === 'flag') {
      expect(last.reason).toBe('too_many_failures_per_account');
    }
  });

  it('successful login clears the account streak (but keeps the IP signal)', async () => {
    let t = 1_000;
    const detector = createCredentialStuffingDetector({
      store: createInMemoryStuffingStore(),
      windowMs: 60_000,
      failuresPerIpThreshold: 5,
      failuresPerAccountThreshold: 3,
      now: () => t,
    });
    await detector.recordAuthAttempt({
      ip: '1.2.3.4',
      accountKey: 'alice',
      success: false,
      at: t,
    });
    t += 1_000;
    await detector.recordAuthAttempt({
      ip: '1.2.3.4',
      accountKey: 'alice',
      success: false,
      at: t,
    });
    t += 1_000;
    const cleared = await detector.recordAuthAttempt({
      ip: '1.2.3.4',
      accountKey: 'alice',
      success: true,
      at: t,
    });
    expect(cleared.verdict).toBe('ok');
    t += 1_000;
    // Now a 3rd account failure should NOT immediately re-flag (streak cleared)
    const after = await detector.recordAuthAttempt({
      ip: '1.2.3.4',
      accountKey: 'alice',
      success: false,
      at: t,
    });
    expect(after.verdict).toBe('ok');
  });

  it('old failures fall off the window', async () => {
    const detector = createCredentialStuffingDetector({
      store: createInMemoryStuffingStore(),
      windowMs: 1_000,
      failuresPerIpThreshold: 2,
      failuresPerAccountThreshold: 999,
      now: () => 10_000,
    });
    // Two failures at t=0 and t=500 — but `now()` is 10_000 ms,
    // so both are outside the 1_000 ms window.
    await detector.recordAuthAttempt({
      ip: '9.9.9.9',
      accountKey: 'x',
      success: false,
      at: 0,
    });
    const second = await detector.recordAuthAttempt({
      ip: '9.9.9.9',
      accountKey: 'y',
      success: false,
      at: 500,
    });
    expect(second.verdict).toBe('ok');
  });
});
