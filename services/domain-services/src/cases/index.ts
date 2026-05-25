import { randomHex } from '../common/id-generator.js';
/**
 * Cases domain service.
 *
 * Handles dispute and legal case management, including case lifecycle,
 * legal notices, evidence tracking, and resolution workflows.
 */

// Re-export infrastructure adapters so composition roots can pull both
// the domain service + live-Postgres repo + SLA worker from the same
// subpath import (`@borjie/domain-services/cases`). These were
// previously unreferenced by any consumer, leaving the production code
// paths unwired even though the classes existed.
export { PostgresCaseRepository } from './postgres-case-repository.js';
export type { PostgresCaseRepositoryClient } from './postgres-case-repository.js';
export {
  CaseSLAWorker,
  MAX_ESCALATION_LEVEL,
  SLA_SYSTEM_ACTOR,
} from './sla-worker.js';
export type {
  CaseSLAWorkerOptions,
  TickResult as CaseSLATickResult,
} from './sla-worker.js';

// Wave 26 — Agent Z2: expose the Sublease + Damage-Deduction sub-modules
// as namespaces so the composition root can reach their Postgres repos +
// services via `@borjie/domain-services/cases` → `Sublease.*` /
// `DamageDeduction.*`. Namespacing avoids collisions with the core Cases
// domain exports defined below.
export * as Sublease from './sublease/index.js';
export * as DamageDeduction from './damage-deduction/index.js';

import type { TenantId, UserId, PaginationParams, PaginatedResult, Result, ISOTimestamp } from '@borjie/domain-models';
import { ok, err } from '@borjie/domain-models';
import type { EventBus } from '../common/events.js';
import { createEventEnvelope, generateEventId } from '../common/events.js';
import { assertTransition, type CaseStatusValue } from './state-machine.js';
import type { CaseStatusChangedEvent } from './events.js';

// ============================================================================
// Types
// ============================================================================

export type CaseId = string & { readonly __brand: 'CaseId' };
export type NoticeId = string & { readonly __brand: 'NoticeId' };
export type EvidenceId = string & { readonly __brand: 'EvidenceId' };
export type CustomerId = string & { readonly __brand: 'CustomerId' };
export type LeaseId = string & { readonly __brand: 'LeaseId' };
export type PropertyId = string & { readonly __brand: 'PropertyId' };
export type UnitId = string & { readonly __brand: 'UnitId' };
export type InvoiceId = string & { readonly __brand: 'InvoiceId' };

export const asCaseId = (s: string): CaseId => s as CaseId;
export const asNoticeId = (s: string): NoticeId => s as NoticeId;
export const asEvidenceId = (s: string): EvidenceId => s as EvidenceId;

export type CaseStatus = 'OPEN' | 'IN_PROGRESS' | 'PENDING_RESPONSE' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';
export type CaseType = 'RENT_ARREARS' | 'DEPOSIT_DISPUTE' | 'PROPERTY_DAMAGE' | 'LEASE_VIOLATION' | 'NOISE_COMPLAINT' | 'MAINTENANCE_DISPUTE' | 'EVICTION' | 'OTHER';
export type CaseSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type NoticeType = 'REMINDER' | 'WARNING' | 'FINAL_NOTICE' | 'EVICTION_NOTICE' | 'LEGAL_SUMMONS';
export type NoticeChannel = 'EMAIL' | 'SMS' | 'WHATSAPP' | 'POSTAL';

export interface CaseTimelineEvent {
  readonly id: string;
  readonly type: string;
  readonly description: string;
  readonly metadata?: Record<string, unknown>;
  readonly createdAt: ISOTimestamp;
  readonly createdBy: UserId;
}

export interface CaseNotice {
  readonly id: NoticeId;
  readonly type: NoticeType;
  readonly title: string;
  readonly content: string;
  readonly sentAt?: ISOTimestamp;
  readonly sentVia?: readonly NoticeChannel[];
  readonly deliveryConfirmed?: boolean;
  readonly deliveryConfirmedAt?: ISOTimestamp;
  readonly createdAt: ISOTimestamp;
  readonly createdBy: UserId;
}

