/**
 * SHA-256 hash-chain helpers for the message log.
 *
 * Hash computation (deterministic, JSON-stable):
 *
 *   hash = sha256(
 *     prev_hash ||
 *     thread_id ||
 *     role      ||
 *     canonical_jsonb(content_jsonb) ||
 *     created_at_iso
 *   )
 *
 * Genesis row uses `GENESIS_HASH` as `prev_hash`. The thread row stores
 * the genesis value in `message_chain_root_hash` so the chain can be
 * re-verified end-to-end from the thread record alone.
 */

import { createHash } from 'node:crypto';

export const GENESIS_HASH = '0'.repeat(64);

// ─────────────────────────────────────────────────────────────────────
// Canonical JSON stringify — stable across object key order so the
// hash is reproducible regardless of how the upstream serialised the
// content blob.
// ─────────────────────────────────────────────────────────────────────

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const body = keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',');
  return `{${body}}`;
}

// ─────────────────────────────────────────────────────────────────────
// Hash computation
// ─────────────────────────────────────────────────────────────────────

export interface ComputeMessageHashArgs {
  readonly prevHash: string;
  readonly threadId: string;
  readonly role: string;
  readonly contentJsonb: unknown;
  readonly createdAtIso: string;
}

export function computeMessageHash(args: ComputeMessageHashArgs): string {
  const payload = [
    args.prevHash,
    args.threadId,
    args.role,
    canonicalJson(args.contentJsonb),
    args.createdAtIso,
  ].join('|');
  return createHash('sha256').update(payload).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────
// Chain verification
// ─────────────────────────────────────────────────────────────────────

export interface MessageHashRow {
  readonly threadId: string;
  readonly role: string;
  readonly contentJsonb: unknown;
  readonly createdAt: Date;
  readonly prevHash: string | undefined;
  readonly hash: string;
}

export interface ChainVerifyResult {
  readonly valid: boolean;
  /** Index of the first broken message, or -1 when valid. */
  readonly brokenAt: number;
  readonly reason?: string;
}

/**
 * Verify a sequence of messages forms a continuous hash chain. The
 * input is expected to be ordered oldest→newest, with the first row's
 * `prevHash` equal to `chainRootHash`.
 */
export function verifyMessageChain(args: {
  readonly chainRootHash: string;
  readonly messages: ReadonlyArray<MessageHashRow>;
}): ChainVerifyResult {
  let expectedPrev = args.chainRootHash;
  for (let i = 0; i < args.messages.length; i += 1) {
    const m = args.messages[i];
    if (!m) {
      return {
        valid: false,
        brokenAt: i,
        reason: `message at index ${i} is undefined`,
      };
    }
    if ((m.prevHash ?? expectedPrev) !== expectedPrev) {
      return {
        valid: false,
        brokenAt: i,
        reason: `prev_hash mismatch at index ${i}: expected ${expectedPrev}, got ${m.prevHash}`,
      };
    }
    const computed = computeMessageHash({
      prevHash: expectedPrev,
      threadId: m.threadId,
      role: m.role,
      contentJsonb: m.contentJsonb,
      createdAtIso: m.createdAt.toISOString(),
    });
    if (computed !== m.hash) {
      return {
        valid: false,
        brokenAt: i,
        reason: `hash mismatch at index ${i}: expected ${computed}, got ${m.hash}`,
      };
    }
    expectedPrev = m.hash;
  }
  return { valid: true, brokenAt: -1 };
}
