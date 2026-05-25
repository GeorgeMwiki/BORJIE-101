/**
 * Credential-stuffing detector.
 *
 * Bots that buy lists of breached `email:password` combos run them
 * against many sites looking for re-use. Defence is to detect bursts
 * of FAILED auth attempts from a single source — high failure rate
 * per (ip, account) within a short window is a strong stuffing signal.
 *
 * We expose two surfaces:
 *
 *   1. `recordAuthAttempt(input)` — call from your auth handler with
 *      `{ ip, accountKey, success, at }`. Returns the current decision.
 *
 *   2. `createCredentialStuffingMiddleware(opts)` — a Hono-shaped
 *      middleware that wraps an auth route, calls the handler, then
 *      asks the detector whether to flag the next attempt. Designed
 *      to be paired with the rate limiter (different signal — stuffing
 *      counts *failures*, rate-limit counts *all* requests).
 *
 * The store is intentionally in-memory only here; for distributed
 * deploys, swap `createInMemoryStuffingStore()` for a Redis-backed
 * adapter that implements the same port (left for ops to wire).
 */

export type StuffingDecision =
  | { readonly verdict: 'ok' }
  | {
      readonly verdict: 'flag';
      readonly reason: 'too_many_failures_per_ip' | 'too_many_failures_per_account';
      readonly windowMs: number;
      readonly failures: number;
    };

export interface RecordAttemptInput {
  readonly ip: string;
  readonly accountKey: string;
  readonly success: boolean;
  readonly at: number;
}

export interface StuffingStore {
  pushFailure(key: string, at: number, windowMs: number): Promise<void>;
  countFailures(key: string, now: number, windowMs: number): Promise<number>;
  clearFailures(key: string): Promise<void>;
}

export function createInMemoryStuffingStore(): StuffingStore {
  const logs = new Map<string, number[]>();
  return {
    async pushFailure(key, at) {
      const arr = logs.get(key);
      if (arr) arr.push(at);
      else logs.set(key, [at]);
    },
    async countFailures(key, now, windowMs) {
      const arr = logs.get(key);
      if (!arr) return 0;
      const cutoff = now - windowMs;
      let i = 0;
      while (i < arr.length && (arr[i] ?? 0) <= cutoff) i++;
      if (i > 0) arr.splice(0, i);
      return arr.length;
    },
    async clearFailures(key) {
      logs.delete(key);
    },
  };
}

export interface StuffingDetectorOptions {
  readonly store?: StuffingStore;
  readonly windowMs?: number; // default 5 min
  readonly failuresPerIpThreshold?: number; // default 20
  readonly failuresPerAccountThreshold?: number; // default 8
  readonly now?: () => number;
}

export interface StuffingDetector {
  recordAuthAttempt(input: RecordAttemptInput): Promise<StuffingDecision>;
}

export function createCredentialStuffingDetector(
  opts: StuffingDetectorOptions = {},
): StuffingDetector {
  const store = opts.store ?? createInMemoryStuffingStore();
  const windowMs = opts.windowMs ?? 5 * 60 * 1000;
  const ipThreshold = opts.failuresPerIpThreshold ?? 20;
  const accountThreshold = opts.failuresPerAccountThreshold ?? 8;
  const now = opts.now ?? Date.now;

  return {
    async recordAuthAttempt({ ip, accountKey, success, at }) {
      const ipKey = `ip:${ip}`;
      const accKey = `account:${accountKey}`;
      if (success) {
        // A successful login clears the streak on the account but NOT
        // the IP — a bot could lift one of the stuffed passwords and
        // succeed once before continuing the rest of the list.
        await store.clearFailures(accKey);
      } else {
        await store.pushFailure(ipKey, at, windowMs);
        await store.pushFailure(accKey, at, windowMs);
      }
      const ipFails = await store.countFailures(ipKey, now(), windowMs);
      if (ipFails >= ipThreshold) {
        return {
          verdict: 'flag',
          reason: 'too_many_failures_per_ip',
          windowMs,
          failures: ipFails,
        };
      }
      const accountFails = await store.countFailures(accKey, now(), windowMs);
      if (accountFails >= accountThreshold) {
        return {
          verdict: 'flag',
          reason: 'too_many_failures_per_account',
          windowMs,
          failures: accountFails,
        };
      }
      return { verdict: 'ok' };
    },
  };
}