export interface CaseEvidence {
  readonly id: EvidenceId;
  readonly type: string;
  readonly name: string;
  readonly description?: string;
  readonly url: string;
  readonly mimeType?: string;
  readonly uploadedAt: ISOTimestamp;
  readonly uploadedBy: UserId;
}

export interface PaymentPlan {
  readonly installments: number;
  readonly amount: number;
  readonly currency: string;
  readonly frequency: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
  readonly startDate: ISOTimestamp;
}

export interface CaseResolution {
  readonly outcome: string;
  readonly summary: string;
  readonly agreedAmount?: number;
  readonly paymentPlan?: PaymentPlan;
  readonly terms?: string;
  readonly resolvedAt: ISOTimestamp;
  readonly resolvedBy: UserId;
}

export interface Case {
  readonly id: CaseId;
  readonly tenantId: TenantId;
  readonly caseNumber: string;
  readonly type: CaseType;
  readonly severity: CaseSeverity;
  readonly status: CaseStatus;
  readonly title: string;
  readonly description: string;
  readonly customerId: CustomerId;
  readonly leaseId?: LeaseId;
  readonly propertyId?: PropertyId;
  readonly unitId?: UnitId;
  readonly relatedInvoiceIds?: readonly InvoiceId[];
  readonly amountInDispute?: number;
  readonly currency?: string;
  readonly assignedTo?: UserId;
  readonly timeline: readonly CaseTimelineEvent[];
  readonly notices: readonly CaseNotice[];
  readonly evidence: readonly CaseEvidence[];
  readonly resolution?: CaseResolution;
  readonly escalatedAt?: ISOTimestamp;
  readonly escalationLevel: number;
  readonly dueDate?: ISOTimestamp;
  readonly closedAt?: ISOTimestamp;
  readonly closedBy?: UserId;
  readonly closureReason?: string;
  readonly createdAt: ISOTimestamp;
  readonly createdBy: UserId;
  readonly updatedAt: ISOTimestamp;
  readonly updatedBy: UserId;
}

// ============================================================================
// Error Types
// ============================================================================

export const CaseServiceError = {
  CASE_NOT_FOUND: 'CASE_NOT_FOUND',
  CASE_ALREADY_CLOSED: 'CASE_ALREADY_CLOSED',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  NOTICE_NOT_FOUND: 'NOTICE_NOT_FOUND',
  INVALID_CASE_DATA: 'INVALID_CASE_DATA',
  CUSTOMER_NOT_FOUND: 'CUSTOMER_NOT_FOUND',
  CANNOT_ESCALATE: 'CANNOT_ESCALATE',
  MAX_ESCALATION_REACHED: 'MAX_ESCALATION_REACHED',
} as const;

export type CaseServiceErrorCode = (typeof CaseServiceError)[keyof typeof CaseServiceError];

export interface CaseServiceErrorResult {
  code: CaseServiceErrorCode;
  message: string;
}

// ============================================================================
// Repository Interface
// ============================================================================

