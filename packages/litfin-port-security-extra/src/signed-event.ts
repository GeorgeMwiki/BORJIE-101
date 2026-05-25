/**
 * Signed-event-emit primitive.
 *
 * LITFIN ref: src/core/governance/audit/* — emits a domain event with a
 * detached HMAC signature so consumers (SIEM, downstream services) can
 * verify origin without a per-event JWT.
 *
 * Distinct from `@borjie/audit-hash-chain` (which chains events
 * into a tamper-evident log). This is the leaf-emit primitive.
 */

import type { CryptoPort, SecurityClock, TenantId } from './types.js';
import { DEFAULT_SECURITY_CLOCK } from './types.js';

export interface SignedEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly tenantId: TenantId;
  readonly tsMs: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly signature: string; // hex HMAC-SHA256
  readonly signingKeyId: string;
  readonly version: 1;
}

export interface SignerConfig {
  readonly keyId: string;
  readonly secret: string;
}

export interface SignerPort {
  readonly sign: (
    input: Omit<SignedEvent, 'signature' | 'signingKeyId' | 'version'>,
  ) => Promise<SignedEvent>;
  readonly verify: (event: SignedEvent) => Promise<boolean>;
  /** Returns the keyId rotation candidate so callers can re-sign. */
  readonly keyId: () => string;
}

const stableSerialize = (obj: Readonly<Record<string, unknown>>): string => {
  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(obj[k])}`);
  return `{${entries.join(',')}}`;
};

const eventBytes = (
  e: Omit<SignedEvent, 'signature' | 'signingKeyId' | 'version'>,
): string =>
  [
    e.eventId,
    e.eventType,
    e.tenantId,
    String(e.tsMs),
    stableSerialize(e.payload),
  ].join('\n');

export const makeSigner = (
  cfg: SignerConfig,
  crypto: CryptoPort,
  _clock: SecurityClock = DEFAULT_SECURITY_CLOCK,
): SignerPort => ({
  keyId: () => cfg.keyId,
  sign: async (input) => {
    const sig = await crypto.hmacSha256Hex(cfg.secret, eventBytes(input));
    return { ...input, signature: sig, signingKeyId: cfg.keyId, version: 1 };
  },
  verify: async (event) => {
    if (event.version !== 1) return false;
    if (event.signingKeyId !== cfg.keyId) return false;
    const expected = await crypto.hmacSha256Hex(cfg.secret, eventBytes(event));
    return crypto.timingSafeEqualHex(expected, event.signature);
  },
});

/**
 * Multi-key verifier — supports key rotation. Pass all currently-valid
 * key configs; verification succeeds if any key matches.
 */
export const makeMultiKeyVerifier = (
  configs: readonly SignerConfig[],
  crypto: CryptoPort,
): { readonly verify: (event: SignedEvent) => Promise<boolean> } => ({
  verify: async (event) => {
    const cfg = configs.find((c) => c.keyId === event.signingKeyId);
    if (!cfg) return false;
    const expected = await crypto.hmacSha256Hex(cfg.secret, eventBytes(event));
    return crypto.timingSafeEqualHex(expected, event.signature);
  },
});
