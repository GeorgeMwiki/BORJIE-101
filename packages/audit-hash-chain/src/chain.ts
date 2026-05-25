/**
 * Hash-chain audit primitive — append, verify, rotate.
 *
 * Pure functions, no I/O. Caller is responsible for persistence.
 *
 * Algorithm:
 *
 *   prevHash    = previous row's rowHash (or `GENESIS` for the first)
 *   rowHash     = sha256(canonicalJson({ prev: prevHash, payload, secret?: secretValue }))
 *
 * Secret rotation: when a secret is provided, `secretId` is stamped on
 * the entry. Verification looks up the secret value via the supplied
 * `SecretRing`. A missing secret in the ring produces a verification
 * failure with `reason = "secret_unknown"`.
 *
 * Reference: Trillian (Google) transparent logs; Rekor v2 (sigstore);
 * QMDB arXiv 2501.05262. Linear chain — Merkle-tree co-signed STH is a
 * follow-up.
 */

import { createHash, createHmac } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import {
  GENESIS_HASH,
  type AuditPayload,
  type ChainEntry,
  type ChainVerificationResult,
  type SecretRing,
} from "./types.js";

// ---------------------------------------------------------------------------
// Core hashing
// ---------------------------------------------------------------------------

interface HashInput {
  readonly prev: string;
  readonly payload: AuditPayload;
  readonly secretId?: string;
}

interface SealOptions {
  readonly secretId?: string;
  readonly secretValue?: string;
  readonly sealedAtIso?: string;
}

/**
 * Compute the sha256/hmac of a row given the previous row's hash and
 * the payload. When `secretValue` is present, the hash is HMAC-SHA256
 * over the canonical form — protecting against an attacker that
 * controls the chain storage but not the secret.
 */
export function chainHash(
  input: HashInput,
  secretValue?: string,
): string {
  const canonical = canonicalJson({
    prev: input.prev,
    payload: input.payload,
    ...(input.secretId !== undefined ? { secretId: input.secretId } : {}),
  });
  if (secretValue !== undefined && secretValue.length > 0) {
    return createHmac("sha256", secretValue).update(canonical).digest("hex");
  }
  return createHash("sha256").update(canonical).digest("hex");
}

// ---------------------------------------------------------------------------
// Append
// ---------------------------------------------------------------------------

/**
 * Append a new entry to an existing chain. Returns a NEW chain — the
 * input is never mutated (immutable per coding-style.md).
 */
export function appendEntry(
  chain: ReadonlyArray<ChainEntry>,
  payload: AuditPayload,
  options: SealOptions = {},
): ReadonlyArray<ChainEntry> {
  const last = chain.length > 0 ? chain[chain.length - 1] : null;
  const prevHash = last ? last.rowHash : GENESIS_HASH;
  const index = last ? last.index + 1 : 0;
  const sealedAtIso = options.sealedAtIso ?? new Date().toISOString();
  const rowHash = chainHash(
    {
      prev: prevHash,
      payload,
      ...(options.secretId !== undefined ? { secretId: options.secretId } : {}),
    },
    options.secretValue,
  );
  const entry: ChainEntry = {
    index,
    prevHash,
    rowHash,
    payload,
    sealedAtIso,
    ...(options.secretId !== undefined ? { secretId: options.secretId } : {}),
  };
  return [...chain, entry];
}

/**
 * Convenience: seal a single payload-only entry (no chain context).
 * Useful for genesis-style stand-alone events.
 */
export function hashChainEntry(args: {
  readonly prev?: string;
  readonly payload: AuditPayload;
  readonly secretId?: string;
  readonly secretValue?: string;
}): string {
  return chainHash(
    {
      prev: args.prev ?? GENESIS_HASH,
      payload: args.payload,
      ...(args.secretId !== undefined ? { secretId: args.secretId } : {}),
    },
    args.secretValue,
  );
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

/**
 * Verify a chain segment in order. Returns `{ ok: true, scanned }` on
 * success. On failure, returns the first broken index with the
 * expected vs actual hashes — so the caller can drop a structured log
 * row pointing at the tampered entry.
 */
export function verifyChain(
  entries: ReadonlyArray<ChainEntry>,
  secrets: SecretRing = {},
): ChainVerificationResult {
  let prev: string = GENESIS_HASH;
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    if (e.index !== i) {
      return {
        ok: false,
        scanned: i,
        firstBrokenIndex: i,
        expectedHash: null,
        actualHash: null,
        reason: `index_mismatch_expected_${i}_got_${e.index}`,
      };
    }
    if (e.prevHash !== prev) {
      return {
        ok: false,
        scanned: i,
        firstBrokenIndex: i,
        expectedHash: prev,
        actualHash: e.prevHash,
        reason: "prev_hash_mismatch",
      };
    }
    let secretValue: string | undefined;
    if (e.secretId !== undefined) {
      if (!(e.secretId in secrets)) {
        return {
          ok: false,
          scanned: i,
          firstBrokenIndex: i,
          expectedHash: null,
          actualHash: null,
          reason: `secret_unknown_${e.secretId}`,
        };
      }
      secretValue = secrets[e.secretId];
    }
    const computed = chainHash(
      {
        prev: e.prevHash,
        payload: e.payload,
        ...(e.secretId !== undefined ? { secretId: e.secretId } : {}),
      },
      secretValue,
    );
    if (computed !== e.rowHash) {
      return {
        ok: false,
        scanned: i,
        firstBrokenIndex: i,
        expectedHash: computed,
        actualHash: e.rowHash,
        reason: "row_hash_mismatch",
      };
    }
    prev = computed;
  }
  return {
    ok: true,
    scanned: entries.length,
    firstBrokenIndex: null,
    expectedHash: null,
    actualHash: null,
    reason: null,
  };
}
