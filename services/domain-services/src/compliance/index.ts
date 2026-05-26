import { randomHex } from '../common/id-generator.js';
/**
 * Compliance/Legal Service
 * Handles compliance items (lease expiry, license renewal, insurance, safety inspection, tax filing),
 * legal cases, formal notices with templates, timeline event tracking, and evidence management.
 */

import type { TenantId, UserId, Result } from '@borjie/domain-models';
import { ok, err } from '@borjie/domain-models';
import type { EventBus, DomainEvent } from '../common/events.js';
import { createEventEnvelope, generateEventId } from '../common/events.js';

// ============================================================================
// Types
// ============================================================================

export type ComplianceType =
  | 'lease_expiry'
  | 'license_renewal'
  | 'insurance'
  | 'safety_inspection'
  | 'tax_filing';

export type ComplianceStatus = 'compliant' | 'due_soon' | 'overdue' | 'expired';

export interface ComplianceItem {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly type: ComplianceType;
  readonly entityId: string;
  readonly description: string;
  readonly dueDate: string;
  readonly status: ComplianceStatus;
  readonly documentId: string | null;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type CaseStatus = 'open' | 'in_progress' | 'pending_response' | 'escalated' | 'resolved' | 'closed';

export interface CaseDocument {
  readonly documentId: string;
  readonly description: string;
  readonly addedAt: string;
  readonly addedBy: UserId;
}

export interface CaseTimelineEntry {
  readonly id: string;
  readonly event: string;
  readonly timestamp: string;
  readonly details?: string;
  readonly userId?: UserId;
  readonly metadata?: Record<string, unknown>;
}

export interface LegalCase {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly caseNumber: string;
  readonly caseType: string;
  readonly customerId: string;
  readonly propertyId: string;
  readonly unitId?: string;
  readonly leaseId?: string;
  readonly status: CaseStatus;
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
  readonly filingDate: string;
  readonly description: string;
  readonly assignedTo: UserId | null;
  readonly documents: readonly CaseDocument[];
  readonly timeline: readonly CaseTimelineEntry[];
  readonly closedAt: string | null;
  readonly closedBy: UserId | null;
  readonly closureReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: UserId;
  readonly updatedBy: UserId;
}

export type NoticeType =
  | 'rent_demand'
  | 'eviction_notice'
  | 'lease_termination'
  | 'rent_increase'
  | 'inspection_notice';

export interface NoticeAcknowledgement {
  readonly acknowledgedAt: string;
  readonly signature: string;
}

export interface Notice {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly type: NoticeType;
  readonly caseId: string | null;
  readonly customerId: string;
  readonly content: string;
  readonly servedAt: string;
  readonly method: string;
  readonly acknowledgement: NoticeAcknowledgement | null;
  readonly createdAt: string;
  readonly createdBy: UserId;
}

export interface ComplianceFilters {
  readonly type?: ComplianceType;
  readonly status?: ComplianceStatus;
  readonly propertyId?: string;
  readonly entityId?: string;
  /**
   * Inclusive lower bound on `dueDate` — pushed into the store's WHERE
   * clause so the caller doesn't have to fetch every item and filter in
   * JS. Strings are ISO timestamps; the store converts to `Date` on read.
   */
  readonly dueAfter?: string;
  /** Inclusive upper bound on `dueDate`. */
  readonly dueBefore?: string;
  /**
   * Optional exclusion list of statuses — handy for "upcoming" queries
   * that need to drop `expired` rows at the store layer.
   */
  readonly excludeStatuses?: readonly ComplianceStatus[];
}

export interface LegalCaseFilters {
  readonly caseType?: string;
  readonly status?: CaseStatus;
  readonly customerId?: string;
  readonly propertyId?: string;
  readonly assignedTo?: UserId;
  readonly severity?: 'low' | 'medium' | 'high' | 'critical';
}

export interface DateRange {
  readonly from: string;
  readonly to: string;
}

export interface ComplianceReport {
  readonly tenantId: TenantId;
  readonly dateRange: DateRange;
  readonly summary: {
    readonly compliant: number;
    readonly dueSoon: number;
    readonly overdue: number;
    readonly expired: number;
    readonly total: number;
  };
  readonly items: readonly ComplianceItem[];
}

// ============================================================================
// Notice Templates
// ============================================================================

/** Template variable map for notice generation */
export interface NoticeTemplateVariables {
  readonly customerName: string;
  readonly propertyName: string;
  readonly unitNumber?: string;
  readonly amount?: string;
  readonly currency?: string;
  readonly dueDate?: string;
  readonly leaseEndDate?: string;
  readonly newRentAmount?: string;
  readonly effectiveDate?: string;
  readonly inspectionDate?: string;
  readonly inspectionTime?: string;
  readonly noticePeriodDays?: number;
  readonly gracePeriodDays?: number;
  readonly caseNumber?: string;
  readonly reason?: string;
  readonly [key: string]: unknown;
}

/** Built-in notice templates */
export const NOTICE_TEMPLATES: Record<NoticeType, { subject: string; body: string }> = {
  rent_demand: {
    subject: 'Rent Demand Notice',
    body: `Dear {{customerName}},

This notice is to inform you that your rent payment of {{currency}} {{amount}} for the property at {{propertyName}}{{#unitNumber}}, Unit {{unitNumber}}{{/unitNumber}} is overdue as of {{dueDate}}.

You are hereby required to make the full payment within {{gracePeriodDays}} days of receiving this notice to avoid further action.

Failure to pay the outstanding amount may result in legal proceedings being initiated against you, including possible eviction.

Please arrange payment immediately and contact us if you wish to discuss a payment arrangement.

Sincerely,
Property Management`,
  },

  eviction_notice: {
    subject: 'Eviction Notice',
    body: `Dear {{customerName}},

NOTICE OF EVICTION

Property: {{propertyName}}{{#unitNumber}}, Unit {{unitNumber}}{{/unitNumber}}
Case Reference: {{caseNumber}}

You are hereby given notice that you are required to vacate the above-mentioned premises within {{noticePeriodDays}} days from the date of this notice.

Reason: {{reason}}

This notice is issued in accordance with the applicable tenancy laws. If you fail to vacate the premises by the specified date, legal proceedings will be initiated to enforce your eviction.

You have the right to contest this notice within the prescribed legal timeframe.

Sincerely,
Property Management`,
  },

  lease_termination: {
    subject: 'Lease Termination Notice',
    body: `Dear {{customerName}},

This notice is to inform you that your lease agreement for {{propertyName}}{{#unitNumber}}, Unit {{unitNumber}}{{/unitNumber}} will be terminated effective {{effectiveDate}}.

{{#reason}}Reason for termination: {{reason}}{{/reason}}

Please ensure the following before the termination date:
1. All outstanding rent and utility payments are settled
2. The unit is vacated and cleaned to an acceptable standard
3. All keys and access devices are returned
4. A move-out inspection is scheduled

Your security deposit will be processed in accordance with the lease terms after the move-out inspection.

Sincerely,
Property Management`,
  },

  rent_increase: {
    subject: 'Rent Increase Notice',
    body: `Dear {{customerName}},

This notice is to inform you of an adjustment to your monthly rent for the property at {{propertyName}}{{#unitNumber}}, Unit {{unitNumber}}{{/unitNumber}}.

Effective from {{effectiveDate}}, your new monthly rent will be {{currency}} {{newRentAmount}}.

This adjustment is in accordance with the terms of your lease agreement and applicable regulations. You have {{noticePeriodDays}} days advance notice as required.

If you have any questions or concerns about this adjustment, please do not hesitate to contact us.

Sincerely,
Property Management`,
  },

  inspection_notice: {
    subject: 'Property Inspection Notice',
    body: `Dear {{customerName}},

This is to notify you that a scheduled inspection of your premises at {{propertyName}}{{#unitNumber}}, Unit {{unitNumber}}{{/unitNumber}} will take place on {{inspectionDate}} at {{inspectionTime}}.

Please ensure the following:
1. The premises are accessible at the scheduled time
2. All areas of the property are reasonably accessible for inspection
3. Any known maintenance issues are reported before the inspection

If the scheduled time is inconvenient, please contact us at least 48 hours in advance to arrange an alternative time.

Sincerely,
Property Management`,
  },
};

/**
 * Render a notice template by replacing {{variable}} placeholders.
 * Supports simple conditional blocks: {{#var}}content{{/var}} which only render when var is truthy.
 */
export function renderNoticeTemplate(
  template: string,
  variables: NoticeTemplateVariables
): string {
  let result = template;

  // Process conditional blocks first: {{#var}}content{{/var}}
  result = result.replace(
    /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_match, varName: string, content: string) => {
      const value = variables[varName];
      return value
        ? content.replace(/\{\{(\w+)\}\}/g, (_m, v: string) => String(variables[v] ?? ''))
        : '';
    }
  );

