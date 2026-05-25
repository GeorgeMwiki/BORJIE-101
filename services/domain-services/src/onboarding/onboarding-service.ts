import { randomHex } from '../common/id-generator.js';
/**
 * Onboarding Service - Tenant Onboarding Workflow
 * Module A per BORJIE_SPEC.md
 * State machine: PRE_MOVE_IN -> WELCOME -> UTILITIES_TRAINING -> PROPERTY_ORIENTATION -> MOVE_IN_INSPECTION -> COMMUNITY_INFO -> COMPLETED
 */

import type {
  TenantId,
  UserId,
  CustomerId,
  LeaseId,
  PropertyId,
  UnitId,
  Result,
} from '@borjie/domain-models';
import { ok, err } from '@borjie/domain-models';
import type { EventBus } from '../common/events.js';
import { createEventEnvelope, generateEventId } from '../common/events.js';
import type {
  OnboardingSession,
  OnboardingSessionId,
  OnboardingState,
  OnboardingChecklist,
  ChecklistItem,
  ChecklistStepId,
  MoveInConditionReport,
  ProcedureCompletionLog,
  UtilitySetupRecord,
  WelcomePack,
  WelcomePackSection,
  OnboardingProgress,
} from './types.js';
import {
  asOnboardingSessionId,
  asProcedureId,
  getNextState,
  ONBOARDING_STATE_ORDER,
} from './types.js';
import type {
  OnboardingStartedEvent,
  OnboardingStepCompletedEvent,
  OnboardingCompletedEvent,
  MoveInInspectionSubmittedEvent,
  ProcedureTrainingCompletedEvent,
} from './events.js';
import { getProcedure, getAllProcedures } from './procedure-library.js';

// ============================================================================
// Repository Interface
// ============================================================================

export interface OnboardingRepository {
  findById(id: OnboardingSessionId, tenantId: TenantId): Promise<OnboardingSession | null>;
  findByCustomer(customerId: CustomerId, tenantId: TenantId): Promise<OnboardingSession | null>;
  findByLease(leaseId: LeaseId, tenantId: TenantId): Promise<OnboardingSession | null>;
  create(session: OnboardingSession): Promise<OnboardingSession>;
  update(session: OnboardingSession): Promise<OnboardingSession>;
}

// ============================================================================
// Error Types
// ============================================================================

export const OnboardingServiceError = {
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  ALREADY_COMPLETED: 'ALREADY_COMPLETED',
  PROCEDURE_NOT_FOUND: 'PROCEDURE_NOT_FOUND',
  INVALID_REPORT: 'INVALID_REPORT',
} as const;

export type OnboardingServiceErrorCode = (typeof OnboardingServiceError)[keyof typeof OnboardingServiceError];

export interface OnboardingServiceErrorResult {
  code: OnboardingServiceErrorCode;
  message: string;
}

// ============================================================================
// Default Checklist
// ============================================================================

const DEFAULT_CHECKLIST_ITEMS: Omit<ChecklistItem, 'completed' | 'completedAt' | 'completedBy'>[] = [
  { stepId: 'pre_move_in', labelEn: 'Pre-move-in setup', labelSw: 'Mapambo kabla ya kuhamia' },
  { stepId: 'welcome', labelEn: 'Welcome & channel setup', labelSw: 'Karibu na usanidi wa njia' },
  { stepId: 'utilities_training', labelEn: 'Utilities activation & training', labelSw: 'Utumizi na mafunzo' },
  { stepId: 'property_orientation', labelEn: 'Property orientation', labelSw: 'Maelezo ya nyumba' },
  { stepId: 'move_in_inspection', labelEn: 'Move-in condition report', labelSw: 'Ripoti ya hali ya kuhamia' },
  { stepId: 'community_info', labelEn: 'Community & local context', labelSw: 'Jamii na mazingira' },
  { stepId: 'completed', labelEn: 'Onboarding completed', labelSw: 'Ukurasa wa karibu umekamilika' },
];

