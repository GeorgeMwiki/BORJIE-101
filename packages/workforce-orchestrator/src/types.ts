/**
 * Piece M — Zod schemas + TypeScript types for the 9 workforce tables.
 *
 * Mirrors migrations 0241_employees.sql .. 0249_workforce_kpis.sql plus
 * 0250_workforce_indexes.sql (no schema change in 0250).
 *
 * All schemas are immutable: every "update" produces a new object via
 * spread. Caller-driven transitions return fresh objects; the DAL is the
 * only consumer that mutates rows.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────
// Shared enums (TEXT in PG; literal unions in TS for forward-compat).
// ─────────────────────────────────────────────────────────────────────────

export const EmployeeStatusEnum = z.enum(['active', 'on_leave', 'terminated']);
export type EmployeeStatus = z.infer<typeof EmployeeStatusEnum>;

export const DefaultChannelEnum = z.enum(['web', 'mobile', 'whatsapp', 'sms']);
export type DefaultChannel = z.infer<typeof DefaultChannelEnum>;

export const PriorityEnum = z.enum(['low', 'medium', 'high', 'urgent']);
export type Priority = z.infer<typeof PriorityEnum>;

export const AssignmentStatusEnum = z.enum([
  'pending',
  'in_progress',
  'blocked',
  'completed',
  'cancelled',
]);
export type AssignmentStatus = z.infer<typeof AssignmentStatusEnum>;

export const RiskTierEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'SOVEREIGN']);
export type RiskTier = z.infer<typeof RiskTierEnum>;

export const CadenceKindEnum = z.enum([
  'daily',
  'mid_week',
  'end_of_week',
  'one_shot',
]);
export type CadenceKind = z.infer<typeof CadenceKindEnum>;

export const FollowupStatusEnum = z.enum([
  'pending',
  'sent',
  'responded',
  'missed',
]);
export type FollowupStatus = z.infer<typeof FollowupStatusEnum>;

export const ResponseKindEnum = z.enum([
  'progress_update',
  'blocker',
  'completed',
  'request_extension',
  'no_response',
]);
export type ResponseKind = z.infer<typeof ResponseKindEnum>;

export const SignalKindEnum = z.enum([
  'on_time_completion',
  'missed_deadline',
  'repeated_blocker',
  'exceptional_work',
  'positive_sentiment',
  'negative_sentiment',
]);
export type SignalKind = z.infer<typeof SignalKindEnum>;

export const SignalSourceKindEnum = z.enum([
  'check_in',
  'audit_event',
  'manual',
  'ai_observation',
]);
export type SignalSourceKind = z.infer<typeof SignalSourceKindEnum>;

export const SkillSourceKindEnum = z.enum([
  'self_rated',
  'manager_rated',
  'ai_inferred',
]);
export type SkillSourceKind = z.infer<typeof SkillSourceKindEnum>;

export const CoachingTriggerKindEnum = z.enum([
  'repeated_blocker',
  'missed_deadline',
  'mastery_milestone',
  'low_sentiment',
  'exceptional_recognition',
]);
export type CoachingTriggerKind = z.infer<typeof CoachingTriggerKindEnum>;

export const CoachingStatusEnum = z.enum([
  'pending',
  'sent',
  'read',
  'dismissed',
]);
export type CoachingStatus = z.infer<typeof CoachingStatusEnum>;

export const SeverityEnum = z.enum(['low', 'medium', 'high', 'critical']);
export type Severity = z.infer<typeof SeverityEnum>;

// ─────────────────────────────────────────────────────────────────────────
// employees (0241)
// ─────────────────────────────────────────────────────────────────────────

export const EmployeeSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  personEntityId: z.string().min(1),
  titleId: z.string().nullable().optional(),
  employeeCode: z.string().nullable().optional(),
  hiredAt: z.string().nullable().optional(), // ISO date
  status: EmployeeStatusEnum.default('active'),
  managerEmployeeId: z.string().nullable().optional(),
  defaultChannel: DefaultChannelEnum.default('web'),
  createdAt: z.string().optional(),
});

export type Employee = z.infer<typeof EmployeeSchema>;

// ─────────────────────────────────────────────────────────────────────────
// work_assignments (0242)
// ─────────────────────────────────────────────────────────────────────────

export const WorkAssignmentSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  missionId: z.string().nullable().optional(),
  title: z.string().min(1).max(500),
  description: z.string().min(1),
  assignedEmployeeId: z.string().min(1),
  assignedByUserId: z.string().min(1),
  priority: PriorityEnum.default('medium'),
  dueAt: z.string().nullable().optional(),
  estimatedEffortHours: z.number().nonnegative().nullable().optional(),
  status: AssignmentStatusEnum.default('pending'),
  riskTier: RiskTierEnum.default('LOW'),
  hitlRequired: z.boolean().default(false),
  assetRefs: z.array(z.string()).default([]),
  createdByPersonaId: z.string().nullable().optional(),
  auditChainId: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  completedAt: z.string().nullable().optional(),
});

export type WorkAssignment = z.infer<typeof WorkAssignmentSchema>;

// ─────────────────────────────────────────────────────────────────────────
// work_followups (0243)
// ─────────────────────────────────────────────────────────────────────────

export const WorkFollowupSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  assignmentId: z.string().min(1),
  scheduledAt: z.string(),
  cadenceKind: CadenceKindEnum,
  channel: z.string().default('whatsapp'),
  status: FollowupStatusEnum.default('pending'),
  createdAt: z.string().optional(),
});

export type WorkFollowup = z.infer<typeof WorkFollowupSchema>;

// ─────────────────────────────────────────────────────────────────────────
// work_check_ins (0244)
// ─────────────────────────────────────────────────────────────────────────

export const CheckInAttachmentSchema = z.object({
  kind: z.string(),
  url: z.string(),
  mime: z.string().optional(),
});

export type CheckInAttachment = z.infer<typeof CheckInAttachmentSchema>;

export const WorkCheckInSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  assignmentId: z.string().min(1),
  followupId: z.string().nullable().optional(),
  employeeId: z.string().min(1),
  responseKind: ResponseKindEnum,
  responseText: z.string().nullable().optional(),
  attachmentsJsonb: z.array(CheckInAttachmentSchema).default([]),
  sentimentScore: z.number().min(-1).max(1).nullable().optional(),
  createdAt: z.string().optional(),
});

export type WorkCheckIn = z.infer<typeof WorkCheckInSchema>;

// ─────────────────────────────────────────────────────────────────────────
// performance_signals (0245)
// ─────────────────────────────────────────────────────────────────────────

export const PerformanceSignalSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  employeeId: z.string().min(1),
  signalKind: SignalKindEnum,
  weight: z.number().default(1.0),
  contextJsonb: z.record(z.unknown()).default({}),
  sourceKind: SignalSourceKindEnum,
  sourceRef: z.string().nullable().optional(),
  createdAt: z.string().optional(),
});

export type PerformanceSignal = z.infer<typeof PerformanceSignalSchema>;

// ─────────────────────────────────────────────────────────────────────────
// advisory_briefs (0246)
// ─────────────────────────────────────────────────────────────────────────

export const AdvisoryGapSchema = z.object({
  title: z.string().min(1),
  severity: SeverityEnum,
  evidenceRefs: z.array(z.string()).default([]),
});
export type AdvisoryGap = z.infer<typeof AdvisoryGapSchema>;

export const AdvisoryOpportunitySchema = z.object({
  title: z.string().min(1),
  severity: SeverityEnum,
  evidenceRefs: z.array(z.string()).default([]),
});
export type AdvisoryOpportunity = z.infer<typeof AdvisoryOpportunitySchema>;

export const AdvisoryActionSchema = z.object({
  title: z.string().min(1),
  severity: SeverityEnum,
  expectedImpact: z.string().optional(),
  ownerPersonaId: z.string().nullable().optional(),
});
export type AdvisoryAction = z.infer<typeof AdvisoryActionSchema>;

export const AdvisoryCitationSchema = z.object({
  sourceKind: z.string(),
  sourceRef: z.string(),
  snippet: z.string().optional(),
});
export type AdvisoryCitation = z.infer<typeof AdvisoryCitationSchema>;

export const AdvisoryBriefSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  audiencePersonaId: z.string().nullable().optional(),
  periodStart: z.string(),
  periodEnd: z.string(),
  overallScore: z.number().min(0).max(100).nullable().optional(),
  gapsJsonb: z.array(AdvisoryGapSchema).default([]),
  opportunitiesJsonb: z.array(AdvisoryOpportunitySchema).default([]),
  recommendedActionsJsonb: z.array(AdvisoryActionSchema).default([]),
  citationsJsonb: z.array(AdvisoryCitationSchema).default([]),
  generatedAt: z.string().optional(),
  auditChainId: z.string().nullable().optional(),
});

export type AdvisoryBrief = z.infer<typeof AdvisoryBriefSchema>;

// ─────────────────────────────────────────────────────────────────────────
// skill_assessments (0247)
// ─────────────────────────────────────────────────────────────────────────

export const SkillAssessmentSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  employeeId: z.string().min(1),
  skillSlug: z.string().min(1),
  proficiencyScore: z.number().min(0).max(1),
  lastAssessedAt: z.string().optional(),
  sourceKind: SkillSourceKindEnum.default('ai_inferred'),
});

export type SkillAssessment = z.infer<typeof SkillAssessmentSchema>;

// ─────────────────────────────────────────────────────────────────────────
// coaching_prompts (0248)
// ─────────────────────────────────────────────────────────────────────────

export const CoachingPromptSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  employeeId: z.string().min(1),
  triggerKind: CoachingTriggerKindEnum,
  promptText: z.string().min(1),
  status: CoachingStatusEnum.default('pending'),
  sentAt: z.string().nullable().optional(),
  createdAt: z.string().optional(),
});

export type CoachingPrompt = z.infer<typeof CoachingPromptSchema>;

// ─────────────────────────────────────────────────────────────────────────
// workforce_kpis (0249)
// ─────────────────────────────────────────────────────────────────────────

export const WorkforceKpiSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  day: z.string(),
  totalAssignments: z.number().int().nonnegative().default(0),
  completedOnTime: z.number().int().nonnegative().default(0),
  overdue: z.number().int().nonnegative().default(0),
  blockersOpen: z.number().int().nonnegative().default(0),
  avgCompletionHours: z.number().nonnegative().nullable().optional(),
});

export type WorkforceKpi = z.infer<typeof WorkforceKpiSchema>;

// ─────────────────────────────────────────────────────────────────────────
// DAL / port surface — every package consumer wires these.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Storage port. The orchestrator never reads from DB directly; every
 * write/read goes through this surface so a test in-memory store +
 * a production Drizzle adapter can both implement it.
 */
