/**
 * Compliance — PDPA (Personal Data Protection Act 2022) sub-area
 * resolver.
 *
 * Backed by `pdpa_processing_records` + `pdpa_subject_requests`
 * (migration 0109). Surfaces:
 *
 *   - openSubjectRequests → status IN ('open','in_review')
 *   - overdueRequests     → openSubjectRequests AND due_by < now()
 *   - dpiaCoverage        → share of processing records with a DPIA
 *                            doc id (0..1)
 *   - lastReviewAt        → MAX(last_review_at) across processing rows
 *
 * Status tone:
 *   green   → 0 overdue, dpiaCoverage >= 0.8, last review within 1 year
 *   amber   → some overdue OR coverage 0.4..0.8 OR review 1..2 years
 *   red     → overdueRequests > 3 OR coverage < 0.4 OR review > 2 years
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

export interface PdpaSummary {
  readonly status: SubAreaStatus['status'];
  readonly openSubjectRequests: number;
  readonly overdueRequests: number;
  readonly processingRecordsCount: number;
  readonly dpiaCoverage: number;
  readonly lastReviewAt: string | null;
}

export async function resolvePdpa(
  { db }: ResolverDeps,
  scope: { tenantId: string },
): Promise<SubAreaStatus> {
  const summary = await summarisePdpa({ db }, scope);
  const status: SubAreaStatus = {
    status: summary.status,
    note:
      summary.status === 'unknown'
        ? 'database unavailable'
        : summary.processingRecordsCount === 0
          ? 'no PDPA processing records on file'
          : `${summary.openSubjectRequests} open request(s), ${summary.overdueRequests} overdue, DPIA coverage ${Math.round(summary.dpiaCoverage * 100)}%`,
  };
  if (summary.lastReviewAt) {
    return { ...status, lastFiledAt: summary.lastReviewAt };
  }
  return status;
}

export async function summarisePdpa(
  { db }: ResolverDeps,
  scope: { tenantId: string },
): Promise<PdpaSummary> {
  if (!db) {
    return {
      status: 'unknown',
      openSubjectRequests: 0,
      overdueRequests: 0,
      processingRecordsCount: 0,
      dpiaCoverage: 0,
      lastReviewAt: null,
    };
  }
  try {
    const procResult = await db.execute(sql`
      SELECT
        COUNT(*)::int AS records_count,
        COUNT(*) FILTER (WHERE dpia_doc_id IS NOT NULL)::int AS with_dpia,
        MAX(last_review_at) AS last_review_at
      FROM pdpa_processing_records
      WHERE tenant_id = ${scope.tenantId}
    `);
    const reqResult = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (
          WHERE status IN ('open', 'in_review')
        )::int AS open_count,
        COUNT(*) FILTER (
          WHERE status IN ('open', 'in_review')
            AND due_by < NOW()
        )::int AS overdue_count
      FROM pdpa_subject_requests
      WHERE tenant_id = ${scope.tenantId}
    `);
    const procRow = rowsOf(procResult)[0];
    const reqRow = rowsOf(reqResult)[0];
    const recordsCount = asNumber(procRow?.records_count);
    const withDpia = asNumber(procRow?.with_dpia);
    const dpiaCoverage = recordsCount === 0 ? 0 : withDpia / recordsCount;
    const lastReviewAt = asIso(procRow?.last_review_at);
    const openSubjectRequests = asNumber(reqRow?.open_count);
    const overdueRequests = asNumber(reqRow?.overdue_count);
    return {
      status: deriveTone({
        recordsCount,
        dpiaCoverage,
        lastReviewAt,
        overdueRequests,
      }),
      openSubjectRequests,
      overdueRequests,
      processingRecordsCount: recordsCount,
      dpiaCoverage,
      lastReviewAt,
    };
  } catch {
    return {
      status: 'unknown',
      openSubjectRequests: 0,
      overdueRequests: 0,
      processingRecordsCount: 0,
      dpiaCoverage: 0,
      lastReviewAt: null,
    };
  }
}

function deriveTone(input: {
  recordsCount: number;
  dpiaCoverage: number;
  lastReviewAt: string | null;
  overdueRequests: number;
}): SubAreaStatus['status'] {
  if (input.recordsCount === 0) return 'red';
  if (input.overdueRequests > 3) return 'red';
  if (input.dpiaCoverage < 0.4) return 'red';

  const reviewAgeYears = computeReviewAgeYears(input.lastReviewAt);
  if (reviewAgeYears !== null && reviewAgeYears > 2) return 'red';

  if (input.overdueRequests > 0) return 'amber';
  if (input.dpiaCoverage < 0.8) return 'amber';
  if (reviewAgeYears !== null && reviewAgeYears > 1) return 'amber';

  return 'green';
}

function computeReviewAgeYears(reviewIso: string | null): number | null {
  if (!reviewIso) return null;
  const t = Date.parse(reviewIso);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / (1000 * 60 * 60 * 24 * 365);
}