function stepIdToState(stepId: ChecklistStepId): OnboardingState {
  const map: Record<ChecklistStepId, OnboardingState> = {
    pre_move_in: 'PRE_MOVE_IN',
    welcome: 'WELCOME',
    utilities_training: 'UTILITIES_TRAINING',
    property_orientation: 'PROPERTY_ORIENTATION',
    move_in_inspection: 'MOVE_IN_INSPECTION',
    community_info: 'COMMUNITY_INFO',
    completed: 'COMPLETED',
  };
  return map[stepId];
}

function createInitialChecklist(): OnboardingChecklist {
  const items: ChecklistItem[] = DEFAULT_CHECKLIST_ITEMS.map((item) => ({
    ...item,
    completed: false,
    completedAt: null,
    completedBy: null,
  }));
  return { items, completedCount: 0 };
}

// ============================================================================
// Onboarding Service
// ============================================================================

export class OnboardingService {
  constructor(
    private readonly repo: OnboardingRepository,
    private readonly eventBus: EventBus
  ) {}

  async startOnboarding(
    tenantId: TenantId,
    customerId: CustomerId,
    leaseId: LeaseId,
    options: {
      moveInDate: string;
      language?: 'en' | 'sw';
      preferredChannel?: 'whatsapp' | 'sms' | 'email' | 'app' | 'voice';
      propertyId?: PropertyId;
      unitId?: UnitId;
    },
    createdBy: UserId,
    correlationId: string
  ): Promise<Result<OnboardingSession, OnboardingServiceErrorResult>> {
    const sessionId = asOnboardingSessionId(`onb_${Date.now()}_${randomHex(4)}`);
    const now = new Date().toISOString();
    const lang = options.language ?? 'en';
    const channel = options.preferredChannel ?? 'whatsapp';

    const session: OnboardingSession = {
      id: sessionId,
      tenantId,
      customerId,
      leaseId,
      propertyId: options.propertyId,
      unitId: options.unitId,
      state: 'PRE_MOVE_IN',
      language: lang,
      preferredChannel: channel,
      moveInDate: options.moveInDate,
      checklist: createInitialChecklist(),
      procedureCompletionLog: [],
      moveInConditionReport: null,
      utilitySetupRecords: [],
      welcomePackGeneratedAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy,
      updatedBy: createdBy,
    };

    const saved = await this.repo.create(session);

    const event: OnboardingStartedEvent = {
      eventId: generateEventId(),
      eventType: 'OnboardingStarted',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        sessionId: saved.id,
        customerId,
        leaseId,
        moveInDate: options.moveInDate,
        language: lang,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'OnboardingSession'));

