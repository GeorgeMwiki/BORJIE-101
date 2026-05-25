/**
 * Test stubs — in-memory implementations of every port the saga needs.
 *
 * Each stub returns a deterministic id keyed off the toolCallRef so the
 * tests can assert idempotency / dedup behaviour. The stubs also record
 * every invocation so the tests can assert e.g. "the reversal handler
 * was called with the original journalId".
 */

import type {
  ApprovalRouterPort,
  EntityPort,
  ExternalApiPort,
  GepgPort,
  LedgerPort,
  NotificationsPort,
  ReportEnginePort,
  SchedulingPort,
  StepHandlerPorts,
  VerifyPort,
  WebhookPort,
} from '../step-handlers/ports.js';
import type {
  AuditChainRow,
} from '../audit-chain.js';
import type {
  PersistedActionStep,
  StepStatus,
  ActionPlan,
} from '../types.js';
import type {
  SagaPersistencePort,
} from '../saga.js';
import { createInMemoryAuditChain } from '../audit-chain.js';
import {
  createPermissivePreconditionPorts,
} from '../preconditions.js';

// ─────────────────────────────────────────────────────────────────────
// Per-port stubs
// ─────────────────────────────────────────────────────────────────────

export interface CallRecord<T extends string> {
  readonly call: T;
  readonly args: unknown;
}

export interface StubLedger extends LedgerPort {
  readonly journals: Map<string, { lines: unknown; toolCallRef: string }>;
  readonly reversals: Map<string, { originalJournalId: string; reason: string }>;
  readonly calls: CallRecord<'postJournal' | 'postReversal'>[];
  /** Failure injection — set to true to make postJournal throw. */
  fail: boolean;
}

export function createStubLedger(): StubLedger {
  const journals = new Map<
    string,
    { lines: unknown; toolCallRef: string }
  >();
  const reversals = new Map<
    string,
    { originalJournalId: string; reason: string }
  >();
  const calls: CallRecord<'postJournal' | 'postReversal'>[] = [];
  const stub: StubLedger = {
    journals,
    reversals,
    calls,
    fail: false,
    async postJournal(args) {
      calls.push({ call: 'postJournal', args });
      if (stub.fail) throw new Error('ledger forced failure');
      // Idempotent on toolCallRef.
      const existing = [...journals.entries()].find(
        ([, v]) => v.toolCallRef === args.toolCallRef,
      );
      if (existing) {
        return { journalId: existing[0], entryIds: [`le_${existing[0]}_0`] };
      }
      const journalId = `j_${journals.size + 1}`;
      journals.set(journalId, { lines: args.lines, toolCallRef: args.toolCallRef });
      return { journalId, entryIds: [`le_${journalId}_0`] };
    },
    async postReversal(args) {
      calls.push({ call: 'postReversal', args });
      const journalId = `j_rev_${reversals.size + 1}`;
      reversals.set(journalId, {
        originalJournalId: args.originalJournalId,
        reason: args.reason,
      });
      return { journalId };
    },
  };
  return stub;
}

// ─── Notifications ─────────────────────────────────────────────────

export interface StubNotifications extends NotificationsPort {
  readonly sent: Array<{
    channel: 'whatsapp' | 'sms' | 'email';
    toolCallRef: string;
    messageId: string;
  }>;
  readonly retractions: Array<{
    channel: 'whatsapp' | 'sms' | 'email';
    originalMessageId: string;
    reason: string;
  }>;
  fail: boolean;
}

export function createStubNotifications(): StubNotifications {
  const sent: StubNotifications['sent'] = [];
  const retractions: StubNotifications['retractions'] = [];
  let counter = 0;
  const stub: StubNotifications = {
    sent,
    retractions,
    fail: false,
    async sendWhatsapp(args) {
      if (stub.fail) throw new Error('whatsapp forced failure');
      const existing = sent.find(
        (s) => s.toolCallRef === args.toolCallRef && s.channel === 'whatsapp',
      );
      if (existing) return { messageId: existing.messageId };
      counter += 1;
      const messageId = `wa_${counter}`;
      sent.push({
        channel: 'whatsapp',
        toolCallRef: args.toolCallRef,
        messageId,
      });
      return { messageId };
    },
    async sendSms(args) {
      if (stub.fail) throw new Error('sms forced failure');
      const existing = sent.find(
        (s) => s.toolCallRef === args.toolCallRef && s.channel === 'sms',
      );
      if (existing) return { messageId: existing.messageId };
      counter += 1;
      const messageId = `sms_${counter}`;
      sent.push({ channel: 'sms', toolCallRef: args.toolCallRef, messageId });
      return { messageId };
    },
    async sendEmail(args) {
      if (stub.fail) throw new Error('email forced failure');
      const existing = sent.find(
        (s) => s.toolCallRef === args.toolCallRef && s.channel === 'email',
      );
      if (existing) return { messageId: existing.messageId };
      counter += 1;
      const messageId = `em_${counter}`;
      sent.push({
        channel: 'email',
        toolCallRef: args.toolCallRef,
        messageId,
      });
      return { messageId };
    },
    async sendRetractionMessage(args) {
      counter += 1;
      const messageId = `retract_${counter}`;
      retractions.push({
        channel: args.channel,
        originalMessageId: args.originalMessageId,
        reason: args.reason,
      });
      return { messageId };
    },
  };
  return stub;
}

