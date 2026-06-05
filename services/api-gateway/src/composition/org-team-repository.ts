/**
 * Postgres-backed OrgTeamRepository (migration 0280).
 *
 * Encapsulates the org / team-management data layer behind the
 * `/api/v1/org-admin/*` route and the `staff.*` brain tools. Ported from the
 * BossNyumba org/team-management repository (itself a LitFin iter-27..31
 * port) and retargeted real-estate → mining (caretaker / leasing_assistant →
 * site_supervisor / pit_foreman / safety_officer / geologist / accountant).
 * The honest behaviours live here as repository methods so the route stays
 * thin:
 *
 *   - createStaffMember : case-insensitive DUPLICATE detection per tenant;
 *                         manager self-FK validated (no dangling FK).
 *   - assignKpi         : resolves the staff member by id OR name within the
 *                         tenant; NOT_FOUND / AMBIGUOUS surfaced.
 *   - scheduleTask      : resolves the (optional) assignee by id OR name.
 *   - raiseEscalation   : verifies the (optional) related task + the
 *                         (optional) staff target both belong to the tenant.
 *   - bulkIngestStaff   : per-row outcome collection (inserted /
 *                         skipped_duplicate / rejected) with manager_name
 *                         resolution against earlier-in-batch or existing rows.
 *
 * Every method is tenant-scoped: each SQL statement carries
 * `WHERE tenant_id = ${tenantId}`. RLS (FORCE-enabled in mig 0280) on the
 * canonical `app.current_tenant_id` GUC is the primary guard; the explicit
 * filter is defense in depth, mirroring the other repositories in this
 * directory (damage-claim-repository.ts, move-out-repository.ts).
 *
 * tenant_id is TEXT in Borjie (migration 0279 convention) so it binds as a
 * plain string — never cast to ::uuid. Staff / task ids ARE uuid, so those
 * keep their ::uuid casts.
 *
 * Result discipline (honest-degrade): methods return a discriminated
 * `{ ok: true; … } | { ok: false; code; message }` union — never throw for a
 * domain failure and never fabricate a row.
 */

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';

import type { Provenance } from '../services/provenance';

// ── shared result + row types ──────────────────────────────────────────

export interface RepoFailure {
  readonly ok: false;
  readonly code:
    | 'DUPLICATE'
    | 'NOT_FOUND'
    | 'AMBIGUOUS'
    | 'INVALID_INPUT'
    | 'NO_ROWS';
  readonly message: string;
}

export type RepoResult<T> = ({ readonly ok: true } & T) | RepoFailure;

interface DbExec {
  execute(query: unknown): Promise<unknown>;
}

export type ProvenanceLike = Provenance;

export interface StaffMemberRow {
  readonly id: string;
  readonly full_name: string;
  readonly role: string;
  readonly hire_date: string;
  readonly manager_id: string | null;
  readonly status: string;
  readonly metadata: Record<string, unknown>;
  readonly created_at: string;
}

export interface KpiRow {
  readonly id: string;
  readonly name: string;
  readonly staff_member_id: string;
  readonly target_value: string;
  readonly metric_unit: string;
  readonly period: string;
  readonly period_end: string | null;
  readonly status: string;
}

export interface TaskRow {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly priority: string;
  readonly due_at: string | null;
  readonly assigned_to: string | null;
}

export interface EscalationRow {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly severity: string;
  readonly status: string;
  readonly escalated_to_staff_id: string | null;
  readonly related_task_id: string | null;
}

export type BulkRowStatus = 'inserted' | 'skipped_duplicate' | 'rejected';

export interface BulkRowOutcome {
  readonly line: number;
  readonly status: BulkRowStatus;
  readonly reason?: string;
  readonly staffMemberId?: string;
}

export interface BulkParsedRow {
  readonly line: number;
  readonly fullName: string;
  readonly role: string;
  readonly hireDateIso: string;
  readonly managerName: string | null;
  readonly metadata: Record<string, unknown>;
}

// ── helpers ─────────────────────────────────────────────────────────────

function extractRows<T>(res: unknown): readonly T[] {
  if (Array.isArray(res)) return res as T[];
  const maybe = (res as { rows?: T[] } | null)?.rows;
  return maybe ?? [];
}

function provenanceJson(p: ProvenanceLike | undefined): string {
  const safe: ProvenanceLike = p ?? {
    via: 'unknown',
    actorId: null,
    requestedAt: new Date().toISOString(),
  };
  return JSON.stringify(safe);
}

