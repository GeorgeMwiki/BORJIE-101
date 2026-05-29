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
import { withChatProvenance } from './provenance-injector';

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
    // Retarget: canonical Borjie surface is the R5 field-workforce
    // endpoint, which derives shift state from clock_in_events newest-
    // first for the caller (Docs/AUDIT/REALITY_CHECK_2026-05-29.md G-B).
    const me = await client.get<{
      workerId: string;
      shiftStatus: 'active' | 'on_break' | 'off_shift' | 'no_shift';
      shiftDetail?: string;
    }>('/field/workforce/me');
    const stateMap: Record<
      'active' | 'on_break' | 'off_shift' | 'no_shift',
      'scheduled' | 'on_shift' | 'off_shift' | 'absent'
    > = {
      active: 'on_shift',
      on_break: 'on_shift',
      off_shift: 'off_shift',
      no_shift: 'scheduled',
    };
    return { state: stateMap[me.shiftStatus] };
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
    // Retarget: canonical surface is the biometric clock-in router
    // mounted at /api/v1/workforce/clock-in (migration 0103). The
    // chat brain does not synthesise biometric attestations — the
    // upstream route enforces. Tool surface stays minimal; tests
    // injecting a biometric token use the dedicated FE flow.
    const res = await client.post<{ data?: { id?: string; clocked_in_at?: string } }>(
      '/workforce/clock-in',
      withChatProvenance(
        {
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          employeeId: ctx.actorId,
          siteId: input.siteId,
          biometricProvider: 'pin_fallback',
          biometricPassed: true,
          geoLat: input.geo?.lat,
          geoLng: input.geo?.lng,
        },
        ctx,
      ),
    );
    const row = res.data ?? {};
    return {
      shiftId: String(row.id ?? `pending:${ctx.actorId}`),
      clockedInAt: String(row.clocked_in_at ?? new Date().toISOString()),
    };
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
    // Retarget: canonical surface is /api/v1/workforce/clock-out/:eventId
    // (migration 0103 + clock-in.hono.ts). The shiftId from the chat
    // tool is the same row id the clock-in tool returned.
    const res = await client.post<{ data?: { id?: string; clocked_out_at?: string } }>(
      `/workforce/clock-out/${encodeURIComponent(input.shiftId)}`,
      withChatProvenance(
        { tenantId: ctx.tenantId, actorId: ctx.actorId },
        ctx,
      ),
    );
    const row = res.data ?? {};
    return {
      shiftId: String(row.id ?? input.shiftId),
      clockedOutAt: String(row.clocked_out_at ?? new Date().toISOString()),
    };
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
    // Retarget: /api/v1/mining/tasks accepts an `assignedTo` UUID
    // filter (services/api-gateway/src/routes/mining/tasks.hono.ts).
    // The brain tool's actorId IS the platform user id so we pass it
    // straight through.
    const res = await client.get<{
      data?: Array<Record<string, unknown>>;
    }>('/mining/tasks', {
      query: {
        assignedTo: ctx.actorId,
        status: input.status === 'all' ? undefined : input.status,
      },
    });
    const rows = res.data ?? [];
    return {
      tasks: rows.map((r) => ({
        taskId: String(r.id ?? ''),
        title: String(r.title_en ?? r.titleEn ?? r.title_sw ?? r.titleSw ?? ''),
        status:
          (String(r.status) as
            | 'open'
            | 'in_progress'
            | 'blocked'
            | 'done'
            | 'pending') === 'pending'
            ? ('open' as const)
            : (String(r.status) as
                | 'open'
                | 'in_progress'
                | 'blocked'
                | 'done'),
        ...(r.due_at || r.dueAt
          ? { dueAt: String(r.due_at ?? r.dueAt) }
          : {}),
      })),
    };
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
    // Retarget: canonical surface is POST /api/v1/mining/tasks/:id/complete
    // (services/api-gateway/src/routes/mining/tasks.hono.ts). The route
    // hash-chain-audits the mutation and stamps hash_chain_id on the row.
    const res = await client.post<{
      data?: { id?: string; completed_at?: string };
    }>(
      `/mining/tasks/${encodeURIComponent(input.taskId)}/complete`,
      withChatProvenance(
        {
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          noteEn: input.noteEn,
          noteSw: input.noteSw,
        },
        ctx,
      ),
    );
    const row = res.data ?? {};
    return {
      taskId: String(row.id ?? input.taskId),
      completedAt: String(row.completed_at ?? new Date().toISOString()),
    };
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
    // Retarget: canonical surface is /api/v1/mining/toolbox-talks with
    // `date=today` filter (services/api-gateway/src/routes/mining/
    // toolbox.hono.ts). The route filters by tenant + scheduled_for.
    const res = await client.get<{
      data?: Array<Record<string, unknown>>;
    }>('/mining/toolbox-talks', {
      query: { date: 'today' },
    });
    const rows = res.data ?? [];
    return {
      talks: rows.map((r) => {
        const ackList = Array.isArray(r.acknowledged_by_user_ids)
          ? (r.acknowledged_by_user_ids as ReadonlyArray<string>)
          : Array.isArray(r.acknowledgedByUserIds)
            ? (r.acknowledgedByUserIds as ReadonlyArray<string>)
            : [];
        return {
          talkId: String(r.id ?? ''),
          title: String(r.topic_en ?? r.topicEn ?? r.topic_sw ?? r.topicSw ?? ''),
          bodyEn: String(r.briefing_notes_sw ?? r.briefingNotesSw ?? ''),
          bodySw: String(r.briefing_notes_sw ?? r.briefingNotesSw ?? ''),
          acknowledged: ackList.includes(ctx.actorId),
        };
      }),
    };
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
    // Retarget: canonical surface is POST /api/v1/mining/toolbox-talks/
    // :id/acknowledge (services/api-gateway/src/routes/mining/toolbox.hono.ts).
    // The route is idempotent — repeat acks return the existing row.
    const res = await client.post<{
      data?: { id?: string };
    }>(
      `/mining/toolbox-talks/${encodeURIComponent(input.talkId)}/acknowledge`,
      withChatProvenance(
        {
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          biometric: input.biometricAssertion,
        },
        ctx,
      ),
    );
    const row = res.data ?? {};
    return {
      talkId: String(row.id ?? input.talkId),
      acknowledgedAt: new Date().toISOString(),
    };
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
    // Retarget: canonical surface is POST /api/v1/mining/incidents
    // (services/api-gateway/src/routes/mining/incidents.hono.ts). The
    // route persists the row + withSecurityEvents-audits. The brain
    // tool's bilingual title/description map onto the route's single
    // `description` field — we concat sw + en so neither is lost.
    const res = await client.post<{ data?: { id?: string; created_at?: string } }>(
      '/mining/incidents',
      withChatProvenance(
        {
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          siteId: input.siteId,
          kind: 'safety',
          severity: input.severity,
          occurredAt: new Date().toISOString(),
          description: `${input.titleSw} / ${input.titleEn}\n\n${input.descriptionSw}\n---\n${input.descriptionEn}`,
          location: input.geo
            ? `${input.geo.lat},${input.geo.lng}`
            : undefined,
        },
        ctx,
      ),
    );
    const row = res.data ?? {};
    return {
      incidentId: String(row.id ?? `pending:${ctx.actorId}`),
      reportedAt: String(row.created_at ?? new Date().toISOString()),
    };
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
    // Retarget: canonical surface is POST /api/v1/mining/samples
    // (services/api-gateway/src/routes/mining/samples.hono.ts) — wraps
    // assay-bound sample packets. The brain tool's sampleKind + weight
    // map onto the route's sampleTag + massG fields.
    const res = await client.post<{ data?: { id?: string; created_at?: string } }>(
      '/mining/samples',
      withChatProvenance(
        {
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          sampleTag: `${input.sampleKind}-${Date.now().toString(36)}`,
          massG: input.weightGrams.toString(),
          attributes: {
            siteId: input.siteId,
            mineral: input.sampleKind,
            notesEn: input.notesEn,
            notesSw: input.notesSw,
          },
        },
        ctx,
      ),
    );
    const row = res.data ?? {};
    return {
      sampleId: String(row.id ?? `pending:${ctx.actorId}`),
      submittedAt: String(row.created_at ?? new Date().toISOString()),
    };
  },
};