// ─── Report engine ────────────────────────────────────────────────

export interface StubReportEngine extends ReportEnginePort {
  readonly drafts: Array<{ toolCallRef: string; letterId: string }>;
  fail: boolean;
}

export function createStubReportEngine(): StubReportEngine {
  const drafts: StubReportEngine['drafts'] = [];
  let counter = 0;
  const stub: StubReportEngine = {
    drafts,
    fail: false,
    async draftLetter(args) {
      if (stub.fail) throw new Error('report engine forced failure');
      const existing = drafts.find((d) => d.toolCallRef === args.toolCallRef);
      if (existing) {
        return {
          letterId: existing.letterId,
          bodyMarkdown: '# replayed',
          checksum: 'cached',
        };
      }
      counter += 1;
      const letterId = `letter_${counter}`;
      drafts.push({ toolCallRef: args.toolCallRef, letterId });
      return {
        letterId,
        bodyMarkdown: `# letter ${counter} for ${args.templateSlug}`,
        checksum: `chk_${counter}`,
      };
    },
  };
  return stub;
}

// ─── Approvals ────────────────────────────────────────────────────

export interface StubApprovals extends ApprovalRouterPort {
  readonly created: Array<{
    approvalId: string;
    actionType: string;
    quorum: number;
    requiredRoleGroup: string;
  }>;
  /**
   * Decisions — set ahead of awaitTerminal calls. Per-approvalId outcome
   * defaults to 'approved' if unset.
   */
  decisions: Map<string, 'approved' | 'rejected' | 'timeout'>;
  /** When true, createApprovalRequest returns 'pending'; awaitTerminal resolves with the decision map entry. */
  pendingMode: boolean;
}

export function createStubApprovals(): StubApprovals {
  const created: StubApprovals['created'] = [];
  let counter = 0;
  const stub: StubApprovals = {
    created,
    decisions: new Map(),
    pendingMode: true,
    async createApprovalRequest(args) {
      counter += 1;
      const approvalId = `app_${counter}`;
      created.push({
        approvalId,
        actionType: args.actionType,
        quorum: args.quorum,
        requiredRoleGroup: args.requiredRoleGroup,
      });
      if (stub.pendingMode) {
        return { approvalId, status: 'pending' };
      }
      const decision = stub.decisions.get(approvalId) ?? 'approved';
      return {
        approvalId,
        status: decision === 'timeout' ? 'pending' : decision,
      };
    },
    async awaitTerminal({ approvalId }) {
      const decision = stub.decisions.get(approvalId) ?? 'approved';
      return { status: decision };
    },
  };
  return stub;
}

// ─── Other ports — simple deterministic stubs ──────────────────────

export const createStubGepg = (): GepgPort & {
  filings: Array<{ fileId: string; toolCallRef: string }>;
  retractions: Array<{ originalFileId: string; reason: string }>;
  fail: boolean;
} => {
  const filings: Array<{ fileId: string; toolCallRef: string }> = [];
  const retractions: Array<{ originalFileId: string; reason: string }> = [];
  let n = 0;
  const stub = {
    filings,
    retractions,
    fail: false,
    async fileReturn(args: Parameters<GepgPort['fileReturn']>[0]) {
      if (stub.fail) throw new Error('gepg forced failure');
      const existing = filings.find((f) => f.toolCallRef === args.toolCallRef);
      if (existing) {
        return {
          fileId: existing.fileId,
          gepgReceiptNumber: `gepg_${existing.fileId}`,
        };
      }
      n += 1;
      const fileId = `gepg_file_${n}`;
      filings.push({ fileId, toolCallRef: args.toolCallRef });
      return { fileId, gepgReceiptNumber: `gepg_${fileId}` };
    },
    async requestRetraction(args: Parameters<GepgPort['requestRetraction']>[0]) {
      n += 1;
      retractions.push({
        originalFileId: args.originalFileId,
        reason: args.reason,
      });
      return { retractionId: `retract_${n}` };
    },
  };
  return stub;
};