export interface WorkforceStore {
  insertEmployee(row: Employee): Promise<Employee>;
  getEmployee(tenantId: string, id: string): Promise<Employee | null>;
  listEmployeesForManager(tenantId: string, managerId: string): Promise<Employee[]>;

  insertAssignment(row: WorkAssignment): Promise<WorkAssignment>;
  getAssignment(tenantId: string, id: string): Promise<WorkAssignment | null>;
  updateAssignment(row: WorkAssignment): Promise<WorkAssignment>;
  listOverdueAssignments(tenantId: string, now: Date): Promise<WorkAssignment[]>;
  listBlockedAssignments(tenantId: string, olderThan: Date): Promise<WorkAssignment[]>;
  listAssignmentsForEmployee(
    tenantId: string,
    employeeId: string,
    statuses?: ReadonlyArray<AssignmentStatus>
  ): Promise<WorkAssignment[]>;

  insertFollowup(row: WorkFollowup): Promise<WorkFollowup>;
  updateFollowup(row: WorkFollowup): Promise<WorkFollowup>;
  listDueFollowups(tenantId: string, now: Date): Promise<WorkFollowup[]>;
  listFollowupsForAssignment(tenantId: string, assignmentId: string): Promise<WorkFollowup[]>;

  insertCheckIn(row: WorkCheckIn): Promise<WorkCheckIn>;
  updateCheckIn(row: WorkCheckIn): Promise<WorkCheckIn>;
  listCheckInsForAssignment(tenantId: string, assignmentId: string): Promise<WorkCheckIn[]>;
  listCheckInsForEmployee(
    tenantId: string,
    employeeId: string,
    since?: Date
  ): Promise<WorkCheckIn[]>;

