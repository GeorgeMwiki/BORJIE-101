/**
 * Test fixtures — in-memory implementations of every port.
 *
 * Each store is intentionally simple: arrays + filters. The same shape
 * a production Drizzle adapter must satisfy.
 */

import type {
  AdvisoryAction,
  AdvisoryBrief,
  AdvisoryCitation,
  AdvisoryGap,
  AdvisoryOpportunity,
  AssignmentStatus,
  AuditChain,
  ChannelAdapter,
  CoachingPrompt,
  ContentGenerator,
  Employee,
  PerformanceSignal,
  SkillAssessment,
  TicketCreator,
  WorkAssignment,
  WorkCheckIn,
  WorkFollowup,
  WorkforceDeps,
  WorkforceKpi,
  WorkforceStore,
} from '../types.js';

export class InMemoryStore implements WorkforceStore {
  employees: Employee[] = [];
  assignments: WorkAssignment[] = [];
  followups: WorkFollowup[] = [];
  checkIns: WorkCheckIn[] = [];
  signals: PerformanceSignal[] = [];
  briefs: AdvisoryBrief[] = [];
  skills: SkillAssessment[] = [];
  coaching: CoachingPrompt[] = [];
  kpis: WorkforceKpi[] = [];

  async insertEmployee(row: Employee): Promise<Employee> {
    this.employees = [...this.employees, row];
    return row;
  }
  async getEmployee(tenantId: string, id: string): Promise<Employee | null> {
    return (
      this.employees.find((e) => e.tenantId === tenantId && e.id === id) ?? null
    );
  }
  async listEmployeesForManager(tenantId: string, managerId: string): Promise<Employee[]> {
    return this.employees.filter(
      (e) => e.tenantId === tenantId && e.managerEmployeeId === managerId
    );
  }

  async insertAssignment(row: WorkAssignment): Promise<WorkAssignment> {
    this.assignments = [...this.assignments, row];
    return row;
  }
  async getAssignment(tenantId: string, id: string): Promise<WorkAssignment | null> {
    return (
      this.assignments.find((a) => a.tenantId === tenantId && a.id === id) ?? null
    );
  }
  async updateAssignment(row: WorkAssignment): Promise<WorkAssignment> {
    this.assignments = this.assignments.map((a) =>
      a.tenantId === row.tenantId && a.id === row.id ? row : a
    );
    return row;
  }
  async listOverdueAssignments(tenantId: string, now: Date): Promise<WorkAssignment[]> {
    return this.assignments.filter(
      (a) =>
        a.tenantId === tenantId &&
        (a.status === 'pending' || a.status === 'in_progress') &&
        a.dueAt !== null &&
        a.dueAt !== undefined &&
        new Date(a.dueAt).getTime() < now.getTime()
    );
  }
  async listBlockedAssignments(tenantId: string, olderThan: Date): Promise<WorkAssignment[]> {
    return this.assignments.filter(
      (a) =>
        a.tenantId === tenantId &&
        a.status === 'blocked' &&
        a.updatedAt !== undefined &&
        new Date(a.updatedAt).getTime() <= olderThan.getTime()
    );
  }
  async listAssignmentsForEmployee(
    tenantId: string,
    employeeId: string,
    statuses?: ReadonlyArray<AssignmentStatus>
  ): Promise<WorkAssignment[]> {
    return this.assignments.filter(
      (a) =>
        a.tenantId === tenantId &&
        a.assignedEmployeeId === employeeId &&
        (!statuses || statuses.includes(a.status))
    );
  }

  async insertFollowup(row: WorkFollowup): Promise<WorkFollowup> {
    this.followups = [...this.followups, row];
    return row;
  }
  async updateFollowup(row: WorkFollowup): Promise<WorkFollowup> {
    this.followups = this.followups.map((f) =>
      f.tenantId === row.tenantId && f.id === row.id ? row : f
    );
    return row;
  }
  async listDueFollowups(tenantId: string, now: Date): Promise<WorkFollowup[]> {
    return this.followups.filter(
      (f) =>
        f.tenantId === tenantId &&
        f.status === 'pending' &&
        new Date(f.scheduledAt).getTime() <= now.getTime()
    );
  }
  async listFollowupsForAssignment(
    tenantId: string,
    assignmentId: string
  ): Promise<WorkFollowup[]> {
    return this.followups.filter(
      (f) => f.tenantId === tenantId && f.assignmentId === assignmentId
    );
  }

