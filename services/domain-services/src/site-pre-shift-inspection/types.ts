/**
 * Site pre-shift inspection — types, enums, Zod validators.
 */

import { z } from 'zod';
import type { TenantId } from '@borjie/domain-models';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const PRE_SHIFT_OVERALL_STATUSES = [
  'pending',
  'passed',
  'failed',
  'sign_off_pending',
] as const;
export type PreShiftOverallStatus =
  (typeof PRE_SHIFT_OVERALL_STATUSES)[number];

export const PRE_SHIFT_SHIFT_KINDS = ['day', 'night'] as const;
export type PreShiftShiftKind = (typeof PRE_SHIFT_SHIFT_KINDS)[number];

export const CHECKLIST_ITEM_STATUSES = ['pass', 'fail', 'na'] as const;
export type ChecklistItemStatus = (typeof CHECKLIST_ITEM_STATUSES)[number];

// ---------------------------------------------------------------------------
// Domain shapes
// ---------------------------------------------------------------------------

export interface ChecklistItem {
  readonly code: string;
  readonly label: string;
  readonly status: ChecklistItemStatus;
  readonly note: string | null;
}

export interface PreShiftInspection {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly siteId: string;
  readonly assetId: string;
  readonly supervisorUserId: string;
  readonly shiftKind: PreShiftShiftKind;
  readonly checklist: readonly ChecklistItem[];
  readonly overallStatus: PreShiftOverallStatus;
  readonly signOffUserId: string | null;
  readonly signOffAt: string | null;
  readonly notes: string | null;
  readonly evidenceIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const checklistItemSchema = z.object({
  code: z.string().min(1).max(80),
  label: z.string().min(1).max(200),
  status: z.enum(CHECKLIST_ITEM_STATUSES),
  note: z.string().max(2000).nullable().default(null),
});

export const recordInspectionSchema = z.object({
  id: z.string().min(1),
  siteId: z.string().min(1),
  assetId: z.string().min(1),
  supervisorUserId: z.string().min(1),
  shiftKind: z.enum(PRE_SHIFT_SHIFT_KINDS).default('day'),
  checklist: z.array(checklistItemSchema).min(1),
  notes: z.string().max(4000).nullable().optional(),
  evidenceIds: z.array(z.string()).default([]),
});
export type RecordInspectionInput = z.infer<typeof recordInspectionSchema>;

export const signOffInspectionSchema = z.object({
  signOffUserId: z.string().min(1),
});
export type SignOffInspectionInput = z.infer<typeof signOffInspectionSchema>;

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

export interface SitePreShiftInspectionRepository {
  recordInspection(
    tenantId: TenantId,
    input: RecordInspectionInput,
  ): Promise<PreShiftInspection>;
  findById(
    tenantId: TenantId,
    id: string,
  ): Promise<PreShiftInspection | null>;
  listForSite(
    tenantId: TenantId,
    siteId: string,
    limit?: number,
  ): Promise<readonly PreShiftInspection[]>;
  listForAsset(
    tenantId: TenantId,
    assetId: string,
    limit?: number,
  ): Promise<readonly PreShiftInspection[]>;
  listPending(
    tenantId: TenantId,
  ): Promise<readonly PreShiftInspection[]>;
  signOff(
    tenantId: TenantId,
    id: string,
    input: SignOffInspectionInput,
  ): Promise<PreShiftInspection>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SitePreShiftInspectionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'VALIDATION'
      | 'NOT_FOUND'
      | 'TENANT_MISMATCH'
      | 'INVALID_TRANSITION',
  ) {
    super(message);
    this.name = 'SitePreShiftInspectionError';
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (overall status derivation)
// ---------------------------------------------------------------------------

export function deriveOverallStatus(
  checklist: readonly ChecklistItem[],
): PreShiftOverallStatus {
  const hasFail = checklist.some((c) => c.status === 'fail');
  if (hasFail) return 'failed';
  const allEvaluated = checklist.every(
    (c) => c.status === 'pass' || c.status === 'na',
  );
  return allEvaluated ? 'sign_off_pending' : 'pending';
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function toIso(d: unknown): string {
  if (d instanceof Date) return d.toISOString();
  return String(d ?? new Date().toISOString());
}

function nullableIso(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return null;
}

export function rowToInspection(
  row: Record<string, unknown>,
): PreShiftInspection {
  const statusRaw = String(row.overallStatus ?? 'pending');
  const overallStatus: PreShiftOverallStatus = (
    PRE_SHIFT_OVERALL_STATUSES as readonly string[]
  ).includes(statusRaw)
    ? (statusRaw as PreShiftOverallStatus)
    : 'pending';
  const shiftRaw = String(row.shiftKind ?? 'day');
  const shiftKind: PreShiftShiftKind = (
    PRE_SHIFT_SHIFT_KINDS as readonly string[]
  ).includes(shiftRaw)
    ? (shiftRaw as PreShiftShiftKind)
    : 'day';
  const checklistRaw = Array.isArray(row.checklist) ? row.checklist : [];
  const checklist: ChecklistItem[] = (
    checklistRaw as ReadonlyArray<Record<string, unknown>>
  ).map((item) => {
    const itemStatusRaw = String(item.status ?? 'na');
    const itemStatus: ChecklistItemStatus = (
      CHECKLIST_ITEM_STATUSES as readonly string[]
    ).includes(itemStatusRaw)
      ? (itemStatusRaw as ChecklistItemStatus)
      : 'na';
    return {
      code: String(item.code ?? ''),
      label: String(item.label ?? ''),
      status: itemStatus,
      note: (item.note as string | null) ?? null,
    };
  });
  return {
    id: String(row.id),
    tenantId: row.tenantId as TenantId,
    siteId: String(row.siteId),
    assetId: String(row.assetId),
    supervisorUserId: String(row.supervisorUserId),
    shiftKind,
    checklist,
    overallStatus,
    signOffUserId: (row.signOffUserId as string | null) ?? null,
    signOffAt: nullableIso(row.signOffAt),
    notes: (row.notes as string | null) ?? null,
    evidenceIds: Array.isArray(row.evidenceIds)
      ? (row.evidenceIds as readonly string[])
      : [],
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}