    return ok(saved);
  }

  async advanceToNextStep(
    sessionId: OnboardingSessionId,
    tenantId: TenantId,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<OnboardingSession, OnboardingServiceErrorResult>> {
    const session = await this.repo.findById(sessionId, tenantId);
    if (!session) return err({ code: OnboardingServiceError.SESSION_NOT_FOUND, message: 'Session not found' });
    if (session.state === 'COMPLETED') return err({ code: OnboardingServiceError.ALREADY_COMPLETED, message: 'Onboarding already completed' });

    const nextState = getNextState(session.state);
    if (!nextState) return err({ code: OnboardingServiceError.INVALID_STATE_TRANSITION, message: 'No next step' });

    const stateToStepId: Record<OnboardingState, ChecklistStepId> = {
      PRE_MOVE_IN: 'pre_move_in',
      WELCOME: 'welcome',
      UTILITIES_TRAINING: 'utilities_training',
      PROPERTY_ORIENTATION: 'property_orientation',
      MOVE_IN_INSPECTION: 'move_in_inspection',
      COMMUNITY_INFO: 'community_info',
      COMPLETED: 'completed',
    };
    const stepId = stateToStepId[nextState];

    const updatedItems = session.checklist.items.map((item) =>
      item.stepId === stepId ? { ...item, completed: true, completedAt: new Date().toISOString(), completedBy: updatedBy } : item
    );
    const completedCount = updatedItems.filter((i) => i.completed).length;
    const checklist: OnboardingChecklist = { items: updatedItems, completedCount };

    const now = new Date().toISOString();
    const updated: OnboardingSession = {
      ...session,
      state: nextState,
      checklist,
      updatedAt: now,
      updatedBy,
    };

    const saved = await this.repo.update(updated);

    const event: OnboardingStepCompletedEvent = {
      eventId: generateEventId(),
      eventType: 'OnboardingStepCompleted',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        sessionId: saved.id,
        stepId,
        previousState: session.state,
        newState: nextState,
        completedBy: updatedBy,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'OnboardingSession'));

    if (nextState === 'COMPLETED') {
      const compEvent: OnboardingCompletedEvent = {
        eventId: generateEventId(),
        eventType: 'OnboardingCompleted',
        timestamp: now,
        tenantId,
        correlationId,
        causationId: null,
        metadata: {},
        payload: { sessionId: saved.id, customerId: saved.customerId, leaseId: saved.leaseId, completedAt: now },
      };
      await this.eventBus.publish(createEventEnvelope(compEvent, saved.id, 'OnboardingSession'));
    }

    return ok(saved);
  }

  async completeStep(
    sessionId: OnboardingSessionId,
    tenantId: TenantId,
    stepId: ChecklistStepId,
    data: Record<string, unknown>,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<OnboardingSession, OnboardingServiceErrorResult>> {
    const session = await this.repo.findById(sessionId, tenantId);
    if (!session) return err({ code: OnboardingServiceError.SESSION_NOT_FOUND, message: 'Session not found' });
    if (session.state === 'COMPLETED') return err({ code: OnboardingServiceError.ALREADY_COMPLETED, message: 'Onboarding already completed' });

    const stateToStepId: Record<OnboardingState, ChecklistStepId> = {
      PRE_MOVE_IN: 'pre_move_in',
      WELCOME: 'welcome',
      UTILITIES_TRAINING: 'utilities_training',
      PROPERTY_ORIENTATION: 'property_orientation',
      MOVE_IN_INSPECTION: 'move_in_inspection',
      COMMUNITY_INFO: 'community_info',
      COMPLETED: 'completed',
    };

    const currentStepId = stateToStepId[session.state];
    const targetIdx = session.checklist.items.findIndex((i) => i.stepId === stepId);
    if (targetIdx < 0) return err({ code: OnboardingServiceError.INVALID_STATE_TRANSITION, message: 'Invalid step' });

    const updatedItems = session.checklist.items.map((item, idx) =>
      item.stepId === stepId ? { ...item, completed: true, completedAt: new Date().toISOString(), completedBy: updatedBy } : item
    );
    const completedCount = updatedItems.filter((i) => i.completed).length;
    const checklist: OnboardingChecklist = { items: updatedItems, completedCount };

    const nextState = stepId === 'completed' ? 'COMPLETED' : getNextState(session.state) ?? session.state;
    const now = new Date().toISOString();
    const updated: OnboardingSession = {
      ...session,
      state: nextState === 'COMPLETED' && stepId === 'completed' ? 'COMPLETED' : nextState as OnboardingState,
      checklist,
      updatedAt: now,
      updatedBy,
    };

    const saved = await this.repo.update(updated);

    const event: OnboardingStepCompletedEvent = {
      eventId: generateEventId(),
      eventType: 'OnboardingStepCompleted',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        sessionId: saved.id,
        stepId,
        previousState: session.state,
        newState: saved.state,
        completedBy: updatedBy,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'OnboardingSession'));

    if (saved.state === 'COMPLETED') {
      const compEvent: OnboardingCompletedEvent = {
        eventId: generateEventId(),
        eventType: 'OnboardingCompleted',
        timestamp: now,
        tenantId,
        correlationId,
        causationId: null,
        metadata: {},
        payload: { sessionId: saved.id, customerId: saved.customerId, leaseId: saved.leaseId, completedAt: now },
      };
      await this.eventBus.publish(createEventEnvelope(compEvent, saved.id, 'OnboardingSession'));
    }

    return ok(saved);
  }

  async getMoveInChecklist(sessionId: OnboardingSessionId, tenantId: TenantId): Promise<Result<OnboardingChecklist, OnboardingServiceErrorResult>> {
    const session = await this.repo.findById(sessionId, tenantId);
    if (!session) return err({ code: OnboardingServiceError.SESSION_NOT_FOUND, message: 'Session not found' });
    return ok(session.checklist);
  }

  async submitMoveInInspection(
    sessionId: OnboardingSessionId,
    tenantId: TenantId,
    report: Omit<MoveInConditionReport, 'id' | 'sessionId' | 'submittedAt' | 'submittedBy'>,
    submittedBy: UserId,
    correlationId: string
  ): Promise<Result<OnboardingSession, OnboardingServiceErrorResult>> {
    const session = await this.repo.findById(sessionId, tenantId);
    if (!session) return err({ code: OnboardingServiceError.SESSION_NOT_FOUND, message: 'Session not found' });
    if (session.moveInConditionReport) return err({ code: OnboardingServiceError.INVALID_REPORT, message: 'Move-in report already submitted' });

    const reportId = `mir_${Date.now()}_${randomHex(4)}`;
    const now = new Date().toISOString();
    const fullReport: MoveInConditionReport = {
      ...report,
      id: reportId,
      sessionId,
      submittedAt: now,
      submittedBy,
    };

    const updated: OnboardingSession = {
      ...session,
      moveInConditionReport: fullReport,
      state: session.state === 'MOVE_IN_INSPECTION' ? 'COMMUNITY_INFO' : session.state,
      updatedAt: now,
      updatedBy: submittedBy,
    };

    const checklistItems = updated.checklist.items.map((item) =>
      item.stepId === 'move_in_inspection' ? { ...item, completed: true, completedAt: now, completedBy: submittedBy } : item
    );
    const completedCount = checklistItems.filter((i) => i.completed).length;
    const saved = await this.repo.update({
      ...updated,
      checklist: { items: checklistItems, completedCount },
    });

    const event: MoveInInspectionSubmittedEvent = {
      eventId: generateEventId(),
      eventType: 'MoveInInspectionSubmitted',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        sessionId: saved.id,
        reportId,
        roomCount: report.rooms.length,
        meterReadingCount: report.meterReadings.length,
        submittedBy,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'OnboardingSession'));

    return ok(saved);
  }

  async completeProcedureTraining(
    sessionId: OnboardingSessionId,
    tenantId: TenantId,
    procedureId: string,
    comprehensionConfirmed: boolean,
    channel: 'whatsapp' | 'app' | 'voice' | 'in_person',
    completedBy: UserId | null,
    correlationId: string
  ): Promise<Result<OnboardingSession, OnboardingServiceErrorResult>> {
    const session = await this.repo.findById(sessionId, tenantId);
    if (!session) return err({ code: OnboardingServiceError.SESSION_NOT_FOUND, message: 'Session not found' });

    const proc = getProcedure(asProcedureId(procedureId));
    if (!proc) return err({ code: OnboardingServiceError.PROCEDURE_NOT_FOUND, message: 'Procedure not found' });

    const now = new Date().toISOString();
    const logEntry: ProcedureCompletionLog = {
      procedureId: proc.id,
      procedureTitleEn: proc.titleEn,
      procedureTitleSw: proc.titleSw,
      completedAt: now,
      completedBy,
      comprehensionConfirmed,
      channel,
    };

    const updated: OnboardingSession = {
      ...session,
      procedureCompletionLog: [...session.procedureCompletionLog, logEntry],
      updatedAt: now,
      updatedBy: completedBy ?? session.updatedBy,
    };

    const saved = await this.repo.update(updated);

    const event: ProcedureTrainingCompletedEvent = {
      eventId: generateEventId(),
      eventType: 'ProcedureTrainingCompleted',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        sessionId: saved.id,
        procedureId: proc.id,
        completedBy,
        comprehensionConfirmed,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'OnboardingSession'));

    return ok(saved);
  }

  async getOnboardingProgress(sessionId: OnboardingSessionId, tenantId: TenantId): Promise<Result<OnboardingProgress, OnboardingServiceErrorResult>> {
    const session = await this.repo.findById(sessionId, tenantId);
    if (!session) return err({ code: OnboardingServiceError.SESSION_NOT_FOUND, message: 'Session not found' });

    const currentStepIdx = ONBOARDING_STATE_ORDER.indexOf(session.state);
    const totalSteps = ONBOARDING_STATE_ORDER.length;
    const percentComplete = Math.round((currentStepIdx / (totalSteps - 1)) * 100);

    const progress: OnboardingProgress = {
      sessionId: session.id,
      state: session.state,
      currentStep: currentStepIdx + 1,
      totalSteps,
      percentComplete: session.state === 'COMPLETED' ? 100 : percentComplete,
      checklist: session.checklist,
      proceduresCompleted: session.procedureCompletionLog.length,
      proceduresTotal: getAllProcedures().length,
      moveInReportSubmitted: !!session.moveInConditionReport,
      welcomePackGenerated: !!session.welcomePackGeneratedAt,
    };

    return ok(progress);
  }

  async generateWelcomePack(sessionId: OnboardingSessionId, tenantId: TenantId): Promise<Result<WelcomePack, OnboardingServiceErrorResult>> {
    const session = await this.repo.findById(sessionId, tenantId);
    if (!session) return err({ code: OnboardingServiceError.SESSION_NOT_FOUND, message: 'Session not found' });

    const procedures = getAllProcedures();
    const sections: WelcomePackSection[] = [
      {
        id: 'sec_repair',
        titleEn: 'Repair request protocol',
        titleSw: 'Mbinu ya kuomba matengenezo',
        contentEn: 'Contact us via WhatsApp, app, or phone. Describe the issue, send photos if possible. We will assign a technician and keep you updated.',
        contentSw: 'Wasiliana nasi kupitia WhatsApp, programu, au simu. Eleza tatizo, tuma picha ikiwezekana. Tutagawanya fundi na tutasasisha.',
        order: 1,
      },
      {
        id: 'sec_emergency',
        titleEn: 'Emergency escalation',
        titleSw: 'Dharura',
        contentEn: 'For fires, floods, break-ins, or safety issues: Call 112 (Police), 114 (Fire), 115 (Ambulance). Notify estate manager and security immediately.',
        contentSw: 'Kwa moto, mafuriko, uvamizi, au matatizo ya usalama: Piga 112 (Polisi), 114 (Moto), 115 (Ambulensi). Wajulishi msimamizi na usalama mara moja.',
        order: 2,
      },
      {
        id: 'sec_utility',
        titleEn: 'Utility SOP links',
        titleSw: 'Viungo vya mbinu za matumizi',
        contentEn: procedures.map((p) => `- ${p.titleEn}`).join('\n'),
        contentSw: procedures.map((p) => `- ${p.titleSw}`).join('\n'),
        order: 3,
      },
      {
        id: 'sec_firstweek',
        titleEn: 'First week checklist',
        titleSw: 'Orodha ya wiki ya kwanza',
        contentEn: '1. Confirm utilities working. 2. Test all appliances. 3. Know emergency contacts. 4. Save manager/security numbers. 5. Report any issues.',
        contentSw: '1. Thibitisha matumizi yanafanya kazi. 2. Jaribu vifaa vyote. 3. Jua mawasiliano ya dharura. 4. Hifadhi nambari za msimamizi/usalama. 5. Ripoti matatizo yoyote.',
        order: 4,
      },
      {
        id: 'sec_fees',
        titleEn: 'How to avoid common fees/conflicts',
        titleSw: 'Jinsi ya kuepuka malipo na migogoro',
        contentEn: 'Pay rent on time. Report maintenance promptly. Follow house rules. Keep unit clean. Return keys on move-out. Document condition at move-in.',
        contentSw: 'Lipa kodi kwa wakati. Ripoti matengenezo haraka. Fuata sheria za nyumba. Weka chumba safi. Rudisha funguo wakati wa kuondoka. Andika hali wakati wa kuhamia.',
        order: 5,
      },
    ];

    const welcomePack: WelcomePack = {
      sessionId,
      generatedAt: new Date().toISOString(),
      sections,
      language: session.language,
    };

    const now = new Date().toISOString();
    await this.repo.update({
      ...session,
      welcomePackGeneratedAt: now,
      updatedAt: now,
      updatedBy: session.updatedBy,
    });

    return ok(welcomePack);
  }
}
