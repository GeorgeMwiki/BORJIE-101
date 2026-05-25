
/**
 * /api/v1/hr — departments, teams, employees, team memberships,
 * assignments, performance records.
 *
 * Auth: authMiddleware + databaseMiddleware (RLS tenant context).
 * Roles: admin or manager may write; any authenticated user may read.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { v4 as uuid } from 'uuid';
import { and, desc, eq } from 'drizzle-orm';
import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';
import {
  departments,
  teams,
  employees,
  teamMemberships,
  assignments,
  performanceRecords,
  DepartmentRepository,
  TeamRepository,
  EmployeeRepository,
  AssignmentRepository,
  PerformanceRepository,
} from '@borjie/database';

import { withSecurityEvents } from '@borjie/observability';
const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

function auth(c) {
  return c.get('auth') as { userId: string; tenantId: string; role: string };
}
function requireManage(c) {
  const a = auth(c);
  if (!['admin', 'manager', 'team_leader'].includes(a.role)) {
    return c.json({ error: 'manager_or_admin_required' }, 403);
  }
  return null;
}
function db(c) {
  return c.get('db');
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

app.get('/departments', async (c) => {
  const { tenantId } = auth(c);
  const repo = new DepartmentRepository(db(c));
  const rows = await repo.listForTenant(tenantId);
  return c.json({ success: true, data: rows });
});

app.post(
  '/departments',
  zValidator(
    'json',
    z.object({ code: z.string().min(1), name: z.string().min(1), description: z.string().optional() })
  ),
  withSecurityEvents({ action: 'hr.create', resource: 'hr', severity: 'info' }, async (c) => {
    const deny = requireManage(c);
    if (deny) return deny;
    const { userId, tenantId } = auth(c);
    const input = c.req.valid('json');
    const repo = new DepartmentRepository(db(c));
    const row = await repo.upsert({
      id: uuid(),
      tenantId,
      code: input.code,
      name: input.name,
      description: input.description,
      createdBy: userId,
    });
    return c.json({ success: true, data: row }, 201);
  })
);

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

app.get('/teams', async (c) => {
  const { tenantId } = auth(c);
  const repo = new TeamRepository(db(c));
  const rows = await repo.listForTenant(tenantId);
  return c.json({ success: true, data: rows });
});

app.post(
  '/teams',
  zValidator(
    'json',
    z.object({
      code: z.string().min(1),
      name: z.string().min(1),
      departmentId: z.string().optional(),
      kind: z
        .enum([
          'leasing',
          'maintenance',
          'finance',
          'compliance',
          'communications',
          'operations',
          'security',
          'caretaking',
          'custom',
        ])
        .default('custom'),
      juniorPersonaId: z.string().optional(),
    })
  ),
  withSecurityEvents({ action: 'hr.create', resource: 'hr', severity: 'info' }, async (c) => {
    const deny = requireManage(c);
    if (deny) return deny;
    const { userId, tenantId } = auth(c);
    const input = c.req.valid('json');
    const repo = new TeamRepository(db(c));
    const row = await repo.upsert({
      id: uuid(),
      tenantId,
      departmentId: input.departmentId,
      code: input.code,
      name: input.name,
      kind: input.kind,
      juniorPersonaId: input.juniorPersonaId,
      createdBy: userId,
    });
    return c.json({ success: true, data: row }, 201);
  })
);

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

app.get('/employees', async (c) => {
  const { tenantId } = auth(c);
  const teamId = c.req.query('teamId');
  const repo = new EmployeeRepository(db(c));
  if (teamId) return c.json({ success: true, data: await repo.listForTeam(tenantId, teamId) });
  const rows = await db(c)
    .select()
    .from(employees)
    .where(eq(employees.tenantId, tenantId))
    .orderBy(desc(employees.createdAt));
  return c.json({ success: true, data: rows });
});

app.get('/employees/:id', async (c) => {
  const { tenantId } = auth(c);
  const repo = new EmployeeRepository(db(c));
  const row = await repo.findById(c.req.param('id'), tenantId);
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ success: true, data: row });
});

app.post(
  '/employees',
  zValidator(
    'json',
    z.object({
      employeeCode: z.string().min(1),
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      jobTitle: z.string().default(''),
      phone: z.string().optional(),
      email: z.string().email().optional(),
      departmentId: z.string().optional(),
      employmentType: z
        .enum(['full_time', 'part_time', 'contract', 'casual', 'intern', 'vendor'])
        .default('full_time'),
    })
  ),
  withSecurityEvents({ action: 'hr.create', resource: 'hr', severity: 'info' }, async (c) => {
    const deny = requireManage(c);
    if (deny) return deny;
    const { userId, tenantId } = auth(c);
    const input = c.req.valid('json');
    const repo = new EmployeeRepository(db(c));
    const row = await repo.upsert({
      id: uuid(),
      tenantId,
      employeeCode: input.employeeCode,
      firstName: input.firstName,
      lastName: input.lastName,
      jobTitle: input.jobTitle,
      phone: input.phone,
      email: input.email,
      departmentId: input.departmentId,
      employmentType: input.employmentType,
      createdBy: userId,
    });
    return c.json({ success: true, data: row }, 201);
  })
);

// Team membership
app.post(
  '/team-memberships',
  zValidator(
    'json',
    z.object({
      teamId: z.string().min(1),
      employeeId: z.string().min(1),
      isTemporary: z.boolean().optional(),
      endsAt: z.string().optional(),
      roleLabel: z.string().optional(),
    })
  ),
  withSecurityEvents({ action: 'hr.create', resource: 'hr', severity: 'info' }, async (c) => {
    const deny = requireManage(c);
    if (deny) return deny;
    const { userId, tenantId } = auth(c);
    const input = c.req.valid('json');
    const [row] = await db(c)
      .insert(teamMemberships)
      .values({
        id: uuid(),
        tenantId,
        teamId: input.teamId,
        employeeId: input.employeeId,
        isTemporary: input.isTemporary ?? false,
        startsAt: new Date(),
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        roleLabel: input.roleLabel ?? 'member',
        createdAt: new Date(),
        createdBy: userId,
      })
      .returning();
    return c.json({ success: true, data: row }, 201);
  })
);

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

const CreateAssignmentSchema = z.object({
  teamId: z.string().optional(),
  assigneeEmployeeId: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  linkedEntityKind: z.string().optional(),
  linkedEntityId: z.string().optional(),
  priority: z.number().int().min(1).max(5).default(3),
  dueAt: z.string().optional(),
  riskLevel: z.string().optional(),
  estimatedEffortMinutes: z.number().int().nonnegative().optional(),
});

app.get('/assignments', async (c) => {
  const { tenantId } = auth(c);
  const employeeId = c.req.query('employeeId');
  const repo = new AssignmentRepository(db(c));
  if (employeeId) {
    const status = c.req.query('status') as
      | 'draft'
      | 'assigned'
      | 'accepted'
      | 'in_progress'
      | 'blocked'
      | 'completed'
      | 'cancelled'
      | undefined;
    const rows = await repo.listForEmployee(tenantId, employeeId, { status });
    return c.json({ success: true, data: rows });
  }
  const rows = await db(c)
    .select()
    .from(assignments)
    .where(eq(assignments.tenantId, tenantId))
    .orderBy(desc(assignments.updatedAt))
    .limit(200);
  return c.json({ success: true, data: rows });
});

app.post('/assignments', zValidator('json', CreateAssignmentSchema), withSecurityEvents({ action: 'hr.create', resource: 'hr', severity: 'info' }, async (c) => {
  const deny = requireManage(c);
  if (deny) return deny;
  const { userId, tenantId } = auth(c);
  const input = c.req.valid('json');
  const repo = new AssignmentRepository(db(c));
  const row = await repo.create({
    id: uuid(),
    tenantId,
    teamId: input.teamId,
    assigneeEmployeeId: input.assigneeEmployeeId,
    assignedByActorId: userId,
    title: input.title,
    description: input.description,
    linkedEntityKind: input.linkedEntityKind,
    linkedEntityId: input.linkedEntityId,
    status: 'draft',
    priority: input.priority,
    dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
    riskLevel: input.riskLevel,
    estimatedEffortMinutes: input.estimatedEffortMinutes,
    createdBy: userId,
  });
  return c.json({ success: true, data: row }, 201);
}));

app.post(
  '/assignments/:id/status',
  zValidator(
    'json',
    z.object({
      status: z.enum([
        'draft',
        'assigned',
        'accepted',
        'in_progress',
        'blocked',
        'completed',
        'cancelled',
      ]),
    })
  ),
  withSecurityEvents({ action: 'hr.create', resource: 'hr', severity: 'info' }, async (c) => {
    const { userId } = auth(c);
    const id = c.req.param('id');
    const input = c.req.valid('json');
    const repo = new AssignmentRepository(db(c));
    await repo.updateStatus(id, input.status, userId);
    // Maintain the standard envelope so clients can unpack response.data
    // uniformly across all endpoints.
    return c.json({ success: true, data: { id, status: input.status } });
  })
);

// ---------------------------------------------------------------------------
// Performance records (append-only)
// ---------------------------------------------------------------------------

app.get('/performance/:employeeId', async (c) => {
  const { tenantId } = auth(c);
  const employeeId = c.req.param('employeeId');
  const repo = new PerformanceRepository(db(c));
  const rows = await repo.listForEmployee(tenantId, employeeId, { limit: 100 });
  return c.json({ success: true, data: rows });
});

app.post(
  '/performance',
  zValidator(
    'json',
    z.object({
      employeeId: z.string().min(1),
      kind: z.enum([
        'observation',
        'weekly_summary',
        'monthly_review',
        'quarterly_review',
        'peer_feedback',
        'tenant_feedback',
        'sla_miss',
        'sla_hit',
        'recognition',
      ]),
      periodStart: z.string().optional(),
      periodEnd: z.string().optional(),
      scores: z.record(z.string(), z.number()).optional(),
      note: z.string().optional(),
      assignmentId: z.string().optional(),
      visibilityScope: z
        .enum(['private', 'team', 'management', 'public'])
        .optional(),
    })
  ),
  withSecurityEvents({ action: 'hr.create', resource: 'hr', severity: 'info' }, async (c) => {
    const { userId, tenantId } = auth(c);
    const input = c.req.valid('json');
    const repo = new PerformanceRepository(db(c));
    await repo.record({
      id: uuid(),
      tenantId,
      employeeId: input.employeeId,
      kind: input.kind,
      periodStart: input.periodStart ? new Date(input.periodStart) : undefined,
      periodEnd: input.periodEnd ? new Date(input.periodEnd) : undefined,
      scores: input.scores,
      observerActorId: userId,
      note: input.note,
      assignmentId: input.assignmentId,
      visibilityScope: input.visibilityScope ?? 'management',
      createdBy: userId,
    });
    return c.json({ success: true }, 201);
  })
);

export const hrRouter = app;
