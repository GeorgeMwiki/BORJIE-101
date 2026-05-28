/**
 * Manager persona — T3 module-manager tools.
 *
 * Nine tools covering the manager's day:
 *   - Attendance / roster
 *   - Task list + assignment (WRITE)
 *   - AI suggestion for task assignee (read-only — recommendation only)
 *   - Open incidents + maintenance exceptions
 *   - Approvals queue + decide (WRITE)
 *   - Escalate to owner (WRITE)
 *   - Draft today's shift line-up
 *
 * WRITE tools emit an audit-chain entry (via the gate's audit sink) on
 * every invocation. None of the manager tools fall under a HIGH-risk
 * policy prefix — escalations are MEDIUM and approvals are bounded by
 * the persona's max_action_tier ceiling.
 */

import { z } from 'zod';
import type { PersonaToolDescriptor } from './types';

const MANAGER: ReadonlyArray<'T3_module_manager'> = ['T3_module_manager'];

// 1. Crew roster
const CrewInput = z.object({
  siteId: z.string().min(1),
  forDate: z.string().optional(),
});
const CrewOutput = z.object({
  crew: z.array(
    z.object({
      workerId: z.string(),
      displayName: z.string(),
      shift: z.string(),
      status: z.enum(['scheduled', 'on_site', 'absent', 'off_duty']),
    }),
  ),
});
export const managerCrewTool: PersonaToolDescriptor<typeof CrewInput, typeof CrewOutput> = {
  id: 'mining.attendance.crew',
  name: 'Manager — crew roster',
  description: 'Today\'s crew roster for the given site with their attendance status.',
  personaSlugs: MANAGER,
  inputSchema: CrewInput,
  outputSchema: CrewOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { crew: [] };
    return client.get<{ crew: Array<{ workerId: string; displayName: string; shift: string; status: 'scheduled' | 'on_site' | 'absent' | 'off_duty' }> }>(
      '/mining/attendance/crew',
      { query: { tenantId: ctx.tenantId, siteId: input.siteId, date: input.forDate } },
    );
  },
};

// 2. Tasks at my site
const TasksSiteInput = z.object({
  siteId: z.string().min(1),
  status: z.enum(['open', 'in_progress', 'blocked', 'done', 'all']).default('open'),
});
const TasksSiteOutput = z.object({
  tasks: z.array(
    z.object({
      taskId: z.string(),
      title: z.string(),
      assignee: z.string().optional(),
      status: z.enum(['open', 'in_progress', 'blocked', 'done']),
      dueAt: z.string().optional(),
    }),
  ),
});
export const managerTasksListSiteTool: PersonaToolDescriptor<
  typeof TasksSiteInput,
  typeof TasksSiteOutput
> = {
  id: 'mining.tasks.list-site',
  name: 'Manager — site task list',
  description: 'List tasks at the given site, optionally filtered by status.',
  personaSlugs: MANAGER,
  inputSchema: TasksSiteInput,
  outputSchema: TasksSiteOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { tasks: [] };
    return client.get<{ tasks: Array<{ taskId: string; title: string; assignee?: string; status: 'open' | 'in_progress' | 'blocked' | 'done'; dueAt?: string }> }>(
      '/mining/tasks',
      { query: { tenantId: ctx.tenantId, siteId: input.siteId, status: input.status } },
    );
  },
};

// 3. Assign task (WRITE)
const AssignInput = z.object({
  taskId: z.string().min(1),
  workerId: z.string().min(1),
  notesEn: z.string().max(2000).optional(),
  notesSw: z.string().max(2000).optional(),
});
const AssignOutput = z.object({
  taskId: z.string(),
  assignee: z.string(),
  assignedAt: z.string(),
});
export const managerAssignTaskTool: PersonaToolDescriptor<typeof AssignInput, typeof AssignOutput> = {
  id: 'mining.tasks.assign',
  name: 'Manager — assign task to worker',
  description: 'Assign a specific task to a specific worker. Emits an audit entry.',
  personaSlugs: MANAGER,
  inputSchema: AssignInput,
  outputSchema: AssignOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        taskId: input.taskId,
        assignee: input.workerId,
        assignedAt: new Date().toISOString(),
      };
    }
    return client.post<{ taskId: string; assignee: string; assignedAt: string }>(
      '/mining/tasks/assign',
      {
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        taskId: input.taskId,
        workerId: input.workerId,
        notesEn: input.notesEn,
        notesSw: input.notesSw,
      },
    );
  },
};