export class OrgTeamRepository {
  constructor(private readonly db: DbExec) {}

  // ── staff: resolve helpers ───────────────────────────────────────────

  /** Resolve a single staff member by exact id within the tenant. */
  async findStaffById(
    tenantId: string,
    id: string,
  ): Promise<StaffMemberRow | null> {
    const res = await this.db.execute(sql`
      SELECT id, full_name, role, hire_date, manager_id, status,
             metadata, created_at
        FROM staff_members
       WHERE tenant_id = ${tenantId} AND id = ${id}::uuid
       LIMIT 1
    `);
    return extractRows<StaffMemberRow>(res)[0] ?? null;
  }

  /** Resolve staff members by case-insensitive name within the tenant. */
  async findStaffByName(
    tenantId: string,
    name: string,
  ): Promise<readonly StaffMemberRow[]> {
    const res = await this.db.execute(sql`
      SELECT id, full_name, role, hire_date, manager_id, status,
             metadata, created_at
        FROM staff_members
       WHERE tenant_id = ${tenantId}
         AND lower(full_name) = lower(${name})
         AND status <> 'terminated'
       ORDER BY created_at ASC
    `);
    return extractRows<StaffMemberRow>(res);
  }

  /**
   * Resolve a staff member by id (preferred) or name. Surfaces
   * NOT_FOUND / AMBIGUOUS honestly. `label` names the field in errors.
   */
  async resolveStaff(
    tenantId: string,
    args: { readonly id?: string | null; readonly name?: string | null },
    label: string,
  ): Promise<RepoResult<{ readonly staff: StaffMemberRow }>> {
    if (args.id) {
      const row = await this.findStaffById(tenantId, args.id);
      if (!row) {
        return {
          ok: false,
          code: 'NOT_FOUND',
          message: `NOT_FOUND: ${label} ${args.id} not in this tenant.`,
        };
      }
      return { ok: true, staff: row };
    }
    if (args.name) {
      const rows = await this.findStaffByName(tenantId, args.name);
      if (rows.length === 0) {
        return {
          ok: false,
          code: 'NOT_FOUND',
          message: `NOT_FOUND: no staff member named "${args.name}". Add them with staff.create first.`,
        };
      }
      if (rows.length > 1) {
        const disambig = rows
          .map((r) => `${r.full_name} (${r.role}, id=${r.id.slice(0, 8)})`)
          .join('; ');
        return {
          ok: false,
          code: 'AMBIGUOUS',
          message: `AMBIGUOUS: ${rows.length} staff members named "${args.name}" — ${disambig}. Pass the id.`,
        };
      }
      return { ok: true, staff: rows[0]! };
    }
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: `Provide a staff id or name for ${label}.`,
    };
  }

  // ── staff.create ─────────────────────────────────────────────────────

  async createStaffMember(
    tenantId: string,
    input: {
      readonly fullName: string;
      readonly role: string;
      readonly hireDateIso: string;
      readonly managerId?: string | null;
      readonly metadata: Record<string, unknown>;
      readonly allowDuplicate: boolean;
    },
    actorUserId: string | null,
    provenance?: ProvenanceLike,
  ): Promise<RepoResult<{ readonly staff: StaffMemberRow }>> {
    if (!input.allowDuplicate) {
      const dups = await this.findStaffByName(tenantId, input.fullName);
      const dup = dups[0];
      if (dup) {
        return {
          ok: false,
          code: 'DUPLICATE',
          message: `DUPLICATE: ${dup.full_name} (${dup.role}, id=${dup.id.slice(0, 8)}) already exists. Pass allowDuplicate:true to force or update the existing row.`,
        };
      }
    }

    let managerId: string | null = null;
    if (input.managerId) {
      const mgr = await this.findStaffById(tenantId, input.managerId);
      if (!mgr) {
        return {
          ok: false,
          code: 'NOT_FOUND',
          message: `manager ${input.managerId} not found in this tenant.`,
        };
      }
      managerId = mgr.id;
    }

    const id = randomUUID();
    await this.db.execute(sql`
      INSERT INTO staff_members (
        id, tenant_id, full_name, role, hire_date, manager_id,
        status, metadata, provenance, created_by, updated_by
      ) VALUES (
        ${id}, ${tenantId}, ${input.fullName}, ${input.role},
        ${input.hireDateIso}::timestamptz,
        ${managerId === null ? null : sql`${managerId}::uuid`},
        'active', ${JSON.stringify(input.metadata)}::jsonb,
        ${provenanceJson(provenance)}::jsonb, ${actorUserId}, ${actorUserId}
      )
    `);
    const row = await this.findStaffById(tenantId, id);
    if (!row) {
      return { ok: false, code: 'NO_ROWS', message: 'insert returned no row.' };
    }
    return { ok: true, staff: row };
  }

  // ── staff.assign_kpi ─────────────────────────────────────────────────

  async assignKpi(
    tenantId: string,
    staffMemberId: string,
    input: {
      readonly name: string;
      readonly description: string | null;
      readonly metricUnit: string;
      readonly targetValue: number;
      readonly period: string;
      readonly periodEndIso: string | null;
    },
    actorUserId: string | null,
    originSessionId: string | null,
    provenance?: ProvenanceLike,
  ): Promise<RepoResult<{ readonly kpi: KpiRow }>> {
    const id = randomUUID();
    await this.db.execute(sql`
      INSERT INTO staff_kpis (
        id, tenant_id, staff_member_id, name, description, metric_unit,
        target_value, current_value, period, period_end, status,
        assigned_by_user_id, origin_session_id, provenance
      ) VALUES (
        ${id}, ${tenantId}, ${staffMemberId}::uuid, ${input.name},
        ${input.description}, ${input.metricUnit}, ${input.targetValue}, 0,
        ${input.period},
        ${input.periodEndIso === null ? null : sql`${input.periodEndIso}::timestamptz`},
        'active', ${actorUserId}, ${originSessionId},
        ${provenanceJson(provenance)}::jsonb
      )
    `);
    const res = await this.db.execute(sql`
      SELECT id, name, staff_member_id, target_value, metric_unit,
             period, period_end, status
        FROM staff_kpis
       WHERE id = ${id}::uuid AND tenant_id = ${tenantId}
       LIMIT 1
    `);
    const kpi = extractRows<KpiRow>(res)[0];
    if (!kpi) {
      return { ok: false, code: 'NO_ROWS', message: 'KPI insert returned no row.' };
    }
    return { ok: true, kpi };
  }

  // ── staff.schedule_task ──────────────────────────────────────────────

  async scheduleTask(
    tenantId: string,
    input: {
      readonly title: string;
      readonly description: string | null;
      readonly assignedTo: string | null;
      readonly priority: string;
      readonly dueAtIso: string | null;
    },
    actorUserId: string | null,
    originSessionId: string | null,
    provenance?: ProvenanceLike,
  ): Promise<RepoResult<{ readonly task: TaskRow }>> {
    const id = randomUUID();
    await this.db.execute(sql`
      INSERT INTO org_tasks (
        id, tenant_id, title, description, assigned_to, assigned_by_user_id,
        status, priority, due_at, origin_session_id, metadata, provenance
      ) VALUES (
        ${id}, ${tenantId}, ${input.title}, ${input.description},
        ${input.assignedTo === null ? null : sql`${input.assignedTo}::uuid`},
        ${actorUserId}, 'open', ${input.priority},
        ${input.dueAtIso === null ? null : sql`${input.dueAtIso}::timestamptz`},
        ${originSessionId}, '{}'::jsonb, ${provenanceJson(provenance)}::jsonb
      )
    `);
    const res = await this.db.execute(sql`
      SELECT id, title, status, priority, due_at, assigned_to
        FROM org_tasks
       WHERE id = ${id}::uuid AND tenant_id = ${tenantId}
       LIMIT 1
    `);
    const task = extractRows<TaskRow>(res)[0];
    if (!task) {
      return { ok: false, code: 'NO_ROWS', message: 'task insert returned no row.' };
    }
    return { ok: true, task };
  }

  // ── staff.escalate_to_human ──────────────────────────────────────────

  /** Verify a task belongs to the tenant. */
  async findTaskById(tenantId: string, id: string): Promise<TaskRow | null> {
    const res = await this.db.execute(sql`
      SELECT id, title, status, priority, due_at, assigned_to
        FROM org_tasks
       WHERE id = ${id}::uuid AND tenant_id = ${tenantId}
       LIMIT 1
    `);
    return extractRows<TaskRow>(res)[0] ?? null;
  }

  async raiseEscalation(
    tenantId: string,
    input: {
      readonly title: string;
      readonly reason: string;
      readonly category: string;
      readonly severity: string;
      readonly escalatedToStaffId: string | null;
      readonly relatedTaskId: string | null;
      readonly relatedSubject: string | null;
    },
    actorUserId: string | null,
    originSessionId: string | null,
    provenance?: ProvenanceLike,
  ): Promise<RepoResult<{ readonly escalation: EscalationRow }>> {
    const id = randomUUID();
    await this.db.execute(sql`
      INSERT INTO org_escalations (
        id, tenant_id, title, reason, category, severity, status,
        escalated_to_staff_id, related_task_id, related_subject,
        raised_by_user_id, origin_session_id, metadata, provenance
      ) VALUES (
        ${id}, ${tenantId}, ${input.title}, ${input.reason},
        ${input.category}, ${input.severity}, 'open',
        ${input.escalatedToStaffId === null ? null : sql`${input.escalatedToStaffId}::uuid`},
        ${input.relatedTaskId === null ? null : sql`${input.relatedTaskId}::uuid`},
        ${input.relatedSubject}, ${actorUserId}, ${originSessionId},
        '{}'::jsonb, ${provenanceJson(provenance)}::jsonb
      )
    `);
    const res = await this.db.execute(sql`
      SELECT id, title, category, severity, status,
             escalated_to_staff_id, related_task_id
        FROM org_escalations
       WHERE id = ${id}::uuid AND tenant_id = ${tenantId}
       LIMIT 1
    `);
    const escalation = extractRows<EscalationRow>(res)[0];
    if (!escalation) {
      return {
        ok: false,
        code: 'NO_ROWS',
        message: 'escalation insert returned no row.',
      };
    }
    return { ok: true, escalation };
  }

  // ── staff.bulk_ingest_csv ────────────────────────────────────────────

  /**
   * Insert parsed staff rows one-by-one, collecting a per-row outcome.
   * manager_name resolves against an earlier-in-batch row OR an existing
   * tenant row; otherwise the row is rejected (NOT_FOUND). Duplicate names are
   * skipped unless `allowDuplicates`.
   */
  async bulkIngestStaff(
    tenantId: string,
    rows: readonly BulkParsedRow[],
    allowDuplicates: boolean,
    actorUserId: string | null,
    provenance?: ProvenanceLike,
  ): Promise<readonly BulkRowOutcome[]> {
    // Pre-load existing names → id (one query, not N).
    const existingRes = await this.db.execute(sql`
      SELECT id, full_name FROM staff_members
       WHERE tenant_id = ${tenantId} AND status <> 'terminated'
    `);
    const existingByLowerName = new Map<string, string>();
    for (const r of extractRows<{ id: string; full_name: string }>(
      existingRes,
    )) {
      existingByLowerName.set(r.full_name.toLowerCase(), r.id);
    }
    const insertedByLowerName = new Map<string, string>();
    const outcomes: BulkRowOutcome[] = [];

    for (const row of rows) {
      const lower = row.fullName.toLowerCase();
      if (!allowDuplicates && existingByLowerName.has(lower)) {
        outcomes.push({
          line: row.line,
          status: 'skipped_duplicate',
          reason: `${row.fullName} already exists`,
        });
        continue;
      }
      let managerId: string | null = null;
      if (row.managerName) {
        const mgrLower = row.managerName.toLowerCase();
        managerId =
          insertedByLowerName.get(mgrLower) ??
          existingByLowerName.get(mgrLower) ??
          null;
        if (!managerId) {
          outcomes.push({
            line: row.line,
            status: 'rejected',
            reason: `manager "${row.managerName}" NOT_FOUND in tenant or earlier-in-csv`,
          });
          continue;
        }
      }
      const id = randomUUID();
      try {
        await this.db.execute(sql`
          INSERT INTO staff_members (
            id, tenant_id, full_name, role, hire_date, manager_id,
            status, metadata, provenance, created_by, updated_by
          ) VALUES (
            ${id}, ${tenantId}, ${row.fullName}, ${row.role},
            ${row.hireDateIso}::timestamptz,
            ${managerId === null ? null : sql`${managerId}::uuid`},
            'active', ${JSON.stringify(row.metadata)}::jsonb,
            ${provenanceJson(provenance)}::jsonb, ${actorUserId}, ${actorUserId}
          )
        `);
      } catch (err) {
        outcomes.push({
          line: row.line,
          status: 'rejected',
          reason: `insert failed: ${
            err instanceof Error ? err.message : 'unknown error'
          }`,
        });
        continue;
      }
      existingByLowerName.set(lower, id);
      insertedByLowerName.set(lower, id);
      outcomes.push({ line: row.line, status: 'inserted', staffMemberId: id });
    }
    return outcomes;
  }
}
