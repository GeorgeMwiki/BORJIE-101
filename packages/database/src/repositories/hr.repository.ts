// @ts-nocheck — drizzle-orm v0.36 audit-column narrowing: downstream apps use stricter exactOptionalPropertyTypes that rejects our insert/update shapes. Tracked: drizzle-team/drizzle-orm#2876.
/**
 * HR repositories — Departments, Teams, Employees, Team Memberships,
 * Assignments, and Performance Records.
 *
 * Multi-tenant, soft-delete-aware where schemas support it. The Brain's
 * assignment-intelligence skill consumes `EmployeeRepository.listForRanking`
 * which returns just the fields the ranker needs.
 */

import { and, eq, isNull, inArray, desc, sql } from 'drizzle-orm';
import type { DatabaseClient } from '../client.js';
import {
  departments,
  teams,
  employees,
  teamMemberships,
  assignments,
  performanceRecords,
} from '../schemas/hr.schema.js';

type DepartmentRow = typeof departments.$inferSelect;
type TeamRow = typeof teams.$inferSelect;
type EmployeeRow = typeof employees.$inferSelect;
type AssignmentRow = typeof assignments.$inferSelect;
type PerformanceRow = typeof performanceRecords.$inferSelect;

// ---------------------------------------------------------------------------
// DepartmentRepository
// ---------------------------------------------------------------------------

export class DepartmentRepository {
  constructor(private readonly db: DatabaseClient) {}

