/**
 * FarService (NEW 16)
 *
 * Fitness-for-Assessment Review: tracks individual asset components
 * (roofs, boilers, lifts...) with a monitoring cadence that drives
 * condition-check events.
 *
 * Public API:
 *   addComponent, assignMonitoring (auto-schedules first check),
 *   logCheck, getScheduledChecks.
 */

import { randomHex } from '../../common/id-generator.js';
import type {
  TenantId,
  UserId,
  PropertyId,
  UnitId,
  Result,
  ISOTimestamp,
} from '@borjie/domain-models';
import { ok, err } from '@borjie/domain-models';
import type { EventBus } from '../../common/events.js';
import { createEventEnvelope, generateEventId } from '../../common/events.js';
import type {
  AssetComponent,
  AssetComponentId,
  AssetComponentStatus,
  AssetComponentCondition,
  FarAssignment,
  FarAssignmentId,
  FarCheckFrequency,
  ConditionCheckEvent,
  ConditionCheckEventId,
  ConditionCheckOutcome,
  NotifyRecipient,
  FarRepository,
  FarServiceErrorResult,
} from './types.js';
import {
  asAssetComponentId,
  asFarAssignmentId,
  asConditionCheckEventId,
  FarServiceError,
  FAR_CHECK_FREQUENCIES,
} from './types.js';

// ============================================================================
// Frequency -> Days
// ============================================================================

const FREQUENCY_DAYS: Record<FarCheckFrequency, number | null> = {
  weekly: 7,
  monthly: 30,
  quarterly: 90,
  biannual: 180,
  annual: 365,
  ad_hoc: null,
};

function addDaysIso(from: ISOTimestamp, days: number): ISOTimestamp {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString() as ISOTimestamp;
}

function nowIso(): ISOTimestamp {
  return new Date().toISOString() as ISOTimestamp;
}

// ============================================================================
// Inputs
// ============================================================================

export interface AddComponentInput {
  readonly tenantId: TenantId;
  readonly propertyId: PropertyId;
  readonly unitId?: UnitId | null;
  readonly code: string;
  readonly name: string;
  readonly category?: string;
  readonly manufacturer?: string;
  readonly modelNumber?: string;
  readonly serialNumber?: string;
  readonly installedAt?: ISOTimestamp;
  readonly expectedLifespanMonths?: number;
  readonly status?: AssetComponentStatus;
  readonly currentCondition?: AssetComponentCondition;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly createdBy: UserId;
}

export interface AssignMonitoringInput {
  readonly tenantId: TenantId;
  readonly componentId: AssetComponentId;
  readonly frequency: FarCheckFrequency;
  readonly assignedTo?: UserId | null;
  readonly firstCheckDueAt?: ISOTimestamp;
  readonly notifyRecipients?: readonly NotifyRecipient[];
  readonly triggerRules?: Readonly<Record<string, unknown>>;
  readonly createdBy: UserId;
}

export interface LogCheckInput {
  readonly tenantId: TenantId;
  readonly assignmentId: FarAssignmentId;
  readonly performedBy: UserId;
  readonly outcome: ConditionCheckOutcome;
  readonly conditionAfter?: AssetComponentCondition;
  readonly notes?: string;
  readonly photos?: readonly string[];
  readonly measurements?: Readonly<Record<string, unknown>>;
  readonly performedAt?: ISOTimestamp;
}

// ============================================================================
// Service
// ============================================================================

export class FarService {
  constructor(
    private repo: FarRepository,
    private readonly eventBus: EventBus
  ) {}

  /** Additive Wave 3 hook — attach the live Postgres repo at runtime. */
  attachRepository(repo: FarRepository): void {
    this.repo = repo;
  }

  async addComponent(
    input: AddComponentInput
  ): Promise<Result<AssetComponent, FarServiceErrorResult>> {
    if (!input.code || !input.name) {
      return err({
        code: FarServiceError.INVALID_INPUT,
        message: 'code and name are required',
      });
    }

    const id = asAssetComponentId(`cmp_${Date.now()}_${randomHex(4)}`);
    const now = nowIso();
    const component: AssetComponent = {
      id,
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      unitId: input.unitId ?? null,
      code: input.code,
      name: input.name,
      category: input.category ?? null,
      manufacturer: input.manufacturer ?? null,
      modelNumber: input.modelNumber ?? null,
      serialNumber: input.serialNumber ?? null,
      installedAt: input.installedAt ?? null,
      expectedLifespanMonths: input.expectedLifespanMonths ?? null,
      status: input.status ?? 'active',
      currentCondition: input.currentCondition ?? 'good',
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
    };

    const saved = await this.repo.createComponent(component);
    return ok(saved);
  }

