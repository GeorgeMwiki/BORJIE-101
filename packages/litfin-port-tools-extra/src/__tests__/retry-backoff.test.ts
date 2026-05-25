import { describe, expect, it } from 'vitest';
import {
  MPESA_POLICY,
  OPENAI_POLICY,
  STRIPE_POLICY,
  TWILIO_POLICY,
  decide,
} from '../retry-backoff.js';

const fixedRng = (n: number) => () => n;

describe('retry-backoff', () => {
  it('gives up on fatal status', () => {
    const out = decide({ attemptCount: 0, lastStatus: 401 }, STRIPE_POLICY, fixedRng(0.5));
    expect(out.action).toBe('give-up');
    expect(out.reason).toContain('fatal-status');
  });

  it('retries on 429 with exponential backoff', () => {
    const out = decide(
      { attemptCount: 1, lastStatus: 429 },
      STRIPE_POLICY,
      fixedRng(0.5), // jitter factor = 1.0
    );
    expect(out.action).toBe('retry');
    expect(out.delayMs).toBe(STRIPE_POLICY.baseDelayMs * STRIPE_POLICY.factor);
  });

  it('honours Retry-After header', () => {
    const out = decide(
      { attemptCount: 0, lastStatus: 429, retryAfterMs: 5000 },
      STRIPE_POLICY,
      fixedRng(0),
    );
    expect(out.action).toBe('retry');
    expect(out.delayMs).toBe(5000);
    expect(out.reason).toBe('retry-after-header');
  });

  it('caps delay at maxDelayMs', () => {
    const out = decide(
      { attemptCount: 99, lastStatus: 500 },
      STRIPE_POLICY,
      fixedRng(0.5),
    );
    expect(out.delayMs).toBeLessThanOrEqual(STRIPE_POLICY.maxDelayMs);
  });

  it('gives up after max attempts', () => {
    const out = decide(
      { attemptCount: STRIPE_POLICY.maxAttempts, lastStatus: 500 },
      STRIPE_POLICY,
      fixedRng(0.5),
    );
    expect(out.action).toBe('give-up');
    expect(out.reason).toBe('max-attempts-exceeded');
  });

  it('first attempt with no status always retries', () => {
    const out = decide({ attemptCount: 0 }, STRIPE_POLICY, fixedRng(0.5));
    expect(out.action).toBe('retry');
  });

  it('subsequent attempt with non-retryable status gives up', () => {
    const out = decide(
      { attemptCount: 1, lastStatus: 418 }, // I'm a teapot, not in retryables or fatals
      STRIPE_POLICY,
      fixedRng(0.5),
    );
    expect(out.action).toBe('give-up');
    expect(out.reason).toContain('non-retryable');
  });

  it('MPESA policy retries on 429', () => {
    const out = decide({ attemptCount: 0, lastStatus: 429 }, MPESA_POLICY, fixedRng(0.5));
    expect(out.action).toBe('retry');
  });

  it('TWILIO policy max attempts honoured', () => {
    expect(TWILIO_POLICY.maxAttempts).toBe(4);
  });

  it('OPENAI policy max delay is 60s', () => {
    expect(OPENAI_POLICY.maxDelayMs).toBe(60_000);
  });

  it('jitter applies symmetrically (rng=0 -> -jitter)', () => {
    const out = decide(
      { attemptCount: 1, lastStatus: 500 },
      STRIPE_POLICY,
      fixedRng(0), // (rng*2-1) = -1 -> full negative jitter
    );
    // baseDelay * factor^1 = 400; with jitter (1 - 0.25) = 300
    expect(out.delayMs).toBe(Math.round(400 * 0.75));
  });
});
