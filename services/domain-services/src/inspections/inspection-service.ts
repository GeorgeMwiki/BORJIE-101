import { randomHex } from '../common/id-generator.js';
/**
 * Inspection Service
 * Property inspection workflow for move-in, move-out, periodic, maintenance, and pre-listing inspections.
 * Supports photo uploads and e-signatures.
 */

import type {
  TenantId,
  UserId,
  PropertyId,
  UnitId,
  Result,
  PaginationParams,
  PaginatedResult,
} from '@borjie/domain-models';
import { ok, err } from '@borjie/domain-models';
import type { EventBus } from '../common/events.js';
import { createEventEnvelope, generateEventId } from '../common/events.js';
import type {
  Inspection,
  InspectionId,
  InspectionReport,
  InspectionItem,
  InspectionRoom,
  InspectionListFilters,
  InspectionComparison,
  DamageComparison,
  ESignature,
  ConditionRating,
} from './types.js';
import {
  asInspectionId,
  asRoomId,
  asInspectionItemId,
  INSPECTION_TYPES,
  CONDITION_RATINGS,
} from './types.js';
import type {
  InspectionScheduledEvent,
  InspectionCompletedEvent,
  InspectionSignedEvent,
  DamageIdentifiedEvent,
} from './events.js';
import { getRoomTemplateById } from './room-template.js';

// ============================================================================
// Repository Interface
// ============================================================================

export interface InspectionRepository {
  findById(id: InspectionId, tenantId: TenantId): Promise<Inspection | null>;
  findMany(
    tenantId: TenantId,
    filters: InspectionListFilters,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Inspection>>;
  create(inspection: Inspection): Promise<Inspection>;
  update(inspection: Inspection): Promise<Inspection>;
}

// ============================================================================
// Error Types
// ============================================================================

export const InspectionServiceError = {
  INSPECTION_NOT_FOUND: 'INSPECTION_NOT_FOUND',
  INVALID_STATUS: 'INVALID_STATUS',
  INVALID_TYPE: 'INVALID_TYPE',
  INVALID_CONDITION: 'INVALID_CONDITION',
  INVALID_INPUT: 'INVALID_INPUT',
  MOVE_IN_NOT_FOUND: 'MOVE_IN_NOT_FOUND',
  MOVE_OUT_NOT_FOUND: 'MOVE_OUT_NOT_FOUND',
} as const;

export type InspectionServiceErrorCode =
  (typeof InspectionServiceError)[keyof typeof InspectionServiceError];

export interface InspectionServiceErrorResult {
  code: InspectionServiceErrorCode;
  message: string;
}

// ============================================================================
// Condition Rating Order (for comparison - worse = higher index)
// ============================================================================

const CONDITION_ORDER: Record<ConditionRating, number> = {
  excellent: 0,
  good: 1,
  fair: 2,
  poor: 3,
  damaged: 4,
};

function compareConditions(moveIn: ConditionRating, moveOut: ConditionRating): 'worse' | 'same' | 'improved' {
  const inVal = CONDITION_ORDER[moveIn];
  const outVal = CONDITION_ORDER[moveOut];
  if (outVal > inVal) return 'worse';
  if (outVal < inVal) return 'improved';
  return 'same';
}

/** Ensure items and signatures are populated from report for convenience access */
function withConvenienceFields(inspection: Inspection): Inspection {
  if (!inspection.report) {
    return { ...inspection, items: [], signatures: [] };
  }
  return {
    ...inspection,
    items: inspection.report.items,
    signatures: inspection.report.signatures,
  };
}

// ============================================================================
// Inspection Service
// ============================================================================

export class InspectionService {
  constructor(
    private readonly repo: InspectionRepository,
    private readonly eventBus: EventBus
  ) {}

