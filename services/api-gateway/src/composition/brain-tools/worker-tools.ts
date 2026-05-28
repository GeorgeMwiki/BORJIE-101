/**
 * Worker persona — T4 field-employee tools.
 *
 * Nine tools the workforce-mobile employee role can reach via chat.
 * WRITE tools (clock-in/out, complete-task, acknowledge-talk, report-
 * incident, submit-sample) all emit an audit-chain entry; the toolbox-
 * talk acknowledgement is the one tool that REQUIRES biometric capture
 * (per CLAUDE.md). We surface `requiresBiometric` in the input schema
 * so the upstream route enforces it — the brain tool itself does not
 * collect biometrics, it just forwards the assertion.
 */

import { z } from 'zod';
import type { PersonaToolDescriptor } from './types';

const WORKER: ReadonlyArray<'T4_field_employee'> = ['T4_field_employee'];

// 1. My shift
const MyShiftInput = z.object({});
const MyShiftOutput = z.object({
  shiftId: z.string().optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  siteId: z.string().optional(),
  state: z.enum(['scheduled', 'on_shift', 'off_shift', 'absent']),
});
export const workerMyShiftTool: PersonaToolDescriptor<typeof MyShiftInput, typeof MyShiftOutput> = {
  id: 'mining.attendance.my-shift',
  name: 'Worker — my shift',
  description: 'Today\'s shift for the calling worker plus current attendance state.',
  personaSlugs: WORKER,
  inputSchema: MyShiftInput,
  outputSchema: MyShiftOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(_input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { state: 'off_shift' as const };
    return client.get<{ shiftId?: string; startsAt?: string; endsAt?: string; siteId?: string; state: 'scheduled' | 'on_shift' | 'off_shift' | 'absent' }>(
      '/mining/attendance/my-shift',
      { query: { tenantId: ctx.tenantId, actorId: ctx.actorId } },
    );
  },
};

// 2. Clock in (WRITE)
const ClockInInput = z.object({
  siteId: z.string().min(1),
  geo: z.object({ lat: z.number(), lng: z.number() }).optional(),
});
const ClockInOutput = z.object({
  shiftId: z.string(),
  clockedInAt: z.string(),
});
export const workerClockInTool: PersonaToolDescriptor<typeof ClockInInput, typeof ClockInOutput> = {
  id: 'mining.attendance.clock-in',
  name: 'Worker — clock in',
  description: 'Clock in for today\'s shift at the given site. Audit-tracked.',
  personaSlugs: WORKER,
  inputSchema: ClockInInput,
  outputSchema: ClockInOutput,
  stakes: 'LOW',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return { shiftId: `pending:${ctx.actorId}`, clockedInAt: new Date().toISOString() };
    }
    return client.post<{ shiftId: string; clockedInAt: string }>(
      '/mining/attendance/clock-in',
      { tenantId: ctx.tenantId, actorId: ctx.actorId, siteId: input.siteId, geo: input.geo },
    );
  },
};

// 3. Clock out (WRITE)
const ClockOutInput = z.object({
  shiftId: z.string().min(1),
  geo: z.object({ lat: z.number(), lng: z.number() }).optional(),
});
const ClockOutOutput = z.object({
  shiftId: z.string(),
  clockedOutAt: z.string(),
});
export const workerClockOutTool: PersonaToolDescriptor<
  typeof ClockOutInput,
  typeof ClockOutOutput
> = {
  id: 'mining.attendance.clock-out',
  name: 'Worker — clock out',
  description: 'Clock out from the given active shift. Audit-tracked.',
  personaSlugs: WORKER,
  inputSchema: ClockOutInput,
  outputSchema: ClockOutOutput,
  stakes: 'LOW',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return { shiftId: input.shiftId, clockedOutAt: new Date().toISOString() };
    }
    return client.post<{ shiftId: string; clockedOutAt: string }>(
      '/mining/attendance/clock-out',
      { tenantId: ctx.tenantId, actorId: ctx.actorId, shiftId: input.shiftId, geo: input.geo },
    );
  },
};

