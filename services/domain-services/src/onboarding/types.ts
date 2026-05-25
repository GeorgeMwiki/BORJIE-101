/**
 * Onboarding Workflow Types
 * Module A - Tenant Onboarding per BORJIE_SPEC.md
 */

import type {
  TenantId,
  UserId,
  ISOTimestamp,
} from '@borjie/domain-models';
import type { CustomerId, LeaseId } from '@borjie/domain-models';
import type { PropertyId, UnitId } from '@borjie/domain-models';

/** Branded ID for onboarding session */
export type OnboardingSessionId = string & { __brand: 'OnboardingSessionId' };
export function asOnboardingSessionId(id: string): OnboardingSessionId {
  return id as OnboardingSessionId;
}

/** Branded ID for procedure */
export type ProcedureId = string & { __brand: 'ProcedureId' };
export function asProcedureId(id: string): ProcedureId {
  return id as ProcedureId;
}

// ============================================================================
// State Machine (per spec A0–A6)
// ============================================================================

export const ONBOARDING_STATES = [
  'PRE_MOVE_IN',
  'WELCOME',
  'UTILITIES_TRAINING',
  'PROPERTY_ORIENTATION',
  'MOVE_IN_INSPECTION',
  'COMMUNITY_INFO',
  'COMPLETED',
] as const;

export type OnboardingState = (typeof ONBOARDING_STATES)[number];

export const ONBOARDING_STATE_ORDER: readonly OnboardingState[] =
  ONBOARDING_STATES;

/** Get next state in the flow */
export function getNextState(
  current: OnboardingState
): OnboardingState | null {
  const idx = ONBOARDING_STATE_ORDER.indexOf(current);
  if (idx < 0 || idx >= ONBOARDING_STATE_ORDER.length - 1) return null;
  const next = ONBOARDING_STATE_ORDER[idx + 1];
  return next ?? null;
}

// ============================================================================
// OnboardingSession
// ============================================================================

export interface OnboardingSession {
  readonly id: OnboardingSessionId;
  readonly tenantId: TenantId;
  readonly customerId: CustomerId;
  readonly leaseId: LeaseId;
  readonly propertyId?: PropertyId;
  readonly unitId?: UnitId;
  readonly state: OnboardingState;
  readonly language: 'en' | 'sw';
  readonly preferredChannel: 'whatsapp' | 'sms' | 'email' | 'app' | 'voice';
  readonly moveInDate: ISOTimestamp;
  readonly checklist: OnboardingChecklist;
  readonly procedureCompletionLog: ProcedureCompletionLog[];
  readonly moveInConditionReport: MoveInConditionReport | null;
  readonly utilitySetupRecords: UtilitySetupRecord[];
  readonly welcomePackGeneratedAt: ISOTimestamp | null;
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
  readonly createdBy: UserId;
  readonly updatedBy: UserId;
}

// ============================================================================
// OnboardingChecklist
// ============================================================================

export type ChecklistStepId =
  | 'pre_move_in'
  | 'welcome'
  | 'utilities_training'
  | 'property_orientation'
  | 'move_in_inspection'
  | 'community_info'
  | 'completed';

export interface ChecklistItem {
  readonly stepId: ChecklistStepId;
  readonly labelEn: string;
  readonly labelSw: string;
  readonly completed: boolean;
  readonly completedAt: ISOTimestamp | null;
  readonly completedBy: UserId | null;
}

export interface OnboardingChecklist {
  readonly items: readonly ChecklistItem[];
  readonly completedCount: number;
}

// ============================================================================
// MoveInConditionReport
// ============================================================================

export interface RoomInspection {
  readonly roomName: string;
  readonly roomNameSw: string;
  readonly condition: 'good' | 'fair' | 'damaged' | 'not_applicable';
  readonly notes: string | null;
  readonly photoUrls: readonly string[];
  readonly videoUrl: string | null;
}

export interface MeterReading {
  readonly meterType: 'electricity' | 'water' | 'gas' | 'other';
  readonly meterNumber: string;
  readonly reading: string;
  readonly unit: string;
  readonly photoUrl: string | null;
}

export interface KeyHandover {
  readonly item: string;
  readonly itemSw: string;
  readonly quantity: number;
  readonly notes: string | null;
}

export interface ApplianceCheck {
  readonly appliance: string;
  readonly applianceSw: string;
  readonly status: 'working' | 'not_working' | 'not_tested';
  readonly notes: string | null;
  readonly photoUrl: string | null;
}

export interface MoveInConditionReport {
  readonly id: string;
  readonly sessionId: OnboardingSessionId;
  readonly rooms: readonly RoomInspection[];
  readonly meterReadings: readonly MeterReading[];
  readonly keysHandover: readonly KeyHandover[];
  readonly applianceChecks: readonly ApplianceCheck[];
  readonly tenantSignature: string | null;
  readonly managerSignature: string | null;
  readonly signedAt: ISOTimestamp | null;
  readonly submittedAt: ISOTimestamp;
  readonly submittedBy: UserId;
}

// ============================================================================
// ProcedureCompletionLog
// ============================================================================

export interface ProcedureCompletionLog {
  readonly procedureId: ProcedureId;
  readonly procedureTitleEn: string;
  readonly procedureTitleSw: string;
  readonly completedAt: ISOTimestamp;
  readonly completedBy: UserId | null;
  readonly comprehensionConfirmed: boolean;
  readonly channel: 'whatsapp' | 'app' | 'voice' | 'in_person';
}

// ============================================================================
// UtilitySetupRecord
// ============================================================================

export type UtilityType = 'electricity' | 'water' | 'internet' | 'waste' | 'gas';

export interface UtilitySetupRecord {
  readonly utilityType: UtilityType;
  readonly responsibility: 'tenant' | 'landlord' | 'shared';
  readonly meterReference: string | null;
  readonly provider: string | null;
  readonly notes: string | null;
  readonly acknowledgedAt: ISOTimestamp;
  readonly acknowledgedBy: UserId;
}

// ============================================================================
// Welcome Pack
// ============================================================================

export interface WelcomePack {
  readonly sessionId: OnboardingSessionId;
  readonly generatedAt: ISOTimestamp;
  readonly sections: readonly WelcomePackSection[];
  readonly language: 'en' | 'sw';
}

export interface WelcomePackSection {
  readonly id: string;
  readonly titleEn: string;
  readonly titleSw: string;
  readonly contentEn: string;
  readonly contentSw: string;
  readonly order: number;
}

// ============================================================================
// Onboarding Progress
// ============================================================================

export interface OnboardingProgress {
  readonly sessionId: OnboardingSessionId;
  readonly state: OnboardingState;
  readonly currentStep: number;
  readonly totalSteps: number;
  readonly percentComplete: number;
  readonly checklist: OnboardingChecklist;
  readonly proceduresCompleted: number;
  readonly proceduresTotal: number;
  readonly moveInReportSubmitted: boolean;
  readonly welcomePackGenerated: boolean;
}
