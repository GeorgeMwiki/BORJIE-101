/**
 * /api/v1/org-admin — org / team-management write surface (migration 0280).
 *
 * The mining operator (owner / admin) tells Mr. Mwikila "add Asha as the new
 * pit foreman", "Asha's quarterly KPI is 5000 tonnes hauled", "schedule the
 * pit-wall inspection for the north bench by Friday", "escalate the haul-road
 * collapse as a safety incident", or pastes a staff roster CSV. Each becomes a
 * real row through this surface.
 *
 * Routes (all tenant-scoped via JWT + RLS; owner/admin role only):
 *   POST  /staff                 create a staff member
 *   POST  /staff/kpis            assign a KPI to a staff member
 *   POST  /tasks                 schedule an org task
 *   POST  /escalations           raise an escalation
 *   POST  /staff/bulk-csv        bulk-ingest a staff roster CSV
 *
 * The chat-as-OS brain reads / writes via the `staff.*` brain tools
 * (org-admin-tools.ts), which loopback-dispatch to these routes so the SAME
 * auth + RLS + observability guards apply as a browser request.
 *
 * Honest-degrade (CLAUDE.md hard rule): when the database client is not
 * configured the route returns 503 DATABASE_UNAVAILABLE rather than
 * fabricating a row.
 *
 * Multi-currency (CLAUDE.md hard rule): a money-denominated KPI uses
 * `metricUnit:'currency'`; no jurisdiction currency is hard-coded here.
 *
 * Provenance: every WRITE resolves provenance via
 * `resolveProvenance(c, body, { trustedSource: true })` so a chat-originated
 * call (loopback service token) keeps its `via: 'chat'` + session/turn ids and
 * a browser POST stamps `via: 'form'`. The "via Mr. Mwikila" pill reads this
 * envelope.
 *
 * Ported from the BN org/team-management routes (itself a LitFin iter-27..31
 * port) and retargeted real-estate → mining.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { withSecurityEvents } from '@borjie/observability';

import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';
import { routeCatch } from '../utils/safe-error';
import { resolveProvenance, type Provenance } from '../services/provenance';
import {
  OrgTeamRepository,
  type RepoFailure,
} from '../composition/org-team-repository';
import { parseStaffCsv } from '../composition/org-team-csv';

// ── role gate ────────────────────────────────────────────────────────────
// Tier-gate (task spec): owner / admin only. Mirrors the persona allowlist on
// the staff.* brain tools (T1_owner_strategist / T2_admin_strategist) — this
// is defense in depth at the route.
const WRITE_ROLES = new Set(['OWNER', 'TENANT_ADMIN', 'ADMIN', 'SUPER_ADMIN']);

// ── shared zod fragments ─────────────────────────────────────────────────

const ProvenanceSchema = z
  .object({
    via: z.string(),
    actorId: z.string().nullable().optional(),
    sessionId: z.string().nullable().optional(),
    turnId: z.string().nullable().optional(),
    requestedAt: z.string().optional(),
  })
  .optional();

const CreateStaffSchema = z.object({
  fullName: z.string().min(1).max(200),
  role: z.string().min(1).max(120),
  hireDate: z.string().optional(),
  managerId: z.string().uuid().optional(),
  contact: z
    .object({
      whatsapp: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
    })
    .optional(),
  notes: z.string().max(2000).optional(),
  allowDuplicate: z.boolean().optional(),
  provenance: ProvenanceSchema,
});

const AssignKpiSchema = z.object({
  staffMemberId: z.string().uuid().optional(),
  staffMemberName: z.string().min(1).max(200).optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  metricUnit: z
    .enum(['count', 'currency', 'percent', 'days', 'hours', 'ratio'])
    .optional(),
  targetValue: z.number().finite().positive(),
  period: z.enum(['week', 'month', 'quarter', 'half', 'year']).optional(),
  periodEnd: z.string().optional(),
  provenance: ProvenanceSchema,
});

const ScheduleTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  assignedToStaffId: z.string().uuid().optional(),
  assignedToStaffName: z.string().min(1).max(200).optional(),
  dueAt: z.string().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  provenance: ProvenanceSchema,
});

const EscalateSchema = z.object({
  title: z.string().min(1).max(200),
  reason: z.string().min(1).max(4000),
  category: z
    .enum(['compliance_breach', 'safety_incident', 'payment_default', 'other'])
    .optional(),
  severity: z.enum(['low', 'normal', 'high', 'critical']).optional(),
  escalatedToStaffId: z.string().uuid().optional(),
  escalatedToStaffName: z.string().min(1).max(200).optional(),
  relatedTaskId: z.string().uuid().optional(),
  relatedSubject: z.string().max(200).optional(),
  provenance: ProvenanceSchema,
});

const BulkCsvSchema = z.object({
  csv: z.string().min(1),
  allowDuplicates: z.boolean().optional(),
  provenance: ProvenanceSchema,
});

type AuthShape = { readonly tenantId: string; readonly userId: string };

// ── helpers ──────────────────────────────────────────────────────────────

function notConfigured(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'OrgTeamRepository not configured — database client is unset',
      },
    },
    503,
  );
}

function forbidden(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'org-admin write requires the owner or admin role',
      },
    },
    403,
  );
}

function invalid(c: any, message: string) {
  return c.json(
    { success: false, error: { code: 'INVALID_INPUT', message } },
    422,
  );
}

/** Map a repository failure code to an HTTP status. */
function statusForFailure(failure: RepoFailure): number {
  switch (failure.code) {
    case 'NOT_FOUND':
      return 404;
    case 'DUPLICATE':
    case 'AMBIGUOUS':
      return 409;
    case 'INVALID_INPUT':
      return 422;
    default:
      return 500;
  }
}

