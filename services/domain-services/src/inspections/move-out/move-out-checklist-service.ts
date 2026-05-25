/**
 * MoveOutChecklistService (NEW 19)
 *
 * End-of-tenancy workflow that complements — but does not replace — the
 * existing inspection service. Wraps the underlying `InspectionRepository`
 * with move-out-specific orchestration:
 *
 *   startInspection -> captureFindings -> selfCheckout | dualSign -> fileDamageClaim
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
  Inspection,
  InspectionId,
  InspectionItem,
  InspectionReport,
  InspectionRoom,
  ESignature,
  ConditionRating,
} from '../types.js';
import {
  asInspectionId,
  asRoomId,
  asInspectionItemId,
} from '../types.js';
import type { InspectionRepository } from '../inspection-service.js';
import { InspectionServiceError } from '../inspection-service.js';
import { MOVE_OUT_TEMPLATE } from './move-out-template.js';
import {
  compareMoveInMoveOutPhotos,
  type PhotoComparisonManifest,
} from './photo-comparator.js';

// ============================================================================
// Error codes (superset of inspection service)
// ============================================================================

export const MoveOutServiceError = {
  ...InspectionServiceError,
  SELF_CHECKOUT_DISABLED: 'SELF_CHECKOUT_DISABLED',
  MISSING_SIGNATURES: 'MISSING_SIGNATURES',
} as const;

export type MoveOutServiceErrorCode =
  (typeof MoveOutServiceError)[keyof typeof MoveOutServiceError];

export interface MoveOutServiceErrorResult {
  code: MoveOutServiceErrorCode;
  message: string;
}

// ============================================================================
// Damage claim stub
// ============================================================================

export interface DamageClaimHandoff {
  readonly caseRefHint: string;
  readonly moveInId: InspectionId | null;
  readonly moveOutId: InspectionId;
  readonly photoManifest: PhotoComparisonManifest;
  readonly note: string;
}

export interface DamageDeductionCaseSink {
  /**
   * Hands the damage information off to the damage-deduction case machinery.
   * The actual case creation is the caller's responsibility; this service
   * only produces the handoff payload.
   */
  handoff(input: DamageClaimHandoff): Promise<{ caseId: string }>;
}

// ============================================================================
// Service
// ============================================================================

export interface StartMoveOutInput {
  readonly tenantId: TenantId;
  readonly propertyId: PropertyId;
  readonly unitId: UnitId;
  readonly inspectorId: UserId;
  readonly scheduledDate: ISOTimestamp;
  readonly linkedMoveInId?: InspectionId | null;
  readonly selfCheckoutAllowed?: boolean;
  readonly createdBy?: UserId;
}

export interface CaptureFindingInput {
  readonly tenantId: TenantId;
  readonly inspectionId: InspectionId;
  readonly roomId: string;
  readonly itemName: string;
  readonly condition: ConditionRating;
  readonly notes?: string;
  readonly photos?: readonly string[];
  readonly addedBy: UserId;
}

export interface SelfCheckoutInput {
  readonly tenantId: TenantId;
  readonly inspectionId: InspectionId;
  readonly tenantSignature: ESignature;
}

export interface DualSignInput {
  readonly tenantId: TenantId;
  readonly inspectionId: InspectionId;
  readonly tenantSignature: ESignature;
  readonly landlordSignature: ESignature;
}

export interface FileDamageClaimInput {
  readonly tenantId: TenantId;
  readonly moveOutInspectionId: InspectionId;
  readonly moveInInspectionId?: InspectionId | null;
  readonly note?: string;
  readonly filedBy: UserId;
}

export class MoveOutChecklistService {
  constructor(
    private readonly repo: InspectionRepository,
    private readonly eventBus: EventBus,
    private readonly damageSink?: DamageDeductionCaseSink
  ) {}

  /** Metadata about move-out inspections, independent of storage. */
  private readonly selfCheckoutFlags = new Map<string, boolean>();

