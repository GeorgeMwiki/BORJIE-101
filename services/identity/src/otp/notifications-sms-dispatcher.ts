/**
 * NotificationsSmsDispatcher
 *
 * Adapter that implements the identity `SmsDispatcher` port by delegating to
 * the notifications service `enqueueNotification` entry point. This replaces
 * the `NoopSmsDispatcher` used by dev/test stacks.
 *
 * Design notes:
 *
 *   - The notifications package is NOT a direct workspace dependency of
 *     `@borjie/identity` (see services/identity/package.json). To avoid
 *     forcing a cyclic or upward package dependency, the dispatcher function
 *     is injected through the `EnqueueNotificationFn` port rather than being
 *     imported from `@borjie/notifications`. The composition root wires
 *     the real `enqueueNotification` in via `otp-factory`.
 *
 *   - Category / templateId is `auth_otp`. This value is additive to the
 *     notifications template union — the notifications dispatcher uses the
 *     field for preference gating only. The OTP flow passes the `body` verbatim
 *     because the SMS provider expects pre-rendered text.
 *
 *   - Priority is `emergency` so quiet-hours suppression is bypassed (see
 *     `services/notifications/src/preferences/service.ts#checkAllowed`). A
 *     user still retains the ability to opt out of SMS entirely via channel
 *     preferences — we do not want to spam a user who has fully disabled SMS.
 *
 *   - On notification-service failure we surface a clear warning through an
 *     injectable logger and rethrow, so the OTP service's send() rollback
 *     deletes the stored record and the caller can retry.
 */

import type { SmsDispatcher } from './otp-service.js';
import { logger } from '../logger.js';

/** The single word used for the OTP send category. */
export const OTP_TEMPLATE_ID = 'auth_otp' as const;

/** The message template sent to the recipient. Keep short for SMS. */
export const OTP_SMS_TEMPLATE =
  'Your BORJIE verification code is {{code}}. Expires in 5 minutes.';

/** Minimal shape of the notifications dispatcher result we care about. */
export interface EnqueueNotificationResult {
  readonly accepted: boolean;
  readonly deadLettered?: boolean;
  readonly lastError?: string;
  readonly suppressedReason?: string;
}

/** Minimal shape of the notifications enqueue input we pass through. */
export interface EnqueueNotificationPayload {
  readonly tenantId: string;
  readonly userId?: string;
  readonly channel: 'sms';
  readonly templateId: string;
  readonly recipient: string;
  readonly body: string;
  readonly data?: Record<string, string>;
  readonly priority: 'emergency';
  readonly correlationId?: string;
  readonly idempotencyKey?: string;
}

/**
 * Port for the notifications enqueue function. Identical in shape to
 * `enqueueNotification` exported from `services/notifications/src/dispatcher.ts`
 * but typed locally to keep the packages decoupled.
 */
export type EnqueueNotificationFn = (
  input: EnqueueNotificationPayload
) => Promise<EnqueueNotificationResult>;

/** Injectable logger surface — warning-level fallback only. */
export interface DispatcherLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

/** Default logger — uses console.warn but tagged for structured-logger upgrade. */
const defaultLogger: DispatcherLogger = {
  warn(message, meta) {
    logger.warn(`[identity.otp.notifications-sms-dispatcher] ${message}`, { value: meta ?? {} })
  },
};

/** Extract the numeric code from the templated message for enqueue `data`. */
function renderBody(code: string): string {
  return OTP_SMS_TEMPLATE.replace('{{code}}', code);
}

export interface NotificationsSmsDispatcherDeps {
  readonly enqueue: EnqueueNotificationFn;
  /** Tenant the OTP is being issued under. Required for provider selection. */
  readonly tenantId: string;
  /** Optional user id — used by notifications preferences gate. */
  readonly userId?: string;
  /** Optional correlation id for tracing. */
  readonly correlationId?: string;
  /** Optional logger for fallback warnings. */
  readonly logger?: DispatcherLogger;
}

export class NotificationsSmsDispatcher implements SmsDispatcher {
  private readonly enqueue: EnqueueNotificationFn;
  private readonly tenantId: string;
  private readonly userId: string | undefined;
  private readonly correlationId: string | undefined;
  private readonly logger: DispatcherLogger;

  constructor(deps: NotificationsSmsDispatcherDeps) {
    if (!deps || typeof deps.enqueue !== 'function') {
      throw new Error(
        'NotificationsSmsDispatcher: `enqueue` function is required'
      );
    }
    if (!deps.tenantId || deps.tenantId.trim().length === 0) {
      throw new Error('NotificationsSmsDispatcher: `tenantId` is required');
    }
    this.enqueue = deps.enqueue;
    this.tenantId = deps.tenantId;
    this.userId = deps.userId;
    this.correlationId = deps.correlationId;
    this.logger = deps.logger ?? defaultLogger;
  }

  async send(phone: string, message: string): Promise<void> {
    if (!phone || phone.trim().length === 0) {
      throw new Error('NotificationsSmsDispatcher.send: phone is required');
    }
    // Extract the numeric code — otp-service constructs a sentence including
    // the code. We prefer the canonical template so the notifications layer
    // sees a stable body string, but the raw message (already templated by
    // otp-service) remains the source of truth for the actual SMS text.
    const code = extractCodeFromMessage(message);
    const body = code ? renderBody(code) : message;

    const payload: EnqueueNotificationPayload = {
      tenantId: this.tenantId,
      ...(this.userId !== undefined ? { userId: this.userId } : {}),
      channel: 'sms',
      templateId: OTP_TEMPLATE_ID,
      recipient: phone,
      body,
      ...(code ? { data: { code } } : {}),
      priority: 'emergency',
      ...(this.correlationId !== undefined ? { correlationId: this.correlationId } : {}),
      ...(code ? { idempotencyKey: `otp:${this.tenantId}:${phone}:${code}` } : {}),
    };

    let result: EnqueueNotificationResult;
    try {
      result = await this.enqueue(payload);
    } catch (error) {
      this.logger.warn('notifications service threw on enqueue', {
        tenantId: this.tenantId,
        recipient: phone,
        error: (error as Error).message,
      });
      throw new Error(
        `NotificationsSmsDispatcher: notifications service unavailable: ${(error as Error).message}`
      );
    }

    if (!result.accepted) {
      // Suppressed-by-preferences is a soft outcome — the user opted out.
      // We surface it as an error so the OTP record is rolled back and the
      // caller can explain to the user why no code arrived.
      if (result.suppressedReason) {
        this.logger.warn('OTP suppressed by preferences', {
          tenantId: this.tenantId,
          recipient: phone,
          reason: result.suppressedReason,
        });
        throw new Error(
          `NotificationsSmsDispatcher: OTP suppressed (${result.suppressedReason})`
        );
      }
      this.logger.warn('notifications enqueue rejected', {
        tenantId: this.tenantId,
        recipient: phone,
        deadLettered: result.deadLettered,
        lastError: result.lastError,
      });
      throw new Error(
        `NotificationsSmsDispatcher: enqueue rejected: ${result.lastError ?? 'unknown'}`
      );
    }
  }
}

/**
 * Best-effort extraction of a 6-digit code from the already-templated message
 * produced by `OtpService`. We keep this permissive: if the message shape
 * changes, we fall back to passing the raw message through as the body.
 */
function extractCodeFromMessage(message: string): string | undefined {
  const match = message.match(/\b(\d{6})\b/);
  return match ? match[1] : undefined;
}
