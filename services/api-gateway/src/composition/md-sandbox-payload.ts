/**
 * Sandbox payload validators (migration 0281).
 *
 * A `sandbox.commit` MUST validate the staged payload (type / shape via zod)
 * BEFORE the atomic write into the real target table. This module holds one
 * zod schema per allowed target table plus the column allowlist used to strip
 * reserved / forbidden columns the brain must never set (id / tenant_id /
 * audit columns / timestamps / provenance).
 *
 * Why a dedicated module: keeps the repository under the 800-line cap and
 * isolates the "what may a staged payload contain" contract so it evolves
 * independently of the SQL.
 *
 * Companion to:
 *   - services/api-gateway/src/composition/md-agentic-repository.ts
 *   - services/api-gateway/src/routes/md-agentic.hono.ts
 *   - packages/database/src/migrations/0281_md_agentic_sandbox.sql
 *
 * The validators mirror the column shapes + CHECK constraints from migration
 * 0280 (staff_members / staff_kpis / org_tasks / org_escalations). They are
 * intentionally permissive on optional fields but STRICT on enums + required
 * fields so a committed insert can never violate a downstream CHECK.
 *
 * Ported from the BN md-sandbox-payload module (RESERVED column stripping +
 * tenant_id forced by the repository) and retargeted real-estate → mining
 * (escalation category maintenance_incident → safety_incident).
 */

import { z } from 'zod';

/** Allowed sandbox target tables — the gap-2 org/team tables only. */
export const SANDBOX_TARGET_TABLES = [
  'staff_members',
  'staff_kpis',
  'org_tasks',
  'org_escalations',
] as const;
export type SandboxTargetTable = (typeof SANDBOX_TARGET_TABLES)[number];

/**
 * Columns the brain must NEVER set in a staged payload — the commit path
 * strips these before validating + writing. `tenant_id` is forced to the
 * caller's tenant by the repository regardless.
 */
export const RESERVED_PAYLOAD_COLUMNS: ReadonlyArray<string> = Object.freeze([
  'id',
  'tenant_id',
  'created_at',
  'updated_at',
  'audit_chain_ids',
  'provenance',
  'created_by',
  'updated_by',
]);

// ── per-table zod validators (commit-time shape gate) ────────────────────

const StaffMembersPayload = z
  .object({
    full_name: z.string().min(1).max(200),
    role: z.string().min(1).max(120),
    hire_date: z.string().optional(),
    manager_id: z.string().uuid().nullable().optional(),
    status: z.enum(['active', 'suspended', 'terminated']).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const StaffKpisPayload = z
  .object({
    staff_member_id: z.string().uuid(),
    name: z.string().min(1).max(200),
    description: z.string().max(4000).nullable().optional(),
    metric_unit: z
      .enum(['count', 'currency', 'percent', 'days', 'hours', 'ratio'])
      .optional(),
    target_value: z.number().finite().positive(),
    current_value: z.number().finite().nonnegative().optional(),
    period: z.enum(['week', 'month', 'quarter', 'half', 'year']).optional(),
    period_end: z.string().nullable().optional(),
    status: z
      .enum(['active', 'paused', 'achieved', 'missed', 'cancelled'])
      .optional(),
  })
  .strict();

const OrgTasksPayload = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(4000).nullable().optional(),
    assigned_to: z.string().uuid().nullable().optional(),
    status: z.enum(['open', 'in_progress', 'done', 'cancelled']).optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    due_at: z.string().nullable().optional(),
    completed_at: z.string().nullable().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const OrgEscalationsPayload = z
  .object({
    title: z.string().min(1).max(200),
    reason: z.string().min(1).max(4000),
    category: z
      .enum([
        'compliance_breach',
        'safety_incident',
        'payment_default',
        'other',
      ])
      .optional(),
    severity: z.enum(['low', 'normal', 'high', 'critical']).optional(),
    status: z
      .enum(['open', 'acknowledged', 'in_progress', 'resolved', 'cancelled'])
      .optional(),
    escalated_to_staff_id: z.string().uuid().nullable().optional(),
    related_task_id: z.string().uuid().nullable().optional(),
    related_subject: z.string().max(200).nullable().optional(),
  })
  .strict();

/**
 * For UPDATE we accept the same shape with EVERY field optional (a partial
 * patch) — required fields only matter for INSERT.
 */
const PAYLOAD_VALIDATORS: Record<
  SandboxTargetTable,
  { readonly insert: z.ZodTypeAny; readonly update: z.ZodTypeAny }
> = {
  staff_members: {
    insert: StaffMembersPayload,
    update: StaffMembersPayload.partial(),
  },
  staff_kpis: { insert: StaffKpisPayload, update: StaffKpisPayload.partial() },
  org_tasks: { insert: OrgTasksPayload, update: OrgTasksPayload.partial() },
  org_escalations: {
    insert: OrgEscalationsPayload,
    update: OrgEscalationsPayload.partial(),
  },
};

export interface PayloadValidationOk {
  readonly ok: true;
  readonly payload: Record<string, unknown>;
}
export interface PayloadValidationErr {
  readonly ok: false;
  readonly message: string;
}
export type PayloadValidation = PayloadValidationOk | PayloadValidationErr;

/**
 * Strip reserved columns, then validate the staged payload against the target
 * table's shape for the given operation. Returns the cleaned, validated
 * payload (reserved columns removed) or a typed error.
 *
 * Immutable: never mutates the caller's payload object.
 */
export function validateSandboxPayload(
  targetTable: SandboxTargetTable,
  operation: 'insert' | 'update',
  rawPayload: Record<string, unknown>,
): PayloadValidation {
  // Build a new object without the reserved columns (immutability).
  const reserved = new Set(RESERVED_PAYLOAD_COLUMNS);
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawPayload)) {
    if (!reserved.has(key)) cleaned[key] = value;
  }

  if (Object.keys(cleaned).length === 0) {
    return {
      ok: false,
      message:
        'proposed_payload has no writable fields after stripping reserved columns.',
    };
  }

  const validator = PAYLOAD_VALIDATORS[targetTable][operation];
  const parsed = validator.safeParse(cleaned);
  if (!parsed.success) {
    return {
      ok: false,
      message: `payload invalid for ${targetTable} ${operation}: ${parsed.error.message}`,
    };
  }
  return { ok: true, payload: parsed.data as Record<string, unknown> };
}

/** Type guard — narrows an arbitrary string to a known target table. */
export function isSandboxTargetTable(
  value: string,
): value is SandboxTargetTable {
  return (SANDBOX_TARGET_TABLES as ReadonlyArray<string>).includes(value);
}
