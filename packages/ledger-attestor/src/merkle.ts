/**
 * Merkle root over a hash-chain segment — pure, no I/O.
 *
 * The attestor commits to an entire ledger/audit chain segment with a
 * single 32-byte root. A binary SHA-256 Merkle tree gives:
 *   - O(log n) inclusion proofs (a regulator can be handed one entry +
 *     a proof, and verify it against a signed root without the chain).
 *   - Tamper localisation: any single-row edit changes the root.
 *
 * Domain separation (RFC 6962 / Certificate Transparency convention):
 *   leaf  = sha256( 0x00 || canonicalJson(leafObject) )
 *   node  = sha256( 0x01 || left || right )
 * The 0x00/0x01 prefixes stop a second-preimage attack that swaps an
 * internal node for a leaf. Odd levels promote the lone tail node
 * unchanged (no duplicate-last-node, which CVE-2012-2459 punished).
 *
 * Leaves are the per-row `rowHash` (audit-hash-chain) or `thisHash`
 * (payments-ledger) — already canonical hex — so the tree is stable
 * regardless of which chain feeds it.
 *
 * @module @borjie/ledger-attestor/merkle
 */

import { createHash } from 'node:crypto';
import { canonicalJson } from '@borjie/audit-hash-chain';

const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

/** Empty-tree sentinel: sha256 of the empty byte string, hex. */
export const EMPTY_MERKLE_ROOT: string = createHash('sha256')
  .update(Buffer.alloc(0))
  .digest('hex');

function sha256Hex(...buffers: ReadonlyArray<Buffer>): string {
  const hash = createHash('sha256');
  for (const b of buffers) hash.update(b);
  return hash.digest('hex');
}

/**
 * Hash a single leaf. The input is any JSON-serialisable value — most
 * callers pass the row's existing hex `rowHash`/`thisHash` string, but
 * an object is accepted so the tree can commit to richer leaves.
 */
export function hashLeaf(leaf: unknown): string {
  const canonical = canonicalJson(leaf);
  return sha256Hex(LEAF_PREFIX, Buffer.from(canonical, 'utf8'));
}

/**
 * Compute the Merkle root over an ordered list of leaves. Order is
 * significant and MUST be the chain's append order (ascending index /
 * sequenceNumber) so the root is reproducible. Returns
 * {@link EMPTY_MERKLE_ROOT} for an empty input.
 */
export function computeMerkleRoot(leaves: ReadonlyArray<unknown>): string {
  if (leaves.length === 0) return EMPTY_MERKLE_ROOT;

  let level: ReadonlyArray<string> = leaves.map((l) => hashLeaf(l));

  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : undefined;
      if (right === undefined) {
        // Lone tail node is promoted unchanged (no duplicate-last-node).
        next.push(left);
      } else {
        next.push(
          sha256Hex(
            NODE_PREFIX,
            Buffer.from(left, 'hex'),
            Buffer.from(right, 'hex'),
          ),
        );
      }
    }
    level = next;
  }
  return level[0];
}
