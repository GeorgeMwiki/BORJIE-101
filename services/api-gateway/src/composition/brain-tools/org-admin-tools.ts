/**
 * Org / team-management brain tools — chat-as-OS parity for migration 0280.
 *
 * Five WRITE tools backing `/api/v1/org-admin/*`:
 *
 *   - staff.create             create a staff member (site_supervisor /
 *                              pit_foreman / safety_officer / geologist /
 *                              accountant)
 *   - staff.assign_kpi         assign a KPI to a staff member
 *   - staff.schedule_task      schedule an org task (e.g. "weekly pit-wall
 *                              inspection scheduling")
 *   - staff.escalate_to_human  raise an escalation (compliance breach /
 *                              safety incident / payment default)
 *   - staff.bulk_ingest_csv    bulk-ingest a staff roster CSV
 *
 * Persona scope: T1 owner_strategist + T2 admin_strategist (the mining
 * operator runs the team from the owner / admin cockpit). The route layer
 * re-checks the role for defense in depth.
 *
 * Stakes: staff.create / assign_kpi / schedule_task are MEDIUM-stakes WRITEs
 * (additive org rows, easily reversed). staff.escalate_to_human and
 * staff.bulk_ingest_csv are HIGH-stakes — an escalation pages a human and a
 * bulk import can land hundreds of rows, so both warrant the higher
 * action-tier ceiling. None carries a HIGH-risk policy prefix
 * (sovereign / kill_switch / four_eye / policy_rollout), so
 * `requiresPolicyRuleLiteral` is false on all five.
 *
 * Honest-degrade (CLAUDE.md hard rule): when no loopback http client is bound
 * every handler returns a typed `unavailable` shape — never a fabricated row.
 * The route itself is the source of truth.
 *
 * Multi-currency (CLAUDE.md hard rule): a money-denominated KPI uses
 * `metricUnit:'currency'`; no jurisdiction currency is hard-coded.
 *
 * Ported from the BN org/team-management chat tools (itself a LitFin
 * iter-27..31 port) and retargeted real-estate → mining (caretaker /
 * leasing_assistant → site_supervisor / pit_foreman / safety_officer ·
 * maintenance escalations → safety-incident escalations).
 *
 * Companion files:
 *   - services/api-gateway/src/routes/org-admin.hono.ts
 *   - services/api-gateway/src/composition/org-team-repository.ts
 *   - services/api-gateway/src/composition/org-team-csv.ts
 *   - packages/database/src/migrations/0280_org_team_management.sql
 */

import { z } from 'zod';

import type { PersonaToolDescriptor } from './types';
import { withChatProvenance } from './provenance-injector';

const OWNER_ADMIN: ReadonlyArray<'T1_owner_strategist' | 'T2_admin_strategist'> =
  ['T1_owner_strategist', 'T2_admin_strategist'];

// ---------------------------------------------------------------------------
// 1. staff.create (WRITE)
// ---------------------------------------------------------------------------

const CreateInput = z.object({
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
});

const CreateOutput = z.object({
  id: z.string(),
  fullName: z.string(),
  role: z.string(),
  status: z.string(),
  hireDate: z.string().nullable(),
  managerId: z.string().nullable(),
});

export const staffCreateTool: PersonaToolDescriptor<
  typeof CreateInput,
  typeof CreateOutput
> = {
  id: 'staff.create',
  name: 'Staff — add a team member (en) / Wafanyakazi — ongeza mwanachama (sw)',
  description:
    'Add a new staff member to the org from chat. Use when the owner / ' +
    'admin says "add Asha as the new pit foreman" or "we just hired a ' +
    'safety officer". fullName + role are required (re-ask if missing — ' +
    'never invent). Roles are mining: site_supervisor, pit_foreman, ' +
    'safety_officer, geologist, accountant, etc. hireDate defaults to now ' +
    'only when omitted. Returns DUPLICATE when a same-name active staff ' +
    'member exists (pass allowDuplicate:true to force). Contact (whatsapp / ' +
    'phone / email) is stored in metadata.',
  personaSlugs: OWNER_ADMIN,
  inputSchema: CreateInput,
  outputSchema: CreateOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const unavailable = {
      id: '',
      fullName: input.fullName,
      role: input.role,
      status: 'unavailable',
      hireDate: null as string | null,
      managerId: input.managerId ?? null,
    };
    const client = ctx.httpClient;
    if (!client) return unavailable;

    const payload: Record<string, unknown> = {
      fullName: input.fullName,
      role: input.role,
      allowDuplicate: input.allowDuplicate === true,
    };
    if (input.hireDate !== undefined) payload.hireDate = input.hireDate;
    if (input.managerId !== undefined) payload.managerId = input.managerId;
    if (input.contact !== undefined) payload.contact = input.contact;
    if (input.notes !== undefined) payload.notes = input.notes;

    const response = await client.post<{
      success?: boolean;
      data?: Record<string, unknown>;
    }>('/org-admin/staff', withChatProvenance(payload, ctx));
    const row = response.data;
    if (!row) return unavailable;
    return {
      id: String(row.id ?? ''),
      fullName: String(row.full_name ?? input.fullName),
      role: String(row.role ?? input.role),
      status: String(row.status ?? 'active'),
      hireDate: row.hire_date != null ? String(row.hire_date) : null,
      managerId: row.manager_id != null ? String(row.manager_id) : null,
    };
  },
};