// 4. My tasks
const MyTasksInput = z.object({
  status: z.enum(['open', 'in_progress', 'blocked', 'done', 'all']).default('open'),
});
const MyTasksOutput = z.object({
  tasks: z.array(
    z.object({
      taskId: z.string(),
      title: z.string(),
      status: z.enum(['open', 'in_progress', 'blocked', 'done']),
      dueAt: z.string().optional(),
    }),
  ),
});
export const workerMyTasksTool: PersonaToolDescriptor<typeof MyTasksInput, typeof MyTasksOutput> = {
  id: 'mining.tasks.mine',
  name: 'Worker — my tasks',
  description: 'Tasks assigned to the calling worker, optionally filtered by status.',
  personaSlugs: WORKER,
  inputSchema: MyTasksInput,
  outputSchema: MyTasksOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { tasks: [] };
    return client.get<{ tasks: Array<{ taskId: string; title: string; status: 'open' | 'in_progress' | 'blocked' | 'done'; dueAt?: string }> }>(
      '/mining/tasks/mine',
      { query: { tenantId: ctx.tenantId, actorId: ctx.actorId, status: input.status } },
    );
  },
};

// 5. Complete task (WRITE)
const CompleteTaskInput = z.object({
  taskId: z.string().min(1),
  noteEn: z.string().max(2000).optional(),
  noteSw: z.string().max(2000).optional(),
});
const CompleteTaskOutput = z.object({
  taskId: z.string(),
  completedAt: z.string(),
});
export const workerCompleteTaskTool: PersonaToolDescriptor<
  typeof CompleteTaskInput,
  typeof CompleteTaskOutput
> = {
  id: 'mining.tasks.complete',
  name: 'Worker — complete task',
  description: 'Mark a task assigned to the calling worker as complete. Audit-tracked.',
  personaSlugs: WORKER,
  inputSchema: CompleteTaskInput,
  outputSchema: CompleteTaskOutput,
  stakes: 'LOW',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return { taskId: input.taskId, completedAt: new Date().toISOString() };
    }
    return client.post<{ taskId: string; completedAt: string }>(
      '/mining/tasks/complete',
      {
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        taskId: input.taskId,
        noteEn: input.noteEn,
        noteSw: input.noteSw,
      },
    );
  },
};

// 6. Today's toolbox talks
const ToolboxTodayInput = z.object({});
const ToolboxTodayOutput = z.object({
  talks: z.array(
    z.object({
      talkId: z.string(),
      title: z.string(),
      bodyEn: z.string(),
      bodySw: z.string(),
      acknowledged: z.boolean(),
    }),
  ),
});
export const workerToolboxTodayTool: PersonaToolDescriptor<
  typeof ToolboxTodayInput,
  typeof ToolboxTodayOutput
> = {
  id: 'mining.toolbox-talks.today',
  name: 'Worker — today\'s toolbox talks',
  description: 'Today\'s safety toolbox talks the worker must read and acknowledge.',
  personaSlugs: WORKER,
  inputSchema: ToolboxTodayInput,
  outputSchema: ToolboxTodayOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(_input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { talks: [] };
    return client.get<{ talks: Array<{ talkId: string; title: string; bodyEn: string; bodySw: string; acknowledged: boolean }> }>(
      '/mining/toolbox-talks/today',
      { query: { tenantId: ctx.tenantId, actorId: ctx.actorId } },
    );
  },
};

// 7. Acknowledge toolbox talk (WRITE — biometric required)
const ToolboxAckInput = z.object({
  talkId: z.string().min(1),
  biometricAssertion: z.object({
    method: z.enum(['fingerprint', 'face', 'liveness']),
    nonce: z.string().min(1),
    signedAt: z.string(),
  }),
});
const ToolboxAckOutput = z.object({
  talkId: z.string(),
  acknowledgedAt: z.string(),
});
export const workerAckToolboxTool: PersonaToolDescriptor<
  typeof ToolboxAckInput,
  typeof ToolboxAckOutput