  // Replace remaining simple variables: {{var}}
  result = result.replace(/\{\{(\w+)\}\}/g, (_match, varName: string) => {
    const value = variables[varName];
    return value !== undefined && value !== null ? String(value) : '';
  });

  return result;
}

// ============================================================================
// Events
// ============================================================================

interface ComplianceEventBase extends DomainEvent {
  readonly payload: Record<string, unknown>;
}

export interface ComplianceDueEvent extends ComplianceEventBase {
  readonly eventType: 'ComplianceDue';
  readonly payload: {
    readonly itemId: string;
    readonly type: ComplianceType;
    readonly entityId: string;
    readonly dueDate: string;
  };
}

export interface ComplianceOverdueEvent extends ComplianceEventBase {
  readonly eventType: 'ComplianceOverdue';
  readonly payload: {
    readonly itemId: string;
    readonly type: ComplianceType;
    readonly entityId: string;
    readonly dueDate: string;
  };
}

export interface NoticeServedEvent extends ComplianceEventBase {
  readonly eventType: 'NoticeServed';
  readonly payload: {
    readonly noticeId: string;
    readonly type: NoticeType;
    readonly customerId: string;
    readonly method: string;
    readonly caseId: string | null;
  };
}

export interface LegalCaseCreatedEvent extends ComplianceEventBase {
  readonly eventType: 'LegalCaseCreated';
  readonly payload: {
    readonly caseId: string;
    readonly caseNumber: string;
    readonly caseType: string;
    readonly customerId: string;
    readonly propertyId: string;
    readonly severity: string;
  };
}

export interface LegalCaseClosedEvent extends ComplianceEventBase {
  readonly eventType: 'LegalCaseClosed';
  readonly payload: {
    readonly caseId: string;
    readonly caseNumber: string;
    readonly reason: string;
    readonly closedBy: UserId;
  };
}

export interface LegalCaseStatusChangedEvent extends ComplianceEventBase {
  readonly eventType: 'LegalCaseStatusChanged';
  readonly payload: {
    readonly caseId: string;
    readonly caseNumber: string;
    readonly previousStatus: CaseStatus;
    readonly newStatus: CaseStatus;
  };
}

export interface CaseEvidenceAddedEvent extends ComplianceEventBase {
  readonly eventType: 'CaseEvidenceAdded';
  readonly payload: {
    readonly caseId: string;
    readonly documentId: string;
    readonly description: string;
  };
}

// ============================================================================
// Repository Interfaces
// ============================================================================

export interface ComplianceItemStore {
  findById(id: string, tenantId: TenantId): Promise<ComplianceItem | null>;
  findMany(tenantId: TenantId, filters: ComplianceFilters): Promise<readonly ComplianceItem[]>;
  create(item: ComplianceItem): Promise<ComplianceItem>;
  update(item: ComplianceItem): Promise<ComplianceItem>;
  delete(id: string, tenantId: TenantId): Promise<void>;
}