// ---------------------------------------------------------------------------
// 2. staff.assign_kpi (WRITE)
// ---------------------------------------------------------------------------

const AssignKpiInput = z.object({
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
});

const AssignKpiOutput = z.object({
  id: z.string(),
  name: z.string(),
  staffMemberName: z.string().nullable(),
  targetValue: z.string(),
  metricUnit: z.string(),
  period: z.string(),
  periodEnd: z.string().nullable(),
  status: z.string(),
});

export const staffAssignKpiTool: PersonaToolDescriptor<
  typeof AssignKpiInput,
  typeof AssignKpiOutput
> = {
  id: 'staff.assign_kpi',
  name: 'Staff — assign a KPI (en) / Wafanyakazi — weka lengo la utendaji (sw)',
  description:
    'Assign a KPI to a staff member from chat. Use when the owner / admin ' +
    'says "Asha\'s quarterly KPI is 5000 tonnes hauled" or "the safety ' +
    'officer should close 95% of inspections this month". name + ' +
    'targetValue are required. metricUnit: count, currency, percent, days, ' +
    'hours, ratio (default count). period: week, month, quarter, half, year ' +
    '(default quarter). Resolve the staff member by id or name; NOT_FOUND / ' +
    'AMBIGUOUS surfaced honestly. For a money KPI use metricUnit:currency — ' +
    'never hard-code a currency code.',
  personaSlugs: OWNER_ADMIN,
  inputSchema: AssignKpiInput,
  outputSchema: AssignKpiOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const unavailable = {
      id: '',
      name: input.name,
      staffMemberName: null as string | null,
      targetValue: String(input.targetValue),
      metricUnit: input.metricUnit ?? 'count',
      period: input.period ?? 'quarter',
      periodEnd: null as string | null,
      status: 'unavailable',
    };
    const client = ctx.httpClient;
    if (!client) return unavailable;

    const payload: Record<string, unknown> = {
      name: input.name,
      targetValue: input.targetValue,
    };
    if (input.staffMemberId !== undefined) {
      payload.staffMemberId = input.staffMemberId;
    }
    if (input.staffMemberName !== undefined) {
      payload.staffMemberName = input.staffMemberName;
    }
    if (input.description !== undefined) payload.description = input.description;
    if (input.metricUnit !== undefined) payload.metricUnit = input.metricUnit;
    if (input.period !== undefined) payload.period = input.period;
    if (input.periodEnd !== undefined) payload.periodEnd = input.periodEnd;

    const response = await client.post<{
      success?: boolean;
      data?: Record<string, unknown>;
    }>('/org-admin/staff/kpis', withChatProvenance(payload, ctx));
    const row = response.data;
    if (!row) return unavailable;
    return {
      id: String(row.id ?? ''),
      name: String(row.name ?? input.name),
      staffMemberName:
        row.staffMemberName != null ? String(row.staffMemberName) : null,
      targetValue: String(row.target_value ?? input.targetValue),
      metricUnit: String(row.metric_unit ?? input.metricUnit ?? 'count'),
      period: String(row.period ?? input.period ?? 'quarter'),
      periodEnd: row.period_end != null ? String(row.period_end) : null,
      status: String(row.status ?? 'active'),
    };
  },
};

// ---------------------------------------------------------------------------
// 3. staff.schedule_task (WRITE)
// ---------------------------------------------------------------------------

const ScheduleTaskInput = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  assignedToStaffId: z.string().uuid().optional(),
  assignedToStaffName: z.string().min(1).max(200).optional(),
  dueAt: z.string().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});

const ScheduleTaskOutput = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  priority: z.string(),
  dueAt: z.string().nullable(),
  assignedTo: z.string().nullable(),
});

