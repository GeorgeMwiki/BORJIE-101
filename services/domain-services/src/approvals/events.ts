/**
 * Approval Workflow Domain Events
 * For approval alerts and notification integration
 */

import type { TenantId, UserId } from '@borjie/domain-models';
import type { ApprovalRequestId, ApprovalType, ApprovalRequestDetails } from './types.js';

/** Base structure for approval events */
interface ApprovalEventBase {
  readonly eventId: string;
  readonly eventType: string;
  readonly timestamp: string;
  readonly tenantId: TenantId;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly metadata: Record<string, unknown>;
}

/** Triggered when an approval request is created */
export interface ApprovalRequestedEvent extends ApprovalEventBase {
  readonly eventType: 'ApprovalRequested';
  readonly payload: {
    readonly requestId: ApprovalRequestId;
    readonly type: ApprovalType;
    readonly requesterId: UserId;
    readonly approverId: UserId | null;
    readonly amount: number | null;
    readonly currency: string | null;
    readonly justification: string;
    readonly details: ApprovalRequestDetails;
  };
}

/** Triggered when an approval request is approved */
export interface ApprovalGrantedEvent extends ApprovalEventBase {
  readonly eventType: 'ApprovalGranted';
  readonly payload: {
    readonly requestId: ApprovalRequestId;
    readonly type: ApprovalType;
    readonly approverId: UserId;
    readonly comments: string | null;
  };
}

/** Triggered when an approval request is rejected */
export interface ApprovalRejectedEvent extends ApprovalEventBase {
  readonly eventType: 'ApprovalRejected';
  readonly payload: {
    readonly requestId: ApprovalRequestId;
    readonly type: ApprovalType;
    readonly approverId: UserId;
    readonly reason: string;
  };
}

/** Triggered when an approval request is escalated */
export interface ApprovalEscalatedEvent extends ApprovalEventBase {
  readonly eventType: 'ApprovalEscalated';
  readonly payload: {
    readonly requestId: ApprovalRequestId;
    readonly type: ApprovalType;
    readonly escalatedToUserId: UserId;
    readonly reason: string;
    readonly previousApproverId: UserId | null;
  };
}

export type ApprovalEvent =
  | ApprovalRequestedEvent
  | ApprovalGrantedEvent
  | ApprovalRejectedEvent
  | ApprovalEscalatedEvent;