  /**
   * Schedule an inspection.
   * @param inspectorId - Inspector to assign (optional; defaults to createdBy)
   */
  async scheduleInspection(
    tenantId: TenantId,
    propertyId: PropertyId,
    unitId: UnitId,
    type: (typeof INSPECTION_TYPES)[number],
    scheduledDate: string,
    inspectorId?: UserId,
    options?: {
      createdBy?: UserId;
      correlationId?: string;
      scheduledTimeSlot?: string;
    }
  ): Promise<Result<Inspection, InspectionServiceErrorResult>> {
    if (!INSPECTION_TYPES.includes(type)) {
      return err({
        code: InspectionServiceError.INVALID_TYPE,
        message: `Invalid inspection type: ${type}`,
      });
    }

    const assignedTo = inspectorId ?? options?.createdBy;
    if (!assignedTo) {
      return err({
        code: InspectionServiceError.INVALID_INPUT,
        message: 'inspectorId or options.createdBy is required',
      });
    }

    const id = asInspectionId(`insp_${Date.now()}_${randomHex(4)}`);
    const now = new Date().toISOString();
    const createdBy = options?.createdBy ?? assignedTo;
    const correlationId = options?.correlationId ?? `corr_${Date.now()}`;

    const inspection: Inspection = {
      id,
      tenantId,
      propertyId,
      unitId,
      type,
      status: 'scheduled',
      scheduledDate,
      scheduledTimeSlot: options?.scheduledTimeSlot ?? null,
      inspector: assignedTo,
      assignedTo,
      startedAt: null,
      completedAt: null,
      report: null,
      items: [],
      signatures: [],
      linkedMoveInId: null,
      linkedMoveOutId: null,
      createdAt: now,
      updatedAt: now,
      createdBy,
      updatedBy: createdBy,
    };

    const saved = await this.repo.create(withConvenienceFields(inspection));

    const event: InspectionScheduledEvent = {
      eventId: generateEventId(),
      eventType: 'InspectionScheduled',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        inspectionId: saved.id,
        propertyId,
        unitId,
        type,
        scheduledDate,
        tenantId,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'Inspection'));

    return ok(withConvenienceFields(saved));
  }

  async startInspection(
    inspectionId: InspectionId,
    tenantId: TenantId,
    updatedBy: UserId
  ): Promise<Result<Inspection, InspectionServiceErrorResult>> {
    const inspection = await this.repo.findById(inspectionId, tenantId);
    if (!inspection) {
      return err({
        code: InspectionServiceError.INSPECTION_NOT_FOUND,
        message: 'Inspection not found',
      });
    }
    if (inspection.status !== 'scheduled') {
      return err({
        code: InspectionServiceError.INVALID_STATUS,
        message: `Cannot start inspection in status: ${inspection.status}`,
      });
    }

    const now = new Date().toISOString();
    const updated: Inspection = {
      ...inspection,
      status: 'in_progress',
      startedAt: now,
      updatedAt: now,
      updatedBy,
    };

    const saved = await this.repo.update(updated);
    return ok(saved);
  }

  async addInspectionItem(
    inspectionId: InspectionId,
    roomId: string,
    item: string,
    condition: (typeof CONDITION_RATINGS)[number],
    options: {
      photos?: readonly string[];
      notes?: string;
    },
    addedBy: UserId,
    tenantId: TenantId
  ): Promise<Result<Inspection, InspectionServiceErrorResult>> {
    const inspection = await this.repo.findById(inspectionId, tenantId);
    if (!inspection) {
      return err({
        code: InspectionServiceError.INSPECTION_NOT_FOUND,
        message: 'Inspection not found',
      });
    }
    if (inspection.status !== 'in_progress') {
      return err({
        code: InspectionServiceError.INVALID_STATUS,
        message: `Cannot add items to inspection in status: ${inspection.status}`,
      });
    }
    if (!CONDITION_RATINGS.includes(condition)) {
      return err({
        code: InspectionServiceError.INVALID_CONDITION,
        message: `Invalid condition rating: ${condition}`,
      });
    }

    const template = getRoomTemplateById(asRoomId(roomId));
    const roomName = template?.name ?? roomId;

    const itemId = asInspectionItemId(`item_${Date.now()}_${randomHex(4)}`);
    const now = new Date().toISOString();
    const inspectionItem: InspectionItem = {
      id: itemId,
      room: roomName,
      item,
      roomId: asRoomId(roomId),
      roomName,
      itemName: item,
      condition,
      photos: options.photos ?? [],
      notes: options.notes ?? null,
      addedAt: now,
      addedBy,
    };

    const existingItems = inspection.report?.items ?? [];
    const newItems = [...existingItems, inspectionItem];

    const roomsMap = new Map<string, InspectionRoom>();
    for (const i of newItems) {
      const key = i.roomId;
      if (!roomsMap.has(key)) {
        roomsMap.set(key, {
          id: i.roomId,
          name: i.roomName,
          items: [],
          photoUrls: [],
          notes: null,
        });
      }
      const room = roomsMap.get(key)!;
      roomsMap.set(key, {
        ...room,
        items: [...room.items, i],
        photoUrls: [...new Set([...room.photoUrls, ...i.photos])],
      });
    }

    const rooms = Array.from(roomsMap.values());
    const allPhotos = [...new Set(newItems.flatMap((i) => i.photos))];
    const report: InspectionReport = {
      inspectionId,
      rooms,
      items: newItems,
      photos: allPhotos,
      signatures: inspection.report?.signatures ?? [],
      inspectorNotes: inspection.report?.inspectorNotes ?? null,
      overallCondition: null,
      completedAt: null,
    };

    const updated: Inspection = {
      ...inspection,
      report,
      updatedAt: now,
      updatedBy: addedBy,
    };

    const saved = await this.repo.update(withConvenienceFields(updated));
    return ok(withConvenienceFields(saved));
  }