  async startInspection(
    input: StartMoveOutInput
  ): Promise<Result<Inspection, MoveOutServiceErrorResult>> {
    const id = asInspectionId(`insp_${Date.now()}_${randomHex(4)}`);
    const now = new Date().toISOString() as ISOTimestamp;
    const createdBy = input.createdBy ?? input.inspectorId;

    const inspection: Inspection = {
      id,
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      unitId: input.unitId,
      type: 'move_out',
      status: 'in_progress',
      scheduledDate: input.scheduledDate,
      scheduledTimeSlot: null,
      inspector: input.inspectorId,
      assignedTo: input.inspectorId,
      startedAt: now,
      completedAt: null,
      report: {
        inspectionId: id,
        rooms: [],
        items: [],
        photos: [],
        signatures: [],
        inspectorNotes: null,
        overallCondition: null,
        completedAt: null,
      },
      items: [],
      signatures: [],
      linkedMoveInId: input.linkedMoveInId ?? null,
      linkedMoveOutId: null,
      createdAt: now,
      updatedAt: now,
      createdBy,
      updatedBy: createdBy,
    };

    const saved = await this.repo.create(inspection);

    // Track self-checkout flag locally (persisted to inspection_extensions
    // by the repository adapter layer — not this service's concern).
    this.selfCheckoutFlags.set(
      saved.id,
      input.selfCheckoutAllowed ?? MOVE_OUT_TEMPLATE.supportsSelfCheckout
    );

    return ok(saved);
  }