export interface LegalCaseStore {
  findById(id: string, tenantId: TenantId): Promise<LegalCase | null>;
  findByCaseNumber(caseNumber: string, tenantId: TenantId): Promise<LegalCase | null>;
  findMany(tenantId: TenantId, filters?: LegalCaseFilters): Promise<readonly LegalCase[]>;
  create(legalCase: LegalCase): Promise<LegalCase>;
  update(legalCase: LegalCase): Promise<LegalCase>;
  getNextSequence(tenantId: TenantId): Promise<number>;
}

export interface NoticeStore {
  findById(id: string, tenantId: TenantId): Promise<Notice | null>;
  findByCaseId(caseId: string, tenantId: TenantId): Promise<readonly Notice[]>;
  findByCustomerId(customerId: string, tenantId: TenantId): Promise<readonly Notice[]>;
  create(notice: Notice): Promise<Notice>;
  update(notice: Notice): Promise<Notice>;
}

// ============================================================================
// Error Types
// ============================================================================

export const ComplianceServiceError = {
  ITEM_NOT_FOUND: 'ITEM_NOT_FOUND',
  CASE_NOT_FOUND: 'CASE_NOT_FOUND',
  CASE_ALREADY_CLOSED: 'CASE_ALREADY_CLOSED',
  NOTICE_NOT_FOUND: 'NOTICE_NOT_FOUND',
  INVALID_STATUS: 'INVALID_STATUS',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  DOCUMENT_ALREADY_ATTACHED: 'DOCUMENT_ALREADY_ATTACHED',
  DOCUMENT_NOT_ATTACHED: 'DOCUMENT_NOT_ATTACHED',
  INVALID_TEMPLATE: 'INVALID_TEMPLATE',
} as const;

export type ComplianceServiceErrorCode =
  (typeof ComplianceServiceError)[keyof typeof ComplianceServiceError];

export interface ComplianceServiceErrorResult {
  code: ComplianceServiceErrorCode;
  message: string;
}

// ============================================================================
// Helpers
// ============================================================================

function computeStatus(dueDate: string): ComplianceStatus {
  const now = new Date();
  const due = new Date(dueDate);
  const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 'expired';
  if (diffDays === 0) return 'overdue';
  if (diffDays <= 30) return 'due_soon';
  return 'compliant';
}

/** Valid case status transitions */
const VALID_STATUS_TRANSITIONS: Record<CaseStatus, readonly CaseStatus[]> = {
  open: ['in_progress', 'closed'],
  in_progress: ['pending_response', 'escalated', 'resolved', 'closed'],
  pending_response: ['in_progress', 'escalated', 'resolved', 'closed'],
  escalated: ['in_progress', 'resolved', 'closed'],
  resolved: ['closed', 'in_progress'], // allow reopen
  closed: [], // terminal
};

