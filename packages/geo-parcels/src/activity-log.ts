/**
 * Piece N — hash-chained activity log.
 *
 * Every meaningful change to a parcel appends a row to
 * `parcel_activity_log`. Each row's `hash` is SHA-256 of a canonical
 * JSON projection of:
 *   { parcel_id, event_kind, event_payload_jsonb, prev_hash, created_at }
 *
 * The chain runs per parcel. To validate, walk the rows in created_at
 * order and confirm each `prev_hash` equals the previous row's `hash`.
 *
 * Canonical JSON rules: keys sorted, no whitespace, UTF-8. Dates
 * serialise to ISO 8601.
 */

import { createHash } from 'node:crypto';

import type {
  ActivityEventKind,
  ActivityLogRow,
} from './types.js';
import type { GeoParcelsPort } from './persistence-port.js';

/**
 * Stable JSON stringification: keys sorted at every level. Dates →
 * ISO strings. Undefined values dropped (matching JSON semantics).
 */
export function canonicalJson(input: unknown): string {
  return JSON.stringify(stableify(input));
}

function stableify(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => stableify(v));
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = stableify(v);
    return out;
  }
  return value;
}

/**
 * Compute a row's hash given its content + the previous row's hash.
 */
export function computeActivityHash(args: {
  parcel_id: string;
  event_kind: ActivityEventKind;
  event_payload_jsonb: Record<string, unknown>;
  prev_hash: string | null;
  created_at: string | Date;
}): string {
  const canonical = canonicalJson({
    parcel_id: args.parcel_id,
    event_kind: args.event_kind,
    event_payload_jsonb: args.event_payload_jsonb,
    prev_hash: args.prev_hash,
    created_at: args.created_at,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export interface AppendActivityArgs {
  id: string;
  tenant_id: string;
  parcel_id: string;
  event_kind: ActivityEventKind;
  event_payload_jsonb?: Record<string, unknown>;
  actor_user_id?: string | null;
  actor_persona_id?: string | null;
  created_at?: Date;
}

/**
 * Append a hash-chained activity row. Looks up the previous hash for
 * the parcel via the port, computes the next hash, and persists.
 */
export async function appendActivity(
  port: GeoParcelsPort,
  args: AppendActivityArgs,
): Promise<ActivityLogRow> {
  const created_at = args.created_at ?? new Date();
  const prev_hash = await port.getLatestActivityHash(args.parcel_id, args.tenant_id);
  const event_payload_jsonb = args.event_payload_jsonb ?? {};

  const hash = computeActivityHash({
    parcel_id: args.parcel_id,
    event_kind: args.event_kind,
    event_payload_jsonb,
    prev_hash,
    created_at: created_at.toISOString(),
  });

  const row: ActivityLogRow = {
    id: args.id,
    tenant_id: args.tenant_id,
    parcel_id: args.parcel_id,
    event_kind: args.event_kind,
    event_payload_jsonb,
    actor_user_id: args.actor_user_id ?? null,
    actor_persona_id: args.actor_persona_id ?? null,
    prev_hash,
    hash,
    created_at: created_at.toISOString(),
  };

  return port.insertActivityLog(row);
}

/**
 * Walk a list of activity rows (in `created_at` ascending order) and
 * recompute hashes to verify chain integrity.
 *
 * Returns:
 *   { ok: true } on success
 *   { ok: false, brokenAtIndex, reason } on first failure
 */
export type ChainVerificationResult =
  | { ok: true }
  | { ok: false; brokenAtIndex: number; reason: string };

export function verifyActivityChain(rows: ActivityLogRow[]): ChainVerificationResult {
  let expectedPrev: string | null = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;

    if ((row.prev_hash ?? null) !== expectedPrev) {
      return {
        ok: false,
        brokenAtIndex: i,
        reason: `prev_hash mismatch at index ${i}: expected ${String(expectedPrev)}, got ${String(row.prev_hash)}`,
      };
    }

    const created_at = row.created_at;
    if (created_at === undefined) {
      return {
        ok: false,
        brokenAtIndex: i,
        reason: `row at index ${i} missing created_at`,
      };
    }

    const isoCreatedAt =
      created_at instanceof Date ? created_at.toISOString() : created_at;

    const recomputed = computeActivityHash({
      parcel_id: row.parcel_id,
      event_kind: row.event_kind,
      event_payload_jsonb: row.event_payload_jsonb,
      prev_hash: row.prev_hash ?? null,
      created_at: isoCreatedAt,
    });

    if (recomputed !== row.hash) {
      return {
        ok: false,
        brokenAtIndex: i,
        reason: `hash mismatch at index ${i}: expected ${recomputed}, stored ${row.hash}`,
      };
    }

    expectedPrev = row.hash;
  }

  return { ok: true };
}
