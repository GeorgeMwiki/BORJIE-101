/**
 * Email provider seam for the notification-dispatch worker.
 *
 * The dispatcher never imports a concrete email service — it only
 * depends on `EmailProvider`. Swap the stub for a real adapter
 * (Resend / SES / SendGrid / Postmark / Mailgun) at composition time.
 *
 * Real providers (#33):
 *   - Resend `resend.emails.send({ from, to, subject, html })`
 *   - AWS SES `SendEmailCommand`
 *   - SendGrid `sgMail.send`
 *   - Postmark `client.sendEmail`
 *
 * The stub is used until a real provider is wired. It signals
 * `not_configured` to the worker so the worker can:
 *   - log a single "degraded" boot warning,
 *   - mark dispatch rows as `failed` with a stable `provider_error_code`
 *     of `provider_not_configured`, allowing future re-runs once a real
 *     provider lands.
 */
import { randomUUID } from 'crypto';

import {
  createConfiguredEmailProviderFromEnv,
  type CompositeEnvDeps,
} from './email-providers/composite';

export type EmailProviderInput = {
  readonly tenantId: string;
  readonly recipientAddress: string;
  readonly templateKey: string;
  readonly locale: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string | null;
};

export type EmailProviderResult =
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

export type EmailProvider = {
  readonly name: string;
  readonly configured: boolean;
  send(input: EmailProviderInput): Promise<EmailProviderResult>;
};

/**
 * Stub email provider — returns a deterministic `failed` result with
 * `errorCode = 'provider_not_configured'`. The worker uses this code
 * to schedule a retry when a real provider is wired up later.
 */
export function createStubEmailProvider(): EmailProvider {
  return {
    name: 'stub-email',
    configured: false,
    async send(_input) {
      return {
        status: 'failed',
        errorCode: 'provider_not_configured',
        errorMessage:
          'No real email provider configured; stub returns failed.',
        retryable: true,
        provider: 'stub-email',
      };
    },
  };
}

/**
 * Composition-time factory. Tries env-driven SendGrid/SES first,
 * falls back to the stub when neither is configured. Keeps the
 * dispatcher composition single-line:
 *
 *   emailProvider: createEmailProviderFromEnv(),
 */
export function createEmailProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  deps: CompositeEnvDeps = {},
): EmailProvider {
  const real = createConfiguredEmailProviderFromEnv(env, deps);
  return real ?? createStubEmailProvider();
}

/**
 * In-memory test provider — succeeds and records sent payloads.
 * Used by tests, not in production composition.
 */
export function createInMemoryEmailProvider(): EmailProvider & {
  readonly sent: ReadonlyArray<EmailProviderInput>;
} {
  const sent: EmailProviderInput[] = [];
  return {
    name: 'in-memory-email',
    configured: true,
    get sent() {
      return [...sent];
    },
    async send(input) {
      sent.push(input);
      return {
        status: 'sent',
        providerRef: `mem_${randomUUID()}`,
        provider: 'in-memory-email',
      };
    },
  };
}