export const staffScheduleTaskTool: PersonaToolDescriptor<
  typeof ScheduleTaskInput,
  typeof ScheduleTaskOutput
> = {
  id: 'staff.schedule_task',
  name: 'Staff — schedule a task (en) / Wafanyakazi — panga kazi (sw)',
  description:
    'Schedule a real org task. Use when the owner / admin says "schedule ' +
    'the pit-wall inspection for the north bench by Friday" or "remind the ' +
    'site supervisor to service the generator". title is required. dueAt ' +
    'must be ISO 8601 (rejects malformed + past dates). assignedToStaffName/' +
    'Id resolved in the tenant; NOT_FOUND / AMBIGUOUS surfaced honestly. ' +
    'priority: low, normal, high, urgent (default normal).',
  personaSlugs: OWNER_ADMIN,
  inputSchema: ScheduleTaskInput,
  outputSchema: ScheduleTaskOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const unavailable = {
      id: '',
      title: input.title,
      status: 'unavailable',
      priority: input.priority ?? 'normal',
      dueAt: null as string | null,
      assignedTo: null as string | null,
    };
    const client = ctx.httpClient;
    if (!client) return unavailable;

    const payload: Record<string, unknown> = { title: input.title };
    if (input.description !== undefined) payload.description = input.description;
    if (input.assignedToStaffId !== undefined) {
      payload.assignedToStaffId = input.assignedToStaffId;
    }
    if (input.assignedToStaffName !== undefined) {
      payload.assignedToStaffName = input.assignedToStaffName;
    }
    if (input.dueAt !== undefined) payload.dueAt = input.dueAt;
    if (input.priority !== undefined) payload.priority = input.priority;

    const response = await client.post<{
      success?: boolean;
      data?: Record<string, unknown>;
    }>('/org-admin/tasks', withChatProvenance(payload, ctx));
    const row = response.data;
    if (!row) return unavailable;
    return {
      id: String(row.id ?? ''),
      title: String(row.title ?? input.title),
      status: String(row.status ?? 'open'),
      priority: String(row.priority ?? input.priority ?? 'normal'),
      dueAt: row.due_at != null ? String(row.due_at) : null,
      assignedTo: row.assigned_to != null ? String(row.assigned_to) : null,
    };
  },
};

// ---------------------------------------------------------------------------
// 4. staff.escalate_to_human (WRITE)
// ---------------------------------------------------------------------------

const EscalateInput = z.object({
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
});

const EscalateOutput = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  severity: z.string(),
  status: z.string(),
  escalatedToStaffId: z.string().nullable(),
  relatedTaskId: z.string().nullable(),
});

export const staffEscalateToHumanTool: PersonaToolDescriptor<
  typeof EscalateInput,
  typeof EscalateOutput
> = {
  id: 'staff.escalate_to_human',
  name: 'Staff — escalate to a human (en) / Wafanyakazi — peleka kwa mtu (sw)',
  description:
    'Raise an escalation for a human to act on. Use when the brain or owner ' +
    'says "this needs a real person" — a compliance breach, a safety ' +
    'incident, or a payment default. title + reason are required. category: ' +
    'compliance_breach, safety_incident, payment_default, other. severity: ' +
    'low, normal, high, critical (default normal). Optional relatedTaskId / ' +
    'escalatedToStaff (id or name) — both verified within the tenant. With ' +
    'no staff target the escalation lands in the org-admin queue.',
  personaSlugs: OWNER_ADMIN,
  inputSchema: EscalateInput,
  outputSchema: EscalateOutput,
  stakes: 'HIGH',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const unavailable = {
      id: '',
      title: input.title,
      category: input.category ?? 'other',
      severity: input.severity ?? 'normal',
      status: 'unavailable',
      escalatedToStaffId: input.escalatedToStaffId ?? null,
      relatedTaskId: input.relatedTaskId ?? null,
    };
    const client = ctx.httpClient;
    if (!client) return unavailable;

    const payload: Record<string, unknown> = {
      title: input.title,
      reason: input.reason,
    };
    if (input.category !== undefined) payload.category = input.category;
    if (input.severity !== undefined) payload.severity = input.severity;
    if (input.escalatedToStaffId !== undefined) {
      payload.escalatedToStaffId = input.escalatedToStaffId;
    }
    if (input.escalatedToStaffName !== undefined) {
      payload.escalatedToStaffName = input.escalatedToStaffName;
    }
    if (input.relatedTaskId !== undefined) {
      payload.relatedTaskId = input.relatedTaskId;
    }
    if (input.relatedSubject !== undefined) {
      payload.relatedSubject = input.relatedSubject;
    }

    const response = await client.post<{
      success?: boolean;
      data?: Record<string, unknown>;
    }>('/org-admin/escalations', withChatProvenance(payload, ctx));
    const row = response.data;
    if (!row) return unavailable;
    return {
      id: String(row.id ?? ''),
      title: String(row.title ?? input.title),
      category: String(row.category ?? input.category ?? 'other'),
      severity: String(row.severity ?? input.severity ?? 'normal'),
      status: String(row.status ?? 'open'),
      escalatedToStaffId:
        row.escalated_to_staff_id != null
          ? String(row.escalated_to_staff_id)
          : null,
      relatedTaskId:
        row.related_task_id != null ? String(row.related_task_id) : null,
    };
  },
};