// 4. Suggest assignee (read-only AI advice)
const SuggestInput = z.object({
  taskId: z.string().min(1),
  topK: z.number().int().positive().max(5).default(3),
});
const SuggestOutput = z.object({
  suggestions: z.array(
    z.object({
      workerId: z.string(),
      score: z.number(),
      reason: z.string(),
      evidenceIds: z.array(z.string()).default([]),
    }),
  ),
});
export const managerSuggestAssigneeTool: PersonaToolDescriptor<
  typeof SuggestInput,
  typeof SuggestOutput
> = {
  id: 'mining.tasks.suggest-assignee',
  name: 'Manager — suggest assignee',
  description:
    'AI-ranked suggestions for who to assign a task to. APPENDS to rule-based ' +
    'decisions — never replaces the manager\'s call.',
  personaSlugs: MANAGER,
  inputSchema: SuggestInput,
  outputSchema: SuggestOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { suggestions: [] };
    return client.get<{ suggestions: Array<{ workerId: string; score: number; reason: string; evidenceIds: string[] }> }>(
      '/mining/tasks/suggest-assignee',
      { query: { tenantId: ctx.tenantId, taskId: input.taskId, topK: input.topK } },
    );
  },
};

// 5. Open incidents + maintenance exceptions
const ExceptionsInput = z.object({
  siteId: z.string().optional(),
});
const ExceptionsOutput = z.object({
  incidents: z.array(
    z.object({
      incidentId: z.string(),
      title: z.string(),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      reportedAt: z.string(),
    }),
  ),
  maintenance: z.array(
    z.object({
      assetId: z.string(),
      summary: z.string(),
      raisedAt: z.string(),
    }),
  ),
});
export const managerExceptionsTool: PersonaToolDescriptor<
  typeof ExceptionsInput,
  typeof ExceptionsOutput
> = {
  id: 'mining.incidents.exceptions',
  name: 'Manager — open exceptions',
  description: 'Open incidents plus maintenance items that need the manager\'s attention.',
  personaSlugs: MANAGER,
  inputSchema: ExceptionsInput,
  outputSchema: ExceptionsOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { incidents: [], maintenance: [] };
    return client.get<{ incidents: Array<{ incidentId: string; title: string; severity: 'low' | 'medium' | 'high' | 'critical'; reportedAt: string }>; maintenance: Array<{ assetId: string; summary: string; raisedAt: string }> }>(
      '/mining/manager/exceptions',
      { query: { tenantId: ctx.tenantId, siteId: input.siteId } },
    );
  },
};

// 6. Approvals queue
const ApprovalsInput = z.object({
  kind: z.enum(['leave', 'fuel', 'advance', 'all']).default('all'),
});
const ApprovalsOutput = z.object({
  approvals: z.array(
    z.object({
      approvalId: z.string(),
      kind: z.enum(['leave', 'fuel', 'advance']),
      requesterId: z.string(),
      summary: z.string(),
      raisedAt: z.string(),
      amount: z.number().optional(),
    }),
  ),
});
export const managerApprovalsQueueTool: PersonaToolDescriptor<
  typeof ApprovalsInput,
  typeof ApprovalsOutput
> = {
  id: 'mining.approvals.queue',
  name: 'Manager — approvals queue',
  description: 'Pending approval requests (leave / fuel / cash advance).',
  personaSlugs: MANAGER,
  inputSchema: ApprovalsInput,
  outputSchema: ApprovalsOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { approvals: [] };
    return client.get<{ approvals: Array<{ approvalId: string; kind: 'leave' | 'fuel' | 'advance'; requesterId: string; summary: string; raisedAt: string; amount?: number }> }>(
      '/mining/approvals',
      { query: { tenantId: ctx.tenantId, kind: input.kind, status: 'pending' } },
    );
  },
};

