/**
 * Activation-attempt throttle (hardening SEC-1) — the per-phone brute-force
 * guard that backs the high-entropy activation code.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  checkActivationAllowed,
  recordFailedActivation,
  clearActivationAttempts,
  clearActivationThrottle,
} from '../activation-throttle';

const PHONE = '+255712345678';

beforeEach(() => {
  clearActivationThrottle();
});

describe('activation throttle', () => {
  it('allows attempts under the threshold', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i += 1) {
      expect(checkActivationAllowed(PHONE, t0).allowed).toBe(true);
      recordFailedActivation(PHONE, t0);
    }
    // 4 failures < 5 threshold → still allowed.
    expect(checkActivationAllowed(PHONE, t0).allowed).toBe(true);
  });

  it('locks out after the 5th failed attempt', () => {
    const t0 = 1_000_000;
    let decision = { allowed: true, retryAfterSeconds: 0 };
    for (let i = 0; i < 5; i += 1) {
      decision = recordFailedActivation(PHONE, t0);
    }
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
    // A subsequent check during the lock window is refused.
    expect(checkActivationAllowed(PHONE, t0 + 1000).allowed).toBe(false);
  });

  it('the lock expires after the window', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i += 1) recordFailedActivation(PHONE, t0);
    expect(checkActivationAllowed(PHONE, t0).allowed).toBe(false);
    // 10 min + 1ms later → fresh slate.
    expect(checkActivationAllowed(PHONE, t0 + 10 * 60 * 1000 + 1).allowed).toBe(
      true,
    );
  });

  it('a successful activation clears the record', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i += 1) recordFailedActivation(PHONE, t0);
    clearActivationAttempts(PHONE);
    // Cleared → the next failure starts a fresh count, not at 4.
    const d = recordFailedActivation(PHONE, t0);
    expect(d.allowed).toBe(true);
  });

  it('throttles each phone independently', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i += 1) recordFailedActivation(PHONE, t0);
    expect(checkActivationAllowed(PHONE, t0).allowed).toBe(false);
    expect(checkActivationAllowed('+255700000000', t0).allowed).toBe(true);
  });
});