function failure(c: any, f: RepoFailure) {
  return c.json(
    { success: false, error: { code: f.code, message: f.message } },
    statusForFailure(f),
  );
}

/** ISO 8601 date string → ISO; null when the field is blank/absent. */
function parseIsoOrNull(raw: string | undefined): string | null | 'INVALID' {
  if (!raw || raw.trim().length === 0) return null;
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) return 'INVALID';
  return new Date(ts).toISOString();
}

function sanitizeContact(
  contact: { whatsapp?: string; phone?: string; email?: string } | undefined,
): Record<string, unknown> {
  const PHONE_RE = /^\+?[0-9]{8,15}$/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const out: Record<string, unknown> = {};
  if (!contact) return out;
  const w = contact.whatsapp?.trim();
  if (w && PHONE_RE.test(w)) out.whatsapp = w;
  const p = contact.phone?.trim();
  if (p && PHONE_RE.test(p)) out.phone = p;
  const e = contact.email?.trim();
  if (e && EMAIL_RE.test(e)) out.email = e;
  return out;
}

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// Owner/admin role gate on every write in this router.
app.use('*', async (c, next) => {
  const auth = c.get('auth') as { role?: string } | undefined;
  if (!auth || !WRITE_ROLES.has(String(auth.role))) return forbidden(c);
  await next();
});

// ── POST /staff — create a staff member ──────────────────────────────────

app.post(
  '/staff',
  zValidator('json', CreateStaffSchema),
  withSecurityEvents(
    {
      action: 'org-admin.staff.create',
      resource: 'staff_member',
      severity: 'info',
    },
    async (c: any) => {
      const db = c.get('db');
      if (!db) return notConfigured(c);
      const auth = c.get('auth') as AuthShape;
      const body = c.req.valid('json');

      const hireDate = parseIsoOrNull(body.hireDate);
      if (hireDate === 'INVALID') {
        return invalid(c, `hireDate must be ISO 8601 (got "${body.hireDate}").`);
      }

      const metadata = sanitizeContact(body.contact);
      if (body.notes && body.notes.trim().length > 0) {
        metadata.notes = body.notes.trim().slice(0, 2_000);
      }

      try {
        const repo = new OrgTeamRepository(db);
        const prov = resolveProvenance(c, body, { trustedSource: true });
        const result = await repo.createStaffMember(
          auth.tenantId,
          {
            fullName: body.fullName.trim(),
            role: body.role.trim(),
            hireDateIso: hireDate ?? new Date().toISOString(),
            managerId: body.managerId ?? null,
            metadata,
            allowDuplicate: body.allowDuplicate === true,
          },
          auth.userId,
          prov,
        );
        if (!result.ok) return failure(c, result);
        return c.json({ success: true, data: result.staff }, 201);
      } catch (err) {
        return routeCatch(c, err, {
          code: 'STAFF_CREATE_FAILED',
          status: 500,
          fallback: 'Failed to create staff member',
        });
      }
    },
  ),
);

