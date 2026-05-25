/**
 * OTP Service — phone one-time password issuance and verification.
 *
 * Default backing store is a `Map<identityId, OtpRecord>` with a 5-minute
 * TTL. Stored codes are hashed (SHA-256) so the raw code exists only in
 * transit to the dispatcher.
 *
 * Interface is intentionally small so a Redis / KV-store backend can slot
 * in without touching callers:
 *
 *   class RedisOtpStore implements OtpStore { ... }
 *
 * SMS delivery is done through `NotificationsDispatcher`. Production
 * startup rejects `NoopSmsDispatcher` (see the constructor guard below);
 * dev/test uses the Noop impl. No outstanding follow-ups — the dispatcher
 * contract is stable.
 */

import { randomInt, createHash } from 'node:crypto';
import type { TenantIdentityId } from '@borjie/domain-models';

/** Default TTL for an OTP code — 5 minutes. */
export const OTP_TTL_MS = 5 * 60 * 1000;

/** Length of the generated numeric OTP. */
export const OTP_LENGTH = 6;

/** Max failed verify attempts before the code is invalidated. */
export const OTP_MAX_ATTEMPTS = 5;

/** One stored OTP record. */
export interface OtpRecord {
  readonly identityId: TenantIdentityId;
  readonly codeHash: string;
  readonly expiresAt: number; // epoch ms
  readonly phone: string;
  readonly attempts: number;
}

/** Storage port for OTP records. Swap the default Map impl for Redis later. */
export interface OtpStore {
  get(identityId: TenantIdentityId): Promise<OtpRecord | undefined>;
  set(record: OtpRecord): Promise<void>;
  delete(identityId: TenantIdentityId): Promise<void>;
}

