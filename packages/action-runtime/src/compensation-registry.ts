/**
 * @borjie/action-runtime — compensation-registry.ts
 *
 * Maps step kind → compensation handler. Compensations are FORWARD-ONLY:
 * they reverse the effect of the original step (a reversing ledger entry,
 * a retraction message, a reverse-state mutation) without ever mutating
 * the original row.
 *
 * The registry is pluggable: tests inject a stub compensation set; prod
 * wires real reversal handlers backed by the same ports as the forward
 * step handlers.
 */

import {
  type StepKind,
  type PersistedActionStep,
  type ActionStep,
} from './types.js';
import {
  type LedgerPort,
  type GepgPort,
  type NotificationsPort,
  type SchedulingPort,
  type EntityPort,
  type WebhookPort,
} from './step-handlers/ports.js';

// ─────────────────────────────────────────────────────────────────────
// Compensation handler shape
// ─────────────────────────────────────────────────────────────────────

export interface CompensationContext {
  readonly tenantId: string;
  readonly personaId: string;
  readonly planId: string;
  readonly compensatingStepId: string;
  /** ISO timestamp. */
  readonly compensatedAtIso: string;
  /** Reason recorded in the audit row (typically the failing step's error). */
  readonly reason: string;
}

export interface CompensationResult {
  readonly ok: boolean;
  readonly resultPayload?: Readonly<Record<string, unknown>>;
  readonly error?: { readonly code: string; readonly message: string };
}

export type CompensationHandler = (
  /** The original SUCCEEDED step being reversed. */
  originalStep: PersistedActionStep,
  /** The plan-step spec (carries `compensation.payloadOverride`). */
  spec: ActionStep,
  ctx: CompensationContext,
) => Promise<CompensationResult>;

export type CompensationRegistry = Partial<
  Record<StepKind, CompensationHandler>
>;

// ─────────────────────────────────────────────────────────────────────
// Default registry — wires per-kind reversal logic
// ─────────────────────────────────────────────────────────────────────

export interface BuildCompensationRegistryDeps {
  readonly ledger: LedgerPort;
  readonly gepg: GepgPort;
  readonly notifications: NotificationsPort;
  readonly scheduling: SchedulingPort;
  readonly entity: EntityPort;
  readonly webhooks: WebhookPort;
}

