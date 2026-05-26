/**
 * Worker incentives — types, enums, Zod validators.
 *
 * Split out so the repository file stays under the project's 300-line cap.
 */

import { z } from 'zod';
import type { TenantId } from '@borjie/domain-models';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const WORKER_INCENTIVE_KINDS = [
  'safety_badge',
  'productivity_reward',
  'attendance_streak',
  'incident_free_days',
  'other',
] as const;
export type WorkerIncentiveKind = (typeof WORKER_INCENTIVE_KINDS)[number];

// ---------------------------------------------------------------------------
// Domain shapes
// ---------------------------------------------------------------------------

export interface WorkerIncentive {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly userId: string;
  readonly kind: WorkerIncentiveKind;
  readonly points: number;
  readonly reason: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly awardedAt: string;
  readonly awardedByUserId: string | null;
  readonly createdAt: string;
}

export interface WorkerIncentiveSummary {
  readonly userId: string;
  readonly totalPoints: number;
  readonly countByKind: Readonly<Record<WorkerIncentiveKind, number>>;
  readonly lastAwardedAt: string | null;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const awardIncentiveSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  kind: z.enum(WORKER_INCENTIVE_KINDS),
  points: z.number().int().min(0).max(100000),
  reason: z.string().max(1000).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  awardedByUserId: z.string().nullable().optional(),
});
export type AwardIncentiveInput = z.infer<typeof awardIncentiveSchema>;

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

export interface WorkerIncentivesRepository {
  award(
    tenantId: TenantId,
    input: AwardIncentiveInput,
  ): Promise<WorkerIncentive>;
  findById(
    tenantId: TenantId,
    id: string,
  ): Promise<WorkerIncentive | null>;
  listForUser(
    tenantId: TenantId,
    userId: string,
    limit?: number,
  ): Promise<readonly WorkerIncentive[]>;
  listForTenant(
    tenantId: TenantId,
    options?: {
      readonly kind?: WorkerIncentiveKind;
      readonly limit?: number;
    },
  ): Promise<readonly WorkerIncentive[]>;
  summaryForUser(
    tenantId: TenantId,
    userId: string,
  ): Promise<WorkerIncentiveSummary>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class WorkerIncentivesError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'VALIDATION'
      | 'NOT_FOUND'
      | 'TENANT_MISMATCH',
  ) {
    super(message);
    this.name = 'WorkerIncentivesError';
  }
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function toIso(d: unknown): string {
  if (d instanceof Date) return d.toISOString();
  return String(d ?? new Date().toISOString());
}

export function rowToIncentive(
  row: Record<string, unknown>,
): WorkerIncentive {
  const kindRaw = String(row.kind ?? 'other');
  const kind: WorkerIncentiveKind = (
    WORKER_INCENTIVE_KINDS as readonly string[]
  ).includes(kindRaw)
    ? (kindRaw as WorkerIncentiveKind)
    : 'other';
  return {
    id: String(row.id),
    tenantId: row.tenantId as TenantId,
    userId: String(row.userId),
    kind,
    points: Number(row.points ?? 0),
    reason: (row.reason as string | null) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    awardedAt: toIso(row.awardedAt),
    awardedByUserId: (row.awardedByUserId as string | null) ?? null,
    createdAt: toIso(row.createdAt),
  };
}