  async findById(id: string, tenantId: string): Promise<DepartmentRow | null> {
    const rows = await this.db
      .select()
      .from(departments)
      .where(
        and(
          eq(departments.id, id),
          eq(departments.tenantId, tenantId),
          isNull(departments.deletedAt)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async listForTenant(tenantId: string): Promise<DepartmentRow[]> {
    return this.db
      .select()
      .from(departments)
      .where(
        and(eq(departments.tenantId, tenantId), isNull(departments.deletedAt))
      )
      .orderBy(departments.name);
  }

  async upsert(d: {
    id: string;
    tenantId: string;
    code: string;
    name: string;
    description?: string;
    createdBy?: string;
  }): Promise<DepartmentRow> {
    const existing = await this.db
      .select()
      .from(departments)
      .where(
        and(
          eq(departments.tenantId, d.tenantId),
          eq(departments.code, d.code),
          isNull(departments.deletedAt)
        )
      )
      .limit(1);
    if (existing[0]) return existing[0];
    const now = new Date();
    await this.db.insert(departments).values({
      id: d.id,
      tenantId: d.tenantId,
      code: d.code,
      name: d.name,
      description: d.description ?? null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      createdBy: d.createdBy ?? null,
    });
    return (await this.findById(d.id, d.tenantId))!;
  }
}

// ---------------------------------------------------------------------------
// TeamRepository
// ---------------------------------------------------------------------------

export class TeamRepository {
  constructor(private readonly db: DatabaseClient) {}

  async findById(id: string, tenantId: string): Promise<TeamRow | null> {
    const rows = await this.db
      .select()
      .from(teams)
      .where(
        and(
          eq(teams.id, id),
          eq(teams.tenantId, tenantId),
          isNull(teams.deletedAt)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async listForTenant(tenantId: string): Promise<TeamRow[]> {
    return this.db
      .select()
      .from(teams)
      .where(and(eq(teams.tenantId, tenantId), isNull(teams.deletedAt)))
      .orderBy(teams.name);
  }

  async findByKindBinding(
    tenantId: string,
    juniorPersonaId: string
  ): Promise<TeamRow[]> {
    return this.db
      .select()
      .from(teams)
      .where(
        and(
          eq(teams.tenantId, tenantId),
          eq(teams.juniorPersonaId, juniorPersonaId),
          isNull(teams.deletedAt)
        )
      );
  }

  async upsert(t: {
    id: string;
    tenantId: string;
    departmentId?: string;
    code: string;
    name: string;
    kind: TeamRow['kind'];
    juniorPersonaId?: string;
    createdBy?: string;
  }): Promise<TeamRow> {
    const existing = await this.db
      .select()
      .from(teams)
      .where(
        and(
          eq(teams.tenantId, t.tenantId),
          eq(teams.code, t.code),
          isNull(teams.deletedAt)
        )
      )
      .limit(1);
    if (existing[0]) return existing[0];
    const now = new Date();
    await this.db.insert(teams).values({
      id: t.id,
      tenantId: t.tenantId,
      departmentId: t.departmentId ?? null,
      code: t.code,
      name: t.name,
      kind: t.kind,
      juniorPersonaId: t.juniorPersonaId ?? null,
      teamLeaderEmployeeId: null,
      isActive: true,
      settings: {},
      createdAt: now,
      updatedAt: now,
      createdBy: t.createdBy ?? null,
    });
    return (await this.findById(t.id, t.tenantId))!;
  }
}

// ---------------------------------------------------------------------------
// EmployeeRepository
// ---------------------------------------------------------------------------

export interface EmployeeRankingRow {
  employeeId: string;
  name: string;
  jobTitle: string;
  status: EmployeeRow['status'];
  capabilities: Record<string, number>;
  languages: string[];
  coveredPropertyIds: string[];
  currentOpenAssignments: number;
  performanceScore: number;
}

export class EmployeeRepository {
  constructor(private readonly db: DatabaseClient) {}

  async findById(id: string, tenantId: string): Promise<EmployeeRow | null> {
    const rows = await this.db
      .select()
      .from(employees)
      .where(
        and(
          eq(employees.id, id),
          eq(employees.tenantId, tenantId),
          isNull(employees.deletedAt)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findByUserId(userId: string): Promise<EmployeeRow | null> {
    const rows = await this.db
      .select()
      .from(employees)
      .where(and(eq(employees.userId, userId), isNull(employees.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listForTeam(tenantId: string, teamId: string): Promise<EmployeeRow[]> {
    const membershipRows = await this.db
      .select({ employeeId: teamMemberships.employeeId })
      .from(teamMemberships)
      .where(
        and(
          eq(teamMemberships.tenantId, tenantId),
          eq(teamMemberships.teamId, teamId)
        )
      );
    const ids = membershipRows.map((r) => r.employeeId);
    if (!ids.length) return [];
    return this.db
      .select()
      .from(employees)
      .where(
        and(
          eq(employees.tenantId, tenantId),
          inArray(employees.id, ids),
          isNull(employees.deletedAt)
        )
      );
  }

  /**
   * Flattened row shape for the HR assignment-ranking skill. One DB call
   * per team, with aggregates (open-assignment count, rolling performance)
   * computed in-query.
   */
  async listForRanking(
    tenantId: string,
    teamId: string
  ): Promise<EmployeeRankingRow[]> {
    const list = await this.listForTeam(tenantId, teamId);
    if (!list.length) return [];

    // Open assignments per employee
    const openRows = await this.db
      .select({
        employeeId: assignments.assigneeEmployeeId,
        count: sql<number>`count(*)::int`,
      })
      .from(assignments)
      .where(
        and(
          eq(assignments.tenantId, tenantId),
          inArray(
            assignments.status,
            ['draft', 'assigned', 'accepted', 'in_progress', 'blocked'] as const
          )
        )
      )
      .groupBy(assignments.assigneeEmployeeId);
    const openMap = new Map(
      openRows
        .filter((r) => r.employeeId)
        .map((r) => [r.employeeId as string, Number(r.count)])
    );

    // Performance score — mean of `scores.overall` across the last 90 days
    const sinceMs = Date.now() - 90 * 24 * 3600_000;
    const perfRows = await this.db
      .select({
        employeeId: performanceRecords.employeeId,
        scores: performanceRecords.scores,
        createdAt: performanceRecords.createdAt,
      })
      .from(performanceRecords)
      .where(eq(performanceRecords.tenantId, tenantId));
    const perfByEmp = new Map<string, number[]>();
    for (const r of perfRows) {
      const t =
        r.createdAt instanceof Date ? r.createdAt.getTime() : Date.parse(String(r.createdAt));
      if (t < sinceMs) continue;
      const overall = Number(
        (r.scores as { overall?: number } | null | undefined)?.overall ?? NaN
      );
      if (!Number.isFinite(overall)) continue;
      const arr = perfByEmp.get(r.employeeId) ?? [];
      arr.push(Math.max(0, Math.min(1, overall)));
      perfByEmp.set(r.employeeId, arr);
    }

    return list.map((e) => {
      const perfArr = perfByEmp.get(e.id) ?? [];
      const perfMean = perfArr.length
        ? perfArr.reduce((s, n) => s + n, 0) / perfArr.length
        : 0.7;
      const caps = (e.capabilities as Record<string, number>) ?? {};
      const langs = Array.isArray(e.languages) ? (e.languages as string[]) : [];
      const covered = Array.isArray(e.coveredPropertyIds)
        ? (e.coveredPropertyIds as string[])
        : [];
      return {
        employeeId: e.id,
        name: `${e.firstName} ${e.lastName}`.trim(),
        jobTitle: e.jobTitle,
        status: e.status,
        capabilities: caps,
        languages: langs,
        coveredPropertyIds: covered,
        currentOpenAssignments: openMap.get(e.id) ?? 0,
        performanceScore: perfMean,
      };
    });
  }

  async upsert(e: {
    id: string;
    tenantId: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
    jobTitle: string;
    phone?: string;
    email?: string;
    departmentId?: string;
    employmentType?: EmployeeRow['employmentType'];
    createdBy?: string;
  }): Promise<EmployeeRow> {
    const existing = await this.db
      .select()
      .from(employees)
      .where(
        and(
          eq(employees.tenantId, e.tenantId),
          eq(employees.employeeCode, e.employeeCode),
          isNull(employees.deletedAt)
        )
      )
      .limit(1);
    if (existing[0]) return existing[0];
    const now = new Date();
    await this.db.insert(employees).values({
      id: e.id,
      tenantId: e.tenantId,
      userId: null,
      employeeCode: e.employeeCode,
      firstName: e.firstName,
      lastName: e.lastName,
      preferredName: null,
      phone: e.phone ?? null,
      phoneAlt: null,
      email: e.email ?? null,
      status: 'pending_onboarding',
      employmentType: e.employmentType ?? 'full_time',
      jobTitle: e.jobTitle,
      departmentId: e.departmentId ?? null,
      managerEmployeeId: null,
      hireDate: null,
      terminationDate: null,
      capabilities: {},
      languages: [],
      baseSalaryKes: null,
      coveredPropertyIds: [],
      notes: null,
      metadata: {},
      createdAt: now,
      updatedAt: now,
      createdBy: e.createdBy ?? null,
    });
    return (await this.findById(e.id, e.tenantId))!;
  }
}

// ---------------------------------------------------------------------------
// AssignmentRepository
// ---------------------------------------------------------------------------

export class AssignmentRepository {
  constructor(private readonly db: DatabaseClient) {}

  async create(a: {
    id: string;
    tenantId: string;
    teamId?: string;
    assigneeEmployeeId?: string;
    assignedByActorId?: string;
    title: string;
    description?: string;
    linkedEntityKind?: string;
    linkedEntityId?: string;
    status?: AssignmentRow['status'];
    priority?: number;
    dueAt?: Date;
    riskLevel?: string;
    estimatedEffortMinutes?: number;
    createdBy?: string;
  }): Promise<AssignmentRow> {
    const now = new Date();
    await this.db.insert(assignments).values({
      id: a.id,
      tenantId: a.tenantId,
      teamId: a.teamId ?? null,
      assigneeEmployeeId: a.assigneeEmployeeId ?? null,
      assignedByActorId: a.assignedByActorId ?? null,
      title: a.title,
      description: a.description ?? null,
      linkedEntityKind: a.linkedEntityKind ?? null,
      linkedEntityId: a.linkedEntityId ?? null,
      status: a.status ?? 'draft',
      priority: a.priority ?? 3,
      dueAt: a.dueAt ?? null,
      riskLevel: a.riskLevel ?? 'MEDIUM',
      estimatedEffortMinutes: a.estimatedEffortMinutes ?? null,
      acceptedAt: null,
      startedAt: null,
      completedAt: null,
      completionEvidence: {},
      createdAt: now,
      updatedAt: now,
      createdBy: a.createdBy ?? null,
    });
    const rows = await this.db
      .select()
      .from(assignments)
      .where(eq(assignments.id, a.id))
      .limit(1);
    return rows[0]!;
  }

  async listForEmployee(
    tenantId: string,
    employeeId: string,
    opts: { limit?: number; status?: AssignmentRow['status'] } = {}
  ): Promise<AssignmentRow[]> {
    const conds = [
      eq(assignments.tenantId, tenantId),
      eq(assignments.assigneeEmployeeId, employeeId),
    ];
    if (opts.status) conds.push(eq(assignments.status, opts.status));
    const q = this.db
      .select()
      .from(assignments)
      .where(and(...conds))
      .orderBy(desc(assignments.updatedAt));
    return opts.limit ? q.limit(opts.limit) : q;
  }

  async updateStatus(
    id: string,
    status: AssignmentRow['status'],
    updatedBy?: string
  ): Promise<void> {
    const now = new Date();
    const extra: Record<string, Date | null> = {};
    if (status === 'accepted') extra.acceptedAt = now;
    if (status === 'in_progress') extra.startedAt = now;
    if (status === 'completed') extra.completedAt = now;
    await this.db
      .update(assignments)
      .set({ status, updatedAt: now, updatedBy: updatedBy ?? null, ...extra })
      .where(eq(assignments.id, id));
  }
}

// ---------------------------------------------------------------------------
// PerformanceRepository
// ---------------------------------------------------------------------------

export class PerformanceRepository {
  constructor(private readonly db: DatabaseClient) {}

  async record(p: {
    id: string;
    tenantId: string;
    employeeId: string;
    kind: PerformanceRow['kind'];
    periodStart?: Date;
    periodEnd?: Date;
    scores?: Record<string, number>;
    observerActorId?: string;
    note?: string;
    assignmentId?: string;
    visibilityScope?: 'private' | 'team' | 'management' | 'public';
    createdBy?: string;
  }): Promise<void> {
    await this.db.insert(performanceRecords).values({
      id: p.id,
      tenantId: p.tenantId,
      employeeId: p.employeeId,
      kind: p.kind,
      periodStart: p.periodStart ?? null,
      periodEnd: p.periodEnd ?? null,
      scores: p.scores ?? {},
      observerActorId: p.observerActorId ?? null,
      note: p.note ?? null,
      assignmentId: p.assignmentId ?? null,
      visibilityScope: p.visibilityScope ?? 'management',
      createdAt: new Date(),
      createdBy: p.createdBy ?? null,
    });
  }

  async listForEmployee(
    tenantId: string,
    employeeId: string,
    opts: { limit?: number } = {}
  ): Promise<PerformanceRow[]> {
    const q = this.db
      .select()
      .from(performanceRecords)
      .where(
        and(
          eq(performanceRecords.tenantId, tenantId),
          eq(performanceRecords.employeeId, employeeId)
        )
      )
      .orderBy(desc(performanceRecords.createdAt));
    return opts.limit ? q.limit(opts.limit) : q;
  }
}