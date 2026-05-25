/**
 * Platform fee — integer basis-point math.
 *
 * Extracted from `server.ts` so tests can exercise the pure function
 * without mocking the entire express / pino / orchestration import graph.
 * The fee is the only piece of fiscal arithmetic that runs on every
 * payment: keep it pure, integer-only, and host-stable.
 *
 * Why basis points instead of percent?
 *   - `parseFloat('5.0') * 750000 / 100` is host-stable on x86 today
 *     but the IEEE-754 representation has surprises (e.g. 0.1 + 0.2),
 *     and `Number.EPSILON`-level drift compounds across a high-volume
 *     ledger. Integer bps in [0, 10000] sidesteps the problem entirely.
 *   - 1 bps = 0.01% = a granularity finer than any rent-payment fee we
 *     would ever charge.
 */
export interface PlatformFeeEnvLike {
  readonly PLATFORM_FEE_BPS?: string;
  readonly PLATFORM_FEE_PERCENT?: string;
  readonly NODE_ENV?: string;
}

export interface PlatformFeeLogger {
  warn(meta: Record<string, unknown>, msg: string): void;
}

export const PLATFORM_FEE_DEFAULT_BPS = 500;

/**
 * Resolve the configured fee in basis points. Precedence:
 *   PLATFORM_FEE_BPS (preferred) → PLATFORM_FEE_PERCENT (deprecated) →
 *   500 bps (DEV/TEST only — throws in production).
 *
 * P84 audit BUG-HI-5: a deployer who forgets to set `PLATFORM_FEE_BPS`
 * would silently charge 5% on every payment. We now fail-fast in
 * production. In dev/test the 500 bps default is preserved so existing
 * test fixtures keep working but a `logger.warn` is emitted.
 *
 * `logger` is optional so tests can call this in isolation; production
 * passes the pino logger from `server.ts`.
 */
export function resolvePlatformFeeBps(
  env: PlatformFeeEnvLike = process.env as PlatformFeeEnvLike,
  logger?: PlatformFeeLogger,
): number {
  const rawBps = env.PLATFORM_FEE_BPS;
  const rawPercent = env.PLATFORM_FEE_PERCENT;
  if (typeof rawBps === 'string' && rawBps.length > 0) {
    const bps = parseInt(rawBps, 10);
    if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
      throw new Error(
        `PLATFORM_FEE_BPS_INVALID: expected integer in [0, 10000], got "${rawBps}"`,
      );
    }
    return bps;
  }
  if (typeof rawPercent === 'string' && rawPercent.length > 0) {
    if (logger) {
      logger.warn(
        { config: 'PLATFORM_FEE_PERCENT', replacement: 'PLATFORM_FEE_BPS' },
        'DEPRECATED: PLATFORM_FEE_PERCENT — set PLATFORM_FEE_BPS (basis points) instead',
      );
    }
    const pct = parseFloat(rawPercent);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      throw new Error(
        `PLATFORM_FEE_PERCENT_INVALID: expected number in [0, 100], got "${rawPercent}"`,
      );
    }
    return Math.round(pct * 100);
  }
  // No explicit config — fail-fast in production so we never silently
  // charge 5% (the historical default) on real money flows.
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'PLATFORM_FEE_UNCONFIGURED: set PLATFORM_FEE_BPS (preferred, integer basis points in [0, 10000]) or PLATFORM_FEE_PERCENT (deprecated, percent in [0, 100]).',
    );
  }
  if (logger) {
    logger.warn(
      { default: PLATFORM_FEE_DEFAULT_BPS },
      `platform-fee: using DEV default ${PLATFORM_FEE_DEFAULT_BPS} bps — set PLATFORM_FEE_BPS in production`,
    );
  }
  return PLATFORM_FEE_DEFAULT_BPS;
}

/**
 * Compute the platform fee in minor units for `amountMinor` at the
 * configured `bps`. Integer end-to-end:
 *
 *   fee = floor(amountMinor * bps / 10000)
 *
 * Throws on non-integer / out-of-range inputs so a misconfigured caller
 * fails loudly rather than silently charging 0.
 */
export function calculatePlatformFeeMinor(
  amountMinor: number,
  bps: number,
): number {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new Error(
      'calculatePlatformFeeMinor: amountMinor must be a non-negative integer',
    );
  }
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new Error(
      'calculatePlatformFeeMinor: bps must be an integer in [0, 10000]',
    );
  }
  return Math.floor((amountMinor * bps) / 10_000);
}
