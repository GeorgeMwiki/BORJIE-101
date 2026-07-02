/**
 * Offline audit-egress verifier — the missing operationalization half of the
 * in-process hash-chained audit trail.
 *
 * BORJIE already writes a per-tenant, hash-chained, HMAC-signed audit trail
 * (`packages/ai-copilot/src/audit-trail/*`, table `ai_audit_chain`). But the
 * chain was only ever verifiable by a live service holding a DB handle. There
 * was no way for an *external auditor* to (a) receive an EXPORTED, portable
 * copy of the chain and recompute the head from first principles, and (b) get
 * a machine-readable tamper/gap verdict — nor any INTEGRITY-FAILURE METRIC or
 * alert when a recompute diverges.
 *
 * This module closes that gap, mirroring LITFIN's audit-streamer `/head` +
 * SHA-256-chain verify TECHNIQUE (pattern, not content): a portable serialized
 * chain that an offline auditor can recompute the head from, byte-for-byte,
 * with zero DB access.
 *
 * DESIGN — package-cycle-free by construction:
 *   observability must NOT import ai-copilot (that would invert the dep graph),
 *   so the verifier consumes a SELF-CONTAINED, zod-validated export shape
 *   (`SerializedAuditEvent`) rather than the live `AuditTrailEntry`. The
 *   recorder/exporter serializes into this shape; the auditor recomputes from
 *   it. The canonical-hash recipe MUST stay byte-identical to
 *   `ai-copilot/src/audit-trail/hash-chain.ts#hashEntry` (documented + guarded
 *   by a cross-package fixture test) so an export verifies against the same
 *   digest the writer produced.
 *
 * Pure + I/O-free: given the same export, returns the same verdict. No clocks
 * except the returned `verifiedAt` stamp, no RNG, no network.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Genesis constant — MUST match ai-copilot/src/audit-trail/types.ts.
// Duplicated (not imported) to keep observability free of an ai-copilot dep;
// the cross-package fixture test asserts they stay equal.
// ---------------------------------------------------------------------------
export const GENESIS_PREV_HASH_V2 =
  'GENESIS_AUDIT_TRAIL_V2_0000000000000000000000000000000000000000000000';

// ---------------------------------------------------------------------------
// Portable export shape — what an offline auditor receives.
// ---------------------------------------------------------------------------

/**
 * One serialized audit event. This is the minimal set of fields that feed the
 * canonical hash recipe PLUS the stored `thisHash`/`signature` the writer
 * persisted. An auditor recomputes `thisHash` from the recipe fields and
 * compares against the stored value.
 */
export const serializedAuditEventSchema = z.object({
  sequenceId: z.number().int().nonnegative(),
  prevHash: z.string().min(1),
  tenantId: z.string().min(1),
  occurredAt: z.string().min(1),
  actorKind: z.string().min(1),
  actionKind: z.string().min(1),
  actionCategory: z.string().min(1),
  decision: z.string().min(1),
  evidence: z.record(z.string(), z.unknown()),
  /** The digest the writer persisted for this row. */
  thisHash: z.string().min(1),
  /** HMAC signature the writer persisted, or null if unsigned. */
  signature: z.string().min(1).nullable(),
});

export type SerializedAuditEvent = z.infer<typeof serializedAuditEventSchema>;

/**
 * A full portable chain export for one tenant. `head` is the writer's claimed
 * chain head (the `thisHash` of the last row); the auditor recomputes it and
 * flags divergence. Includes `tenantId` and `exportedAt` for provenance.
 */
export const auditChainExportSchema = z.object({
  tenantId: z.string().min(1),
  exportedAt: z.string().min(1),
  /** Writer's claimed head (last row's thisHash) — recomputed + compared. */
  head: z.string().min(1),
  events: z.array(serializedAuditEventSchema),
});

export type AuditChainExport = z.infer<typeof auditChainExportSchema>;

// ---------------------------------------------------------------------------
// Canonical hash recipe — MUST stay byte-identical to ai-copilot hashEntry.
// ---------------------------------------------------------------------------

function canonicalEvidence(value: unknown): string {
  return JSON.stringify(value, replacer);
}

function replacer(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[k] = (value as Record<string, unknown>)[k];
  }
  return sorted;
}

/**
 * Recompute a row's `thisHash` from its recipe fields. Byte-identical to
 * `ai-copilot/src/audit-trail/hash-chain.ts#hashEntry`.
 */
export function recomputeThisHash(event: SerializedAuditEvent): string {
  const serialised = [
    String(event.sequenceId),
    event.prevHash,
    event.tenantId,
    event.occurredAt,
    event.actorKind,
    event.actionKind,
    event.actionCategory,
    event.decision,
    canonicalEvidence(event.evidence),
  ].join('|');
  return createHash('sha256').update(serialised).digest('hex');
}

/** Recompute the HMAC signature over a `thisHash`. */
export function recomputeSignature(
  thisHash: string,
  secret: string | null | undefined,
): string | null {
  if (!secret) return null;
  return createHmac('sha256', secret).update(thisHash).digest('hex');
}

function constantTimeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------------------
// Verdict shape
// ---------------------------------------------------------------------------

export type ChainBreakReason =
  | 'sequence-gap'
  | 'prev-hash-mismatch'
  | 'payload-mutated'
  | 'signature-mismatch'
  | 'head-mismatch'
  | 'schema-invalid';

