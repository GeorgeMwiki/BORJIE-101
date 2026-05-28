/**
 * Domain-depth resolvers — shared utilities.
 *
 * Generic patterns the resolver modules reuse:
 *
 *   - `countRows(db, sql)` runs a single COUNT(*) query and returns
 *     the integer, or `null` when the DB call fails.
 *   - `firstRow(db, sql)` returns the first row of a Drizzle execute
 *     result as a plain record, or `null`.
 *   - `tone()` deterministically picks a SubAreaStatusTone from a count
 *     threshold and an "overdue" count.
 *
 * Every helper is failure-tolerant — resolvers must NEVER throw.
 */

import type { SubAreaStatus } from '../types';

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

interface ExecRow {
  readonly [key: string]: unknown;
}

export function rowsOf(result: unknown): ReadonlyArray<ExecRow> {
  if (Array.isArray(result)) return result as ReadonlyArray<ExecRow>;
  const wrapped = result as { rows?: ReadonlyArray<ExecRow> };
  return wrapped?.rows ?? [];
}

export function asNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

export function asIso(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string' && v.trim() !== '') return v;
  return null;
}

export async function execute(
  db: DbLike | null,
  query: unknown,
): Promise<ReadonlyArray<ExecRow>> {
  if (!db) return [];
  try {
    return rowsOf(await db.execute(query));
  } catch {
    return [];
  }
}

/**
 * Tone from a record count + an "overdue" count. Always returns the
 * conservative tone — green only when records exist and zero overdue.
 */
export function toneFromCounts(input: {
  recordsCount: number;
  overdueCount?: number;
}): SubAreaStatus['status'] {
  if (input.recordsCount === 0) return 'amber';
  if ((input.overdueCount ?? 0) > 0) return 'amber';
  return 'green';
}

/** Render a `SubAreaStatus` with optional last-filed pointer. */
export function statusFor(input: {
  tone: SubAreaStatus['status'];
  note: string;
  lastFiledAt?: string | null;
}): SubAreaStatus {
  const out: SubAreaStatus = { status: input.tone, note: input.note };
  if (input.lastFiledAt) return { ...out, lastFiledAt: input.lastFiledAt };
  return out;
}
