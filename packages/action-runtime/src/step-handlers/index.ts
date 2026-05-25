/**
 * Step handler registry — one handler per step kind.
 *
 * Each handler is a pure async function from `(step, ctx) → result`.
 * The saga loops over the step graph, picks the handler by kind, and
 * drives the status machine.
 *
 * Handlers MUST be idempotent: replaying with the same `toolCallRef`
 * must produce the same effect (same ledger entry, same notification,
 * same DB row). Ports inject the underlying IO so handlers can be unit-
 * tested without touching real services.
 */

import { type StepKind, type ActionStep } from '../types.js';

// ─────────────────────────────────────────────────────────────────────
// Handler context — injected by the saga
// ─────────────────────────────────────────────────────────────────────

export interface StepHandlerContext {
  readonly tenantId: string;
  readonly personaId: string;
  readonly planId: string;
  readonly stepId: string;
  readonly toolCallRef: string | null;
  /** OTel span id captured at step start (for cross-link to audit row). */
  readonly otelSpanId: string | null;
  /** Iso timestamp at step start. */
  readonly startedAtIso: string;
}

export interface StepHandlerResult {
  readonly status: 'SUCCEEDED' | 'FAILED';
  /** Free-form result payload — recorded in audit chain row. */
  readonly resultPayload?: Readonly<Record<string, unknown>>;
  /** Set when status === 'FAILED'. */
  readonly error?: { readonly code: string; readonly message: string };
}

export type StepHandler = (
  step: ActionStep,
  ctx: StepHandlerContext,
) => Promise<StepHandlerResult>;

export type StepHandlerRegistry = Readonly<Record<StepKind, StepHandler>>;

// ─────────────────────────────────────────────────────────────────────
// Default registry built from the per-kind handler files
// ─────────────────────────────────────────────────────────────────────

import { draftLetterHandler } from './draft-letter.js';
import { routeApprovalHandler } from './route-approval.js';
import { postLedgerHandler } from './post-ledger.js';
import { fileGepgHandler } from './file-gepg.js';
import { sendWhatsappHandler } from './send-whatsapp.js';
import { sendSmsHandler } from './send-sms.js';
import { sendEmailHandler } from './send-email.js';
import { scheduleFieldVisitHandler } from './schedule-field-visit.js';
import { mutateEntityHandler } from './mutate-entity.js';
import { callExternalApiHandler } from './call-external-api.js';
import { emitWebhookHandler } from './emit-webhook.js';
import { notifyHandler } from './notify.js';
import { verifyHandler } from './verify.js';
import { compensateHandler } from './compensate.js';

import {
  type StepHandlerPorts,
  buildStepHandlerRegistry,
} from './ports.js';

export {
  draftLetterHandler,
  routeApprovalHandler,
  postLedgerHandler,
  fileGepgHandler,
  sendWhatsappHandler,
  sendSmsHandler,
  sendEmailHandler,
  scheduleFieldVisitHandler,
  mutateEntityHandler,
  callExternalApiHandler,
  emitWebhookHandler,
  notifyHandler,
  verifyHandler,
  compensateHandler,
  buildStepHandlerRegistry,
};
export type { StepHandlerPorts };