function isValidStatusTransition(from: CaseStatus, to: CaseStatus): boolean {
  return VALID_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

// ============================================================================
// Compliance Service
// ============================================================================

export class ComplianceService {
  constructor(
    private readonly complianceStore: ComplianceItemStore,
    private readonly legalCaseStore: LegalCaseStore,
    private readonly noticeStore: NoticeStore,
    private readonly eventBus: EventBus
  ) {}

  // ==================== Compliance Item Operations ====================

  /**
   * Create a compliance tracking item with automatic status calculation.
   */
  async createComplianceItem(
    tenantId: TenantId,
    type: ComplianceType,
    entityId: string,
    description: string,
    dueDate: string,
    notes?: string
  ): Promise<Result<ComplianceItem, ComplianceServiceErrorResult>> {
    const id = `cmp_${Date.now()}_${randomHex(4)}`;
    const now = new Date().toISOString();
    const status = computeStatus(dueDate);

    const item: ComplianceItem = {
      id,
      tenantId,
      type,
      entityId,
      description,
      dueDate,
      status,
      documentId: null,
      notes: notes ?? null,
      createdAt: now,
      updatedAt: now,
    };

    const saved = await this.complianceStore.create(item);

    if (status === 'due_soon') {
      const event: ComplianceDueEvent = {
        eventId: generateEventId(),
        eventType: 'ComplianceDue',
        timestamp: now,
        tenantId,
        correlationId: saved.id,
        causationId: null,
        metadata: {},
        payload: { itemId: saved.id, type, entityId, dueDate },
      };
      await this.eventBus.publish(createEventEnvelope(event, saved.id, 'ComplianceItem'));
    } else if (status === 'overdue' || status === 'expired') {
      const event: ComplianceOverdueEvent = {
        eventId: generateEventId(),
        eventType: 'ComplianceOverdue',
        timestamp: now,
        tenantId,
        correlationId: saved.id,
        causationId: null,
        metadata: {},
        payload: { itemId: saved.id, type, entityId, dueDate },
      };
      await this.eventBus.publish(createEventEnvelope(event, saved.id, 'ComplianceItem'));
    }

    return ok(saved);
  }

  /**
   * Get a single compliance item by ID.
   */
  async getComplianceItem(
    itemId: string,
    tenantId: TenantId
  ): Promise<Result<ComplianceItem, ComplianceServiceErrorResult>> {
    const item = await this.complianceStore.findById(itemId, tenantId);
    if (!item) return err({ code: ComplianceServiceError.ITEM_NOT_FOUND, message: 'Compliance item not found' });
    return ok(item);
  }

  /**
   * Update the status of a compliance item, optionally linking a supporting document.
   */
  async updateComplianceStatus(
    itemId: string,
    tenantId: TenantId,
    status: ComplianceStatus,
    documentId?: string
  ): Promise<Result<ComplianceItem, ComplianceServiceErrorResult>> {
    const item = await this.complianceStore.findById(itemId, tenantId);
    if (!item) return err({ code: ComplianceServiceError.ITEM_NOT_FOUND, message: 'Compliance item not found' });

    const now = new Date().toISOString();
    const updated: ComplianceItem = {
      ...item,
      status,
      documentId: documentId ?? item.documentId,
      updatedAt: now,
    };

    const saved = await this.complianceStore.update(updated);
    return ok(saved);
  }

  /**
   * Update notes on a compliance item.
   */
  async updateComplianceNotes(
    itemId: string,
    tenantId: TenantId,
    notes: string
  ): Promise<Result<ComplianceItem, ComplianceServiceErrorResult>> {
    const item = await this.complianceStore.findById(itemId, tenantId);
    if (!item) return err({ code: ComplianceServiceError.ITEM_NOT_FOUND, message: 'Compliance item not found' });

    const now = new Date().toISOString();
    const updated: ComplianceItem = { ...item, notes, updatedAt: now };
    const saved = await this.complianceStore.update(updated);
    return ok(saved);
  }

  /**
   * Delete a compliance item.
   */
  async deleteComplianceItem(
    itemId: string,
    tenantId: TenantId
  ): Promise<Result<void, ComplianceServiceErrorResult>> {
    const item = await this.complianceStore.findById(itemId, tenantId);
    if (!item) return err({ code: ComplianceServiceError.ITEM_NOT_FOUND, message: 'Compliance item not found' });
    await this.complianceStore.delete(itemId, tenantId);
    return ok(undefined);
  }

  /**
   * List compliance items with optional filters.
   */
  async getComplianceItems(
    tenantId: TenantId,
    filters: ComplianceFilters = {}
  ): Promise<readonly ComplianceItem[]> {
    return this.complianceStore.findMany(tenantId, filters);
  }

  /**
   * Get items due within N days (excludes already expired items).
   */
  async getUpcomingCompliance(
    tenantId: TenantId,
    days: number
  ): Promise<readonly ComplianceItem[]> {
    const items = await this.complianceStore.findMany(tenantId, {});
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + days);

    return items.filter((item) => {
      if (item.status === 'expired') return false;
      const due = new Date(item.dueDate);
      return due <= cutoff;
    });
  }

  /**
   * Batch re-check all compliance item statuses based on current date.
   * Returns items whose status was changed.
   */
  async refreshComplianceStatuses(
    tenantId: TenantId
  ): Promise<ComplianceItem[]> {
    const items = await this.complianceStore.findMany(tenantId, {});
    const changed: ComplianceItem[] = [];
    const now = new Date().toISOString();

    for (const item of items) {
      const currentStatus = computeStatus(item.dueDate);
      if (currentStatus !== item.status) {
        const updated: ComplianceItem = { ...item, status: currentStatus, updatedAt: now };
        const saved = await this.complianceStore.update(updated);
        changed.push(saved);

        // Emit events for newly overdue/expired items
        if (currentStatus === 'overdue' || currentStatus === 'expired') {
          const event: ComplianceOverdueEvent = {
            eventId: generateEventId(),
            eventType: 'ComplianceOverdue',
            timestamp: now,
            tenantId,
            correlationId: saved.id,
            causationId: null,
            metadata: {},
            payload: { itemId: saved.id, type: saved.type, entityId: saved.entityId, dueDate: saved.dueDate },
          };
          await this.eventBus.publish(createEventEnvelope(event, saved.id, 'ComplianceItem'));
        } else if (currentStatus === 'due_soon') {
          const event: ComplianceDueEvent = {
            eventId: generateEventId(),
            eventType: 'ComplianceDue',
            timestamp: now,
            tenantId,
            correlationId: saved.id,
            causationId: null,
            metadata: {},
            payload: { itemId: saved.id, type: saved.type, entityId: saved.entityId, dueDate: saved.dueDate },
          };
          await this.eventBus.publish(createEventEnvelope(event, saved.id, 'ComplianceItem'));
        }
      }
    }

    return changed;
  }

  // ==================== Legal Case Operations ====================

  /**
   * Create a new legal case with timeline tracking.
   */
  async createLegalCase(
    tenantId: TenantId,
    caseType: string,
    customerId: string,
    propertyId: string,
    description: string,
    createdBy: UserId,
    options?: {
      unitId?: string;
      leaseId?: string;
      severity?: 'low' | 'medium' | 'high' | 'critical';
      assignedTo?: UserId;
    }
  ): Promise<Result<LegalCase, ComplianceServiceErrorResult>> {
    const id = `lgl_${Date.now()}_${randomHex(4)}`;
    const now = new Date().toISOString();
    const caseNumber = await this.generateCaseNumber(tenantId);

    const legalCase: LegalCase = {
      id,
      tenantId,
      caseNumber,
      caseType,
      customerId,
      propertyId,
      unitId: options?.unitId,
      leaseId: options?.leaseId,
      status: 'open',
      severity: options?.severity ?? 'medium',
      filingDate: now,
      description,
      assignedTo: options?.assignedTo ?? null,
      documents: [],
      timeline: [{
        id: `evt_${Date.now()}`,
        event: 'case_created',
        timestamp: now,
        details: description,
        userId: createdBy,
      }],
      closedAt: null,
      closedBy: null,
      closureReason: null,
      createdAt: now,
      updatedAt: now,
      createdBy,
      updatedBy: createdBy,
    };

    const saved = await this.legalCaseStore.create(legalCase);

    const event: LegalCaseCreatedEvent = {
      eventId: generateEventId(),
      eventType: 'LegalCaseCreated',
      timestamp: now,
      tenantId,
      correlationId: saved.id,
      causationId: null,
      metadata: {},
      payload: {
        caseId: saved.id,
        caseNumber: saved.caseNumber,
        caseType,
        customerId,
        propertyId,
        severity: saved.severity,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'LegalCase'));

    return ok(saved);
  }

  /**
   * Get a single legal case by ID.
   */
  async getLegalCase(
    caseId: string,
    tenantId: TenantId
  ): Promise<Result<LegalCase, ComplianceServiceErrorResult>> {
    const legalCase = await this.legalCaseStore.findById(caseId, tenantId);
    if (!legalCase) return err({ code: ComplianceServiceError.CASE_NOT_FOUND, message: 'Legal case not found' });
    return ok(legalCase);
  }

  /**
   * Get a legal case by case number.
   */
  async getLegalCaseByCaseNumber(
    caseNumber: string,
    tenantId: TenantId
  ): Promise<Result<LegalCase, ComplianceServiceErrorResult>> {
    const legalCase = await this.legalCaseStore.findByCaseNumber(caseNumber, tenantId);
    if (!legalCase) return err({ code: ComplianceServiceError.CASE_NOT_FOUND, message: 'Legal case not found' });
    return ok(legalCase);
  }

  /**
   * List legal cases with optional filters.
   */
  async listLegalCases(
    tenantId: TenantId,
    filters?: LegalCaseFilters
  ): Promise<readonly LegalCase[]> {
    return this.legalCaseStore.findMany(tenantId, filters);
  }

  /**
   * Update a legal case (status, description, severity, assignment).
   * Enforces valid status transitions and tracks changes in the timeline.
   */
  async updateLegalCase(
    caseId: string,
    tenantId: TenantId,
    updates: Partial<Pick<LegalCase, 'status' | 'description' | 'severity' | 'assignedTo'>>,
    updatedBy: UserId,
    correlationId?: string
  ): Promise<Result<LegalCase, ComplianceServiceErrorResult>> {
    const legalCase = await this.legalCaseStore.findById(caseId, tenantId);
    if (!legalCase) return err({ code: ComplianceServiceError.CASE_NOT_FOUND, message: 'Legal case not found' });

    if (legalCase.status === 'closed') {
      return err({ code: ComplianceServiceError.CASE_ALREADY_CLOSED, message: 'Cannot update a closed case' });
    }

    // Validate status transition
    if (updates.status && updates.status !== legalCase.status) {
      if (!isValidStatusTransition(legalCase.status, updates.status)) {
        return err({
          code: ComplianceServiceError.INVALID_STATUS_TRANSITION,
          message: `Cannot transition from '${legalCase.status}' to '${updates.status}'`,
        });
      }
    }

    const now = new Date().toISOString();
    const timelineEntries: CaseTimelineEntry[] = [];

    if (updates.status && updates.status !== legalCase.status) {
      timelineEntries.push({
        id: `evt_${Date.now()}_status`,
        event: 'status_changed',
        timestamp: now,
        details: `Status changed from '${legalCase.status}' to '${updates.status}'`,
        userId: updatedBy,
        metadata: { previousStatus: legalCase.status, newStatus: updates.status },
      });
    }
    if (updates.severity && updates.severity !== legalCase.severity) {
      timelineEntries.push({
        id: `evt_${Date.now()}_sev`,
        event: 'severity_changed',
        timestamp: now,
        details: `Severity changed from '${legalCase.severity}' to '${updates.severity}'`,
        userId: updatedBy,
      });
    }
    if (updates.assignedTo !== undefined && updates.assignedTo !== legalCase.assignedTo) {
      timelineEntries.push({
        id: `evt_${Date.now()}_assign`,
        event: 'assignment_changed',
        timestamp: now,
        details: updates.assignedTo ? `Case assigned to ${updates.assignedTo}` : 'Case unassigned',
        userId: updatedBy,
      });
    }
    if (updates.description && updates.description !== legalCase.description) {
      timelineEntries.push({
        id: `evt_${Date.now()}_desc`,
        event: 'description_updated',
        timestamp: now,
        details: 'Case description updated',
        userId: updatedBy,
      });
    }

    const updated: LegalCase = {
      ...legalCase,
      status: updates.status ?? legalCase.status,
      description: updates.description ?? legalCase.description,
      severity: updates.severity ?? legalCase.severity,
      assignedTo: updates.assignedTo !== undefined ? (updates.assignedTo ?? null) : legalCase.assignedTo,
      timeline: [...legalCase.timeline, ...timelineEntries],
      updatedAt: now,
      updatedBy,
    };

    const saved = await this.legalCaseStore.update(updated);

    if (updates.status && updates.status !== legalCase.status) {
      const statusEvent: LegalCaseStatusChangedEvent = {
        eventId: generateEventId(),
        eventType: 'LegalCaseStatusChanged',
        timestamp: now,
        tenantId,
        correlationId: correlationId ?? caseId,
        causationId: null,
        metadata: {},
        payload: {
          caseId: saved.id,
          caseNumber: saved.caseNumber,
          previousStatus: legalCase.status,
          newStatus: updates.status,
        },
      };
      await this.eventBus.publish(createEventEnvelope(statusEvent, saved.id, 'LegalCase'));
    }

    return ok(saved);
  }

  /**
   * Close a legal case with a reason. This is a terminal state.
   */
  async closeLegalCase(
    caseId: string,
    tenantId: TenantId,
    reason: string,
    closedBy: UserId,
    correlationId?: string
  ): Promise<Result<LegalCase, ComplianceServiceErrorResult>> {
    const legalCase = await this.legalCaseStore.findById(caseId, tenantId);
    if (!legalCase) return err({ code: ComplianceServiceError.CASE_NOT_FOUND, message: 'Legal case not found' });
    if (legalCase.status === 'closed') {
      return err({ code: ComplianceServiceError.CASE_ALREADY_CLOSED, message: 'Case is already closed' });
    }

    const now = new Date().toISOString();
    const timelineEntry: CaseTimelineEntry = {
      id: `evt_${Date.now()}_close`,
      event: 'case_closed',
      timestamp: now,
      details: `Case closed: ${reason}`,
      userId: closedBy,
    };

    const updated: LegalCase = {
      ...legalCase,
      status: 'closed',
      closedAt: now,
      closedBy,
      closureReason: reason,
      timeline: [...legalCase.timeline, timelineEntry],
      updatedAt: now,
      updatedBy: closedBy,
    };

    const saved = await this.legalCaseStore.update(updated);

    const event: LegalCaseClosedEvent = {
      eventId: generateEventId(),
      eventType: 'LegalCaseClosed',
      timestamp: now,
      tenantId,
      correlationId: correlationId ?? caseId,
      causationId: null,
      metadata: {},
      payload: {
        caseId: saved.id,
        caseNumber: saved.caseNumber,
        reason,
        closedBy,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'LegalCase'));

    return ok(saved);
  }

  // ==================== Timeline Event Tracking ====================

  /**
   * Add an explicit timeline event to a case for tracking purposes.
   */
  async addTimelineEvent(
    caseId: string,
    tenantId: TenantId,
    eventType: string,
    details: string,
    addedBy: UserId,
    metadata?: Record<string, unknown>
  ): Promise<Result<CaseTimelineEntry, ComplianceServiceErrorResult>> {
    const legalCase = await this.legalCaseStore.findById(caseId, tenantId);
    if (!legalCase) return err({ code: ComplianceServiceError.CASE_NOT_FOUND, message: 'Legal case not found' });

    const now = new Date().toISOString();
    const entry: CaseTimelineEntry = {
      id: `evt_${Date.now()}_${randomHex(4)}`,
      event: eventType,
      timestamp: now,
      details,
      userId: addedBy,
      metadata,
    };

    const updated: LegalCase = {
      ...legalCase,
      timeline: [...legalCase.timeline, entry],
      updatedAt: now,
      updatedBy: addedBy,
    };
    await this.legalCaseStore.update(updated);

    return ok(entry);
  }

  /**
   * Get the full timeline for a case, sorted chronologically.
   */
  async getCaseTimeline(
    caseId: string,
    tenantId: TenantId
  ): Promise<Result<readonly CaseTimelineEntry[], ComplianceServiceErrorResult>> {
    const legalCase = await this.legalCaseStore.findById(caseId, tenantId);
    if (!legalCase) return err({ code: ComplianceServiceError.CASE_NOT_FOUND, message: 'Legal case not found' });

    const sorted = [...legalCase.timeline].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    return ok(sorted);
  }

  // ==================== Evidence / Document Attachment ====================

  /**
   * Attach a document as evidence to a case.
   */
  async addCaseDocument(
    caseId: string,
    tenantId: TenantId,
    documentId: string,
    description: string,
    addedBy: UserId,
    correlationId?: string
  ): Promise<Result<LegalCase, ComplianceServiceErrorResult>> {
    const legalCase = await this.legalCaseStore.findById(caseId, tenantId);
    if (!legalCase) return err({ code: ComplianceServiceError.CASE_NOT_FOUND, message: 'Legal case not found' });

    if (legalCase.documents.some(d => d.documentId === documentId)) {
      return err({
        code: ComplianceServiceError.DOCUMENT_ALREADY_ATTACHED,
        message: 'Document is already attached to this case',
      });
    }

    const now = new Date().toISOString();
    const doc: CaseDocument = { documentId, description, addedAt: now, addedBy };
    const timelineEntry: CaseTimelineEntry = {
      id: `evt_${Date.now()}_doc`,
      event: 'evidence_added',
      timestamp: now,
      details: `Evidence document added: ${description}`,
      userId: addedBy,
      metadata: { documentId },
    };

    const updated: LegalCase = {
      ...legalCase,
      documents: [...legalCase.documents, doc],
      timeline: [...legalCase.timeline, timelineEntry],
      updatedAt: now,
      updatedBy: addedBy,
    };

    const saved = await this.legalCaseStore.update(updated);

    const event: CaseEvidenceAddedEvent = {
      eventId: generateEventId(),
      eventType: 'CaseEvidenceAdded',
      timestamp: now,
      tenantId,
      correlationId: correlationId ?? caseId,
      causationId: null,
      metadata: {},
      payload: { caseId, documentId, description },
    };
    await this.eventBus.publish(createEventEnvelope(event, caseId, 'LegalCase'));

    return ok(saved);
  }

  /**
   * Remove a document from a case's evidence list.
   */
  async removeCaseDocument(
    caseId: string,
    tenantId: TenantId,
    documentId: string,
    removedBy: UserId
  ): Promise<Result<LegalCase, ComplianceServiceErrorResult>> {
    const legalCase = await this.legalCaseStore.findById(caseId, tenantId);
    if (!legalCase) return err({ code: ComplianceServiceError.CASE_NOT_FOUND, message: 'Legal case not found' });

    const docIndex = legalCase.documents.findIndex(d => d.documentId === documentId);
    if (docIndex < 0) {
      return err({
        code: ComplianceServiceError.DOCUMENT_NOT_ATTACHED,
        message: 'Document is not attached to this case',
      });
    }

    const removedDoc = legalCase.documents[docIndex];
    const now = new Date().toISOString();
    const timelineEntry: CaseTimelineEntry = {
      id: `evt_${Date.now()}_rmv`,
      event: 'evidence_removed',
      timestamp: now,
      details: `Evidence document removed: ${removedDoc.description}`,
      userId: removedBy,
      metadata: { documentId },
    };

    const updated: LegalCase = {
      ...legalCase,
      documents: legalCase.documents.filter(d => d.documentId !== documentId),
      timeline: [...legalCase.timeline, timelineEntry],
      updatedAt: now,
      updatedBy: removedBy,
    };

    const saved = await this.legalCaseStore.update(updated);
    return ok(saved);
  }

  /**
   * Get all documents attached to a case.
   */
  async getCaseDocuments(
    caseId: string,
    tenantId: TenantId
  ): Promise<Result<readonly CaseDocument[], ComplianceServiceErrorResult>> {
    const legalCase = await this.legalCaseStore.findById(caseId, tenantId);
    if (!legalCase) return err({ code: ComplianceServiceError.CASE_NOT_FOUND, message: 'Legal case not found' });
    return ok(legalCase.documents);
  }

  // ==================== Notice Operations ====================

  /**
   * Serve a notice with raw content.
   */
  async serveNotice(
    tenantId: TenantId,
    customerId: string,
    type: NoticeType,
    content: string,
    method: string,
    servedBy: UserId,
    caseId?: string
  ): Promise<Result<Notice, ComplianceServiceErrorResult>> {
    const id = `ntc_${Date.now()}_${randomHex(4)}`;
    const now = new Date().toISOString();

    const notice: Notice = {
      id,
      tenantId,
      type,
      caseId: caseId ?? null,
      customerId,
      content,
      servedAt: now,
      method,
      acknowledgement: null,
      createdAt: now,
      createdBy: servedBy,
    };

    const saved = await this.noticeStore.create(notice);

    // If linked to a case, add timeline entry
    if (caseId) {
      const legalCase = await this.legalCaseStore.findById(caseId, tenantId);
      if (legalCase) {
        const timelineEntry: CaseTimelineEntry = {
          id: `evt_${Date.now()}_ntc`,
          event: 'notice_served',
          timestamp: now,
          details: `${type.replace(/_/g, ' ')} notice served via ${method}`,
          userId: servedBy,
          metadata: { noticeId: saved.id, noticeType: type, method },
        };
        const updatedCase: LegalCase = {
          ...legalCase,
          timeline: [...legalCase.timeline, timelineEntry],
          updatedAt: now,
          updatedBy: servedBy,
        };
        await this.legalCaseStore.update(updatedCase);
      }
    }

    const event: NoticeServedEvent = {
      eventId: generateEventId(),
      eventType: 'NoticeServed',
      timestamp: now,
      tenantId,
      correlationId: saved.id,
      causationId: null,
      metadata: {},
      payload: {
        noticeId: saved.id,
        type,
        customerId,
        method,
        caseId: caseId ?? null,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'Notice'));

    return ok(saved);
  }

  /**
   * Generate a notice from a built-in template with variable substitution,
   * then serve it.
   */
  async generateAndServeNotice(
    tenantId: TenantId,
    customerId: string,
    type: NoticeType,
    variables: NoticeTemplateVariables,
    method: string,
    servedBy: UserId,
    caseId?: string
  ): Promise<Result<Notice, ComplianceServiceErrorResult>> {
    const template = NOTICE_TEMPLATES[type];
    if (!template) {
      return err({
        code: ComplianceServiceError.INVALID_TEMPLATE,
        message: `No template found for notice type '${type}'`,
      });
    }

    const renderedContent = renderNoticeTemplate(template.body, variables);
    return this.serveNotice(tenantId, customerId, type, renderedContent, method, servedBy, caseId);
  }

  /**
   * Acknowledge receipt of a notice.
   */
  async acknowledgeNotice(
    noticeId: string,
    tenantId: TenantId,
    customerId: string,
    signature: string
  ): Promise<Result<Notice, ComplianceServiceErrorResult>> {
    const notice = await this.noticeStore.findById(noticeId, tenantId);
    if (!notice) return err({ code: ComplianceServiceError.NOTICE_NOT_FOUND, message: 'Notice not found' });
    if (notice.customerId !== customerId) {
      return err({ code: ComplianceServiceError.NOTICE_NOT_FOUND, message: 'Notice not found for customer' });
    }

    const now = new Date().toISOString();
    const acknowledgement: NoticeAcknowledgement = { acknowledgedAt: now, signature };
    const updated: Notice = { ...notice, acknowledgement };
    const saved = await this.noticeStore.update(updated);

    // If linked to a case, add timeline entry for acknowledgement
    if (notice.caseId) {
      const legalCase = await this.legalCaseStore.findById(notice.caseId, tenantId);
      if (legalCase) {
        const timelineEntry: CaseTimelineEntry = {
          id: `evt_${Date.now()}_ack`,
          event: 'notice_acknowledged',
          timestamp: now,
          details: `${notice.type.replace(/_/g, ' ')} notice acknowledged by customer`,
          metadata: { noticeId: notice.id },
        };
        const updatedCase: LegalCase = {
          ...legalCase,
          timeline: [...legalCase.timeline, timelineEntry],
          updatedAt: now,
          updatedBy: legalCase.updatedBy,
        };
        await this.legalCaseStore.update(updatedCase);
      }
    }

    return ok(saved);
  }

  /**
   * Get a single notice by ID.
   */
  async getNotice(
    noticeId: string,
    tenantId: TenantId
  ): Promise<Result<Notice, ComplianceServiceErrorResult>> {
    const notice = await this.noticeStore.findById(noticeId, tenantId);
    if (!notice) return err({ code: ComplianceServiceError.NOTICE_NOT_FOUND, message: 'Notice not found' });
    return ok(notice);
  }

  /**
   * Get all notices associated with a case.
   */
  async getNoticesByCase(
    caseId: string,
    tenantId: TenantId
  ): Promise<readonly Notice[]> {
    return this.noticeStore.findByCaseId(caseId, tenantId);
  }

  /**
   * Get all notices served to a customer.
   */
  async getNoticesByCustomer(
    customerId: string,
    tenantId: TenantId
  ): Promise<readonly Notice[]> {
    return this.noticeStore.findByCustomerId(customerId, tenantId);
  }

  // ==================== Reporting ====================

  /**
   * Generate a compliance report for a date range.
   */
  async getComplianceReport(
    tenantId: TenantId,
    dateRange: DateRange
  ): Promise<ComplianceReport> {
    const items = await this.complianceStore.findMany(tenantId, {});
    const from = new Date(dateRange.from);
    const to = new Date(dateRange.to);

    const filteredItems = items.filter((item) => {
      const due = new Date(item.dueDate);
      return due >= from && due <= to;
    });

    const summary = {
      compliant: filteredItems.filter((i) => i.status === 'compliant').length,
      dueSoon: filteredItems.filter((i) => i.status === 'due_soon').length,
      overdue: filteredItems.filter((i) => i.status === 'overdue').length,
      expired: filteredItems.filter((i) => i.status === 'expired').length,
      total: filteredItems.length,
    };

    return {
      tenantId,
      dateRange,
      summary,
      items: filteredItems,
    };
  }

  // ==================== Helpers ====================

  private async generateCaseNumber(tenantId: TenantId): Promise<string> {
    const sequence = await this.legalCaseStore.getNextSequence(tenantId);
    const year = new Date().getFullYear();
    return `CASE-${year}-${String(sequence).padStart(4, '0')}`;
  }
}

