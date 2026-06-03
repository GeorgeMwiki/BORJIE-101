/**
 * Sovereign-claim crypto port.
 *
 * The sovereign-claim verifier is a security *leaf*: it must never reach
 * for `node:crypto` directly so it stays pure, testable, and runnable in
 * any runtime (Node, edge, Workers, browser test harness). All HMAC and
 * constant-time comparison is delegated to an injected `CryptoPort`.
 *
 * The composition root supplies a concrete adapter (a thin wrapper over
 * `node:crypto` `createHmac` + `timingSafeEqual`, or the Web Crypto
 * `subtle` API). Tests supply a deterministic in-memory adapter.
 */

/**
 * Minimal cryptographic surface the sovereign-claim verifier needs.
 *
 * `hmacSha256Hex` returns the lowercase hex HMAC-SHA256 of `message`
 * under `key`. `timingSafeEqualHex` compares two hex digests in
 * constant time and returns `false` (never throws) on any malformed or
 * length-mismatched input.
 */
export interface CryptoPort {
  readonly hmacSha256Hex: (key: string, message: string) => string;
  readonly timingSafeEqualHex: (aHex: string, bHex: string) => boolean;
}
