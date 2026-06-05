/**
 * Canonical checkpoint serialisation — the exact bytes that get signed.
 *
 * The signer signs `serializeCheckpoint(payload)` and a verifier
 * recomputes the same string, so the serialisation MUST be canonical
 * (sorted keys, no whitespace) and stable across Node versions. We
 * reuse `canonicalJson` from `@borjie/audit-hash-chain` so the attestor
 * and the chain primitive agree byte-for-byte.
 *
 * @module @borjie/ledger-attestor/checkpoint
 */

import { canonicalJson } from '@borjie/audit-hash-chain';
import type { CheckpointPayload } from './types.js';

/**
 * Produce the canonical signable string for a checkpoint payload. This
 * is the message handed to `SignerPort.sign` and recomputed at verify
 * time — never change it without versioning the signature scheme.
 */
export function serializeCheckpoint(payload: CheckpointPayload): string {
  return canonicalJson({
    attestedAtIso: payload.attestedAtIso,
    chainId: payload.chainId,
    headIndex: payload.headIndex,
    leafCount: payload.leafCount,
    merkleRoot: payload.merkleRoot,
    prevRoot: payload.prevRoot,
  });
}