export const createStubScheduling = (): SchedulingPort & {
  visits: Array<{ visitId: string; toolCallRef: string }>;
  cancellations: Array<{ visitId: string; reason: string }>;
} => {
  const visits: Array<{ visitId: string; toolCallRef: string }> = [];
  const cancellations: Array<{ visitId: string; reason: string }> = [];
  let n = 0;
  return {
    visits,
    cancellations,
    async scheduleFieldVisit(args) {
      const existing = visits.find((v) => v.toolCallRef === args.toolCallRef);
      if (existing) return { visitId: existing.visitId };
      n += 1;
      const visitId = `visit_${n}`;
      visits.push({ visitId, toolCallRef: args.toolCallRef });
      return { visitId };
    },
    async cancelFieldVisit(args) {
      cancellations.push({ visitId: args.visitId, reason: args.reason });
    },
  };
};

export const createStubEntity = (): EntityPort & {
  mutations: Array<{ entityId: string; patch: unknown; priorState: unknown }>;
  reversals: Array<{ entityId: string; priorState: unknown; reason: string }>;
  fail: boolean;
} => {
  const mutations: Array<{ entityId: string; patch: unknown; priorState: unknown }> = [];
  const reversals: Array<{ entityId: string; priorState: unknown; reason: string }> = [];
  const stub = {
    mutations,
    reversals,
    fail: false,
    async mutateEntity(args: Parameters<EntityPort['mutateEntity']>[0]) {
      if (stub.fail) throw new Error('entity mutate forced failure');
      mutations.push({
        entityId: args.entityId,
        patch: args.patch,
        priorState: args.priorState,
      });
      return { revisedAt: new Date() };
    },
    async reverseEntityMutation(args: Parameters<EntityPort['reverseEntityMutation']>[0]) {
      reversals.push({
        entityId: args.entityId,
        priorState: args.priorState,
        reason: args.reason,
      });
      return { revisedAt: new Date() };
    },
  };
  return stub;
};

export const createStubExternalApi = (): ExternalApiPort & {
  calls: Array<{ endpoint: string; method: string; toolCallRef: string }>;
} => {
  const calls: Array<{ endpoint: string; method: string; toolCallRef: string }> = [];
  return {
    calls,
    async call(args) {
      calls.push({
        endpoint: args.endpoint,
        method: args.method,
        toolCallRef: args.toolCallRef,
      });
      return { statusCode: 200, body: '' };
    },
  };
};

export const createStubWebhooks = (): WebhookPort & {
  emissions: Array<{ eventType: string; toolCallRef: string; payload: unknown }>;
} => {
  const emissions: Array<{ eventType: string; toolCallRef: string; payload: unknown }> = [];
  let n = 0;
  return {
    emissions,
    async emit(args) {
      const existing = emissions.find(
        (e) => e.toolCallRef === args.toolCallRef,
      );
      if (existing) {
        return { deliveryId: `dlv_replayed` };
      }
      n += 1;
      emissions.push({
        eventType: args.eventType,
        toolCallRef: args.toolCallRef,
        payload: args.payload,
      });
      return { deliveryId: `dlv_${n}` };
    },
  };
};

export const createStubVerify = (): VerifyPort & {
  shouldPass: boolean;
} => {
  const stub = {
    shouldPass: true,
    async verifyStep(_args: Parameters<VerifyPort['verifyStep']>[0]) {
      return stub.shouldPass
        ? { ok: true }
        : { ok: false, reason: 'verify stub: shouldPass=false' };
    },
  };
  return stub;
};

// ─────────────────────────────────────────────────────────────────────
// Persistence stub — in-memory plan + steps table
// ─────────────────────────────────────────────────────────────────────

export interface StubPersistence extends SagaPersistencePort {
  readonly plans: Map<string, {
    tenantId: string;
    personaId: string;
    status: string;
    budgetMicros: number;
    budgetUsedMicros: number;
    expiresAt: Date;
    auditChainLink: string | null;
  }>;
  readonly steps: Map<string, PersistedActionStep>;
  readonly quotaBumps: Array<{
    tenantId: string;
    personaId: string;
    delta: Record<string, number | undefined>;
  }>;
}

