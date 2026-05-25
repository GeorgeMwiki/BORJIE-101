/**
 * Slack v0 signing-secret verifier — HMAC-SHA256 over
 * `v0:{timestamp}:{raw_body}`.
 *
 * Reference: https://api.slack.com/authentication/verifying-requests-from-slack
 *
 * Security contract:
 *   - **Timing-safe compare** is mandatory. A naive `===` leaks the
 *     comparison position via timing side-channel; we use
 *     `crypto.timingSafeEqual` over equal-length buffers.
 *   - **5-minute skew window** rejects replays. Slack itself recommends
 *     this; longer windows widen the replay surface (an attacker who
 *     captures a payload can resubmit it for the duration). Configurable
 *     for tests (see `maxSkewSeconds`).
 *   - **Per-tenant signing secret.** The caller MUST look up the
 *     correct secret for the inbound `team_id` (carried in the body)
 *     BEFORE calling this function. Mismatched secret = mismatched
 *     HMAC = `mismatch` outcome — no exception, no information leak.
 *   - **Raw body matters.** Slack signs the exact bytes of the request
 *     body; reserialising parsed JSON would produce a different HMAC.
 *     The caller MUST capture the raw body before any parser touches
 *     it (e.g. via an Express raw-body middleware).
 *
 * Non-throwing API: all failure modes return a discriminated outcome
 * (`{ ok: false, reason }`). Throwing would force callers to wrap
 * every verify in try/catch — that pattern is brittle for HTTP
 * middleware. The discriminator is exhaustive so `noFallthroughCases`
 * catches missing handlers at compile time.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  SlackSignatureVerifyInput,
  SlackSignatureVerifyOutcome,
} from './types.js';

/**
 * Slack's official window is 5 minutes (300 seconds). We narrow to
 * the same default — any wider and a captured payload becomes
 * replayable for too long; any narrower and clock skew between
 * Slack's edge and the BORJIE app server starts causing false
 * negatives.
 */
const DEFAULT_MAX_SKEW_SECONDS = 60 * 5;

/**
 * Slack's signature header is `v0=<hex>`. Other versions may exist in
 * the future; we lock to `v0` explicitly because every cryptographic
 * scheme should be version-pinned.
 */
const SIGNATURE_VERSION = 'v0';

/** Options for {@link verifySlackSignature}. */
export interface VerifySlackSignatureOptions {
  /**
   * Override the maximum skew (in seconds). Production: leave
   * default. Tests: pass `Number.POSITIVE_INFINITY` to disable the
   * skew check when asserting on signature-only properties.
   */
  readonly maxSkewSeconds?: number;
  /**
   * Clock injection for deterministic tests. Returns the current
   * unix time in seconds (NOT ms).
   */
  readonly nowSeconds?: () => number;
}

/**
 * Verify a Slack event-subscription signature.
 *
 * Always non-throwing. Returns `{ ok: true }` only when ALL checks
 * pass:
 *   1. Signature header present and well-formed (`v0=<64 hex chars>`).
 *   2. Timestamp header present and parsable as a unix-second integer.
 *   3. Timestamp within the skew window.
 *   4. HMAC-SHA256 over `v0:{timestamp}:{rawBody}` matches the header.
 */
export function verifySlackSignature(
  input: SlackSignatureVerifyInput,
  options: VerifySlackSignatureOptions = {},
): SlackSignatureVerifyOutcome {
  const { signature, timestamp, signingSecret, rawBody } = input;

  // 1. Header presence
  if (typeof signature !== 'string' || signature.length === 0) {
    return { ok: false, reason: 'missing-signature' };
  }
  if (typeof timestamp !== 'string' || timestamp.length === 0) {
    return { ok: false, reason: 'missing-timestamp' };
  }

  // 2. Signature header well-formedness — `v0=<hex>`.
  if (!signature.startsWith(`${SIGNATURE_VERSION}=`)) {
    return { ok: false, reason: 'malformed-signature' };
  }
  const providedHex = signature.slice(SIGNATURE_VERSION.length + 1);
  // SHA-256 hex = 64 chars. Defensive — `timingSafeEqual` itself
  // requires equal-length buffers, but a length mismatch here is
  // an attacker-controlled malformed input, not a verification
  // mismatch, so distinguish them.
  if (providedHex.length !== 64 || !/^[a-f0-9]+$/i.test(providedHex)) {
    return { ok: false, reason: 'malformed-signature' };
  }

  // 3. Timestamp parse + skew check
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || ts <= 0) {
    return { ok: false, reason: 'missing-timestamp' };
  }
  const maxSkew = options.maxSkewSeconds ?? DEFAULT_MAX_SKEW_SECONDS;
  const nowSec = options.nowSeconds ? options.nowSeconds() : Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > maxSkew) {
    return { ok: false, reason: 'timestamp-skew' };
  }

  // 4. Compute expected HMAC and timing-safe compare.
  const baseString = `${SIGNATURE_VERSION}:${ts}:${rawBody}`;
  const expectedHex = createHmac('sha256', signingSecret).update(baseString, 'utf8').digest('hex');

  const expectedBuf = Buffer.from(expectedHex, 'utf8');
  const providedBuf = Buffer.from(providedHex.toLowerCase(), 'utf8');

  // `timingSafeEqual` throws on unequal lengths — we've already
  // validated providedHex.length === 64, and expectedHex from
  // SHA-256 hex is always 64, so this is safe. Belt-and-braces:
  // guard explicitly so a future regression in the validator above
  // can't reach an unhandled exception.
  if (expectedBuf.length !== providedBuf.length) {
    return { ok: false, reason: 'mismatch' };
  }
  if (!timingSafeEqual(expectedBuf, providedBuf)) {
    return { ok: false, reason: 'mismatch' };
  }

  return { ok: true };
}