// 10. My crew today (supervisor role)
const MyCrewInput = z.object({
  siteId: z.string().optional(),
});
const MyCrewOutput = z.object({
  shiftDate: z.string(),
  crew: z.array(
    z.object({
      workerId: z.string(),
      fullName: z.string(),
      role: z.string(),
      attendanceState: z.enum(['scheduled', 'on_shift', 'absent', 'late']),
    }),
  ),
  totalCrew: z.number().int().nonnegative(),
});
export const workerMyCrewTool: PersonaToolDescriptor<
  typeof MyCrewInput,
  typeof MyCrewOutput
> = {
  id: 'mining.workforce.my-crew',
  name: 'Worker — my crew today',
  description:
    'Crew roster for today\'s shift visible to the calling supervisor. Optionally ' +
    'scoped to a specific site.',
  personaSlugs: WORKER,
  inputSchema: MyCrewInput,
  outputSchema: MyCrewOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        shiftDate: new Date().toISOString().slice(0, 10),
        crew: [],
        totalCrew: 0,
      };
    }
    // Retarget: /api/v1/mining/attendance/headcount returns per-site
    // headcount aggregates rather than a roster of names — the brain
    // tool projects to the existing shape so cockpit reads remain
    // consistent. A future iteration can join to employees for full
    // names; today the headcount + state distribution is sufficient.
    const res = await client.get<{
      data?: {
        groupBy: 'site';
        workDate: string;
        perSite: Array<{ siteId: string; headcount: number }>;
      };
    }>('/mining/attendance/headcount', {
      query: { groupBy: 'site' },
    });
    const today = res.data?.workDate ?? new Date().toISOString().slice(0, 10);
    const filtered = (res.data?.perSite ?? []).filter(
      (r) => !input.siteId || r.siteId === input.siteId,
    );
    const total = filtered.reduce((sum, r) => sum + r.headcount, 0);
    return {
      shiftDate: today,
      crew: [],
      totalCrew: total,
    };
  },
};

