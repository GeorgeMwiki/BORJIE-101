/**
 * Live audit-chain integrity SWEEP cron (Tier-1 integrity-sweep wiring).
 *
 * `@borjie/observability`'s `runAuditChainIntegritySweep` is the production
 * consumer that recomputes each `audit_trail_entries` row's hash from first
 * principles, re-verifies the per-tenant hash-chain, and RECORDS every verdict
 * through the observability integrity recorder (the OTel
 * `audit_chain_integrity_failures_total` counter + pager alert on tamper).
 * Until this cron, that sweep had ZERO production callers — only the offline
 * CLI invoked it — so a payload mutation / prev-hash rewrite / sequence gap /
 * signature forgery in the hash-chained AI audit trail was NOT detected +
 * recorded in a live scheduled path. This cron is that scheduled caller: it
 * runs inside the consolidation-worker supervisor next to the ledger-attestor
 * cron, reads `audit_trail_entries`, and hands the rows to the sweep.
 *
 * ── Fail-safety ─────────────────────────────────────────────────────────────
 * The sweep itself performs zero I/O and never throws (a malformed export is
 * reported as a broken chain, never silently passed). This cron wrapper does
 * the DB read and additionally try/catches so a source/DB error (transient
 * outage, pre-migration schema) degrades to a logged no-op — a cron error
 * never crashes the supervisor.
 *
 * ── Hash fidelity ───────────────────────────────────────────────────────────
 * The canonical hash recipe consumes `occurredAt` as the exact ISO-8601 string
 * the writer hashed. The writer inserts `entry.occurredAt` (a `.toISOString()`
 * value) as `timestamptz`; reading it back and normalising through
 * `new Date(...).toISOString()` round-trips to the same millisecond-precision
 * UTC string — matching `audit-trail-repository.ts`'s own `mapRow` convention,
 * so a faithful row does NOT false-positive as tampered.
 *
 * @module audit-integrity-sweep-cron
 */

import { sql } from 'drizzle-orm';
import {
  runAuditChainIntegritySweep,
  createAuditIntegrityRecorder,
  type AuditTrailRow,
  type AuditChainSweepSummary,
  type AuditIntegrityRecorder,
} from '@borjie/observability';
import { logger } from '../logger.js';

/** Minimum DB surface the sweep source needs — read-only `execute(q)`. */
export interface AuditSweepDbLike {
  execute(query: unknown): Promise<unknown>;
}

// Hard ceiling on rows pulled per tick. The sweep verifies the chain HEAD each
// run, so a very long chain is fully covered across successive ticks even if a
// single tick is bounded; a sane cap keeps a pathological table from loading
// unboundedly into memory.
const MAX_ROWS_PER_TICK = 100_000;

export interface AuditIntegritySweepCronDeps {
  readonly db: AuditSweepDbLike;
  /** Shared recorder (metric + pager hook). Built once at boot and reused. */
  readonly recorder: AuditIntegrityRecorder;
  /** HMAC secret to re-verify signatures. Omitted → signature checks skipped. */
  readonly signingSecret?: string | null;
}

/**
 * Build the cron deps. The integrity recorder is created ONCE (its pager hook
 * is stable across ticks). The signing secret is resolved from the same env var
 * the audit-trail writer uses so signature re-verification is enabled in prod.
 */
export function buildAuditIntegritySweepCronDeps(
  db: AuditSweepDbLike,
): AuditIntegritySweepCronDeps {
  const signingSecret =
    process.env.AUDIT_TRAIL_SIGNING_SECRET?.trim() || null;
  const recorder = createAuditIntegrityRecorder({
    onIntegrityFailure: (alert) => {
      logger.error(
        'audit-integrity-sweep: hash-chain tamper detected',
        {
          tenantId: alert.tenantId,
          reason: alert.reason,
          brokenAt: alert.brokenAt ?? null,
          verifiedAt: alert.verifiedAt,
        },
      );
    },
  });
  return signingSecret !== null
    ? { db, recorder, signingSecret }
    : { db, recorder };
}

/**
 * Read every `audit_trail_entries` row the sweep needs, mapped to the pure
 * `AuditTrailRow` contract. `occurred_at` is normalised to the exact ISO string
 * the writer hashed (see header). Degrades to `[]` on any DB error.
 */
