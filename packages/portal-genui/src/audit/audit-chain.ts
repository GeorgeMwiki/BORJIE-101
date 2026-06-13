/**
 * Hash-chained, append-only audit for generated tabs.
 *
 * Borjie's audit-chain HARD RULE ("AI audit chain is hash-chained, append-only,
 * no mutation") applies to the brain's largest new output class too. Before
 * this, a PortalTab's `audit.history` was a plain JSONB ring buffer — a row
 * with DB access could silently rewrite who created or edited a tab. Now each
 * entry carries `hash = sha256(prevHash ‖ canonical(entry))`, chained from a
 * genesis constant, so any retroactive edit to a sealed entry breaks the chain
 * and `verifyAuditChain` flags exactly where.
 *
 * Sealing happens at the engine persist/patch chokepoint, so the four
 * generator construction sites stay simple (they emit hashless entries) and the
 * stored record is always sealed. Append-only is preserved: `sealAuditChain`
 * never recomputes an already-hashed entry, so historical hashes are immutable
 * and new entries chain onto the last.
 *
 * @module @borjie/portal-genui/audit/audit-chain
 */

import { createHash } from 'node:crypto';
import type { PortalTabAudit, PortalTabAuditEntry } from '../types.js';

/** First link's predecessor — a fixed, well-known anchor. */
export const GENESIS_HASH = 'borjie:portal-genui:audit:genesis:v1';

type EntryWithHash = PortalTabAuditEntry & { hash?: string };

/** Stable, hash-excluding serialization of an entry (sorted keys). */
function canonicalizeEntry(entry: PortalTabAuditEntry): string {
  const rest = { ...(entry as EntryWithHash) };
  delete rest.hash;
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(rest).sort()) {
    ordered[key] = (rest as Record<string, unknown>)[key];
  }
  return JSON.stringify(ordered);
}

/** Compute the chain hash for one entry given its predecessor's hash. */
export function hashAuditEntry(
  prevHash: string,
  entry: PortalTabAuditEntry,
): string {
  return createHash('sha256')
    .update(prevHash)
    .update('\n')
    .update(canonicalizeEntry(entry))
    .digest('hex');
}

/**
 * Stamp chain hashes on every not-yet-sealed entry, chaining from the last
 * sealed hash (or genesis). Already-sealed entries are left untouched
 * (append-only). Returns a new audit; never mutates the input.
 */
export function sealAuditChain(audit: PortalTabAudit): PortalTabAudit {
  let prev = GENESIS_HASH;
  const history = audit.history.map((entry) => {
    const e = entry as EntryWithHash;
    if (e.hash) {
      prev = e.hash;
      return entry;
    }
    const hash = hashAuditEntry(prev, entry);
    prev = hash;
    return { ...entry, hash };
  });
  return { ...audit, history };
}

export interface AuditChainVerdict {
  /** True when every sealed entry chains correctly. */
  readonly ok: boolean;
  /** Index of the first broken link, when `ok` is false. */
  readonly brokenAtIndex?: number;
  /** Count of legacy/unsealed (hashless) entries encountered. */
  readonly unsealed: number;
}

/**
 * Verify the chain. Sealed entries must hash-chain from their predecessor;
 * any mismatch (content edit, reorder, forged hash) fails at that index.
 * Legacy hashless entries are tolerated (counted as `unsealed`), so a v1 row
 * that predates chaining is reported clean rather than falsely broken.
 */
export function verifyAuditChain(audit: PortalTabAudit): AuditChainVerdict {
  let prev = GENESIS_HASH;
  let unsealed = 0;
  for (let i = 0; i < audit.history.length; i += 1) {
    const e = audit.history[i] as EntryWithHash;
    if (!e.hash) {
      unsealed += 1;
      continue;
    }
    const expected = hashAuditEntry(prev, e);
    if (expected !== e.hash) {
      return { ok: false, brokenAtIndex: i, unsealed };
    }
    prev = e.hash;
  }
  return { ok: true, unsealed };
}