export function createStubPersistence(): StubPersistence {
  const plans: StubPersistence['plans'] = new Map();
  const steps: StubPersistence['steps'] = new Map();
  const quotaBumps: StubPersistence['quotaBumps'] = [];
  return {
    plans,
    steps,
    quotaBumps,
    async loadPlan(planId, tenantId) {
      const p = plans.get(planId);
      if (!p || p.tenantId !== tenantId) return null;
      const planSteps = [...steps.values()]
        .filter((s) => s.planId === planId)
        .sort((a, b) => a.stepIndex - b.stepIndex);
      return {
        tenantId: p.tenantId,
        personaId: p.personaId,
        status: p.status,
        budgetMicros: p.budgetMicros,
        budgetUsedMicros: p.budgetUsedMicros,
        expiresAt: p.expiresAt,
        steps: planSteps,
      };
    },
    async updatePlanStatus(args) {
      const p = plans.get(args.planId);
      if (!p) return;
      p.status = args.status;
      if (args.budgetUsedDelta) {
        p.budgetUsedMicros += args.budgetUsedDelta;
      }
      if (args.auditChainLink) {
        p.auditChainLink = args.auditChainLink;
      }
    },
    async updateStep(args) {
      const existing = steps.get(args.stepId);
      if (!existing) return;
      const next: PersistedActionStep = {
        ...existing,
        ...args.patch,
        ...(args.patch.status ? { status: args.patch.status } : {}),
        ...(args.patch.payloadJsonb
          ? { payloadJsonb: args.patch.payloadJsonb }
          : {}),
      } as PersistedActionStep;
      steps.set(args.stepId, next);
    },
    async readStep(stepId, tenantId) {
      const s = steps.get(stepId);
      if (!s || s.tenantId !== tenantId) return null;
      return s;
    },
    async bumpQuota(args) {
      quotaBumps.push({
        tenantId: args.tenantId,
        personaId: args.personaId,
        delta: { ...args.delta },
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// One-shot fixture — wires all stubs into a saga config
// ─────────────────────────────────────────────────────────────────────

export interface RuntimeFixture {
  readonly persistence: StubPersistence;
  readonly ledger: StubLedger;
  readonly notifications: StubNotifications;
  readonly reportEngine: StubReportEngine;
  readonly approvals: StubApprovals;
  readonly gepg: ReturnType<typeof createStubGepg>;
  readonly scheduling: ReturnType<typeof createStubScheduling>;
  readonly entity: ReturnType<typeof createStubEntity>;
  readonly externalApi: ReturnType<typeof createStubExternalApi>;
  readonly webhooks: ReturnType<typeof createStubWebhooks>;
  readonly verify: ReturnType<typeof createStubVerify>;
  readonly auditChain: ReturnType<typeof createInMemoryAuditChain>;
  readonly stepHandlerPorts: StepHandlerPorts;
}

export function createFixture(): RuntimeFixture {
  const persistence = createStubPersistence();
  const ledger = createStubLedger();
  const notifications = createStubNotifications();
  const reportEngine = createStubReportEngine();
  const approvals = createStubApprovals();
  const gepg = createStubGepg();
  const scheduling = createStubScheduling();
  const entity = createStubEntity();
  const externalApi = createStubExternalApi();
  const webhooks = createStubWebhooks();
  const verify = createStubVerify();
  const auditChain = createInMemoryAuditChain();

  const stepHandlerPorts: StepHandlerPorts = {
    reportEngine,
    approvals,
    ledger,
    gepg,
    notifications,
    scheduling,
    entity,
    externalApi,
    webhooks,
    verify,
  };
  return {
    persistence,
    ledger,
    notifications,
    reportEngine,
    approvals,
    gepg,
    scheduling,
    entity,
    externalApi,
    webhooks,
    verify,
    auditChain,
    stepHandlerPorts,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Plan helpers — seed a plan + steps into the persistence stub
// ─────────────────────────────────────────────────────────────────────

export function seedPlan(
  persistence: StubPersistence,
  plan: ActionPlan,
  planId: string,
): void {
  persistence.plans.set(planId, {
    tenantId: plan.tenantId,
    personaId: plan.personaId,
    status: 'APPROVED',
    budgetMicros: plan.budgetMicros,
    budgetUsedMicros: 0,
    expiresAt: plan.expiresAt ? new Date(plan.expiresAt) : new Date(Date.now() + 60_000),
    auditChainLink: null,
  });
  for (const step of plan.steps) {
    const stepId = step.id ?? `as_${planId.slice(3, 11)}_${step.stepIndex}`;
    const persisted: PersistedActionStep = {
      id: stepId,
      planId,
      tenantId: plan.tenantId,
      stepIndex: step.stepIndex,
      kind: step.kind,
      payloadJsonb: { ...step.payload },
      toolCallRef: step.toolCallRef ?? null,
      otelSpanId: null,
      auditChainId: null,
      status: 'PENDING' as StepStatus,
      attempts: 0,
      lastError: null,
      compensationStepIndex: null,
      startedAt: null,
      finishedAt: null,
      createdAt: new Date(),
    };
    persistence.steps.set(stepId, persisted);
  }
}

export function permissivePorts() {
  return createPermissivePreconditionPorts();
}

export type { AuditChainRow };
