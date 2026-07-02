/**
 * Live audit-chain integrity SWEEP — the production consumer that turns the
 * (previously CLI-only) offline verifier + integrity recorder into a real,
 * scheduled tamper detector.
 *
 * WHY THIS EXISTS
 * ---------------
 * `offline-chain-verify.ts` can recompute a chain head from a portable export,
 * and `integrity-metric.ts` can emit an OTel counter + fire a pager alert when
 * a chain is broken — but until now the ONLY caller was the offline CLI an
 * external auditor runs by hand. Nothing in a live scheduled path recomputed
 * each `audit_trail_entries` row's hash from first principles, so a payload
 * mutation / prev-hash rewrite / sequence gap / signature forgery in the
 * hash-chained AI audit trail was NOT detected + recorded in production. This
 * module is that live consumer: given rows read from `audit_trail_entries`, it
 * groups them per tenant, rebuilds the portable export shape, verifies each
 * chain, and records every verdict through the integrity recorder (metric +
 * alert on tamper).
 *
 * DESIGN
 * ------
 * Pure + I/O-free. The caller (a worker cron) does the DB read and passes plain
 * rows in; this function does zero I/O of its own, so it is trivially testable
 * and cannot crash a supervisor. It reuses `verifyAuditChainExport` (the same
 * recipe the writer used) and `createAuditIntegrityRecorder` (the same metric +
 * alert contract the CLI uses) — no duplicated crypto, no second recipe.
 */

import {
  verifyAuditChainExport,
  GENESIS_PREV_HASH_V2,
  type AuditChainExport,
  type SerializedAuditEvent,
  type OfflineVerifyResult,
} from './offline-chain-verify.js';
import {
  createAuditIntegrityRecorder,
  type AuditIntegrityRecorder,
  type AuditIntegrityRecorderOptions,
} from './integrity-metric.js';

/**
 * One `audit_trail_entries` row as the sweep needs it. This is the minimal set
 * of columns the canonical hash recipe consumes PLUS the persisted
 * `thisHash`/`signature`. Field names mirror the DB columns (snake_case-free —
 * the caller maps `occurred_at` → `occurredAt` etc. so this module stays a
 * pure data contract). `evidence` is the stored evidence blob.
 */
export interface AuditTrailRow {
  readonly tenantId: string;
  readonly sequenceId: number;
  readonly prevHash: string;
  readonly occurredAt: string;
  readonly actorKind: string;
  readonly actionKind: string;
  readonly actionCategory: string;
  readonly decision: string;
  readonly evidence: Record<string, unknown>;
  readonly thisHash: string;
  readonly signature: string | null;
}

export interface AuditChainSweepOptions {
  /** HMAC secret to re-verify signatures. Omitted → signature checks skipped. */
  readonly signingSecret?: string | null;
  /** Injectable clock for deterministic tests (forwarded to the verifier). */
  readonly now?: () => Date;
  /**
   * Recorder to fan verdicts through. Defaults to a fresh recorder bound to the
   * global meter. Pass one (with an `onIntegrityFailure` pager hook) in prod.
   */
  readonly recorder?: AuditIntegrityRecorder;
  /** Options for the DEFAULT recorder when none is supplied. */
  readonly recorderOptions?: AuditIntegrityRecorderOptions;
}

export interface AuditChainSweepSummary {
  /** Number of distinct tenant chains verified. */
  readonly chainsChecked: number;
  /** Number of chains that FAILED verification (tamper / gap / head-mismatch). */
  readonly chainsBroken: number;
  /** Per-chain verdicts (already recorded through the integrity recorder). */
  readonly results: readonly OfflineVerifyResult[];
}

/**
 * Build a portable `AuditChainExport` per tenant from a flat list of rows.
 *
 * Rows may arrive in any order and interleaved across tenants; we group by
 * `tenantId` and sort each group by `sequenceId` ascending so the verifier sees
 * a dense, ordered chain. The claimed `head` is the last (highest-sequence)
 * row's `thisHash`, or the genesis constant for an empty group — exactly what
 * the verifier reconciles against.
 */
export function groupRowsIntoExports(
  rows: readonly AuditTrailRow[],
): readonly AuditChainExport[] {
  const byTenant = new Map<string, AuditTrailRow[]>();
  for (const row of rows) {
    const bucket = byTenant.get(row.tenantId);
    if (bucket) bucket.push(row);
    else byTenant.set(row.tenantId, [row]);
  }

  const exports: AuditChainExport[] = [];
  const exportedAt = new Date(0).toISOString(); // provenance stamp; not hashed.
  for (const [tenantId, group] of byTenant) {
    const ordered = [...group].sort((a, b) => a.sequenceId - b.sequenceId);
    const events: SerializedAuditEvent[] = ordered.map((r) => ({
      sequenceId: r.sequenceId,
      prevHash: r.prevHash,
      tenantId: r.tenantId,
      occurredAt: r.occurredAt,
      actorKind: r.actorKind,
      actionKind: r.actionKind,
      actionCategory: r.actionCategory,
      decision: r.decision,
      evidence: r.evidence,
      thisHash: r.thisHash,
      signature: r.signature,
    }));
    const last = ordered[ordered.length - 1];
    exports.push({
      tenantId,
      exportedAt,
      head: last ? last.thisHash : GENESIS_PREV_HASH_V2,
      events,
    });
  }
  return exports;
}

/**
 * Verify every tenant chain in `rows` and RECORD each verdict (OTel metric +
 * pager alert on a broken chain). Returns a summary the caller can log.
 *
 * Fail-safe: a malformed export is reported as a broken chain (never silently
 * passed), and recording errors never mask the verdict (the recorder swallows
 * sink errors). This function performs zero I/O.
 */
export function runAuditChainIntegritySweep(
  rows: readonly AuditTrailRow[],
  options: AuditChainSweepOptions = {},
): AuditChainSweepSummary {
  const recorder =
    options.recorder ?? createAuditIntegrityRecorder(options.recorderOptions);
  const exports = groupRowsIntoExports(rows);

  const results: OfflineVerifyResult[] = exports.map((exp) => {
    // The verifier re-validates the export shape internally and reports a
    // schema-invalid export as a broken chain (never silently passed), so one
    // malformed tenant chain never aborts the whole sweep.
    const verifyOpts: { signingSecret?: string | null; now?: () => Date } = {};
    if (options.signingSecret !== undefined) {
      verifyOpts.signingSecret = options.signingSecret;
    }
    if (options.now !== undefined) {
      verifyOpts.now = options.now;
    }
    return recorder.record(verifyAuditChainExport(exp, verifyOpts));
  });

  const chainsBroken = results.filter((r) => !r.valid).length;
  return {
    chainsChecked: results.length,
    chainsBroken,
    results,
  };
}