  async insertCheckIn(row: WorkCheckIn): Promise<WorkCheckIn> {
    this.checkIns = [...this.checkIns, row];
    return row;
  }
  async updateCheckIn(row: WorkCheckIn): Promise<WorkCheckIn> {
    this.checkIns = this.checkIns.map((c) =>
      c.tenantId === row.tenantId && c.id === row.id ? row : c
    );
    return row;
  }
  async listCheckInsForAssignment(tenantId: string, assignmentId: string): Promise<WorkCheckIn[]> {
    return this.checkIns.filter(
      (c) => c.tenantId === tenantId && c.assignmentId === assignmentId
    );
  }
  async listCheckInsForEmployee(
    tenantId: string,
    employeeId: string,
    since?: Date
  ): Promise<WorkCheckIn[]> {
    return this.checkIns.filter(
      (c) =>
        c.tenantId === tenantId &&
        c.employeeId === employeeId &&
        (!since ||
          (c.createdAt !== undefined && new Date(c.createdAt).getTime() >= since.getTime()))
    );
  }

  async insertSignal(row: PerformanceSignal): Promise<PerformanceSignal> {
    this.signals = [...this.signals, row];
    return row;
  }
  async listSignalsForEmployee(
    tenantId: string,
    employeeId: string,
    since?: Date
  ): Promise<PerformanceSignal[]> {
    // Convention: employeeId === '__all__' returns all signals for the
    // tenant. Used by the advisory-brief engine.
    return this.signals.filter(
      (s) =>
        s.tenantId === tenantId &&
        (employeeId === '__all__' || s.employeeId === employeeId) &&
        (!since ||
          (s.createdAt !== undefined && new Date(s.createdAt).getTime() >= since.getTime()))
    );
  }

  async insertAdvisoryBrief(row: AdvisoryBrief): Promise<AdvisoryBrief> {
    this.briefs = [...this.briefs, row];
    return row;
  }
  async latestAdvisoryBrief(
    tenantId: string,
    audiencePersonaId: string | null
  ): Promise<AdvisoryBrief | null> {
    const candidates = this.briefs.filter(
      (b) => b.tenantId === tenantId && (b.audiencePersonaId ?? null) === audiencePersonaId
    );
    return candidates.length
      ? candidates.reduce((a, b) => (a.periodEnd > b.periodEnd ? a : b))
      : null;
  }

  async upsertSkillAssessment(row: SkillAssessment): Promise<SkillAssessment> {
    const idx = this.skills.findIndex(
      (s) =>
        s.tenantId === row.tenantId &&
        s.employeeId === row.employeeId &&
        s.skillSlug === row.skillSlug
    );
    if (idx === -1) {
      this.skills = [...this.skills, row];
    } else {
      this.skills = this.skills.map((s, i) => (i === idx ? row : s));
    }
    return row;
  }
  async listSkillsForEmployee(tenantId: string, employeeId: string): Promise<SkillAssessment[]> {
    return this.skills.filter((s) => s.tenantId === tenantId && s.employeeId === employeeId);
  }

  async insertCoachingPrompt(row: CoachingPrompt): Promise<CoachingPrompt> {
    this.coaching = [...this.coaching, row];
    return row;
  }
  async updateCoachingPrompt(row: CoachingPrompt): Promise<CoachingPrompt> {
    this.coaching = this.coaching.map((c) =>
      c.tenantId === row.tenantId && c.id === row.id ? row : c
    );
    return row;
  }
  async listPendingCoachingPrompts(tenantId: string, employeeId: string): Promise<CoachingPrompt[]> {
    return this.coaching.filter(
      (c) =>
        c.tenantId === tenantId &&
        c.employeeId === employeeId &&
        c.status === 'pending'
    );
  }

  async upsertKpi(row: WorkforceKpi): Promise<WorkforceKpi> {
    const idx = this.kpis.findIndex(
      (k) => k.tenantId === row.tenantId && k.day === row.day
    );
    if (idx === -1) {
      this.kpis = [...this.kpis, row];
    } else {
      this.kpis = this.kpis.map((k, i) => (i === idx ? row : k));
    }
    return row;
  }
  async getKpiForDay(tenantId: string, day: string): Promise<WorkforceKpi | null> {
    return this.kpis.find((k) => k.tenantId === tenantId && k.day === day) ?? null;
  }
}

export class CapturedChannel implements ChannelAdapter {
  sent: Array<{
    tenantId: string;
    employeeId: string;
    channel: string;
    template: string;
    payload: Record<string, unknown>;
  }> = [];