  async captureFindings(
    input: CaptureFindingInput
  ): Promise<Result<Inspection, MoveOutServiceErrorResult>> {
    const inspection = await this.repo.findById(
      input.inspectionId,
      input.tenantId
    );
    if (!inspection) {
      return err({
        code: MoveOutServiceError.INSPECTION_NOT_FOUND,
        message: 'Inspection not found',
      });
    }
    if (inspection.tenantId !== input.tenantId) {
      return err({
        code: MoveOutServiceError.INSPECTION_NOT_FOUND,
        message: 'Inspection not found for tenant',
      });
    }
    if (inspection.type !== 'move_out') {
      return err({
        code: MoveOutServiceError.INVALID_TYPE,
        message: 'Not a move-out inspection',
      });
    }
    if (inspection.status !== 'in_progress') {
      return err({
        code: MoveOutServiceError.INVALID_STATUS,
        message: `Cannot capture findings in status: ${inspection.status}`,
      });
    }

    const now = new Date().toISOString() as ISOTimestamp;
    const itemId = asInspectionItemId(`item_${Date.now()}_${randomHex(4)}`);
    const newItem: InspectionItem = {
      id: itemId,
      room: input.roomId,
      item: input.itemName,
      roomId: asRoomId(input.roomId),
      roomName: input.roomId,
      itemName: input.itemName,
      condition: input.condition,
      photos: input.photos ?? [],
      notes: input.notes ?? null,
      addedAt: now,
      addedBy: input.addedBy,
    };

    const existingItems = inspection.report?.items ?? [];
    const items = [...existingItems, newItem];
    const roomsMap = new Map<string, InspectionRoom>();
    for (const i of items) {
      const key = i.roomId as string;
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

    const report: InspectionReport = {
      inspectionId: inspection.id,
      rooms: Array.from(roomsMap.values()),
      items,
      photos: [...new Set(items.flatMap((i) => i.photos))],
      signatures: inspection.report?.signatures ?? [],
      inspectorNotes: inspection.report?.inspectorNotes ?? null,
      overallCondition: inspection.report?.overallCondition ?? null,
      completedAt: null,
    };

    const updated: Inspection = {
      ...inspection,
      report,
      items,
      signatures: report.signatures,
      updatedAt: now,
      updatedBy: input.addedBy,
    };

    const saved = await this.repo.update(updated);
    return ok(saved);
  }

  async selfCheckout(
    input: SelfCheckoutInput
  ): Promise<Result<Inspection, MoveOutServiceErrorResult>> {
    const inspection = await this.repo.findById(
      input.inspectionId,
      input.tenantId
    );
    if (!inspection) {
      return err({
        code: MoveOutServiceError.INSPECTION_NOT_FOUND,
        message: 'Inspection not found',
      });
    }
    if (inspection.tenantId !== input.tenantId) {
      return err({
        code: MoveOutServiceError.INSPECTION_NOT_FOUND,
        message: 'Inspection not found for tenant',
      });
    }
    const allowed = this.selfCheckoutFlags.get(inspection.id) ?? false;
    if (!allowed) {
      return err({
        code: MoveOutServiceError.SELF_CHECKOUT_DISABLED,
        message: 'Self-checkout not allowed for this inspection',
      });
    }

    const now = new Date().toISOString() as ISOTimestamp;
    const existingReport = inspection.report ?? {
      inspectionId: inspection.id,
      rooms: [],
      items: [],
      photos: [],
      signatures: [],
      inspectorNotes: null,
      overallCondition: null,
      completedAt: null,
    };
    const signatures = [...existingReport.signatures, input.tenantSignature];
    const report: InspectionReport = {
      ...existingReport,
      signatures,
      completedAt: now,
    };

    const updated: Inspection = {
      ...inspection,
      status: 'completed',
      completedAt: now,
      report,
      items: report.items,
      signatures,
      updatedAt: now,
      updatedBy: input.tenantSignature.signerUserId,
    };
    const saved = await this.repo.update(updated);

    await this.eventBus.publish(
      createEventEnvelope(
        {
          eventId: generateEventId(),
          eventType: 'MoveOutSelfCheckoutCompleted',
          timestamp: now,
          tenantId: input.tenantId,
          correlationId: `corr_${Date.now()}`,
          causationId: null,
          metadata: {},
          payload: {
            inspectionId: saved.id,
            tenantSignatureAt: input.tenantSignature.signedAt,
          },
        },
        saved.id,
        'Inspection'
      )
    );

    return ok(saved);
  }

  async dualSign(
    input: DualSignInput
  ): Promise<Result<Inspection, MoveOutServiceErrorResult>> {
    const inspection = await this.repo.findById(
      input.inspectionId,
      input.tenantId
    );
    if (!inspection) {
      return err({
        code: MoveOutServiceError.INSPECTION_NOT_FOUND,
        message: 'Inspection not found',
      });
    }
    if (inspection.tenantId !== input.tenantId) {
      return err({
        code: MoveOutServiceError.INSPECTION_NOT_FOUND,
        message: 'Inspection not found for tenant',
      });
    }
    if (
      !input.tenantSignature ||
      !input.landlordSignature ||
      input.tenantSignature.signerRole === input.landlordSignature.signerRole
    ) {
      return err({
        code: MoveOutServiceError.MISSING_SIGNATURES,
        message: 'Both tenant and landlord signatures are required',
      });
    }

    const now = new Date().toISOString() as ISOTimestamp;
    const existingReport = inspection.report ?? {
      inspectionId: inspection.id,
      rooms: [],
      items: [],
      photos: [],
      signatures: [],
      inspectorNotes: null,
      overallCondition: null,
      completedAt: null,
    };
    const signatures = [
      ...existingReport.signatures,
      input.tenantSignature,
      input.landlordSignature,
    ];
    const report: InspectionReport = {
      ...existingReport,
      signatures,
      completedAt: now,
    };
    const updated: Inspection = {
      ...inspection,
      status: 'completed',
      completedAt: now,
      report,
      items: report.items,
      signatures,
      updatedAt: now,
      updatedBy: input.landlordSignature.signerUserId,
    };
    const saved = await this.repo.update(updated);
    return ok(saved);
  }

  async fileDamageClaim(
    input: FileDamageClaimInput
  ): Promise<Result<DamageClaimHandoff, MoveOutServiceErrorResult>> {
    const moveOut = await this.repo.findById(
      input.moveOutInspectionId,
      input.tenantId
    );
    if (!moveOut) {
      return err({
        code: MoveOutServiceError.INSPECTION_NOT_FOUND,
        message: 'Move-out inspection not found',
      });
    }
    if (moveOut.tenantId !== input.tenantId) {
      return err({
        code: MoveOutServiceError.INSPECTION_NOT_FOUND,
        message: 'Inspection not found for tenant',
      });
    }

    const moveInId = input.moveInInspectionId ?? moveOut.linkedMoveInId;
    const moveIn = moveInId
      ? await this.repo.findById(moveInId, input.tenantId)
      : null;

    const manifest = compareMoveInMoveOutPhotos(
      moveIn?.report?.items ?? [],
      moveOut.report?.items ?? []
    );

    const handoff: DamageClaimHandoff = {
      caseRefHint: `damage_${moveOut.id}_${Date.now().toString(36)}`,
      moveInId: moveIn?.id ?? null,
      moveOutId: moveOut.id,
      photoManifest: manifest,
      note: input.note ?? 'Move-out damage claim filed',
    };

    // Stub hand-off: if a sink is wired, forward. Otherwise return the
    // manifest for the caller to route into the damage-deduction case flow.
    // Follow-up KI-007 (Docs/TODO_BACKLOG.md): wire to AI persona — generate a narrative description
    //   of observed damage from the photo manifest before hand-off.
    //   See Docs/KNOWN_ISSUES.md#ki-007.
    if (this.damageSink) {
      await this.damageSink.handoff(handoff);
    }

    return ok(handoff);
  }
}