> = {
  id: 'mining.toolbox-talks.acknowledge',
  name: 'Worker — acknowledge toolbox talk',
  description:
    'Acknowledge a toolbox talk. The caller MUST supply a biometric assertion ' +
    '(fingerprint / face / liveness) per Borjie\'s biometric requirement; the ' +
    'upstream route revalidates the assertion.',
  personaSlugs: WORKER,
  inputSchema: ToolboxAckInput,
  outputSchema: ToolboxAckOutput,
  stakes: 'LOW',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return { talkId: input.talkId, acknowledgedAt: new Date().toISOString() };
    }
    return client.post<{ talkId: string; acknowledgedAt: string }>(
      '/mining/toolbox-talks/acknowledge',
      {
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        talkId: input.talkId,
        biometric: input.biometricAssertion,
      },
    );
  },
};

// 8. Report incident (WRITE)
const IncidentReportInput = z.object({
  titleEn: z.string().min(1).max(200),
  titleSw: z.string().min(1).max(200),
  descriptionEn: z.string().min(1).max(4000),
  descriptionSw: z.string().min(1).max(4000),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('low'),
  siteId: z.string().optional(),
  geo: z.object({ lat: z.number(), lng: z.number() }).optional(),
});
const IncidentReportOutput = z.object({
  incidentId: z.string(),
  reportedAt: z.string(),
});
export const workerReportIncidentTool: PersonaToolDescriptor<
  typeof IncidentReportInput,
  typeof IncidentReportOutput
> = {
  id: 'mining.incidents.report',
  name: 'Worker — report incident',
  description: 'File a new incident report from the field. Audit-tracked.',
  personaSlugs: WORKER,
  inputSchema: IncidentReportInput,
  outputSchema: IncidentReportOutput,
  stakes: 'LOW',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return { incidentId: `pending:${ctx.actorId}`, reportedAt: new Date().toISOString() };
    }
    return client.post<{ incidentId: string; reportedAt: string }>(
      '/mining/incidents/report',
      {
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        titleEn: input.titleEn,
        titleSw: input.titleSw,
        descriptionEn: input.descriptionEn,
        descriptionSw: input.descriptionSw,
        severity: input.severity,
        siteId: input.siteId,
        geo: input.geo,
      },
    );
  },
};

// 9. Submit sample (WRITE)
const SampleSubmitInput = z.object({
  sampleKind: z.enum(['gold', 'copper', 'tanzanite', 'other']),
  weightGrams: z.number().positive(),
  siteId: z.string().min(1),
  notesEn: z.string().max(2000).optional(),
  notesSw: z.string().max(2000).optional(),
});
const SampleSubmitOutput = z.object({
  sampleId: z.string(),
  submittedAt: z.string(),
});
export const workerSubmitSampleTool: PersonaToolDescriptor<
  typeof SampleSubmitInput,
  typeof SampleSubmitOutput
> = {
  id: 'mining.samples.submit',
  name: 'Worker — submit sample',
  description: 'Submit a physical sample (gold / copper / tanzanite / other). Audit-tracked.',
  personaSlugs: WORKER,
  inputSchema: SampleSubmitInput,
  outputSchema: SampleSubmitOutput,
  stakes: 'LOW',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return { sampleId: `pending:${ctx.actorId}`, submittedAt: new Date().toISOString() };
    }
    return client.post<{ sampleId: string; submittedAt: string }>(
      '/mining/samples/submit',
      {
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        sampleKind: input.sampleKind,
        weightGrams: input.weightGrams,
        siteId: input.siteId,
        notesEn: input.notesEn,
        notesSw: input.notesSw,
      },
    );
  },
};

export const WORKER_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  workerMyShiftTool,
  workerClockInTool,
  workerClockOutTool,
  workerMyTasksTool,
  workerCompleteTaskTool,
  workerToolboxTodayTool,
  workerAckToolboxTool,
  workerReportIncidentTool,
  workerSubmitSampleTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