export interface CaseRepository {
  findById(id: CaseId, tenantId: TenantId): Promise<Case | null>;
  findByCaseNumber(caseNumber: string, tenantId: TenantId): Promise<Case | null>;
  findMany(tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Case>>;
  findByCustomer(customerId: CustomerId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Case>>;
  findByStatus(status: CaseStatus, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Case>>;
  findByType(type: CaseType, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Case>>;
  findBySeverity(severity: CaseSeverity, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Case>>;
  findByAssignee(assignedTo: UserId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Case>>;
  findByProperty(propertyId: PropertyId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Case>>;
  findOverdue(tenantId: TenantId): Promise<Case[]>;
  findEscalated(tenantId: TenantId): Promise<Case[]>;
  create(caseEntity: Case): Promise<Case>;
  update(caseEntity: Case): Promise<Case>;
  delete(id: CaseId, tenantId: TenantId, deletedBy: UserId): Promise<void>;
  getNextSequence(tenantId: TenantId): Promise<number>;
  countByStatus(tenantId: TenantId): Promise<Record<CaseStatus, number>>;
}

// ============================================================================
// Input Types
// ============================================================================

export interface CreateCaseInput {
  type: CaseType;
  severity?: CaseSeverity;
  title: string;
  description: string;
  customerId: CustomerId;
  leaseId?: LeaseId;
  propertyId?: PropertyId;
  unitId?: UnitId;
  relatedInvoiceIds?: InvoiceId[];
  amountInDispute?: number;
  currency?: string;
  assignedTo?: UserId;
  dueDate?: ISOTimestamp;
}

export interface UpdateCaseInput {
  title?: string;
  description?: string;
  severity?: CaseSeverity;
  assignedTo?: UserId;
  dueDate?: ISOTimestamp;
  amountInDispute?: number;
}

export interface AddTimelineEventInput {
  type: string;
  description: string;
  metadata?: Record<string, unknown>;
}

export interface CreateNoticeInput {
  type: NoticeType;
  title: string;
  content: string;
}

export interface SendNoticeInput {
  channels: NoticeChannel[];
}

export interface AddEvidenceInput {
  type: string;
  name: string;
  description?: string;
  url: string;
  mimeType?: string;
}

export interface ResolveCaseInput {
  outcome: string;
  summary: string;
  agreedAmount?: number;
  paymentPlan?: { installments: number; amount: number; frequency: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY'; startDate: ISOTimestamp };
  terms?: string;
}

// ============================================================================
// Domain Events
// ============================================================================

export interface CaseCreatedEvent {
  eventId: string;
  eventType: 'CaseCreated';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: { caseId: CaseId; caseNumber: string; type: CaseType; severity: CaseSeverity; customerId: CustomerId; amountInDispute?: number };
}

export interface CaseEscalatedEvent {
  eventId: string;
  eventType: 'CaseEscalated';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: { caseId: CaseId; caseNumber: string; escalationLevel: number; reason: string };
}

export interface CaseResolvedEvent {
  eventId: string;
  eventType: 'CaseResolved';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: { caseId: CaseId; caseNumber: string; outcome: string; agreedAmount?: number };
}

export interface NoticeSentEvent {
  eventId: string;
  eventType: 'NoticeSent';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: { caseId: CaseId; noticeId: NoticeId; noticeType: NoticeType; channels: NoticeChannel[] };
}

// ============================================================================
// Case Service Implementation
// ============================================================================

const MAX_ESCALATION_LEVEL = 3;

export class CaseService {
  constructor(private caseRepo: CaseRepository, private readonly eventBus: EventBus) {}

  /** Additive Wave 3 hook — attach the live Postgres repo at runtime. */
  attachRepository(repo: CaseRepository): void {
    this.caseRepo = repo;
  }

  async createCase(tenantId: TenantId, input: CreateCaseInput, createdBy: UserId, correlationId: string): Promise<Result<Case, CaseServiceErrorResult>> {
    if (!input.title || !input.description || !input.customerId) {
      return err({ code: CaseServiceError.INVALID_CASE_DATA, message: 'Title, description, and customer are required' });
    }

    const caseNumber = await this.generateCaseNumber(tenantId);
    const caseId = asCaseId(`case_${Date.now()}_${randomHex(4)}`);
    const now = new Date().toISOString() as ISOTimestamp;

    const newCase: Case = {
      id: caseId, tenantId, caseNumber, type: input.type, severity: input.severity || 'MEDIUM', status: 'OPEN',
      title: input.title, description: input.description, customerId: input.customerId,
      leaseId: input.leaseId, propertyId: input.propertyId, unitId: input.unitId,
      relatedInvoiceIds: input.relatedInvoiceIds, amountInDispute: input.amountInDispute,
      // Currency is resolved by the caller from tenant region-config; we
      // do not inject a TZS fallback which would hide cross-region bugs.
      currency: input.currency ?? '',
      assignedTo: input.assignedTo,
      timeline: [{ id: `event_${Date.now()}`, type: 'CASE_CREATED', description: `Case created: ${input.title}`, createdAt: now, createdBy }],
      notices: [], evidence: [], escalationLevel: 0, dueDate: input.dueDate,
      createdAt: now, createdBy, updatedAt: now, updatedBy: createdBy,
    };

    const savedCase = await this.caseRepo.create(newCase);

    const event: CaseCreatedEvent = {
      eventId: generateEventId(), eventType: 'CaseCreated', timestamp: now, tenantId, correlationId, causationId: null, metadata: {},
      payload: { caseId: savedCase.id, caseNumber: savedCase.caseNumber, type: savedCase.type, severity: savedCase.severity, customerId: savedCase.customerId, amountInDispute: savedCase.amountInDispute },
    };
    await this.eventBus.publish(createEventEnvelope(event, savedCase.id, 'Case'));

    return ok(savedCase);
  }

  async getCase(caseId: CaseId, tenantId: TenantId): Promise<Case | null> {
    return this.caseRepo.findById(caseId, tenantId);
  }

  async getCaseByNumber(caseNumber: string, tenantId: TenantId): Promise<Case | null> {
    return this.caseRepo.findByCaseNumber(caseNumber, tenantId);
  }

  async listCases(tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Case>> {
    return this.caseRepo.findMany(tenantId, pagination);
  }

  async listCasesByCustomer(customerId: CustomerId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Case>> {
    return this.caseRepo.findByCustomer(customerId, tenantId, pagination);
  }

  async listCasesByStatus(status: CaseStatus, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Case>> {
    return this.caseRepo.findByStatus(status, tenantId, pagination);
  }

  async getCaseStats(tenantId: TenantId): Promise<Record<CaseStatus, number>> {
    return this.caseRepo.countByStatus(tenantId);
  }

  async updateCase(caseId: CaseId, tenantId: TenantId, input: UpdateCaseInput, updatedBy: UserId, correlationId: string): Promise<Result<Case, CaseServiceErrorResult>> {
    const caseEntity = await this.caseRepo.findById(caseId, tenantId);
    if (!caseEntity) return err({ code: CaseServiceError.CASE_NOT_FOUND, message: 'Case not found' });
    if (caseEntity.status === 'CLOSED') return err({ code: CaseServiceError.CASE_ALREADY_CLOSED, message: 'Cannot update a closed case' });

    const now = new Date().toISOString() as ISOTimestamp;
    const updatedCase: Case = { ...caseEntity, ...input, updatedAt: now, updatedBy };
    const savedCase = await this.caseRepo.update(updatedCase);
    return ok(savedCase);
  }

  async addTimelineEvent(caseId: CaseId, tenantId: TenantId, input: AddTimelineEventInput, createdBy: UserId): Promise<Result<CaseTimelineEvent, CaseServiceErrorResult>> {
    const caseEntity = await this.caseRepo.findById(caseId, tenantId);
    if (!caseEntity) return err({ code: CaseServiceError.CASE_NOT_FOUND, message: 'Case not found' });

    const now = new Date().toISOString() as ISOTimestamp;
    const event: CaseTimelineEvent = { id: `event_${Date.now()}`, type: input.type, description: input.description, metadata: input.metadata, createdAt: now, createdBy };
    const updatedCase: Case = { ...caseEntity, timeline: [...caseEntity.timeline, event], updatedAt: now, updatedBy: createdBy };
    await this.caseRepo.update(updatedCase);
    return ok(event);
  }

  async createNotice(caseId: CaseId, tenantId: TenantId, input: CreateNoticeInput, createdBy: UserId): Promise<Result<CaseNotice, CaseServiceErrorResult>> {
    const caseEntity = await this.caseRepo.findById(caseId, tenantId);
    if (!caseEntity) return err({ code: CaseServiceError.CASE_NOT_FOUND, message: 'Case not found' });

    const now = new Date().toISOString() as ISOTimestamp;
    const notice: CaseNotice = { id: asNoticeId(`notice_${Date.now()}`), type: input.type, title: input.title, content: input.content, createdAt: now, createdBy };
    const timelineEvent: CaseTimelineEvent = { id: `event_${Date.now()}`, type: 'NOTICE_CREATED', description: `${input.type} notice created: ${input.title}`, createdAt: now, createdBy };
    const updatedCase: Case = { ...caseEntity, notices: [...caseEntity.notices, notice], timeline: [...caseEntity.timeline, timelineEvent], updatedAt: now, updatedBy: createdBy };
    await this.caseRepo.update(updatedCase);
    return ok(notice);
  }

  async sendNotice(caseId: CaseId, noticeId: NoticeId, tenantId: TenantId, input: SendNoticeInput, sentBy: UserId, correlationId: string): Promise<Result<CaseNotice, CaseServiceErrorResult>> {
    const caseEntity = await this.caseRepo.findById(caseId, tenantId);
    if (!caseEntity) return err({ code: CaseServiceError.CASE_NOT_FOUND, message: 'Case not found' });

    const noticeIdx = caseEntity.notices.findIndex(n => n.id === noticeId);
    if (noticeIdx < 0) return err({ code: CaseServiceError.NOTICE_NOT_FOUND, message: 'Notice not found' });

    const now = new Date().toISOString() as ISOTimestamp;
    const sentNotice: CaseNotice = { ...caseEntity.notices[noticeIdx], sentAt: now, sentVia: input.channels };
    const notices = [...caseEntity.notices];
    notices[noticeIdx] = sentNotice;

    const timelineEvent: CaseTimelineEvent = { id: `event_${Date.now()}`, type: 'NOTICE_SENT', description: `Notice sent via ${input.channels.join(', ')}: ${sentNotice.title}`, metadata: { channels: input.channels }, createdAt: now, createdBy: sentBy };
    const updatedCase: Case = { ...caseEntity, notices, timeline: [...caseEntity.timeline, timelineEvent], updatedAt: now, updatedBy: sentBy };
    await this.caseRepo.update(updatedCase);

    const event: NoticeSentEvent = {
      eventId: generateEventId(), eventType: 'NoticeSent', timestamp: now, tenantId, correlationId, causationId: null, metadata: {},
      payload: { caseId, noticeId, noticeType: sentNotice.type, channels: input.channels },
    };
    await this.eventBus.publish(createEventEnvelope(event, caseId, 'Case'));

    return ok(sentNotice);
  }

  async addEvidence(caseId: CaseId, tenantId: TenantId, input: AddEvidenceInput, uploadedBy: UserId): Promise<Result<CaseEvidence, CaseServiceErrorResult>> {
    const caseEntity = await this.caseRepo.findById(caseId, tenantId);
    if (!caseEntity) return err({ code: CaseServiceError.CASE_NOT_FOUND, message: 'Case not found' });

    const now = new Date().toISOString() as ISOTimestamp;
    const evidence: CaseEvidence = { id: asEvidenceId(`evidence_${Date.now()}`), type: input.type, name: input.name, description: input.description, url: input.url, mimeType: input.mimeType, uploadedAt: now, uploadedBy };
    const timelineEvent: CaseTimelineEvent = { id: `event_${Date.now()}`, type: 'EVIDENCE_ADDED', description: `Evidence added: ${input.name}`, createdAt: now, createdBy: uploadedBy };
    const updatedCase: Case = { ...caseEntity, evidence: [...caseEntity.evidence, evidence], timeline: [...caseEntity.timeline, timelineEvent], updatedAt: now, updatedBy: uploadedBy };
    await this.caseRepo.update(updatedCase);
    return ok(evidence);
  }

  async escalateCase(caseId: CaseId, tenantId: TenantId, reason: string, escalatedBy: UserId, correlationId: string): Promise<Result<Case, CaseServiceErrorResult>> {
    const caseEntity = await this.caseRepo.findById(caseId, tenantId);
    if (!caseEntity) return err({ code: CaseServiceError.CASE_NOT_FOUND, message: 'Case not found' });
    if (caseEntity.status === 'CLOSED' || caseEntity.status === 'RESOLVED') return err({ code: CaseServiceError.CANNOT_ESCALATE, message: 'Cannot escalate a closed or resolved case' });
    if (caseEntity.escalationLevel >= MAX_ESCALATION_LEVEL) return err({ code: CaseServiceError.MAX_ESCALATION_REACHED, message: 'Maximum escalation level reached' });

    const now = new Date().toISOString() as ISOTimestamp;
    const newLevel = caseEntity.escalationLevel + 1;
    const timelineEvent: CaseTimelineEvent = { id: `event_${Date.now()}`, type: 'CASE_ESCALATED', description: `Case escalated to level ${newLevel}: ${reason}`, metadata: { reason }, createdAt: now, createdBy: escalatedBy };
    const updatedCase: Case = { ...caseEntity, status: 'ESCALATED', escalatedAt: now, escalationLevel: newLevel, timeline: [...caseEntity.timeline, timelineEvent], updatedAt: now, updatedBy: escalatedBy };
    const savedCase = await this.caseRepo.update(updatedCase);

    const event: CaseEscalatedEvent = {
      eventId: generateEventId(), eventType: 'CaseEscalated', timestamp: now, tenantId, correlationId, causationId: null, metadata: {},
      payload: { caseId, caseNumber: savedCase.caseNumber, escalationLevel: newLevel, reason },
    };
    await this.eventBus.publish(createEventEnvelope(event, caseId, 'Case'));

    return ok(savedCase);
  }

  async resolveCase(caseId: CaseId, tenantId: TenantId, input: ResolveCaseInput, resolvedBy: UserId, correlationId: string): Promise<Result<Case, CaseServiceErrorResult>> {
    const caseEntity = await this.caseRepo.findById(caseId, tenantId);
    if (!caseEntity) return err({ code: CaseServiceError.CASE_NOT_FOUND, message: 'Case not found' });
    if (caseEntity.status === 'CLOSED') return err({ code: CaseServiceError.CASE_ALREADY_CLOSED, message: 'Case is already closed' });

    const now = new Date().toISOString() as ISOTimestamp;
    const resolution: CaseResolution = {
      outcome: input.outcome, summary: input.summary, agreedAmount: input.agreedAmount,
      // Inherit the case's currency so the payment plan cannot silently
      // ship TZS against a non-Tanzania tenant.
      paymentPlan: input.paymentPlan ? { ...input.paymentPlan, currency: caseEntity.currency ?? '' } : undefined,
      terms: input.terms, resolvedAt: now, resolvedBy,
    };
    const timelineEvent: CaseTimelineEvent = { id: `event_${Date.now()}`, type: 'CASE_RESOLVED', description: `Case resolved: ${input.outcome}`, metadata: { outcome: input.outcome, agreedAmount: input.agreedAmount }, createdAt: now, createdBy: resolvedBy };
    const updatedCase: Case = { ...caseEntity, status: 'RESOLVED', resolution, timeline: [...caseEntity.timeline, timelineEvent], updatedAt: now, updatedBy: resolvedBy };
    const savedCase = await this.caseRepo.update(updatedCase);

    const event: CaseResolvedEvent = {
      eventId: generateEventId(), eventType: 'CaseResolved', timestamp: now, tenantId, correlationId, causationId: null, metadata: {},
      payload: { caseId, caseNumber: savedCase.caseNumber, outcome: input.outcome, agreedAmount: input.agreedAmount },
    };
    await this.eventBus.publish(createEventEnvelope(event, caseId, 'Case'));

    return ok(savedCase);
  }

  async closeCase(caseId: CaseId, tenantId: TenantId, reason: string, closedBy: UserId): Promise<Result<Case, CaseServiceErrorResult>> {
    const caseEntity = await this.caseRepo.findById(caseId, tenantId);
    if (!caseEntity) return err({ code: CaseServiceError.CASE_NOT_FOUND, message: 'Case not found' });
    if (caseEntity.status === 'CLOSED') return err({ code: CaseServiceError.CASE_ALREADY_CLOSED, message: 'Case is already closed' });

    const now = new Date().toISOString() as ISOTimestamp;
    const timelineEvent: CaseTimelineEvent = { id: `event_${Date.now()}`, type: 'CASE_CLOSED', description: `Case closed: ${reason}`, createdAt: now, createdBy: closedBy };
    const updatedCase: Case = { ...caseEntity, status: 'CLOSED', closedAt: now, closedBy, closureReason: reason, timeline: [...caseEntity.timeline, timelineEvent], updatedAt: now, updatedBy: closedBy };
    const savedCase = await this.caseRepo.update(updatedCase);
    return ok(savedCase);
  }

  async generateEvidencePack(caseId: CaseId, tenantId: TenantId): Promise<Result<object, CaseServiceErrorResult>> {
    const caseEntity = await this.caseRepo.findById(caseId, tenantId);
    if (!caseEntity) return err({ code: CaseServiceError.CASE_NOT_FOUND, message: 'Case not found' });

    const evidencePack = {
      caseNumber: caseEntity.caseNumber,
      generatedAt: new Date().toISOString(),
      summary: { type: caseEntity.type, severity: caseEntity.severity, status: caseEntity.status, title: caseEntity.title, description: caseEntity.description, amountInDispute: caseEntity.amountInDispute, currency: caseEntity.currency },
      timeline: caseEntity.timeline,
      notices: caseEntity.notices,
      evidence: caseEntity.evidence,
      resolution: caseEntity.resolution,
    };
    return ok(evidencePack);
  }

  /**
   * transitionCase — state-machine-guarded status change.
   *
   * Additive method (SCAFFOLDED_COMPLETION.md §3). Does NOT replace
   * the existing escalateCase/resolveCase/closeCase methods; those
   * remain the canonical path for their respective side effects
   * (escalation level bumps, resolution payload, closure reason).
   *
   * Use this method for intermediate transitions, e.g.
   * OPEN -> IN_PROGRESS, IN_PROGRESS -> PENDING_RESPONSE.
   */
  async transitionCase(
    caseId: CaseId,
    tenantId: TenantId,
    nextStatus: CaseStatusValue,
    reason: string,
    actor: UserId,
    correlationId?: string
  ): Promise<Result<Case, CaseServiceErrorResult>> {
    const caseEntity = await this.caseRepo.findById(caseId, tenantId);
    if (!caseEntity) {
      return err({ code: CaseServiceError.CASE_NOT_FOUND, message: 'Case not found' });
    }

    const currentStatus = caseEntity.status as CaseStatusValue;
    const check = assertTransition(currentStatus, nextStatus);
    if (!check.success) {
      return err({
        code: CaseServiceError.INVALID_STATUS_TRANSITION,
        message: check.error.message,
      });
    }

    const now = new Date().toISOString() as ISOTimestamp;
    const timelineEvent: CaseTimelineEvent = {
      id: `event_${Date.now()}`,
      type: 'STATUS_CHANGED',
      description: `Status changed ${currentStatus} -> ${nextStatus}: ${reason}`,
      metadata: { from: currentStatus, to: nextStatus, reason },
      createdAt: now,
      createdBy: actor,
    };

    const updatedCase: Case = {
      ...caseEntity,
      status: nextStatus as CaseStatus,
      timeline: [...caseEntity.timeline, timelineEvent],
      updatedAt: now,
      updatedBy: actor,
    };
    const savedCase = await this.caseRepo.update(updatedCase);

    const event: CaseStatusChangedEvent = {
      eventId: generateEventId(),
      eventType: 'CaseStatusChanged',
      timestamp: now,
      tenantId,
      correlationId: correlationId ?? generateEventId(),
      causationId: null,
      metadata: {},
      payload: {
        caseId: savedCase.id,
        caseNumber: savedCase.caseNumber,
        from: currentStatus,
        to: nextStatus,
        reason,
        actor,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, savedCase.id, 'Case'));

    return ok(savedCase);
  }

  private async generateCaseNumber(tenantId: TenantId): Promise<string> {
    const sequence = await this.caseRepo.getNextSequence(tenantId);
    const year = new Date().getFullYear();
    return `CASE-${year}-${String(sequence).padStart(3, '0')}`;
  }
}