// ── POST /staff/kpis — assign a KPI ──────────────────────────────────────

app.post(
  '/staff/kpis',
  zValidator('json', AssignKpiSchema),
  withSecurityEvents(
    {
      action: 'org-admin.staff.assign_kpi',
      resource: 'staff_kpi',
      severity: 'info',
    },
    async (c: any) => {
      const db = c.get('db');
      if (!db) return notConfigured(c);
      const auth = c.get('auth') as AuthShape;
      const body = c.req.valid('json');

      const periodEnd = parseIsoOrNull(body.periodEnd);
      if (periodEnd === 'INVALID') {
        return invalid(
          c,
          `periodEnd must be ISO 8601 (got "${body.periodEnd}").`,
        );
      }

      try {
        const repo = new OrgTeamRepository(db);
        const resolved = await repo.resolveStaff(
          auth.tenantId,
          { id: body.staffMemberId ?? null, name: body.staffMemberName ?? null },
          'staff member',
        );
        if (!resolved.ok) return failure(c, resolved);

        const prov = resolveProvenance(c, body, { trustedSource: true });
        const result = await repo.assignKpi(
          auth.tenantId,
          resolved.staff.id,
          {
            name: body.name.trim(),
            description: body.description?.trim().slice(0, 4_000) ?? null,
            metricUnit: body.metricUnit ?? 'count',
            targetValue: body.targetValue,
            period: body.period ?? 'quarter',
            periodEndIso: periodEnd,
          },
          auth.userId,
          sessionIdOf(prov),
          prov,
        );
        if (!result.ok) return failure(c, result);
        return c.json(
          {
            success: true,
            data: { ...result.kpi, staffMemberName: resolved.staff.full_name },
          },
          201,
        );
      } catch (err) {
        return routeCatch(c, err, {
          code: 'STAFF_KPI_ASSIGN_FAILED',
          status: 500,
          fallback: 'Failed to assign KPI',
        });
      }
    },
  ),
);

// ── POST /tasks — schedule an org task ───────────────────────────────────

app.post(
  '/tasks',
  zValidator('json', ScheduleTaskSchema),
  withSecurityEvents(
    { action: 'org-admin.task.schedule', resource: 'org_task', severity: 'info' },
    async (c: any) => {
      const db = c.get('db');
      if (!db) return notConfigured(c);
      const auth = c.get('auth') as AuthShape;
      const body = c.req.valid('json');

      const dueAt = parseIsoOrNull(body.dueAt);
      if (dueAt === 'INVALID') {
        return invalid(c, `dueAt must be ISO 8601 (got "${body.dueAt}").`);
      }
      if (dueAt !== null && Date.parse(dueAt) < Date.now() - 5 * 60_000) {
        return invalid(
          c,
          `dueAt is in the past (${body.dueAt}). Confirm the date.`,
        );
      }

      try {
        const repo = new OrgTeamRepository(db);
        let assignedTo: string | null = null;
        if (body.assignedToStaffId || body.assignedToStaffName) {
          const resolved = await repo.resolveStaff(
            auth.tenantId,
            {
              id: body.assignedToStaffId ?? null,
              name: body.assignedToStaffName ?? null,
            },
            'assignee',
          );
          if (!resolved.ok) return failure(c, resolved);
          assignedTo = resolved.staff.id;
        }

        const prov = resolveProvenance(c, body, { trustedSource: true });
        const result = await repo.scheduleTask(
          auth.tenantId,
          {
            title: body.title.trim(),
            description: body.description?.trim().slice(0, 4_000) ?? null,
            assignedTo,
            priority: body.priority ?? 'normal',
            dueAtIso: dueAt,
          },
          auth.userId,
          sessionIdOf(prov),
          prov,
        );
        if (!result.ok) return failure(c, result);
        return c.json({ success: true, data: result.task }, 201);
      } catch (err) {
        return routeCatch(c, err, {
          code: 'ORG_TASK_SCHEDULE_FAILED',
          status: 500,
          fallback: 'Failed to schedule task',
        });
      }
    },
  ),
);

// ── POST /escalations — raise an escalation ──────────────────────────────

