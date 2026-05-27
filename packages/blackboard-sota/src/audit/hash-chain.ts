/**
 * Per-region hash-chain integration for blackboard-sota.
 *
 * Wave BLACKBOARD-CORE. Every row in `blackboard_regions`,
 * `blackboard_posts_v2`, and `blackboard_summaries` carries an
 * `audit_hash` that chains into the *region's* tamper-evident hash
 * chain (see spec §11). The chain is per-region (not global) so
 * verification is O(posts(region)) and a tamper anywhere in the
 * region's history is surfaced as a single broken-index event.
 *
 * Reuses `@borjie/audit-hash-chain`'s pure `chainHash` and
 * `verifyChain` primitives.
 */

import {
  chainHash,
  verifyChain,
  GENESIS_HASH,
  type ChainEntry,
  type ChainVerificationResult,
} from '@borjie/audit-hash-chain';

/**
 * Compute a single blackboard-sota row's audit hash.
 *
 * The `prev` value is the chain's previous row hash. The first post
 * in a region uses `GENESIS_HASH`. Subsequent posts / summaries pass
 * the previous row's `audit_hash` as `prev`.
 */
export function computeBlackboardHash(
  payload: Readonly<Record<string, unknown>>,
  prev: string = GENESIS_HASH,
): string {
  return chainHash({ prev, payload });
}

/**
 * Verify a region's hash chain in order. Returns the canonical
 * `ChainVerificationResult` from `@borjie/audit-hash-chain` —
 * `ok=true` on success, or `ok=false` with the first broken index
 * and the expected vs actual hashes.
 *
 * The caller supplies the row sequence already sorted by `postedAt`
 * (for posts) / `generatedAt` (for summaries). The convention is
 * region open → posts → summaries interleaved by time.
 */
export function verifyRegionChain(
  entries: ReadonlyArray<ChainEntry>,
): ChainVerificationResult {
  return verifyChain(entries);
}

/**
 * Convenience: re-export `GENESIS_HASH` so callers don't need to
 * import from two packages.
 */
export { GENESIS_HASH };