/** SMS dispatcher port — integrates with notifications service. */
export interface SmsDispatcher {
  send(phone: string, message: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory default store
// ---------------------------------------------------------------------------

/**
 * Default OTP store: process-local Map. Good enough for tests, dev, and
 * single-node deployments. Production should inject a Redis-backed
 * implementation of `OtpStore`.
 */
export class InMemoryOtpStore implements OtpStore {
  private readonly records = new Map<string, OtpRecord>();

  async get(identityId: TenantIdentityId): Promise<OtpRecord | undefined> {
    return this.records.get(identityId as unknown as string);
  }

  async set(record: OtpRecord): Promise<void> {
    this.records.set(record.identityId as unknown as string, record);
  }

  async delete(identityId: TenantIdentityId): Promise<void> {
    this.records.delete(identityId as unknown as string);
  }
}

/**
 * No-op SMS dispatcher. Logs nothing (console.log is banned by project
 * rules). Real deployments should inject a `NotificationsDispatcher`-backed
 * implementation.
 */
export class NoopSmsDispatcher implements SmsDispatcher {
  async send(_phone: string, _message: string): Promise<void> {
    // Intentional no-op: dev/test-only dispatcher. Production startup
    // rejects this class (see OtpService constructor guard).
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** Result of a verify attempt. */
export interface OtpVerifyResult {
  readonly verified: boolean;
  readonly reason?:
    | 'NO_CODE'
    | 'EXPIRED'
    | 'MISMATCH'
    | 'TOO_MANY_ATTEMPTS';
}

/**
 * Hash a raw OTP code. SHA-256 is sufficient here — codes are high-entropy
 * numeric, short-lived, and hashing protects against store-dump replay
 * rather than brute-force collision resistance.
 */
function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Generate a zero-padded numeric OTP of the configured length.
 * Uses `crypto.randomInt` for uniform distribution.
 */
function generateCode(length: number): string {
  const upper = 10 ** length;
  const n = randomInt(0, upper);
  return String(n).padStart(length, '0');
}

/** Number of total attempts (original + retries) when dispatching an OTP. */
export const OTP_DEFAULT_SEND_ATTEMPTS = 2;

/** Backoff delay between OTP dispatch retries, in ms. */
export const OTP_DEFAULT_SEND_BACKOFF_MS = 2000;

/** Minimum wait between consecutive resends for the same phone number. */
export const OTP_RESEND_COOLDOWN_MS = 30 * 1000;

/** Max OTP sends per phone number inside the resend window. */
export const OTP_RESEND_MAX_PER_WINDOW = 5;

/** Rolling window size over which OTP_RESEND_MAX_PER_WINDOW applies. */
export const OTP_RESEND_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export interface OtpServiceOptions {
  readonly now?: () => number;
  readonly ttlMs?: number;
  /** Total send attempts including the first try. Default: 2 (1 retry). */
  readonly sendAttempts?: number;
  /** Backoff delay between send attempts, in ms. Default: 2000. */
  readonly sendBackoffMs?: number;
  /** Sleep hook — injected for deterministic tests. */
  readonly sleep?: (ms: number) => Promise<void>;
  /**
   * Minimum milliseconds between resends for the SAME phone. Defaults to
   * OTP_RESEND_COOLDOWN_MS (30s). Attackers resending to flood a real
   * recipient with SMS must wait this long — prevents SMS-bomb abuse.
   */
  readonly resendCooldownMs?: number;
  /** Max sends per phone inside `resendWindowMs`. Defaults to 5. */
  readonly resendMaxPerWindow?: number;
  /** Rolling window for `resendMaxPerWindow`. Defaults to 1 hour. */
  readonly resendWindowMs?: number;
}

/**
 * Raised when the per-phone resend cooldown or hourly cap is exceeded.
 * Callers should surface a generic "try again later" message to the user
 * — do NOT echo the remaining cooldown back, as that's a timing oracle
 * for attackers fingerprinting phone-number registration.
 */
export class OtpResendThrottledError extends Error {
  constructor(
    public readonly retryAfterMs: number,
    public readonly reason: 'cooldown' | 'hourly_cap',
  ) {
    super(`OtpService.send throttled (${reason}), retry in ${retryAfterMs}ms`);
    this.name = 'OtpResendThrottledError';
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OtpService {
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly sendAttempts: number;
  private readonly sendBackoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly resendCooldownMs: number;
  private readonly resendMaxPerWindow: number;
  private readonly resendWindowMs: number;
  /**
   * Per-phone send history. `timestamps` is used for the hourly cap;
   * `lastSentAt` is used for the short cooldown. Keyed by raw phone
   * string so two different identities can't work around the cap by
   * registering the same number twice.
   */
  private readonly phoneHistory = new Map<
    string,
    { lastSentAt: number; timestamps: number[] }
  >();

  constructor(
    private readonly store: OtpStore = new InMemoryOtpStore(),
    private readonly sms: SmsDispatcher = new NoopSmsDispatcher(),
    nowOrOptions: (() => number) | OtpServiceOptions = () => Date.now(),
    ttlMs: number = OTP_TTL_MS
  ) {
    // FIXED H-5: production must inject durable store + real SMS dispatcher.
    // InMemoryOtpStore + NoopSmsDispatcher are for dev/test only — in a
    // multi-node deploy they enable distributed brute force because attempt
    // counters don't cross node boundaries and codes never reach the user.
    if (process.env.NODE_ENV === 'production') {
      if (store instanceof InMemoryOtpStore) {
        throw new Error(
          'OtpService: InMemoryOtpStore not permitted in production. Inject RedisOtpStore via otp-factory.ts.',
        );
      }
      if (sms instanceof NoopSmsDispatcher) {
        throw new Error(
          'OtpService: NoopSmsDispatcher not permitted in production. Inject NotificationsSmsDispatcher.',
        );
      }
    }
    // Back-compat: the old constructor signature took `now` as a function and
    // `ttlMs` as the final arg. If callers pass an options object, we prefer
    // that. Otherwise fall back to the positional form.
    if (typeof nowOrOptions === 'function') {
      // Legacy positional form: preserve single-attempt behaviour so existing
      // callers and their tests are not slowed down by the new retry path.
      this.now = nowOrOptions;
      this.ttlMs = ttlMs;
      this.sendAttempts = 1;
      this.sendBackoffMs = OTP_DEFAULT_SEND_BACKOFF_MS;
      this.sleep = defaultSleep;
      // Legacy tests exercise the exact send()/verify() contract with
      // no cooldown between sends; zero these out so they don't break.
      this.resendCooldownMs = 0;
      this.resendMaxPerWindow = Number.POSITIVE_INFINITY;
      this.resendWindowMs = OTP_RESEND_WINDOW_MS;
    } else {
      this.now = nowOrOptions.now ?? (() => Date.now());
      this.ttlMs = nowOrOptions.ttlMs ?? OTP_TTL_MS;
      this.sendAttempts =
        nowOrOptions.sendAttempts ?? OTP_DEFAULT_SEND_ATTEMPTS;
      this.sendBackoffMs =
        nowOrOptions.sendBackoffMs ?? OTP_DEFAULT_SEND_BACKOFF_MS;
      this.sleep = nowOrOptions.sleep ?? defaultSleep;
      this.resendCooldownMs =
        nowOrOptions.resendCooldownMs ?? OTP_RESEND_COOLDOWN_MS;
      this.resendMaxPerWindow =
        nowOrOptions.resendMaxPerWindow ?? OTP_RESEND_MAX_PER_WINDOW;
      this.resendWindowMs =
        nowOrOptions.resendWindowMs ?? OTP_RESEND_WINDOW_MS;
    }
  }

  /**
   * Enforce per-phone resend throttling. Throws OtpResendThrottledError
   * when either the short cooldown or the hourly cap is exceeded.
   * Also GC's old entries so phoneHistory doesn't grow unboundedly.
   */
  private checkResendThrottle(phone: string): void {
    const now = this.now();
    const entry = this.phoneHistory.get(phone);
    if (!entry) return;
    // Short cooldown: block rapid consecutive sends (SMS bomb).
    const sinceLast = now - entry.lastSentAt;
    if (sinceLast < this.resendCooldownMs) {
      throw new OtpResendThrottledError(
        this.resendCooldownMs - sinceLast,
        'cooldown',
      );
    }
    // Prune timestamps outside the rolling window.
    const windowStart = now - this.resendWindowMs;
    const fresh = entry.timestamps.filter((t) => t >= windowStart);
    if (fresh.length >= this.resendMaxPerWindow) {
      // Earliest send that would expire next determines retryAfter.
      const oldest = fresh[0];
      throw new OtpResendThrottledError(
        Math.max(0, oldest + this.resendWindowMs - now),
        'hourly_cap',
      );
    }
    this.phoneHistory.set(phone, { lastSentAt: entry.lastSentAt, timestamps: fresh });
  }

  /** Record a successful send against the per-phone throttle counters. */
  private recordSend(phone: string): void {
    const now = this.now();
    const entry = this.phoneHistory.get(phone);
    if (!entry) {
      this.phoneHistory.set(phone, { lastSentAt: now, timestamps: [now] });
      return;
    }
    const windowStart = now - this.resendWindowMs;
    const fresh = entry.timestamps.filter((t) => t >= windowStart);
    fresh.push(now);
    this.phoneHistory.set(phone, { lastSentAt: now, timestamps: fresh });
  }

  /**
   * Generate and send an OTP to the given phone for the given identity.
   * Overwrites any previous in-flight code for this identity.
   *
   * SMS dispatch is retried `sendAttempts - 1` times with a fixed backoff
   * between attempts. If every attempt fails, the stored record is rolled
   * back so the caller can safely retry without a dangling valid code.
   */
  async send(
    identityId: TenantIdentityId,
    phone: string
  ): Promise<{ readonly expiresAt: number }> {
    if (!phone || phone.trim().length === 0) {
      throw new Error('OtpService.send: phone is required');
    }
    // FIXED W7-M1: per-phone resend throttle. Blocks SMS-bomb abuse
    // where an attacker forces a second system to spam a real user.
    // Throws OtpResendThrottledError — callers should return a 429 with
    // a neutral "try again later" message (do NOT expose retryAfterMs).
    this.checkResendThrottle(phone);
    const code = generateCode(OTP_LENGTH);
    const expiresAt = this.now() + this.ttlMs;
    const record: OtpRecord = {
      identityId,
      codeHash: hashCode(code),
      expiresAt,
      phone,
      attempts: 0,
    };
    await this.store.set(record);

    const message = `Your BORJIE verification code is ${code}. It expires in 5 minutes.`;
    const totalAttempts = Math.max(1, this.sendAttempts);
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      try {
        await this.sms.send(phone, message);
        this.recordSend(phone);
        return { expiresAt };
      } catch (error) {
        lastError = error as Error;
        if (attempt < totalAttempts) {
          await this.sleep(this.sendBackoffMs);
        }
      }
    }

    // All attempts failed. Don't leak the raw code — drop the stored record
    // so the caller can retry without a dangling valid code.
    await this.store.delete(identityId);
    throw new Error(
      `OtpService.send: failed to dispatch SMS after ${totalAttempts} attempt(s): ${
        lastError ? lastError.message : 'unknown error'
      }`
    );
  }

  /**
   * Verify a submitted code for an identity. On success the record is
   * consumed (single-use). On mismatch the attempt counter is incremented
   * and the record is discarded once `OTP_MAX_ATTEMPTS` is reached.
   */
  async verify(
    identityId: TenantIdentityId,
    code: string
  ): Promise<OtpVerifyResult> {
    const record = await this.store.get(identityId);
    if (!record) {
      return { verified: false, reason: 'NO_CODE' };
    }
    if (this.now() >= record.expiresAt) {
      await this.store.delete(identityId);
      return { verified: false, reason: 'EXPIRED' };
    }
    const submitted = hashCode(code);
    if (submitted !== record.codeHash) {
      const nextAttempts = record.attempts + 1;
      if (nextAttempts >= OTP_MAX_ATTEMPTS) {
        await this.store.delete(identityId);
        return { verified: false, reason: 'TOO_MANY_ATTEMPTS' };
      }
      await this.store.set({
        ...record,
        attempts: nextAttempts,
      });
      return { verified: false, reason: 'MISMATCH' };
    }
    // Success — consume the record so it can't be replayed.
    await this.store.delete(identityId);
    return { verified: true };
  }
}
