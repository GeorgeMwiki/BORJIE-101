/**
 * Onboarding Domain Events
 * Module A - Tenant Onboarding per BORJIE_SPEC.md
 */

import type { TenantId, UserId, CustomerId, LeaseId } from '@borjie/domain-models';
import type { OnboardingSessionId, OnboardingState, ChecklistStepId } from './types.js';
import type { ProcedureId } from './types.js';

/** Base structure for onboarding events */
interface OnboardingEventBase {
  readonly eventId: string;
  readonly eventType: string;
  readonly timestamp: string;
  readonly tenantId: TenantId;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly metadata: Record<string, unknown>;
}

/** Triggered when onboarding starts */
export interface OnboardingStartedEvent extends OnboardingEventBase {
  readonly eventType: 'OnboardingStarted';
  readonly payload: {
    readonly sessionId: OnboardingSessionId;
    readonly customerId: CustomerId;
    readonly leaseId: LeaseId;
    readonly moveInDate: string;
    readonly language: 'en' | 'sw';
  };
}

/** Triggered when a step is completed */
export interface OnboardingStepCompletedEvent extends OnboardingEventBase {
  readonly eventType: 'OnboardingStepCompleted';
  readonly payload: {
    readonly sessionId: OnboardingSessionId;
    readonly stepId: ChecklistStepId;
    readonly previousState: OnboardingState;
    readonly newState: OnboardingState;
    readonly completedBy: UserId | null;
  };
}

/** Triggered when onboarding is fully completed */
export interface OnboardingCompletedEvent extends OnboardingEventBase {
  readonly eventType: 'OnboardingCompleted';
  readonly payload: {
    readonly sessionId: OnboardingSessionId;
    readonly customerId: CustomerId;
    readonly leaseId: LeaseId;
    readonly completedAt: string;
  };
}

/** Triggered when move-in inspection is submitted */
export interface MoveInInspectionSubmittedEvent extends OnboardingEventBase {
  readonly eventType: 'MoveInInspectionSubmitted';
  readonly payload: {
    readonly sessionId: OnboardingSessionId;
    readonly reportId: string;
    readonly roomCount: number;
    readonly meterReadingCount: number;
    readonly submittedBy: UserId;
  };
}

/** Triggered when procedure training is completed */
export interface ProcedureTrainingCompletedEvent extends OnboardingEventBase {
  readonly eventType: 'ProcedureTrainingCompleted';
  readonly payload: {
    readonly sessionId: OnboardingSessionId;
    readonly procedureId: ProcedureId;
    readonly completedBy: UserId | null;
    readonly comprehensionConfirmed: boolean;
  };
}

export type OnboardingEvent =
  | OnboardingStartedEvent
  | OnboardingStepCompletedEvent
  | OnboardingCompletedEvent
  | MoveInInspectionSubmittedEvent
  | ProcedureTrainingCompletedEvent;