  /**
   * Complete an inspection with summary (inspector notes).
   * @param summary - Inspector notes/summary of the inspection
   */
  async completeInspection(
    inspectionId: InspectionId,
    tenantId: TenantId,
    summary: string,
    options?: {
      signatures?: readonly ESignature[];
      overallCondition?: (typeof CONDITION_RATINGS)[number];
      updatedBy?: UserId;
      correlationId?: string;
    }
  ): Promise<Result<Inspection, InspectionServiceErrorResult>> {
    const inspection = await this.repo.findById(inspectionId, tenantId);
    if (!inspection) {
      return err({
        code: InspectionServiceError.INSPECTION_NOT_FOUND,
        message: 'Inspection not found',
      });
    }
    if (inspection.status !== 'in_progress') {
      return err({
        code: InspectionServiceError.INVALID_STATUS,
        message: `Cannot complete inspection in status: ${inspection.status}`,
      });
    }

    const now = new Date().toISOString();
    const updatedBy = options?.updatedBy ?? inspection.assignedTo;
    const correlationId = options?.correlationId ?? `corr_${Date.now()}`;
    const existingReport = inspection.report ?? {
      inspectionId,
      rooms: [],
      items: [],
      photos: [],
      signatures: [],
      inspectorNotes: null,
      overallCondition: null,
      completedAt: null,
    };

    const report: InspectionReport = {
      ...existingReport,
      inspectorNotes: summary,
      signatures: options?.signatures ?? existingReport.signatures,
      overallCondition: options?.overallCondition ?? existingReport.overallCondition,
      completedAt: now,
    };

    const updated: Inspection = {
      ...inspection,
      status: 'completed',
      completedAt: now,
      report,
      updatedAt: now,
      updatedBy,
    };

    const saved = await this.repo.update(withConvenienceFields(updated));

    const event: InspectionCompletedEvent = {
      eventId: generateEventId(),
      eventType: 'InspectionCompleted',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        inspectionId: saved.id,
        propertyId: saved.propertyId,
        unitId: saved.unitId,
        type: saved.type,
        completedAt: now,
        status: saved.status,
        roomCount: report.rooms.length,
        itemCount: report.items.length,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'Inspection'));

