/**
 * Per-vendor connector retry/backoff schedules.
 *
 * LITFIN ref: src/core/integrations/* — empirically-tuned schedules
 * for known third-party APIs. Each schedule respects the vendor's
 * published rate-limit semantics + retry-after headers.
 *
 * Stateless: caller passes the attempt count + last error and gets a
 * `RetryDecision` with the delay to wait.
 */

export interface RetryDecision {
  readonly action: 'retry' | 'give-up';
  readonly delayMs: number;
  readonly reason: string;
}

export interface VendorBackoffPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  /** Exponential factor; 2 = double each time. */
  readonly factor: number;
  /** Random jitter +/- this fraction (e.g. 0.2 = +/-20%). */
  readonly jitterRatio: number;
  /** HTTP status codes that are retryable. */
  readonly retryableStatuses: readonly number[];
  /** HTTP statuses we should never retry (e.g. 401, 403). */
  readonly fatalStatuses: readonly number[];
}

export const STRIPE_POLICY: VendorBackoffPolicy = {
  maxAttempts: 5,
  baseDelayMs: 200,
  maxDelayMs: 30_000,
  factor: 2,
  jitterRatio: 0.25,
  retryableStatuses: [408, 409, 425, 429, 500, 502, 503, 504],
  fatalStatuses: [400, 401, 402, 403, 404, 422],
};

export const MPESA_POLICY: VendorBackoffPolicy = {
  // Daraja is generous with timeouts but flaky during peak hours.
  maxAttempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 15_000,
  factor: 2,
  jitterRatio: 0.3,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
  fatalStatuses: [400, 401, 403, 404],
};

export const TWILIO_POLICY: VendorBackoffPolicy = {
  maxAttempts: 4,
  baseDelayMs: 300,
  maxDelayMs: 15_000,
  factor: 2,
  jitterRatio: 0.25,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
  fatalStatuses: [400, 401, 403, 404],
};

export const OPENAI_POLICY: VendorBackoffPolicy = {
  maxAttempts: 6,
  baseDelayMs: 500,
  maxDelayMs: 60_000,
  factor: 2,
  jitterRatio: 0.4,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
  fatalStatuses: [400, 401, 403, 404],
};

export interface RetryInput {
  readonly attemptCount: number; // 0 = first attempt about to happen
  readonly lastStatus?: number;
  readonly retryAfterMs?: number; // server-supplied
}

/** Pseudo-random for jitter. Caller can wrap to inject. */
const defaultRng = (): number => Math.random();

export const decide = (
  input: RetryInput,
  policy: VendorBackoffPolicy,
  rng: () => number = defaultRng,
): RetryDecision => {
  if (input.lastStatus !== undefined && policy.fatalStatuses.includes(input.lastStatus)) {
    return { action: 'give-up', delayMs: 0, reason: `fatal-status:${input.lastStatus}` };
  }
  if (input.attemptCount >= policy.maxAttempts) {
    return { action: 'give-up', delayMs: 0, reason: 'max-attempts-exceeded' };
  }
  if (
    input.lastStatus !== undefined &&
    !policy.retryableStatuses.includes(input.lastStatus) &&
    input.attemptCount > 0
  ) {
    return { action: 'give-up', delayMs: 0, reason: `non-retryable:${input.lastStatus}` };
  }
  // Honour server-supplied Retry-After if present.
  if (input.retryAfterMs !== undefined && input.retryAfterMs >= 0) {
    return {
      action: 'retry',
      delayMs: Math.min(policy.maxDelayMs, input.retryAfterMs),
      reason: 'retry-after-header',
    };
  }
  const exp = policy.baseDelayMs * Math.pow(policy.factor, input.attemptCount);
  const capped = Math.min(policy.maxDelayMs, exp);
  const jitter = 1 + (rng() * 2 - 1) * policy.jitterRatio;
  const delayMs = Math.max(0, Math.round(capped * jitter));
  return { action: 'retry', delayMs, reason: 'exponential-backoff' };
};
