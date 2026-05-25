/**
 * AuditTrailVerifier — walks a per-tenant range and returns
 *   { valid, brokenAt, firstValidAt, lastValidAt, entriesChecked, error? }
 *
 * The verifier re-runs both the SHA-256 row hash AND the HMAC signature
 * check. Any of these failing flips `valid` to false and reports the
 * sequence-id where the chain broke.
 */

import type {
  AuditActionCategory,
  AuditActorKind,
  AuditTrailEntry,
  AuditTrailRepository,
  VerifyRangeResult,
} from './types.js';
import { GENESIS_PREV_HASH_V2 } from './types.js';
import { hashEntry, verifySignature } from './hash-chain.js';

export interface AuditTrailVerifierDeps {
  readonly repo: AuditTrailRepository;
  readonly signingSecret?: string | null;
}

export interface VerifyRangeOptions {
  readonly from?: Date;
  readonly to?: Date;
  readonly category?: AuditActionCategory;
  readonly actorKind?: AuditActorKind;
}

export interface AuditTrailVerifier {
  verifyRange(
    tenantId: string,
    options?: VerifyRangeOptions,
  ): Promise<VerifyRangeResult>;
}

export function createAuditTrailVerifier(
  deps: AuditTrailVerifierDeps,
): AuditTrailVerifier {
  const secret = deps.signingSecret ?? null;

  return {
    async verifyRange(tenantId, options) {
      if (!tenantId || tenantId.trim() === '') {
        throw new Error('audit-trail-verifier: tenantId is required');
      }

      // We must verify from sequence 1 onwards for the FIRST row's prev_hash
      // to be the genesis constant. Range filters (from/to/category/actor)
      // describe which rows the UI wanted to VIEW — but the chain itself is
      // an integrity property over every row, so we always walk the full
      // range of rows for that tenant when a sub-window is requested and
      // clip the reported summary to the requested window.
      const allRows = await deps.repo.list(tenantId);
      if (allRows.length === 0) {
        return { valid: true, entriesChecked: 0 };
      }

      let brokenAt: number | undefined;
      let firstValidAt: string | undefined;
      let lastValidAt: string | undefined;
      let error: string | undefined;

      for (let i = 0; i < allRows.length; i++) {
        const entry = allRows[i];
        const expectedSeq = i + 1;
        if (entry.sequenceId !== expectedSeq) {
          brokenAt = entry.sequenceId;
          error = `sequence gap or reorder at sequence ${entry.sequenceId} (expected ${expectedSeq})`;
          break;
        }
        const expectedPrev =
          i === 0 ? GENESIS_PREV_HASH_V2 : allRows[i - 1].thisHash;
        if (entry.prevHash !== expectedPrev) {
          brokenAt = entry.sequenceId;
          error = `prevHash mismatch at sequence ${entry.sequenceId}`;
          break;
        }
        const expectedHash = hashEntry({
          sequenceId: entry.sequenceId,
          prevHash: entry.prevHash,
          tenantId: entry.tenantId,
          occurredAt: entry.occurredAt,
          actorKind: entry.actorKind,
          actionKind: entry.actionKind,
          actionCategory: entry.actionCategory,
          decision: entry.decision,
          evidence: entry.evidence,
        });
        if (expectedHash !== entry.thisHash) {
          brokenAt = entry.sequenceId;
          error = `payload mutated at sequence ${entry.sequenceId}`;
          break;
        }
        if (secret !== null && !verifySignature(entry.thisHash, entry.signature, secret)) {
          brokenAt = entry.sequenceId;
          error = `signature mismatch at sequence ${entry.sequenceId}`;
          break;
        }
        // Track range within window if the caller asked for one.
        if (matchesWindow(entry, options)) {
          if (!firstValidAt) firstValidAt = entry.occurredAt;
          lastValidAt = entry.occurredAt;
        }
      }

      if (brokenAt !== undefined) {
        return {
          valid: false,
          entriesChecked: brokenAt,
          brokenAt,
          firstValidAt,
          lastValidAt,
          error,
        };
      }
      return {
        valid: true,
        entriesChecked: allRows.length,
        firstValidAt,
        lastValidAt,
      };
    },
  };
}

function matchesWindow(
  entry: AuditTrailEntry,
  options?: VerifyRangeOptions,
): boolean {
  if (!options) return true;
  if (options.from && new Date(entry.occurredAt) < options.from) return false;
  if (options.to && new Date(entry.occurredAt) > options.to) return false;
  if (options.category && entry.actionCategory !== options.category) return false;
  if (options.actorKind && entry.actorKind !== options.actorKind) return false;
  return true;
}