async function readAuditTrailRows(
  db: AuditSweepDbLike,
): Promise<readonly AuditTrailRow[]> {
  try {
    const result = (await db.execute(
      sql`SELECT tenant_id, sequence_id, prev_hash, occurred_at,
                 actor_kind, action_kind, action_category, decision,
                 evidence_json, this_hash, signature
            FROM audit_trail_entries
           WHERE this_hash IS NOT NULL
           ORDER BY tenant_id, sequence_id ASC
           LIMIT ${MAX_ROWS_PER_TICK}`,
    )) as unknown;
    return toRows(result)
      .map(mapRow)
      .filter((row): row is AuditTrailRow => row !== null);
  } catch (error) {
    logger.warn(
      'audit-integrity-sweep: audit_trail_entries read failed (schema may be pre-migration)',
      { reason: messageOf(error) },
    );
    return [];
  }
}

/**
 * Run one sweep tick: read rows, verify + record every per-tenant chain. Never
 * throws — a DB error yields an empty read (zero chains checked). Returns the
 * summary so the caller can log it.
 */
export async function runAuditIntegritySweepTick(
  deps: AuditIntegritySweepCronDeps,
): Promise<AuditChainSweepSummary> {
  const rows = await readAuditTrailRows(deps.db);
  const options: {
    recorder: AuditIntegrityRecorder;
    signingSecret?: string | null;
  } = { recorder: deps.recorder };
  if (deps.signingSecret !== undefined) {
    options.signingSecret = deps.signingSecret;
  }
  const summary = runAuditChainIntegritySweep(rows, options);
  if (summary.chainsBroken > 0) {
    logger.error('audit-integrity-sweep: one or more chains BROKEN', {
      chainsChecked: summary.chainsChecked,
      chainsBroken: summary.chainsBroken,
    });
  } else {
    logger.info('audit-integrity-sweep: tick complete', {
      chainsChecked: summary.chainsChecked,
    });
  }
  return summary;
}

// ─────────────────────────────────────────────────────────────────────
// Cadence — default hourly, env-tunable + clamped to [5min, 24h].
// ─────────────────────────────────────────────────────────────────────

export function resolveAuditSweepIntervalMs(): number {
  const raw = Number(process.env.AUDIT_INTEGRITY_SWEEP_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return 60 * 60 * 1000;
  return Math.min(Math.max(Math.floor(raw), 5 * 60 * 1000), 24 * 60 * 60 * 1000);
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function toRows(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as ReadonlyArray<Record<string, unknown>>;
  }
  const wrapped = (result as { rows?: ReadonlyArray<Record<string, unknown>> })
    ?.rows;
  return Array.isArray(wrapped) ? wrapped : [];
}

/** Map one DB row to the sweep's pure contract, or null when a required field is missing. */
function mapRow(row: Record<string, unknown>): AuditTrailRow | null {
  const tenantId = asString(row.tenant_id);
  const sequenceId = asNumber(row.sequence_id);
  const prevHash = asString(row.prev_hash);
  const thisHash = asString(row.this_hash);
  if (
    tenantId === undefined ||
    sequenceId === undefined ||
    prevHash === undefined ||
    thisHash === undefined
  ) {
    return null;
  }
  return {
    tenantId,
    sequenceId,
    prevHash,
    occurredAt: asIsoString(row.occurred_at),
    actorKind: asString(row.actor_kind) ?? '',
    actionKind: asString(row.action_kind) ?? '',
    actionCategory: asString(row.action_category) ?? '',
    decision: asString(row.decision) ?? '',
    evidence: asRecord(row.evidence_json),
    thisHash,
    signature: asNullableString(row.signature),
  };
}

function asString(v: unknown): string | undefined {
  if (typeof v === 'string' && v.length > 0) return v;
  return undefined;
}

function asNullableString(v: unknown): string | null {
  if (typeof v === 'string' && v.length > 0) return v;
  return null;
}

function asNumber(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Normalise a DB `occurred_at` value to the exact ISO-8601 string the writer
 * hashed. The writer's `occurredAt` was a `.toISOString()` value; reading the
 * `timestamptz` back through `new Date(...).toISOString()` round-trips to the
 * same millisecond-precision UTC string.
 */
function asIsoString(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') {
    const parsed = new Date(v);
    return Number.isNaN(parsed.getTime()) ? v : parsed.toISOString();
  }
  return new Date(0).toISOString();
}

function asRecord(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through to empty record
    }
  }
  return {};
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