    return ok(withConvenienceFields(saved));
  }

  /**
   * Add signature to an inspection. Publishes InspectionSignedEvent.
   */
  async signInspection(
    inspectionId: InspectionId,
    tenantId: TenantId,
    signerId: UserId,
    signature: ESignature,
    options?: { correlationId?: string }
  ): Promise<Result<Inspection, InspectionServiceErrorResult>> {
    const inspection = await this.repo.findById(inspectionId, tenantId);
    if (!inspection) {
      return err({
        code: InspectionServiceError.INSPECTION_NOT_FOUND,
        message: 'Inspection not found',
      });
    }
    if (inspection.status === 'cancelled') {
      return err({
        code: InspectionServiceError.INVALID_STATUS,
        message: 'Cannot sign cancelled inspection',
      });
    }

    const existingReport = inspection.report ?? {
      inspectionId,
      rooms: [],
      items: [],
      photos: [],
      signatures: [],
      inspectorNotes: null,
      overallCondition: null,
      completedAt: null,
    };

    const now = new Date().toISOString();
    const signatures = [...existingReport.signatures, signature];
    const report: InspectionReport = {
      ...existingReport,
      signatures,
    };

    const updated: Inspection = {
      ...inspection,
      report,
      updatedAt: now,
      updatedBy: signerId,
    };

    const saved = await this.repo.update(withConvenienceFields(updated));

    const correlationId = options?.correlationId ?? `corr_${Date.now()}`;
    const event: InspectionSignedEvent = {
      eventId: generateEventId(),
      eventType: 'InspectionSigned',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        inspectionId: saved.id,
        propertyId: saved.propertyId,
        unitId: saved.unitId,
        signerId,
        signerRole: signature.signerRole,
        signedAt: signature.signedAt,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'Inspection'));

    return ok(withConvenienceFields(saved));
  }

  async getInspectionReport(
    inspectionId: InspectionId,
    tenantId: TenantId
  ): Promise<Result<InspectionReport, InspectionServiceErrorResult>> {
    const inspection = await this.repo.findById(inspectionId, tenantId);
    if (!inspection) {
      return err({
        code: InspectionServiceError.INSPECTION_NOT_FOUND,
        message: 'Inspection not found',
      });
    }
    if (!inspection.report) {
      return err({
        code: InspectionServiceError.INVALID_STATUS,
        message: 'Inspection report not yet created',
      });
    }
    return ok(inspection.report);
  }

  /**
   * Compare move-in and move-out inspections for deposit deductions.
   */
  async compareInspections(
    moveInId: InspectionId,
    moveOutId: InspectionId,
    tenantId: TenantId,
    correlationId?: string
  ): Promise<Result<InspectionComparison, InspectionServiceErrorResult>> {
    const [moveIn, moveOut] = await Promise.all([
      this.repo.findById(moveInId, tenantId),
      this.repo.findById(moveOutId, tenantId),
    ]);

    if (!moveIn) {
      return err({
        code: InspectionServiceError.MOVE_IN_NOT_FOUND,
        message: 'Move-in inspection not found',
      });
    }
    if (!moveOut) {
      return err({
        code: InspectionServiceError.MOVE_OUT_NOT_FOUND,
        message: 'Move-out inspection not found',
      });
    }
    if (moveIn.type !== 'move_in') {
      return err({
        code: InspectionServiceError.INVALID_TYPE,
        message: 'First inspection must be move-in type',
      });
    }
    if (moveOut.type !== 'move_out') {
      return err({
        code: InspectionServiceError.INVALID_TYPE,
        message: 'Second inspection must be move-out type',
      });
    }

    const moveInItems = moveIn.report?.items ?? [];
    const moveOutItems = moveOut.report?.items ?? [];

    const moveInByKey = new Map<string, ConditionRating>();
    for (const i of moveInItems) {
      const key = `${i.roomName}|${i.itemName}`;
      moveInByKey.set(key, i.condition);
    }

    const damages: DamageComparison[] = [];
    const improvements: string[] = [];

    for (const outItem of moveOutItems) {
      const key = `${outItem.roomName}|${outItem.itemName}`;
      const moveInCondition = moveInByKey.get(key) ?? 'excellent';
      const delta = compareConditions(moveInCondition, outItem.condition);

      if (delta === 'worse') {
        damages.push({
          roomName: outItem.roomName,
          itemName: outItem.itemName,
          moveInCondition,
          moveOutCondition: outItem.condition,
          delta: 'worse',
          notes: outItem.notes,
          photoUrls: outItem.photos,
        });
      } else if (delta === 'improved') {
        improvements.push(`${outItem.roomName} - ${outItem.itemName}`);
      }
    }

    const estimatedDeduction = damages.length > 0 ? null : null;

    const comparison: InspectionComparison = {
      moveInId,
      moveOutId,
      propertyId: moveIn.propertyId,
      unitId: moveIn.unitId,
      damages,
      improvements,
      summary: {
        totalDamagedItems: damages.length,
        totalImprovedItems: improvements.length,
        estimatedDeduction,
      },
    };

    const corrId = correlationId ?? `corr_${Date.now()}`;
    if (damages.length > 0) {
      const damageEvent: DamageIdentifiedEvent = {
        eventId: generateEventId(),
        eventType: 'DamageIdentified',
        timestamp: new Date().toISOString(),
        tenantId,
        correlationId: corrId,
        causationId: null,
        metadata: {},
        payload: {
          moveInId,
          moveOutId,
          propertyId: moveIn.propertyId,
          unitId: moveIn.unitId,
          damages,
          totalDamagedItems: damages.length,
          estimatedDeduction,
        },
      };
      await this.eventBus.publish(
        createEventEnvelope(damageEvent, moveOutId, 'Inspection')
      );
    }

    return ok(comparison);
  }

  async listInspections(
    tenantId: TenantId,
    filters: InspectionListFilters,
    pagination?: PaginationParams
  ): Promise<Result<PaginatedResult<Inspection>, InspectionServiceErrorResult>> {
    const result = await this.repo.findMany(tenantId, filters, pagination);
    return ok({
      ...result,
      items: result.items.map(withConvenienceFields),
    });
  }

  /**
   * Get inspection history for a property.
   */
  async getPropertyInspectionHistory(
    propertyId: PropertyId,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<Result<PaginatedResult<Inspection>, InspectionServiceErrorResult>> {
    return this.listInspections(
      tenantId,
      { tenantId, propertyId },
      pagination
    );
  }

  // ==========================================================================
  // NEW: kind-dispatching factory (additive)
  // ==========================================================================

  /**
   * Create an inspection by high-level `kind`. This is an additive router
   * that picks the right underlying inspection `type` and delegates to the
   * existing `scheduleInspection` method.
   *
   * `kind` is a higher-level grouping than `type`:
   *   - 'move_in'             -> type 'move_in'
   *   - 'move_out'            -> type 'move_out'
   *   - 'routine'             -> type 'periodic'
   *   - 'conditional_survey'  -> type 'periodic' (flag only; survey body lives
   *                              in ConditionalSurveyService)
   */
  async createByKind(
    kind: 'move_in' | 'move_out' | 'routine' | 'conditional_survey',
    tenantId: TenantId,
    propertyId: PropertyId,
    unitId: UnitId,
    scheduledDate: string,
    inspectorId?: UserId,
    options?: {
      createdBy?: UserId;
      correlationId?: string;
      scheduledTimeSlot?: string;
    }
  ): Promise<Result<Inspection, InspectionServiceErrorResult>> {
    const kindToType: Record<
      'move_in' | 'move_out' | 'routine' | 'conditional_survey',
      (typeof INSPECTION_TYPES)[number]
    > = {
      move_in: 'move_in',
      move_out: 'move_out',
      routine: 'periodic',
      conditional_survey: 'periodic',
    };
    const type = kindToType[kind];
    if (!type) {
      return err({
        code: InspectionServiceError.INVALID_TYPE,
        message: `Invalid kind: ${kind}`,
      });
    }
    return this.scheduleInspection(
      tenantId,
      propertyId,
      unitId,
      type,
      scheduledDate,
      inspectorId,
      options
    );
  }

  /**
   * Mark a routine inspection as transitioning into a conditional survey.
   * This does NOT alter the underlying inspection record; it cancels the
   * in-progress inspection and returns a descriptor the caller can use to
   * create the conditional survey via `ConditionalSurveyService.scheduleSurvey`.
   */
  async transitionToConditionalSurvey(
    inspectionId: InspectionId,
    tenantId: TenantId,
    updatedBy: UserId
  ): Promise<
    Result<
      {
        readonly inspection: Inspection;
        readonly transitionedAt: string;
      },
      InspectionServiceErrorResult
    >
  > {
    const inspection = await this.repo.findById(inspectionId, tenantId);
    if (!inspection) {
      return err({
        code: InspectionServiceError.INSPECTION_NOT_FOUND,
        message: 'Inspection not found',
      });
    }
    if (
      inspection.status !== 'in_progress' &&
      inspection.status !== 'scheduled'
    ) {
      return err({
        code: InspectionServiceError.INVALID_STATUS,
        message: `Cannot transition inspection in status: ${inspection.status}`,
      });
    }

    const now = new Date().toISOString();
    const updated: Inspection = {
      ...inspection,
      status: 'cancelled',
      updatedAt: now,
      updatedBy,
    };
    const saved = await this.repo.update(withConvenienceFields(updated));

    return ok({ inspection: saved, transitionedAt: now });
  }
}