// ============================================================================
// In-Memory Stores (for development/testing)
// ============================================================================

const complianceMap = new Map<string, ComplianceItem>();
const legalCaseMap = new Map<string, LegalCase>();
const noticeMap = new Map<string, Notice>();

function complianceKey(id: string, tenantId: TenantId): string {
  return `${tenantId}:cmp:${id}`;
}

function legalCaseKey(id: string, tenantId: TenantId): string {
  return `${tenantId}:lgl:${id}`;
}

function noticeKey(id: string, tenantId: TenantId): string {
  return `${tenantId}:ntc:${id}`;
}

export class MemoryComplianceItemStore implements ComplianceItemStore {
  async findById(id: string, tenantId: TenantId): Promise<ComplianceItem | null> {
    return complianceMap.get(complianceKey(id, tenantId)) ?? null;
  }

  async findMany(tenantId: TenantId, filters: ComplianceFilters): Promise<readonly ComplianceItem[]> {
    let items = [...complianceMap.values()].filter((i) => i.tenantId === tenantId);
    if (filters.type) items = items.filter((i) => i.type === filters.type);
    if (filters.status) items = items.filter((i) => i.status === filters.status);
    if (filters.propertyId) items = items.filter((i) => i.entityId === filters.propertyId);
    if (filters.entityId) items = items.filter((i) => i.entityId === filters.entityId);
    if (filters.excludeStatuses && filters.excludeStatuses.length > 0) {
      const excluded = new Set<ComplianceStatus>(filters.excludeStatuses);
      items = items.filter((i) => !excluded.has(i.status));
    }
    if (filters.dueAfter) {
      const lower = new Date(filters.dueAfter);
      items = items.filter((i) => new Date(i.dueDate) >= lower);
    }
    if (filters.dueBefore) {
      const upper = new Date(filters.dueBefore);
      items = items.filter((i) => new Date(i.dueDate) <= upper);
    }
    return items;
  }