  insertSignal(row: PerformanceSignal): Promise<PerformanceSignal>;
  listSignalsForEmployee(
    tenantId: string,
    employeeId: string,
    since?: Date
  ): Promise<PerformanceSignal[]>;

  insertAdvisoryBrief(row: AdvisoryBrief): Promise<AdvisoryBrief>;
  latestAdvisoryBrief(
    tenantId: string,
    audiencePersonaId: string | null
  ): Promise<AdvisoryBrief | null>;

  upsertSkillAssessment(row: SkillAssessment): Promise<SkillAssessment>;
  listSkillsForEmployee(tenantId: string, employeeId: string): Promise<SkillAssessment[]>;

  insertCoachingPrompt(row: CoachingPrompt): Promise<CoachingPrompt>;
  updateCoachingPrompt(row: CoachingPrompt): Promise<CoachingPrompt>;
  listPendingCoachingPrompts(tenantId: string, employeeId: string): Promise<CoachingPrompt[]>;

  upsertKpi(row: WorkforceKpi): Promise<WorkforceKpi>;
  getKpiForDay(tenantId: string, day: string): Promise<WorkforceKpi | null>;
}

/**
 * Channel adapter — the notifications-service port the orchestrator uses.
 * In production, wire to services/notifications dispatchers. In tests, an
 * in-memory implementation suffices.
 */