export function buildCompensationRegistry(
  deps: BuildCompensationRegistryDeps,
): CompensationRegistry {
  return {
    // ── Money path — reversing journal entry ───────────────────────
    POST_LEDGER: async (originalStep, _spec, ctx) => {
      const journalId =
        (originalStep.payloadJsonb['__result__'] as
          | Record<string, unknown>
          | undefined)?.['journalId'] ??
        originalStep.payloadJsonb['journalId'];
      if (typeof journalId !== 'string') {
        return {
          ok: false,
          error: {
            code: 'NO_ORIGINAL_JOURNAL',
            message: 'compensation: original journalId missing on step payload',
          },
        };
      }
      try {
        const result = await deps.ledger.postReversal({
          tenantId: ctx.tenantId,
          originalJournalId: journalId,
          reason: ctx.reason,
          toolCallRef: `${ctx.compensatingStepId}:reversal`,
          createdBy: `persona:${ctx.personaId}`,
        });
        return {
          ok: true,
          resultPayload: { reversalJournalId: result.journalId },
        };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'LEDGER_REVERSAL_ERROR',
            message:
              err instanceof Error ? err.message : 'ledger reversal failed',
          },
        };
      }
    },

    // ── GePG — request retraction ──────────────────────────────────
    FILE_GEPG: async (originalStep, _spec, ctx) => {
      const fileId =
        (originalStep.payloadJsonb['__result__'] as
          | Record<string, unknown>
          | undefined)?.['fileId'] ??
        originalStep.payloadJsonb['fileId'];
      if (typeof fileId !== 'string') {
        return {
          ok: false,
          error: {
            code: 'NO_ORIGINAL_FILE',
            message: 'compensation: original fileId missing on step payload',
          },
        };
      }
      try {
        const result = await deps.gepg.requestRetraction({
          tenantId: ctx.tenantId,
          originalFileId: fileId,
          reason: ctx.reason,
        });
        return {
          ok: true,
          resultPayload: { retractionId: result.retractionId },
        };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'GEPG_RETRACTION_ERROR',
            message:
              err instanceof Error ? err.message : 'gepg retraction failed',
          },
        };
      }
    },

    // ── Messaging — send retraction message ────────────────────────
    SEND_WHATSAPP: async (originalStep, _spec, ctx) =>
      reverseMessage(originalStep, ctx, 'whatsapp', deps.notifications),
    SEND_SMS: async (originalStep, _spec, ctx) =>
      reverseMessage(originalStep, ctx, 'sms', deps.notifications),
    SEND_EMAIL: async (originalStep, _spec, ctx) =>
      reverseMessage(originalStep, ctx, 'email', deps.notifications),

    // ── Field visit — cancel ───────────────────────────────────────
    SCHEDULE_FIELD_VISIT: async (originalStep, _spec, ctx) => {
      const visitId =
        (originalStep.payloadJsonb['__result__'] as
          | Record<string, unknown>
          | undefined)?.['visitId'] ??
        originalStep.payloadJsonb['visitId'];
      if (typeof visitId !== 'string') {
        return {
          ok: false,
          error: {
            code: 'NO_ORIGINAL_VISIT',
            message: 'compensation: original visitId missing',
          },
        };
      }
      try {
        await deps.scheduling.cancelFieldVisit({
          tenantId: ctx.tenantId,
          visitId,
          reason: ctx.reason,
        });
        return { ok: true, resultPayload: { cancelledVisitId: visitId } };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'VISIT_CANCEL_ERROR',
            message:
              err instanceof Error ? err.message : 'visit cancel failed',
          },
        };
      }
    },

    // ── Entity mutation — reverse-apply prior state ────────────────
    MUTATE_ENTITY: async (originalStep, _spec, ctx) => {
      const entityId = originalStep.payloadJsonb['entityId'];
      const priorState = originalStep.payloadJsonb['priorState'];
      if (
        typeof entityId !== 'string' ||
        !priorState ||
        typeof priorState !== 'object'
      ) {
        return {
          ok: false,
          error: {
            code: 'NO_PRIOR_STATE',
            message: 'compensation: priorState missing for mutate_entity',
          },
        };
      }
      try {
        const result = await deps.entity.reverseEntityMutation({
          tenantId: ctx.tenantId,
          entityId,
          priorState: priorState as Record<string, unknown>,
          reason: ctx.reason,
        });
        return {
          ok: true,
          resultPayload: { revisedAt: result.revisedAt.toISOString() },
        };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'ENTITY_REVERSE_ERROR',
            message:
              err instanceof Error ? err.message : 'entity reverse failed',
          },
        };
      }
    },

    // ── Webhook — emit a counter-event ─────────────────────────────
    EMIT_WEBHOOK: async (originalStep, _spec, ctx) => {
      const originalEventType = String(
        originalStep.payloadJsonb['eventType'] ?? 'unknown',
      );
      try {
        const result = await deps.webhooks.emit({
          tenantId: ctx.tenantId,
          toolCallRef: `${ctx.compensatingStepId}:retract`,
          eventType: `${originalEventType}.compensated`,
          payload: {
            originalEventType,
            reason: ctx.reason,
            compensatedAt: ctx.compensatedAtIso,
          },
        });
        return {
          ok: true,
          resultPayload: { compensatingDeliveryId: result.deliveryId },
        };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'WEBHOOK_COMPENSATE_ERROR',
            message:
              err instanceof Error
                ? err.message
                : 'webhook compensation failed',
          },
        };
      }
    },

    // ── External API — best-effort log only ────────────────────────
    CALL_EXTERNAL_API: async (originalStep, _spec, ctx) => ({
      ok: true,
      resultPayload: {
        compensatedExternalEndpoint:
          originalStep.payloadJsonb['endpoint'] ?? 'unknown',
        reason: ctx.reason,
        // External APIs typically can't be unilaterally reversed; the
        // saga records the compensation attempt for audit but doesn't
        // call the remote service.
      },
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Internal — retraction-message helper for the three SEND_* kinds
// ─────────────────────────────────────────────────────────────────────

async function reverseMessage(
  originalStep: PersistedActionStep,
  ctx: CompensationContext,
  channel: 'whatsapp' | 'sms' | 'email',
  notifications: NotificationsPort,
): Promise<CompensationResult> {
  const originalMessageId =
    (originalStep.payloadJsonb['__result__'] as
      | Record<string, unknown>
      | undefined)?.['messageId'] ??
    originalStep.payloadJsonb['messageId'];
  if (typeof originalMessageId !== 'string') {
    return {
      ok: false,
      error: {
        code: 'NO_ORIGINAL_MESSAGE',
        message: 'compensation: original messageId missing',
      },
    };
  }
  try {
    const result = await notifications.sendRetractionMessage({
      tenantId: ctx.tenantId,
      toolCallRef: `${ctx.compensatingStepId}:retract`,
      originalMessageId,
      channel,
      reason: ctx.reason,
    });
    return {
      ok: true,
      resultPayload: { retractionMessageId: result.messageId },
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'MESSAGE_RETRACTION_ERROR',
        message:
          err instanceof Error
            ? err.message
            : `${channel} retraction failed`,
      },
    };
  }
}