  async assignMonitoring(
    input: AssignMonitoringInput
  ): Promise<Result<FarAssignment, FarServiceErrorResult>> {
    if (!FAR_CHECK_FREQUENCIES.includes(input.frequency)) {
      return err({
        code: FarServiceError.INVALID_INPUT,
        message: `Invalid frequency: ${input.frequency}`,
      });
    }

    const component = await this.repo.findComponentById(
      input.componentId,
      input.tenantId
    );
    if (!component) {
      return err({
        code: FarServiceError.COMPONENT_NOT_FOUND,
        message: 'Component not found',
      });
    }
    if (component.tenantId !== input.tenantId) {
      return err({
        code: FarServiceError.TENANT_MISMATCH,
        message: 'Component belongs to a different tenant',
      });
    }

    const now = nowIso();
    const days = FREQUENCY_DAYS[input.frequency];
    const firstDue: ISOTimestamp | null =
      input.firstCheckDueAt ?? (days !== null ? addDaysIso(now, days) : null);

    const assignment: FarAssignment = {
      id: asFarAssignmentId(`far_${Date.now()}_${randomHex(4)}`),
      tenantId: input.tenantId,
      componentId: input.componentId,
      assignedTo: input.assignedTo ?? null,
      frequency: input.frequency,
      status: 'active',
      triggerRules: input.triggerRules ?? {},
      firstCheckDueAt: firstDue,
      nextCheckDueAt: firstDue,
      lastCheckedAt: null,
      notifyRecipients: input.notifyRecipients ?? [],
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
    };

    const saved = await this.repo.createAssignment(assignment);

    // Auto-schedule the first condition-check event (skipped outcome, due now+period).
    if (firstDue) {
      const firstEvent: ConditionCheckEvent = {
        id: asConditionCheckEventId(`ccev_${Date.now()}_${randomHex(4)}`),
        tenantId: input.tenantId,
        farAssignmentId: saved.id,
        componentId: input.componentId,
        performedBy: null,
        dueAt: firstDue,
        performedAt: null,
        outcome: 'skipped',
        conditionAfter: null,
        notes: null,
        photos: [],
        measurements: {},
        notificationsLog: [],
        createdAt: now,
        updatedAt: now,
      };
      await this.repo.createCheckEvent(firstEvent);
    }

    return ok(saved);
  }

  async logCheck(
    input: LogCheckInput
  ): Promise<Result<ConditionCheckEvent, FarServiceErrorResult>> {
    const assignment = await this.repo.findAssignmentById(
      input.assignmentId,
      input.tenantId
    );
    if (!assignment) {
      return err({
        code: FarServiceError.ASSIGNMENT_NOT_FOUND,
        message: 'FAR assignment not found',
      });
    }
    if (assignment.tenantId !== input.tenantId) {
      return err({
        code: FarServiceError.TENANT_MISMATCH,
        message: 'Assignment belongs to a different tenant',
      });
    }
    if (assignment.status !== 'active') {
      return err({
        code: FarServiceError.INVALID_STATUS,
        message: `Cannot log check on assignment in status: ${assignment.status}`,
      });
    }

    const now = input.performedAt ?? nowIso();
    const event: ConditionCheckEvent = {
      id: asConditionCheckEventId(`ccev_${Date.now()}_${randomHex(4)}`),
      tenantId: input.tenantId,
      farAssignmentId: input.assignmentId,
      componentId: assignment.componentId,
      performedBy: input.performedBy,
      dueAt: assignment.nextCheckDueAt,
      performedAt: now,
      outcome: input.outcome,
      conditionAfter: input.conditionAfter ?? null,
      notes: input.notes ?? null,
      photos: input.photos ?? [],
      measurements: input.measurements ?? {},
      notificationsLog: [],
      createdAt: now,
      updatedAt: now,
    };

    const saved = await this.repo.createCheckEvent(event);

    // Advance the assignment: bump lastCheckedAt and nextCheckDueAt.
    const days = FREQUENCY_DAYS[assignment.frequency];
    const updated: FarAssignment = {
      ...assignment,
      lastCheckedAt: now,
      nextCheckDueAt: days !== null ? addDaysIso(now, days) : null,
      updatedAt: now,
      updatedBy: input.performedBy,
    };
    await this.repo.updateAssignment(updated);

    // Emit event for observers (cases, notifications).
    await this.eventBus.publish(
      createEventEnvelope(
        {
          eventId: generateEventId(),
          eventType: 'FarConditionCheckLogged',
          timestamp: now,
          tenantId: input.tenantId,
          correlationId: `corr_${Date.now()}`,
          causationId: null,
          metadata: {},
          payload: {
            assignmentId: assignment.id,
            componentId: assignment.componentId,
            outcome: input.outcome,
            conditionAfter: input.conditionAfter ?? null,
          },
        },
        saved.id,
        'FarConditionCheck'
      )
    );

    return ok(saved);
  }

  async getScheduledChecks(
    tenantId: TenantId,
    componentId?: AssetComponentId
  ): Promise<Result<readonly ConditionCheckEvent[], FarServiceErrorResult>> {
    const events = await this.repo.findScheduledChecks(tenantId, componentId);
    return ok(events);
  }
}