// 7. Approve / reject (WRITE)
const DecideInput = z.object({
  approvalId: z.string().min(1),
  decision: z.enum(['approve', 'reject']),
  reasonEn: z.string().max(2000).optional(),
  reasonSw: z.string().max(2000).optional(),
});
const DecideOutput = z.object({
  approvalId: z.string(),
  decision: z.enum(['approve', 'reject']),
  decidedAt: z.string(),
});
export const managerDecideApprovalTool: PersonaToolDescriptor<
  typeof DecideInput,
  typeof DecideOutput
> = {
  id: 'mining.approvals.decide',
  name: 'Manager — decide approval',
  description:
    'Approve or reject a pending approval request. Emits an audit entry.',
  personaSlugs: MANAGER,
  inputSchema: DecideInput,
  outputSchema: DecideOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        approvalId: input.approvalId,
        decision: input.decision,
        decidedAt: new Date().toISOString(),
      };
    }
    return client.post<{ approvalId: string; decision: 'approve' | 'reject'; decidedAt: string }>(
      '/mining/approvals/decide',
      {
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        approvalId: input.approvalId,
        decision: input.decision,
        reasonEn: input.reasonEn,
        reasonSw: input.reasonSw,
      },
    );
  },
};

// 8. Escalate to owner (WRITE)
const EscalateInput = z.object({
  subjectEn: z.string().min(1).max(200),
  subjectSw: z.string().min(1).max(200),
  bodyEn: z.string().min(1).max(4000),
  bodySw: z.string().min(1).max(4000),
  severity: z.enum(['low', 'medium', 'high']).default('medium'),
});
const EscalateOutput = z.object({
  ticketId: z.string(),
  raisedAt: z.string(),
});
export const managerEscalateTool: PersonaToolDescriptor<
  typeof EscalateInput,
  typeof EscalateOutput
> = {
  id: 'mining.escalations.raise',
  name: 'Manager — escalate to owner',
  description:
    'Raise an escalation ticket to the owner. Audit-tracked. Use only when the matter ' +
    'exceeds manager authority or requires owner sign-off.',
  personaSlugs: MANAGER,
  inputSchema: EscalateInput,
  outputSchema: EscalateOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return { ticketId: `pending:${ctx.actorId}`, raisedAt: new Date().toISOString() };
    }
    return client.post<{ ticketId: string; raisedAt: string }>(
      '/mining/escalations',
      {
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        subjectEn: input.subjectEn,
        subjectSw: input.subjectSw,
        bodyEn: input.bodyEn,
        bodySw: input.bodySw,
        severity: input.severity,
      },
    );
  },
};

// 9. Draft today's shift line-up
const ShiftDraftInput = z.object({
  siteId: z.string().min(1),
  forDate: z.string().optional(),
});
const ShiftDraftOutput = z.object({
  draftId: z.string(),
  lineup: z.array(
    z.object({
      workerId: z.string(),
      role: z.string(),
      shift: z.string(),
    }),
  ),
  rationaleEn: z.string(),
  rationaleSw: z.string(),
});
export const managerShiftDraftTool: PersonaToolDescriptor<
  typeof ShiftDraftInput,
  typeof ShiftDraftOutput
> = {
  id: 'mining.shift-reports.draft',
  name: 'Manager — draft today\'s shift line-up',
  description:
    'Draft today\'s shift assignment for the given site. Returns the draft; the ' +
    'manager confirms separately via the existing draft commit endpoint.',
  personaSlugs: MANAGER,
  inputSchema: ShiftDraftInput,
  outputSchema: ShiftDraftOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        draftId: `draft:${ctx.tenantId}:${input.siteId}`,
        lineup: [],
        rationaleEn: 'draft requires httpClient',
        rationaleSw: 'rasimu inahitaji httpClient',
      };
    }
    return client.post<{ draftId: string; lineup: Array<{ workerId: string; role: string; shift: string }>; rationaleEn: string; rationaleSw: string }>(
      '/mining/shift-reports/draft',
      {
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        siteId: input.siteId,
        forDate: input.forDate,
      },
    );
  },
};

export const MANAGER_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  managerCrewTool,
  managerTasksListSiteTool,
  managerAssignTaskTool,
  managerSuggestAssigneeTool,
  managerExceptionsTool,
  managerApprovalsQueueTool,
  managerDecideApprovalTool,
  managerEscalateTool,
  managerShiftDraftTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