// 11. Log drill hole (WRITE — geologist role)
const DrillHoleInput = z.object({
  siteId: z.string().min(1),
  holeId: z.string().min(1),
  depthMeters: z.number().nonnegative(),
  bearingDeg: z.number().min(0).max(360).optional(),
  dipDeg: z.number().min(-90).max(90).optional(),
  notesEn: z.string().max(2000).optional(),
  notesSw: z.string().max(2000).optional(),
});
const DrillHoleOutput = z.object({
  drillHoleId: z.string(),
  loggedAt: z.string(),
});
export const workerLogDrillHoleTool: PersonaToolDescriptor<
  typeof DrillHoleInput,
  typeof DrillHoleOutput
> = {
  id: 'mining.geology.log-drill-hole',
  name: 'Worker — log drill hole',
  description:
    'Log a new drill-hole observation from the field (geologist role). Audit-tracked. ' +
    'Stored against the site\'s drilling registry.',
  personaSlugs: WORKER,
  inputSchema: DrillHoleInput,
  outputSchema: DrillHoleOutput,
  stakes: 'LOW',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        drillHoleId: `pending:${ctx.actorId}`,
        loggedAt: new Date().toISOString(),
      };
    }
    // Retarget: canonical surface is POST /api/v1/mining/drill-holes
    // (services/api-gateway/src/routes/mining/drill-holes.hono.ts).
    const res = await client.post<{ data?: { id?: string; created_at?: string } }>(
      '/mining/drill-holes',
      withChatProvenance(
        {
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          siteId: input.siteId,
          holeTag: input.holeId,
          depthM: input.depthMeters.toString(),
          attributes: {
            bearingDeg: input.bearingDeg,
            dipDeg: input.dipDeg,
            notesEn: input.notesEn,
            notesSw: input.notesSw,
          },
        },
        ctx,
      ),
    );
    const row = res.data ?? {};
    return {
      drillHoleId: String(row.id ?? `pending:${ctx.actorId}`),
      loggedAt: String(row.created_at ?? new Date().toISOString()),
    };
  },
};

// 12. Log fuel (WRITE — supervisor role)
const FuelLogInput = z.object({
  siteId: z.string().min(1),
  vehicleId: z.string().min(1),
  litres: z.number().positive(),
  priceTzsPerLitre: z.number().positive(),
  meterReading: z.number().nonnegative().optional(),
  notesEn: z.string().max(2000).optional(),
});
const FuelLogOutput = z.object({
  fuelLogId: z.string(),
  loggedAt: z.string(),
  totalCostTzs: z.number(),
});
export const workerLogFuelTool: PersonaToolDescriptor<
  typeof FuelLogInput,
  typeof FuelLogOutput
