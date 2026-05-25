import { describe, expect, it } from 'vitest';
import { InMemoryIdempotencyCache } from '../idempotency/trigger-seen.js';

describe('InMemoryIdempotencyCache', () => {
  it('returns false for an unseen key', () => {
    const c = new InMemoryIdempotencyCache();
    expect(c.hasSeenRecently('a', 24)).toBe(false);
  });

  it('returns true after markSeen within window', () => {
    let now = 1_000_000;
    const c = new InMemoryIdempotencyCache(() => now);
    c.markSeen('a', 24);
    expect(c.hasSeenRecently('a', 24)).toBe(true);
  });

  it('expires after the TTL elapses', () => {
    let now = 1_000_000;
    const c = new InMemoryIdempotencyCache(() => now);
    c.markSeen('a', 1); // 1 hour TTL
    now += 2 * 60 * 60 * 1000;
    expect(c.hasSeenRecently('a', 1)).toBe(false);
  });

  it('size reflects current entries', () => {
    const c = new InMemoryIdempotencyCache();
    c.markSeen('a', 1);
    c.markSeen('b', 1);
    expect(c.size()).toBe(2);
  });
});
