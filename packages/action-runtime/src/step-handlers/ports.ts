/**
 * Step handler injection ports.
 *
 * Each port mirrors the surface the corresponding step handler needs.
 * The composition root in services/api-gateway wires real adapters
 * (LedgerService, GePG provider, WhatsApp client, …); tests inject
 * stubs.
 */

import { type StepKind } from '../types.js';
import { type StepHandlerRegistry, type StepHandler } from './index.js';

// ─────────────────────────────────────────────────────────────────────
// Per-kind ports
// ─────────────────────────────────────────────────────────────────────

export interface ReportEnginePort {
  draftLetter: (args: {
    readonly tenantId: string;
    readonly templateSlug: string;
    readonly variables: Readonly<Record<string, unknown>>;
    readonly toolCallRef: string;
  }) => Promise<{
    readonly letterId: string;
    readonly bodyMarkdown: string;
    readonly checksum: string;
  }>;
}

export interface ApprovalRouterPort {
  createApprovalRequest: (args: {
    readonly tenantId: string;
    readonly planId: string;
    readonly stepId: string;
    readonly actionType: string;
    readonly proposerPersonaId: string;
    readonly requiredRoleGroup: string;
    readonly quorum: number;
    readonly notifyRoleGroup: string | null;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly toolCallRef: string;
  }) => Promise<{
    readonly approvalId: string;
    readonly status: 'pending' | 'approved' | 'rejected';
  }>;
  /** Block until approval reaches a terminal status (or timeout). */
  awaitTerminal: (args: {
    readonly approvalId: string;
    readonly timeoutMs: number;
  }) => Promise<{ readonly status: 'approved' | 'rejected' | 'timeout' }>;
}

export interface LedgerPort {
  postJournal: (args: {
    readonly tenantId: string;
    readonly toolCallRef: string;
    readonly lines: ReadonlyArray<{
      readonly accountId: string;
      readonly direction: 'DEBIT' | 'CREDIT';
      readonly amountMinorUnits: number;
      readonly currency: string;
      readonly description: string;
    }>;
    readonly effectiveDate: Date;
    readonly metadata?: Readonly<Record<string, unknown>>;
    readonly createdBy: string;
  }) => Promise<{
    readonly journalId: string;
    readonly entryIds: ReadonlyArray<string>;
  }>;
  /** Post a reversing entry — used by the compensation registry. */
  postReversal: (args: {
    readonly tenantId: string;
    readonly originalJournalId: string;
    readonly reason: string;
    readonly toolCallRef: string;
    readonly createdBy: string;
  }) => Promise<{ readonly journalId: string }>;
}

export interface GepgPort {
  fileReturn: (args: {
    readonly tenantId: string;
    readonly toolCallRef: string;
    readonly billPayload: Readonly<Record<string, unknown>>;
  }) => Promise<{
    readonly fileId: string;
    readonly gepgReceiptNumber: string;
  }>;
  requestRetraction: (args: {
    readonly tenantId: string;
    readonly originalFileId: string;
    readonly reason: string;
  }) => Promise<{ readonly retractionId: string }>;
}

export interface NotificationsPort {
  sendWhatsapp: (args: {
    readonly tenantId: string;
    readonly toolCallRef: string;
    readonly recipientPhone: string;
    readonly templateSlug: string;
    readonly variables: Readonly<Record<string, unknown>>;
  }) => Promise<{ readonly messageId: string }>;
  sendSms: (args: {
    readonly tenantId: string;
    readonly toolCallRef: string;
    readonly recipientPhone: string;
    readonly body: string;
  }) => Promise<{ readonly messageId: string }>;
  sendEmail: (args: {
    readonly tenantId: string;
    readonly toolCallRef: string;
    readonly recipientEmail: string;
    readonly subject: string;
    readonly bodyHtml: string;
  }) => Promise<{ readonly messageId: string }>;
  sendRetractionMessage: (args: {
    readonly tenantId: string;
    readonly toolCallRef: string;
    readonly originalMessageId: string;
    readonly channel: 'whatsapp' | 'sms' | 'email';
    readonly reason: string;
  }) => Promise<{ readonly messageId: string }>;
}

export interface SchedulingPort {
  scheduleFieldVisit: (args: {
    readonly tenantId: string;
    readonly toolCallRef: string;
    readonly entityId: string;
    readonly scheduledFor: Date;
    readonly assigneeUserId: string | null;
    readonly notes: string;
  }) => Promise<{ readonly visitId: string }>;
  cancelFieldVisit: (args: {
    readonly tenantId: string;
    readonly visitId: string;
    readonly reason: string;
  }) => Promise<void>;
}