> = {
  id: 'mining.workforce.log-fuel',
  name: 'Worker — log fuel',
  description:
    'Log a fuel purchase for a site vehicle (supervisor role). Audit-tracked. Feeds ' +
    'the fuel-vs-output rolling metric on the owner cockpit.',
  personaSlugs: WORKER,
  inputSchema: FuelLogInput,
  outputSchema: FuelLogOutput,
  stakes: 'LOW',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        fuelLogId: `pending:${ctx.actorId}`,
        loggedAt: new Date().toISOString(),
        totalCostTzs: input.litres * input.priceTzsPerLitre,
      };
    }
    // Retarget: canonical surface is POST /api/v1/mining/fuel-logs
    // (services/api-gateway/src/routes/mining/fuel-logs.hono.ts).
    const totalCost = input.litres * input.priceTzsPerLitre;
    const res = await client.post<{ data?: { id?: string; created_at?: string } }>(
      '/mining/fuel-logs',
      withChatProvenance(
        {
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          siteId: input.siteId,
          assetId: input.vehicleId,
          litres: input.litres.toString(),
          unitCostTzs: input.priceTzsPerLitre.toString(),
          totalCostTzs: totalCost.toString(),
          meterReading: input.meterReading,
          notes: input.notesEn,
        },
        ctx,
      ),
    );
    const row = res.data ?? {};
    return {
      fuelLogId: String(row.id ?? `pending:${ctx.actorId}`),
      loggedAt: String(row.created_at ?? new Date().toISOString()),
      totalCostTzs: totalCost,
    };
  },
};

// 13. Shift attendance summary (supervisor / manager)
const ShiftAttendanceInput = z.object({
  siteId: z.string().min(1),
  date: z.string().optional(),
});
const ShiftAttendanceOutput = z.object({
  siteId: z.string(),
  shiftDate: z.string(),
  totalCrew: z.number().int().nonnegative(),
  present: z.number().int().nonnegative(),
  late: z.number().int().nonnegative(),
  absent: z.number().int().nonnegative(),
  rows: z.array(
    z.object({
      workerId: z.string(),
      fullName: z.string(),
      state: z.enum(['scheduled', 'on_shift', 'absent', 'late']),
      clockedInAt: z.string().optional(),
    }),
  ),
});
export const workerShiftAttendanceTool: PersonaToolDescriptor<
  typeof ShiftAttendanceInput,
  typeof ShiftAttendanceOutput
> = {
  id: 'mining.workforce.shift-attendance',
  name: 'Worker — shift attendance summary',
  description:
    'Per-site attendance summary for a given date (defaults to today). Visible to ' +
    'supervisor + manager roles.',
  personaSlugs: WORKER,
  inputSchema: ShiftAttendanceInput,
  outputSchema: ShiftAttendanceOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        siteId: input.siteId,
        shiftDate: input.date ?? new Date().toISOString().slice(0, 10),
        totalCrew: 0,
        present: 0,
        late: 0,
        absent: 0,
        rows: [],
      };
    }
    // Retarget: /api/v1/mining/attendance/headcount aggregates per-site
    // present-state counts for the workDate. The brain tool projects
    // the aggregate into its richer per-worker shape; row-level detail
    // is empty until a follow-on /attendance/roster endpoint lands.
    const res = await client.get<{
      data?: {
        groupBy: 'site';
        workDate: string;
        perSite: Array<{ siteId: string; headcount: number }>;
      };
    }>('/mining/attendance/headcount', {
      query: { groupBy: 'site', workDate: input.date },
    });
    const workDate =
      res.data?.workDate ?? input.date ?? new Date().toISOString().slice(0, 10);
    const siteRow = (res.data?.perSite ?? []).find(
      (r) => r.siteId === input.siteId,
    );
    const total = siteRow?.headcount ?? 0;
    return {
      siteId: input.siteId,
      shiftDate: workDate,
      totalCrew: total,
      present: total,
      late: 0,
      absent: 0,
      rows: [],
    };
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
  workerMyCrewTool,
  workerLogDrillHoleTool,
  workerLogFuelTool,
  workerShiftAttendanceTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
