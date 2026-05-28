/**
 * Compliance — PCCB (anti-corruption) sub-area resolver.
 *
 * Backed by `pccb_disclosures` (migration 0109). Surfaces:
 *
 *   - lastFiledAt      → most recent declaration (gift / hospitality /
 *                        lobbying / conflict of interest)
 *   - recordsCount     → total declarations on file for the tenant
 *   - overdueCount     → declarations whose `period_covered` is more
 *                        than 365 days old (rolling-year staleness)
 *
 * Status tone:
 *   green   → lastFiledAt within the last 90 days AND zero overdue
 *   amber   → lastFiledAt within last 365 days OR overdue >= 1
 *   red     → no declarations on file OR all declarations are stale
 *   unknown → DB unavailable
 */

import { sql } from 'drizzle-orm';
import type { SubAreaStatus } from '../types';
import type { ResolverDeps } from './types.js';

interface ExecRow {
  readonly [key: string]: unknown;
}

function rowsOf(result: unknown): ReadonlyArray<ExecRow> {
  if (Array.isArray(result)) return result as ReadonlyArray<ExecRow>;
  const wrapped = result as { rows?: ReadonlyArray<ExecRow> };
  return wrapped?.rows ?? [];
}

function asNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function asIso(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string' && v.trim() !== '') return v;
  return null;
}

export interface PccbSummary {
  readonly status: SubAreaStatus['status'];
  readonly lastFiledAt: string | null;
  readonly recordsCount: number;
  readonly overdueCount: number;
}

export async function resolvePccb(
  { db }: ResolverDeps,
  scope: { tenantId: string },
): Promise<SubAreaStatus> {
  const summary = await summarisePccb({ db }, scope);
  const status: SubAreaStatus = {
    status: summary.status,
    note:
      summary.status === 'unknown'
        ? 'database unavailable'
        : summary.recordsCount === 0
          ? 'no PCCB disclosures on file'
          : `${summary.recordsCount} disclosure(s), ${summary.overdueCount} overdue`,
  };
  if (summary.lastFiledAt) {
    return { ...status, lastFiledAt: summary.lastFiledAt };
  }
  return status;
}

/**
 * Structured summary exposed to the brain tool
 * `compliance.pccb_summary()` so the brain can answer "how is my PCCB
 * posture?" without going through the panel renderer.
 */
export async function summarisePccb(
  { db }: ResolverDeps,
  scope: { tenantId: string },
): Promise<PccbSummary> {
  if (!db) {
    return {
      status: 'unknown',
      lastFiledAt: null,
      recordsCount: 0,
      overdueCount: 0,
    };
  }
  try {
    const result = await db.execute(sql`
      SELECT
        COUNT(*)::int AS records_count,
        COUNT(*) FILTER (
          WHERE period_covered < (CURRENT_DATE - INTERVAL '365 days')
        )::int AS overdue_count,
        MAX(declared_at) AS last_filed_at
      FROM pccb_disclosures
      WHERE tenant_id = ${scope.tenantId}
    `);
    const row = rowsOf(result)[0];
    const recordsCount = asNumber(row?.records_count);
    const overdueCount = asNumber(row?.overdue_count);
    const lastFiledAt = asIso(row?.last_filed_at);
    return {
      status: deriveTone({ recordsCount, overdueCount, lastFiledAt }),
      lastFiledAt,
      recordsCount,
      overdueCount,
    };
  } catch {
    return {
      status: 'unknown',
      lastFiledAt: null,
      recordsCount: 0,
      overdueCount: 0,
    };
  }
}

function deriveTone(input: {
  recordsCount: number;
  overdueCount: number;
  lastFiledAt: string | null;
}): SubAreaStatus['status'] {
  if (input.recordsCount === 0) return 'red';
  if (!input.lastFiledAt) return 'red';
  const lastMs = Date.parse(input.lastFiledAt);
  if (!Number.isFinite(lastMs)) return 'amber';
  const nowMs = Date.now();
  const ageDays = (nowMs - lastMs) / (1000 * 60 * 60 * 24);
  if (ageDays > 365) return 'red';
  if (ageDays > 90 || input.overdueCount > 0) return 'amber';
  return 'green';
}