  async create(item: ComplianceItem): Promise<ComplianceItem> {
    complianceMap.set(complianceKey(item.id, item.tenantId), item);
    return item;
  }

  async update(item: ComplianceItem): Promise<ComplianceItem> {
    complianceMap.set(complianceKey(item.id, item.tenantId), item);
    return item;
  }

  async delete(id: string, tenantId: TenantId): Promise<void> {
    complianceMap.delete(complianceKey(id, tenantId));
  }

  clear(): void {
    complianceMap.clear();
  }
}

let caseSequence = 0;

export class MemoryLegalCaseStore implements LegalCaseStore {
  async findById(id: string, tenantId: TenantId): Promise<LegalCase | null> {
    return legalCaseMap.get(legalCaseKey(id, tenantId)) ?? null;
  }

  async findByCaseNumber(caseNumber: string, tenantId: TenantId): Promise<LegalCase | null> {
    for (const lc of legalCaseMap.values()) {
      if (lc.tenantId === tenantId && lc.caseNumber === caseNumber) return lc;
    }
    return null;
  }

  async findMany(tenantId: TenantId, filters?: LegalCaseFilters): Promise<readonly LegalCase[]> {
    let items = [...legalCaseMap.values()].filter((lc) => lc.tenantId === tenantId);
    if (filters?.caseType) items = items.filter((lc) => lc.caseType === filters.caseType);
    if (filters?.status) items = items.filter((lc) => lc.status === filters.status);
    if (filters?.customerId) items = items.filter((lc) => lc.customerId === filters.customerId);
    if (filters?.propertyId) items = items.filter((lc) => lc.propertyId === filters.propertyId);
    if (filters?.assignedTo) items = items.filter((lc) => lc.assignedTo === filters.assignedTo);
    if (filters?.severity) items = items.filter((lc) => lc.severity === filters.severity);
    return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async create(legalCase: LegalCase): Promise<LegalCase> {
    legalCaseMap.set(legalCaseKey(legalCase.id, legalCase.tenantId), legalCase);
    return legalCase;
  }

  async update(legalCase: LegalCase): Promise<LegalCase> {
    legalCaseMap.set(legalCaseKey(legalCase.id, legalCase.tenantId), legalCase);
    return legalCase;
  }

  async getNextSequence(_tenantId: TenantId): Promise<number> {
    return ++caseSequence;
  }

  clear(): void {
    legalCaseMap.clear();
    caseSequence = 0;
  }
}

export class MemoryNoticeStore implements NoticeStore {
  async findById(id: string, tenantId: TenantId): Promise<Notice | null> {
    return noticeMap.get(noticeKey(id, tenantId)) ?? null;
  }