// ---------------------------------------------------------------------------
// 5. staff.bulk_ingest_csv (WRITE)
// ---------------------------------------------------------------------------

const BulkIngestInput = z.object({
  csv: z.string().min(1),
  allowDuplicates: z.boolean().optional(),
});

const BulkIngestOutput = z.object({
  totalRows: z.number(),
  inserted: z.number(),
  skippedDuplicates: z.number(),
  rejected: z.number(),
  outcomes: z.array(
    z.object({
      line: z.number(),
      status: z.string(),
      reason: z.string().optional(),
      staffMemberId: z.string().optional(),
    }),
  ),
});

export const staffBulkIngestCsvTool: PersonaToolDescriptor<
  typeof BulkIngestInput,
  typeof BulkIngestOutput
> = {
  id: 'staff.bulk_ingest_csv',
  name: 'Staff — bulk-import a roster CSV (en) / Wafanyakazi — pakia orodha ya CSV (sw)',
  description:
    'Parse a CSV roster (header must include name + role; optional ' +
    'hire_date, whatsapp, phone, email, manager_name, notes) and insert one ' +
    'staff_members row per data line. Use when the owner / admin pastes or ' +
    'uploads a team roster. Reports a per-row outcome (inserted / ' +
    'skipped_duplicate / rejected) with line numbers. manager_name resolves ' +
    'against rows earlier in the same CSV OR existing tenant staff; reports ' +
    'NOT_FOUND otherwise. Hard cap 500 rows per call.',
  personaSlugs: OWNER_ADMIN,
  inputSchema: BulkIngestInput,
  outputSchema: BulkIngestOutput,
  stakes: 'HIGH',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const unavailable = {
      totalRows: 0,
      inserted: 0,
      skippedDuplicates: 0,
      rejected: 0,
      outcomes: [] as Array<{
        line: number;
        status: string;
        reason?: string;
        staffMemberId?: string;
      }>,
    };
    const client = ctx.httpClient;
    if (!client) return unavailable;

    const payload: Record<string, unknown> = { csv: input.csv };
    if (input.allowDuplicates !== undefined) {
      payload.allowDuplicates = input.allowDuplicates;
    }

    const response = await client.post<{
      success?: boolean;
      data?: {
        totalRows?: number;
        inserted?: number;
        skippedDuplicates?: number;
        rejected?: number;
        outcomes?: ReadonlyArray<Record<string, unknown>>;
      };
    }>('/org-admin/staff/bulk-csv', withChatProvenance(payload, ctx));
    const data = response.data;
    if (!data) return unavailable;
    const outcomes = (data.outcomes ?? []).map((o) => {
      const mapped: {
        line: number;
        status: string;
        reason?: string;
        staffMemberId?: string;
      } = {
        line: Number(o.line ?? 0),
        status: String(o.status ?? 'rejected'),
      };
      if (o.reason != null) mapped.reason = String(o.reason);
      if (o.staffMemberId != null) {
        mapped.staffMemberId = String(o.staffMemberId);
      }
      return mapped;
    });
    return {
      totalRows: Number(data.totalRows ?? 0),
      inserted: Number(data.inserted ?? 0),
      skippedDuplicates: Number(data.skippedDuplicates ?? 0),
      rejected: Number(data.rejected ?? 0),
      outcomes,
    };
  },
};

// ---------------------------------------------------------------------------
// Catalog export — included by `buildPersonaToolHandlers` in index.ts.
// ---------------------------------------------------------------------------

export const ORG_ADMIN_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  staffCreateTool,
  staffAssignKpiTool,
  staffScheduleTaskTool,
  staffEscalateToHumanTool,
  staffBulkIngestCsvTool,
] as unknown as ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
>);