app.post(
  '/escalations',
  zValidator('json', EscalateSchema),
  withSecurityEvents(
    {
      action: 'org-admin.escalation.raise',
      resource: 'org_escalation',
      severity: 'warning',
    },
    async (c: any) => {
      const db = c.get('db');
      if (!db) return notConfigured(c);
      const auth = c.get('auth') as AuthShape;
      const body = c.req.valid('json');

      try {
        const repo = new OrgTeamRepository(db);

        // Verify related task FK (optional).
        let relatedTaskId: string | null = null;
        if (body.relatedTaskId) {
          const task = await repo.findTaskById(auth.tenantId, body.relatedTaskId);
          if (!task) {
            return c.json(
              {
                success: false,
                error: {
                  code: 'NOT_FOUND',
                  message: `NOT_FOUND: task ${body.relatedTaskId} not in this tenant.`,
                },
              },
              404,
            );
          }
          relatedTaskId = task.id;
        }

        // Resolve escalation target (optional).
        let escalatedToStaffId: string | null = null;
        if (body.escalatedToStaffId || body.escalatedToStaffName) {
          const resolved = await repo.resolveStaff(
            auth.tenantId,
            {
              id: body.escalatedToStaffId ?? null,
              name: body.escalatedToStaffName ?? null,
            },
            'escalation target',
          );
          if (!resolved.ok) return failure(c, resolved);
          escalatedToStaffId = resolved.staff.id;
        }

        const prov = resolveProvenance(c, body, { trustedSource: true });
        const result = await repo.raiseEscalation(
          auth.tenantId,
          {
            title: body.title.trim(),
            reason: body.reason.trim().slice(0, 4_000),
            category: body.category ?? 'other',
            severity: body.severity ?? 'normal',
            escalatedToStaffId,
            relatedTaskId,
            relatedSubject: body.relatedSubject?.trim().slice(0, 200) ?? null,
          },
          auth.userId,
          sessionIdOf(prov),
          prov,
        );
        if (!result.ok) return failure(c, result);
        return c.json({ success: true, data: result.escalation }, 201);
      } catch (err) {
        return routeCatch(c, err, {
          code: 'ORG_ESCALATION_RAISE_FAILED',
          status: 500,
          fallback: 'Failed to raise escalation',
        });
      }
    },
  ),
);

// ── POST /staff/bulk-csv — bulk-ingest a staff roster ────────────────────

app.post(
  '/staff/bulk-csv',
  zValidator('json', BulkCsvSchema),
  withSecurityEvents(
    {
      action: 'org-admin.staff.bulk_ingest',
      resource: 'staff_member',
      severity: 'info',
    },
    async (c: any) => {
      const db = c.get('db');
      if (!db) return notConfigured(c);
      const auth = c.get('auth') as AuthShape;
      const body = c.req.valid('json');

      const parsed = parseStaffCsv(body.csv);
      if (!parsed.ok) {
        return c.json(
          {
            success: false,
            error: { code: parsed.code, message: parsed.message },
            ...(parsed.outcomes
              ? {
                  data: {
                    totalRows: parsed.totalDataRows,
                    outcomes: parsed.outcomes,
                  },
                }
              : {}),
          },
          422,
        );
      }

      try {
        const repo = new OrgTeamRepository(db);
        const prov = resolveProvenance(c, body, { trustedSource: true });
        const insertOutcomes = await repo.bulkIngestStaff(
          auth.tenantId,
          parsed.parsedRows,
          body.allowDuplicates === true,
          auth.userId,
          prov,
        );
        const outcomes = [...parsed.preInsertOutcomes, ...insertOutcomes];
        const inserted = outcomes.filter((o) => o.status === 'inserted').length;
        const skipped = outcomes.filter(
          (o) => o.status === 'skipped_duplicate',
        ).length;
        const rejected = outcomes.filter((o) => o.status === 'rejected').length;

        return c.json(
          {
            success: inserted > 0,
            data: {
              totalRows: parsed.totalDataRows,
              inserted,
              skippedDuplicates: skipped,
              rejected,
              outcomes,
            },
          },
          inserted > 0 ? 201 : 422,
        );
      } catch (err) {
        return routeCatch(c, err, {
          code: 'STAFF_BULK_INGEST_FAILED',
          status: 500,
          fallback: 'Failed to bulk-ingest staff roster',
        });
      }
    },
  ),
);

/** Pull the session id out of a resolved provenance envelope (may be absent). */
function sessionIdOf(prov: Provenance): string | null {
  return prov.sessionId ?? null;
}

export const orgAdminRouter = app;
export default orgAdminRouter;