export interface ChannelAdapter {
  send(args: {
    tenantId: string;
    employeeId: string;
    channel: string;
    template: string;
    payload: Record<string, unknown>;
  }): Promise<{ delivered: boolean; messageId?: string }>;
}

/**
 * Audit chain port — kernel writes ai_audit_chain. Returns the new
 * chain row id so the caller can stamp it onto domain rows.
 */
export interface AuditChain {
  append(args: {
    tenantId: string;
    action: string;
    payload: Record<string, unknown>;
    sessionId?: string;
    turnId?: string;
  }): Promise<{ chainId: string }>;
}

/**
 * Content generator port — kernel (Haiku-cascade) writes coaching text
 * + advisory brief content. In tests, a deterministic stub.
 */
export interface ContentGenerator {
  generateCoaching(args: {
    tenantId: string;
    employee: Employee;
    triggerKind: CoachingTriggerKind;
    recentSignals: PerformanceSignal[];
  }): Promise<{ text: string }>;
  inferSentiment(args: { text: string }): Promise<{ score: number }>;
  draftAdvisoryBrief(args: {
    tenantId: string;
    periodStart: string;
    periodEnd: string;
    kpis: WorkforceKpi[];
    signals: PerformanceSignal[];
  }): Promise<{
    gaps: AdvisoryGap[];
    opportunities: AdvisoryOpportunity[];
    recommendedActions: AdvisoryAction[];
    citations: AdvisoryCitation[];
    overallScore: number;
  }>;
}

/**
 * Ticket port — escalation creates a T3-manager ticket via Pieces D+F's
 * tickets table. Soft pointer; the adapter is wired at composition
 * root. In tests, an in-memory stub.
 */
export interface TicketCreator {
  createTicket(args: {
    tenantId: string;
    title: string;
    description: string;
    assigneeUserId: string;
    severity: Severity;
    sourceRef: string;
  }): Promise<{ ticketId: string }>;
}

/**
 * Composite dependency bundle. Every orchestrator entrypoint takes
 * exactly this shape so wiring is explicit and tests trivially swap
 * any port.
 */
export interface WorkforceDeps {
  store: WorkforceStore;
  channel: ChannelAdapter;
  audit: AuditChain;
  content: ContentGenerator;
  tickets: TicketCreator;
  clock: () => Date;
  uuid: () => string;
}