export interface OfflineVerifyResult {
  readonly tenantId: string;
  readonly valid: boolean;
  readonly entriesChecked: number;
  /** sequenceId of the first bad row, or the head sentinel (-1). Undefined when valid. */
  readonly brokenAt?: number;
  readonly reason?: ChainBreakReason;
  readonly detail?: string;
  /** The head the auditor recomputed from the events (for reconciliation). */
  readonly recomputedHead: string;
  readonly verifiedAt: string;
}

export interface OfflineVerifyOptions {
  /**
   * HMAC secret to re-verify signatures. When omitted, signature checks are
   * skipped (an unsigned export still verifies hash-chain continuity). When
   * provided, every signed row MUST match.
   */
  readonly signingSecret?: string | null;
  /** Injectable clock for deterministic tests. */
  readonly now?: () => Date;
}

/**
 * Verify a portable audit-chain export OFFLINE. Recomputes each row's hash and
 * (optionally) signature, checks dense sequencing and prev_hash linkage, and
 * compares the recomputed head against the export's claimed `head`.
 *
 * Detects: payload mutation, prev-hash rewiring, sequence gaps/reorders,
 * signature forgery, and a claimed-head mismatch (a truncated or extended
 * chain). Fail-safe: a schema-invalid export is reported broken, never
 * silently passed.
 */
export function verifyAuditChainExport(
  rawExport: unknown,
  options: OfflineVerifyOptions = {},
): OfflineVerifyResult {
  const now = options.now ?? (() => new Date());
  const verifiedAt = now().toISOString();
  const secret = options.signingSecret ?? null;

  const parsed = auditChainExportSchema.safeParse(rawExport);
  if (!parsed.success) {
    return {
      tenantId:
        typeof (rawExport as { tenantId?: unknown })?.tenantId === 'string'
          ? (rawExport as { tenantId: string }).tenantId
          : '',
      valid: false,
      entriesChecked: 0,
      brokenAt: -1,
      reason: 'schema-invalid',
      detail: parsed.error.issues[0]?.message ?? 'export failed schema validation',
      recomputedHead: GENESIS_PREV_HASH_V2,
      verifiedAt,
    };
  }

  const { tenantId, events, head: claimedHead } = parsed.data;

  if (events.length === 0) {
    // An empty chain is valid; its head is genesis. A claimed non-genesis head
    // over an empty event set is a truncation — flag it.
    if (claimedHead !== GENESIS_PREV_HASH_V2) {
      return {
        tenantId,
        valid: false,
        entriesChecked: 0,
        brokenAt: -1,
        reason: 'head-mismatch',
        detail: 'empty export claims a non-genesis head (truncated chain)',
        recomputedHead: GENESIS_PREV_HASH_V2,
        verifiedAt,
      };
    }
    return {
      tenantId,
      valid: true,
      entriesChecked: 0,
      recomputedHead: GENESIS_PREV_HASH_V2,
      verifiedAt,
    };
  }

  let recomputedHead = GENESIS_PREV_HASH_V2;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event === undefined) continue;

    const expectedSeq = i + 1;
    if (event.sequenceId !== expectedSeq) {
      return broken(
        tenantId,
        event.sequenceId,
        'sequence-gap',
        `sequence gap or reorder at ${event.sequenceId} (expected ${expectedSeq})`,
        recomputedHead,
        verifiedAt,
        i,
      );
    }

    const expectedPrev = i === 0 ? GENESIS_PREV_HASH_V2 : recomputedHead;
    if (event.prevHash !== expectedPrev) {
      return broken(
        tenantId,
        event.sequenceId,
        'prev-hash-mismatch',
        `prevHash at ${event.sequenceId} does not link to the prior row`,
        recomputedHead,
        verifiedAt,
        i,
      );
    }

    const expectedHash = recomputeThisHash(event);
    if (!constantTimeEqualHex(expectedHash, event.thisHash)) {
      return broken(
        tenantId,
        event.sequenceId,
        'payload-mutated',
        `payload mutated at ${event.sequenceId}`,
        recomputedHead,
        verifiedAt,
        i,
      );
    }

    if (secret !== null && event.signature !== null) {
      const expectedSig = recomputeSignature(event.thisHash, secret);
      if (
        expectedSig === null ||
        !constantTimeEqualHex(expectedSig, event.signature)
      ) {
        return broken(
          tenantId,
          event.sequenceId,
          'signature-mismatch',
          `signature mismatch at ${event.sequenceId}`,
          recomputedHead,
          verifiedAt,
          i,
        );
      }
    }

    recomputedHead = event.thisHash;
  }

  // Head reconciliation — the export's claimed head must equal the head we
  // recomputed by walking every row. A mismatch means the export was
  // truncated, extended, or the head was tampered independently of the rows.
  if (!constantTimeEqualHex(recomputedHead, claimedHead)) {
    return {
      tenantId,
      valid: false,
      entriesChecked: events.length,
      brokenAt: -1,
      reason: 'head-mismatch',
      detail: 'recomputed head does not match the export claimed head',
      recomputedHead,
      verifiedAt,
    };
  }

  return {
    tenantId,
    valid: true,
    entriesChecked: events.length,
    recomputedHead,
    verifiedAt,
  };
}

function broken(
  tenantId: string,
  brokenAt: number,
  reason: ChainBreakReason,
  detail: string,
  recomputedHead: string,
  verifiedAt: string,
  index: number,
): OfflineVerifyResult {
  return {
    tenantId,
    valid: false,
    entriesChecked: index + 1,
    brokenAt,
    reason,
    detail,
    recomputedHead,
    verifiedAt,
  };
}