  async send(args: {
    tenantId: string;
    employeeId: string;
    channel: string;
    template: string;
    payload: Record<string, unknown>;
  }): Promise<{ delivered: boolean; messageId?: string }> {
    this.sent = [...this.sent, args];
    return { delivered: true, messageId: `msg-${this.sent.length}` };
  }
}

export class FailingChannel implements ChannelAdapter {
  async send(): Promise<{ delivered: boolean; messageId?: string }> {
    throw new Error('channel adapter intentionally failing');
  }
}

export class StubAudit implements AuditChain {
  appended: Array<{ tenantId: string; action: string; payload: Record<string, unknown> }> = [];
  async append(args: {
    tenantId: string;
    action: string;
    payload: Record<string, unknown>;
  }): Promise<{ chainId: string }> {
    this.appended = [...this.appended, args];
    return { chainId: `chain-${this.appended.length}` };
  }
}

export class StubContent implements ContentGenerator {
  coachingText: string = 'Stub coaching prompt.';
  sentimentScore: number = 0;
  advisoryDraft: {
    gaps: AdvisoryGap[];
    opportunities: AdvisoryOpportunity[];
    recommendedActions: AdvisoryAction[];
    citations: AdvisoryCitation[];
    overallScore: number;
  } = {
    gaps: [],
    opportunities: [],
    recommendedActions: [],
    citations: [],
    overallScore: 50,
  };

  async generateCoaching(): Promise<{ text: string }> {
    return { text: this.coachingText };
  }
  async inferSentiment(): Promise<{ score: number }> {
    return { score: this.sentimentScore };
  }
  async draftAdvisoryBrief(): Promise<{
    gaps: AdvisoryGap[];
    opportunities: AdvisoryOpportunity[];
    recommendedActions: AdvisoryAction[];
    citations: AdvisoryCitation[];
    overallScore: number;
  }> {
    return this.advisoryDraft;
  }
}

export class CapturedTickets implements TicketCreator {
  created: Array<{
    tenantId: string;
    title: string;
    description: string;
    assigneeUserId: string;
    severity: string;
    sourceRef: string;
    ticketId: string;
  }> = [];

  async createTicket(args: {
    tenantId: string;
    title: string;
    description: string;
    assigneeUserId: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    sourceRef: string;
  }): Promise<{ ticketId: string }> {
    const ticketId = `tkt-${this.created.length + 1}`;
    this.created = [...this.created, { ...args, ticketId }];
    return { ticketId };
  }
}

export interface FixtureBundle {
  deps: WorkforceDeps;
  store: InMemoryStore;
  channel: CapturedChannel;
  audit: StubAudit;
  content: StubContent;
  tickets: CapturedTickets;
  setClock: (d: Date) => void;
}

export function makeFixture(initial: { nowIso?: string } = {}): FixtureBundle {
  const store = new InMemoryStore();
  const channel = new CapturedChannel();
  const audit = new StubAudit();
  const content = new StubContent();
  const tickets = new CapturedTickets();

  let nowMs = initial.nowIso ? new Date(initial.nowIso).getTime() : Date.parse('2026-05-22T08:00:00Z');
  let counter = 0;

  const deps: WorkforceDeps = {
    store,
    channel,
    audit,
    content,
    tickets,
    clock: () => new Date(nowMs),
    uuid: () => {
      counter += 1;
      return `id-${counter}`;
    },
  };

  return {
    deps,
    store,
    channel,
    audit,
    content,
    tickets,
    setClock: (d: Date) => {
      nowMs = d.getTime();
    },
  };
}

export function seedEmployee(
  store: InMemoryStore,
  partial: Partial<Employee> & Pick<Employee, 'id' | 'tenantId' | 'personEntityId'>
): Employee {
  const row: Employee = {
    id: partial.id,
    tenantId: partial.tenantId,
    personEntityId: partial.personEntityId,
    titleId: partial.titleId ?? null,
    employeeCode: partial.employeeCode ?? null,
    hiredAt: partial.hiredAt ?? null,
    status: partial.status ?? 'active',
    managerEmployeeId: partial.managerEmployeeId ?? null,
    defaultChannel: partial.defaultChannel ?? 'whatsapp',
    createdAt: partial.createdAt ?? '2026-01-01T00:00:00Z',
  };
  // Stuff straight in (skip RLS / async machinery).
  store.employees = [...store.employees, row];
  return row;
}
