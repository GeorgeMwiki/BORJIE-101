/**
 * Activation-attempt throttle (hardening SEC-1) — best-effort per-phone
 * brute-force guard on the PUBLIC /workforce/invites/activate route.
 *
 * The PRIMARY defense is code entropy (the activation code is now ~49 bits,
 * see generateActivationCode) — brute force is infeasible by math regardless
 * of this throttle. This module is defense-in-depth: it caps wrong-code
 * attempts per phone so a single replica also refuses to be hammered.
 *
 * In-process by design: the route is pre-auth (no tenant context, no pinned
 * connection), and the entropy already closes the cross-replica gap, so a
 * Redis round-trip on every activation is not worth it. The map is bounded
 * and self-expiring; a full map is cleared wholesale (the worst case is a
 * brief loss of throttle memory, never a crash). No console.* — silent.
 */

const MAX_FAILED_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_TRACKED_PHONES = 50_000;

interface AttemptRecord {
  failures: number;
  firstAttemptMs: number;
  lockedUntilMs: number;
}

const attempts = new Map<string, AttemptRecord>();

/** Test seam + memory hygiene. */
export function clearActivationThrottle(): void {
  attempts.clear();
}

export interface ThrottleDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

/**
 * Check whether a phone may attempt activation right now. Call BEFORE the
 * code comparison. `nowMs` is injectable for tests.
 */
export function checkActivationAllowed(
  phoneE164: string,
  nowMs: number = Date.now(),
): ThrottleDecision {
  const rec = attempts.get(phoneE164);
  if (!rec) return { allowed: true, retryAfterSeconds: 0 };
  if (rec.lockedUntilMs > nowMs) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((rec.lockedUntilMs - nowMs) / 1000),
    };
  }
  // Window elapsed → the record is stale; treat as a fresh slate.
  if (nowMs - rec.firstAttemptMs > WINDOW_MS) {
    attempts.delete(phoneE164);
    return { allowed: true, retryAfterSeconds: 0 };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Record a FAILED activation attempt (wrong code). Returns the decision for
 * the NEXT attempt (so the caller can surface a lockout immediately on the
 * attempt that crosses the threshold).
 */
export function recordFailedActivation(
  phoneE164: string,
  nowMs: number = Date.now(),
): ThrottleDecision {
  if (attempts.size >= MAX_TRACKED_PHONES && !attempts.has(phoneE164)) {
    // Bounded memory: drop the whole map rather than grow unbounded. The
    // entropy defense means losing throttle memory is not a security event.
    attempts.clear();
  }
  const existing = attempts.get(phoneE164);
  const rec: AttemptRecord =
    existing && nowMs - existing.firstAttemptMs <= WINDOW_MS
      ? { ...existing, failures: existing.failures + 1 }
      : { failures: 1, firstAttemptMs: nowMs, lockedUntilMs: 0 };

  if (rec.failures >= MAX_FAILED_ATTEMPTS) {
    rec.lockedUntilMs = nowMs + WINDOW_MS;
  }
  attempts.set(phoneE164, rec);
  return rec.lockedUntilMs > nowMs
    ? {
        allowed: false,
        retryAfterSeconds: Math.ceil((rec.lockedUntilMs - nowMs) / 1000),
      }
    : { allowed: true, retryAfterSeconds: 0 };
}

/** Clear a phone's record on SUCCESSFUL activation. */
export function clearActivationAttempts(phoneE164: string): void {
  attempts.delete(phoneE164);
}
