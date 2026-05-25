/**
 * SendGrid email provider.
 *
 * POSTs `https://api.sendgrid.com/v3/mail/send` with `Bearer <key>`.
 * Required env:
 *   - `SENDGRID_API_KEY`
 *   - `SENDGRID_FROM_EMAIL`
 * Optional env:
 *   - `SENDGRID_FROM_NAME`
 *   - `SENDGRID_API_BASE_URL` (defaults to https://api.sendgrid.com)
 *
 * Tenant scoping: passes `X-Bossnyumba-Tenant-Id` header so SendGrid
 * sub-account routing / IP pool selection can be tenant-aware in the
 * future without re-shaping this adapter.
 *
 * Status mapping:
 *   - 2xx → 'sent', providerRef = `x-message-id` header (or generated)
 *   - 4xx (not 408/409/429) → 'failed' non-retryable
 *   - 408/409/429/5xx/timeouts → 'failed' retryable
 *
 * The API key is sanitised out of error messages before they reach
 * the worker / logger.
 */
import { randomUUID } from 'crypto';

import type {
  EmailProvider,
  EmailProviderInput,
  EmailProviderResult,
} from '../email-provider';

const HTTP_TIMEOUT_MS = 15_000;
const PROVIDER_NAME = 'sendgrid';

export type SendGridConfig = {
  readonly apiKey: string;
  readonly fromEmail: string;
  readonly fromName?: string;
  readonly apiBaseUrl?: string;
};

export type SendGridDeps = {
  readonly fetch?: typeof fetch;
  readonly renderSubject?: (input: EmailProviderInput) => string;
  readonly renderHtml?: (input: EmailProviderInput) => string;
};

export function readSendGridConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SendGridConfig | null {
  const apiKey = env.SENDGRID_API_KEY;
  const fromEmail = env.SENDGRID_FROM_EMAIL;
  if (!apiKey || !fromEmail) return null;
  return {
    apiKey,
    fromEmail,
    fromName: env.SENDGRID_FROM_NAME,
    apiBaseUrl: env.SENDGRID_API_BASE_URL,
  };
}

export function createSendGridEmailProvider(
  config: SendGridConfig,
  deps: SendGridDeps = {},
): EmailProvider {
  const baseUrl = config.apiBaseUrl ?? 'https://api.sendgrid.com';
  const fetchImpl = deps.fetch ?? fetch;
  const renderSubject =
    deps.renderSubject ?? defaultRenderSubject;
  const renderHtml = deps.renderHtml ?? defaultRenderHtml;

  return {
    name: PROVIDER_NAME,
    configured: true,
    async send(input: EmailProviderInput): Promise<EmailProviderResult> {
      const body = {
        personalizations: [
          {
            to: [{ email: input.recipientAddress }],
            custom_args: {
              tenant_id: input.tenantId,
              template_key: input.templateKey,
              locale: input.locale,
              ...(input.idempotencyKey
                ? { idempotency_key: input.idempotencyKey }
                : {}),
            },
          },
        ],
        from: config.fromName
          ? { email: config.fromEmail, name: config.fromName }
          : { email: config.fromEmail },
        subject: renderSubject(input),
        content: [
          {
            type: 'text/html',
            value: renderHtml(input),
          },
        ],
      };

      try {
        const response = await fetchImpl(
          `${baseUrl}/v3/mail/send`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${config.apiKey}`,
              'content-type': 'application/json',
              'X-Bossnyumba-Tenant-Id': input.tenantId,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
          },
        );

        if (response.status >= 200 && response.status < 300) {
          const ref =
            response.headers.get('x-message-id') ??
            `sg_${randomUUID()}`;
          return {
            status: 'sent',
            providerRef: ref,
            provider: PROVIDER_NAME,
          };
        }

        const rawText = await safeReadBody(response);
        const sanitised = sanitiseApiKey(rawText, config.apiKey);
        return {
          status: 'failed',
          errorCode: mapHttpStatusToErrorCode(response.status),
          errorMessage: `sendgrid http ${response.status}: ${sanitised}`,
          retryable: isRetryableHttpStatus(response.status),
          provider: PROVIDER_NAME,
        };
      } catch (error) {
        const isTimeout =
          error instanceof Error &&
          (error.name === 'TimeoutError' ||
            error.name === 'AbortError');
        const message = sanitiseApiKey(
          error instanceof Error ? error.message : String(error),
          config.apiKey,
        );
        return {
          status: 'failed',
          errorCode: isTimeout ? 'http_timeout' : 'http_network_error',
          errorMessage: `sendgrid: ${message}`,
          retryable: true,
          provider: PROVIDER_NAME,
        };
      }
    },
  };
}

function defaultRenderSubject(input: EmailProviderInput): string {
  return `BORJIE: ${input.templateKey}`;
}

function defaultRenderHtml(input: EmailProviderInput): string {
  return `<p>Notification ${escapeHtml(input.templateKey)} (${escapeHtml(input.locale)})</p>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return '';
  }
}

function sanitiseApiKey(value: string, apiKey: string): string {
  if (!apiKey) return value;
  return value.split(apiKey).join('***');
}

function mapHttpStatusToErrorCode(status: number): string {
  if (status === 401 || status === 403) return 'auth_failed';
  if (status === 429) return 'rate_limited';
  if (status === 408) return 'http_timeout';
  if (status >= 500) return 'provider_5xx';
  if (status >= 400) return 'invalid_request';
  return 'unknown_http_error';
}

function isRetryableHttpStatus(status: number): boolean {
  if (status === 408 || status === 409 || status === 429) return true;
  if (status >= 500) return true;
  return false;
}
