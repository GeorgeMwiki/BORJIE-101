/**
 * Canary-token types — system-prompt-leakage detection.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §4
 * (Rebuff-pattern: unique strings embedded in SP; if they appear in
 * output, runtime kill-switches the response.)
 */

/**
 * A canary record. Each session gets a fresh canary; never reuse.
 */
export interface CanaryToken {
  /** The opaque canary value embedded in the system prompt. */
  readonly value: string;
  /** Session this canary belongs to. */
  readonly sessionId: string;
  /** UNIX-ms when the canary was issued. */
  readonly issuedAt: number;
  /** UNIX-ms when the canary will be rotated out. */
  readonly expiresAt: number;
  /** Random nonce binding the value to this session. */
  readonly nonce: string;
}

/**
 * Result of `detectCanaryLeak`.
 */
export interface CanaryDetectionResult {
  readonly leaked: boolean;
  readonly canary: CanaryToken;
  /** Position in the response where the canary first appears, if any. */
  readonly position: number;
  readonly reason: string;
}

/**
 * Configuration for the canary generator.
 */
export interface CanaryConfig {
  /** How long a canary is valid for (default: 1 session = 60 min). */
  readonly ttlMs: number;
  /** Prefix used in the canary string (default: 'BNY-CANARY'). */
  readonly prefix: string;
}

export const DEFAULT_CANARY_CONFIG: CanaryConfig = Object.freeze({
  ttlMs: 60 * 60 * 1000,
  prefix: 'BNY-CANARY',
});
