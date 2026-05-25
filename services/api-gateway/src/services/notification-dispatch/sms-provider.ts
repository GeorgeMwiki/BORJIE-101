/**
 * SMS / WhatsApp provider seam for the notification-dispatch worker.
 *
 * Same pattern as the email provider: dispatcher depends on a port,
 * not a concrete rail. Swap the stub for a real adapter at
 * composition time.
 *
 * Real adapters live under `./sms-providers/`:
 *   - twilio.ts          (global SMS + WhatsApp)
 *   - africastalking.ts  (pan-Africa SMS, no WhatsApp)
 *   - composite.ts       (env-driven router across the two)
 *
 * Future rails (placeholder):
 *   - Beem Africa (TZ-first)
 *   - Infobip / MessageBird
 *
 * Composition resolves the provider in this priority order:
 *   1. Composite (any of Twilio / AT configured via env)
 *   2. Stub (`provider_not_configured`)
 */
import { randomUUID } from 'crypto';
import { createCompositeSmsProviderFromEnv } from './sms-providers/composite';

export type SmsProviderInput = {
  readonly tenantId: string;
  readonly recipientAddress: string;
  readonly templateKey: string;
  readonly locale: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string | null;
  /**
   * Either 'sms' or 'whatsapp' — the worker forwards the row's
   * channel so the SMS provider can route the right rail.
   */
  readonly channel: 'sms' | 'whatsapp';
};

export type SmsProviderResult =
  | {
      readonly status: 'sent';
      readonly providerRef: string;
      readonly provider: string;
    }
  | {
      readonly status: 'failed';
      readonly errorCode: string;
      readonly errorMessage: string;
      readonly retryable: boolean;
      readonly provider: string;
    };

export type SmsProvider = {
  readonly name: string;
  readonly configured: boolean;
  send(input: SmsProviderInput): Promise<SmsProviderResult>;
};

export function createStubSmsProvider(): SmsProvider {
  return {
    name: 'stub-sms',
    configured: false,
    async send(_input) {
      return {
        status: 'failed',
        errorCode: 'provider_not_configured',
        errorMessage:
          'No real SMS / WhatsApp provider configured; stub returns failed.',
        retryable: true,
        provider: 'stub-sms',
      };
    },
  };
}

/**
 * Resolve the production SMS provider:
 *   - Composite (Twilio / Africa's Talking) if any env-configured.
 *   - Stub otherwise (so the worker logs `provider_not_configured`
 *     and rows can be retried once a rail is wired).
 */
export function resolveSmsProviderFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env
): SmsProvider {
  const composite = createCompositeSmsProviderFromEnv(env);
  return composite ?? createStubSmsProvider();
}

export function createInMemorySmsProvider(): SmsProvider & {
  readonly sent: ReadonlyArray<SmsProviderInput>;
} {
  const sent: SmsProviderInput[] = [];
  return {
    name: 'in-memory-sms',
    configured: true,
    get sent() {
      return [...sent];
    },
    async send(input) {
      sent.push(input);
      return {
        status: 'sent',
        providerRef: `mem_${randomUUID()}`,
        provider: 'in-memory-sms',
      };
    },
  };
}