  async findByCaseId(caseId: string, tenantId: TenantId): Promise<readonly Notice[]> {
    return [...noticeMap.values()].filter(
      (n) => n.tenantId === tenantId && n.caseId === caseId
    ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async findByCustomerId(customerId: string, tenantId: TenantId): Promise<readonly Notice[]> {
    return [...noticeMap.values()].filter(
      (n) => n.tenantId === tenantId && n.customerId === customerId
    ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async create(notice: Notice): Promise<Notice> {
    noticeMap.set(noticeKey(notice.id, notice.tenantId), notice);
    return notice;
  }

  async update(notice: Notice): Promise<Notice> {
    noticeMap.set(noticeKey(notice.id, notice.tenantId), notice);
    return notice;
  }

  clear(): void {
    noticeMap.clear();
  }
}

// ============================================================================
// GDPR Right-to-be-Forgotten — Wave 9 enterprise polish
// ============================================================================
export {
  createGdprService,
  buildPseudonymizationStatements,
  GdprError,
  GDPR_DELETION_STATUSES,
  type GdprService,
  type GdprServiceDeps,
  type GdprRepository,
  type GdprDeletionRequest,
  type GdprDeletionRequestInput,
  type GdprDeletionStatus,
  type PseudonymizationStatement,
  type ExecuteDeletionResult,
  type GdprDeletionRequestedEvent,
  type GdprDeletionExecutedEvent,
} from './gdpr-service.js';

export { DrizzleGdprRepository } from './drizzle-gdpr-repository.js';
