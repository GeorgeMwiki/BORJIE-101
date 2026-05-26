/**
 * Site-supervisor coverage — types, enums, Zod validators.
 *
 * A coverage row binds one supervisor (a `users.id`) to one site for a
 * given shift kind across a validity window. The "active coverage" for
 * a (site, shift, instant) is the row whose [validFrom, validTo) range
 * contains the instant, with `shift_kind = 'all'` rows acting as the
 * default fallback.
 */

import { z } from 'zod';
import type { TenantId } from '@borjie/domain-models';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const SUPERVISOR_SHIFT_KINDS = ['day', 'night', 'all'] as const;
export type SupervisorShiftKind = (typeof SUPERVISOR_SHIFT_KINDS)[number];

// ---------------------------------------------------------------------------
// Domain shapes
// ---------------------------------------------------------------------------

export interface SiteSupervisorCoverage {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly siteId: string;
  readonly supervisorUserId: string;
  readonly shiftKind: SupervisorShiftKind;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const upsertCoverageSchema = z.object({
  id: z.string().min(1),
  siteId: z.string().min(1),
  supervisorUserId: z.string().min(1),
  shiftKind: z.enum(SUPERVISOR_SHIFT_KINDS).default('day'),
  validFrom: z.string().min(1),
  validTo: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type UpsertCoverageInput = z.infer<typeof upsertCoverageSchema>;

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

export interface SiteSupervisorCoverageRepository {
  upsert(
    tenantId: TenantId,
    input: UpsertCoverageInput,
  ): Promise<SiteSupervisorCoverage>;
  findById(
    tenantId: TenantId,
    id: string,
  ): Promise<SiteSupervisorCoverage | null>;
  listForSite(
    tenantId: TenantId,
    siteId: string,
  ): Promise<readonly SiteSupervisorCoverage[]>;
  listForSupervisor(
    tenantId: TenantId,
    supervisorUserId: string,
  ): Promise<readonly SiteSupervisorCoverage[]>;
  findActive(
    tenantId: TenantId,
    siteId: string,
    shiftKind: SupervisorShiftKind,
    at?: string,
  ): Promise<SiteSupervisorCoverage | null>;
  endCoverage(
    tenantId: TenantId,
    id: string,
    endAt: string,
  ): Promise<SiteSupervisorCoverage>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SiteSupervisorCoverageError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'VALIDATION'
      | 'NOT_FOUND'
      | 'TENANT_MISMATCH'
      | 'INVALID_TRANSITION',
  ) {
    super(message);
    this.name = 'SiteSupervisorCoverageError';
  }
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

export function rowToCoverage(
  row: Record<string, unknown>,
): SiteSupervisorCoverage {
  const shiftRaw = String(row.shiftKind ?? 'day');
  const shiftKind: SupervisorShiftKind = (
    SUPERVISOR_SHIFT_KINDS as readonly string[]
  ).includes(shiftRaw)
    ? (shiftRaw as SupervisorShiftKind)
    : 'day';
  return {
    id: String(row.id),
    tenantId: row.tenantId as TenantId,
    siteId: String(row.siteId),
    supervisorUserId: String(row.supervisorUserId),
    shiftKind,
    validFrom: toIso(row.validFrom),
    validTo: nullableIso(row.validTo),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}