export interface EntityPort {
  mutateEntity: (args: {
    readonly tenantId: string;
    readonly toolCallRef: string;
    readonly entityId: string;
    readonly patch: Readonly<Record<string, unknown>>;
    readonly priorState: Readonly<Record<string, unknown>>;
  }) => Promise<{ readonly revisedAt: Date }>;
  reverseEntityMutation: (args: {
    readonly tenantId: string;
    readonly entityId: string;
    readonly priorState: Readonly<Record<string, unknown>>;
    readonly reason: string;
  }) => Promise<{ readonly revisedAt: Date }>;
}

export interface ExternalApiPort {
  call: (args: {
    readonly tenantId: string;
    readonly toolCallRef: string;
    readonly endpoint: string;
    readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    readonly bodyJson: Readonly<Record<string, unknown>>;
  }) => Promise<{ readonly statusCode: number; readonly body: unknown }>;
}

export interface WebhookPort {
  emit: (args: {
    readonly tenantId: string;
    readonly toolCallRef: string;
    readonly eventType: string;
    readonly payload: Readonly<Record<string, unknown>>;
  }) => Promise<{ readonly deliveryId: string }>;
}

export interface VerifyPort {
  verifyStep: (args: {
    readonly tenantId: string;
    readonly planId: string;
    readonly targetStepIndex: number;
    readonly expectedStatus: string;
  }) => Promise<{ readonly ok: boolean; readonly reason?: string }>;
}

// ─────────────────────────────────────────────────────────────────────
// Aggregated injection — one struct passed through the saga
// ─────────────────────────────────────────────────────────────────────

export interface StepHandlerPorts {
  readonly reportEngine: ReportEnginePort;
  readonly approvals: ApprovalRouterPort;
  readonly ledger: LedgerPort;
  readonly gepg: GepgPort;
  readonly notifications: NotificationsPort;
  readonly scheduling: SchedulingPort;
  readonly entity: EntityPort;
  readonly externalApi: ExternalApiPort;
  readonly webhooks: WebhookPort;
  readonly verify: VerifyPort;
}

// ─────────────────────────────────────────────────────────────────────
// Registry builder — used by the saga composition root
// ─────────────────────────────────────────────────────────────────────

import { makeDraftLetterHandler } from './draft-letter.js';
import { makeRouteApprovalHandler } from './route-approval.js';
import { makePostLedgerHandler } from './post-ledger.js';
import { makeFileGepgHandler } from './file-gepg.js';
import { makeSendWhatsappHandler } from './send-whatsapp.js';
import { makeSendSmsHandler } from './send-sms.js';
import { makeSendEmailHandler } from './send-email.js';
import { makeScheduleFieldVisitHandler } from './schedule-field-visit.js';
import { makeMutateEntityHandler } from './mutate-entity.js';
import { makeCallExternalApiHandler } from './call-external-api.js';
import { makeEmitWebhookHandler } from './emit-webhook.js';
import { makeNotifyHandler } from './notify.js';
import { makeVerifyHandler } from './verify.js';
import { makeCompensateHandler } from './compensate.js';

export function buildStepHandlerRegistry(
  ports: StepHandlerPorts,
): StepHandlerRegistry {
  const registry: Record<StepKind, StepHandler> = {
    DRAFT_LETTER: makeDraftLetterHandler(ports.reportEngine),
    ROUTE_APPROVAL: makeRouteApprovalHandler(ports.approvals),
    POST_LEDGER: makePostLedgerHandler(ports.ledger),
    FILE_GEPG: makeFileGepgHandler(ports.gepg),
    SEND_WHATSAPP: makeSendWhatsappHandler(ports.notifications),
    SEND_SMS: makeSendSmsHandler(ports.notifications),
    SEND_EMAIL: makeSendEmailHandler(ports.notifications),
    SCHEDULE_FIELD_VISIT: makeScheduleFieldVisitHandler(ports.scheduling),
    MUTATE_ENTITY: makeMutateEntityHandler(ports.entity),
    CALL_EXTERNAL_API: makeCallExternalApiHandler(ports.externalApi),
    EMIT_WEBHOOK: makeEmitWebhookHandler(ports.webhooks),
    NOTIFY: makeNotifyHandler(ports.notifications),
    VERIFY: makeVerifyHandler(ports.verify),
    COMPENSATE: makeCompensateHandler(),
  };
  return registry;
}
