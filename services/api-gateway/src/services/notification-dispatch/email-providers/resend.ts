/**
 * Resend email provider.
 *
 * POSTs `https://api.resend.com/emails` with `Bearer <key>` and a JSON
 * body of `{ from, to, subject, html }` — the exact shape the Resend
 * `/emails` endpoint expects.
 *
 * Required env:
 *   - `RESEND_API_KEY`
 *   - `RESEND_FROM_EMAIL`
 * Optional env:
 *   - `RESEND_FROM_NAME` (rendered as `Name <email>` per RFC 5322)
 *   - `RESEND_API_URL` (defaults to https://api.resend.com)
 *
 * Tenant scoping: passes `X-Borjie-Tenant-Id` so Resend audience /
 * domain routing can become tenant-aware without re-shaping this
 * adapter, mirroring the SendGrid seam.
 *
 * Status mapping (identical to the SendGrid adapter so the dispatcher
 * sees one stable error vocabulary regardless of provider):
 *   - 2xx → 'sent', providerRef = response `id` (or generated)
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
const PROVIDER_NAME = 'resend';

export type ResendConfig = {
  readonly apiKey: string;
  readonly fromEmail: string;
  readonly fromName?: string;
  readonly apiBaseUrl?: string;
};

export type ResendDeps = {
  readonly fetch?: typeof fetch;
  readonly renderSubject?: (input: EmailProviderInput) => string;
  readonly renderHtml?: (input: EmailProviderInput) => string;
};

export function readResendConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ResendConfig | null {
  const apiKey = env.RESEND_API_KEY;
  const fromEmail = env.RESEND_FROM_EMAIL;
  if (!apiKey || !fromEmail) return null;
  return {
    apiKey,
    fromEmail,
    ...(env.RESEND_FROM_NAME !== undefined ? { fromName: env.RESEND_FROM_NAME } : {}),
    ...(env.RESEND_API_URL !== undefined ? { apiBaseUrl: env.RESEND_API_URL } : {}),
  };
}

export function createResendEmailProvider(
  config: ResendConfig,
  deps: ResendDeps = {},
): EmailProvider {
  const baseUrl = config.apiBaseUrl ?? 'https://api.resend.com';
  const fetchImpl = deps.fetch ?? fetch;
  const renderSubject = deps.renderSubject ?? defaultRenderSubject;
  const renderHtml = deps.renderHtml ?? defaultRenderHtml;
  const from = config.fromName
    ? `${config.fromName} <${config.fromEmail}>`
    : config.fromEmail;

  return {
    name: PROVIDER_NAME,
    configured: true,
    async send(input: EmailProviderInput): Promise<EmailProviderResult> {
      const body = {
        from,
        to: input.recipientAddress,
        subject: renderSubject(input),
        html: renderHtml(input),
      };

      try {
        const response = await fetchImpl(`${baseUrl}/emails`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            'content-type': 'application/json',
            'X-Borjie-Tenant-Id': input.tenantId,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        });

        if (response.status >= 200 && response.status < 300) {
          const ref = (await safeReadId(response)) ?? `re_${randomUUID()}`;
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
          errorMessage: `resend http ${response.status}: ${sanitised}`,
          retryable: isRetryableHttpStatus(response.status),
          provider: PROVIDER_NAME,
        };
      } catch (error) {
        const isTimeout =
          error instanceof Error &&
          (error.name === 'TimeoutError' || error.name === 'AbortError');
        const message = sanitiseApiKey(
          error instanceof Error ? error.message : String(error),
          config.apiKey,
        );
        return {
          status: 'failed',
          errorCode: isTimeout ? 'http_timeout' : 'http_network_error',
          errorMessage: `resend: ${message}`,
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

/**
 * Resend returns `{ "id": "<uuid>" }` on success. Parse it for the
 * providerRef; fall through to a generated ref if the body is empty
 * or unparseable (mirrors SendGrid's missing-header fallback).
 */
async function safeReadId(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    if (!text) return null;
    const parsed = JSON.parse(text) as { id?: unknown };
    if (typeof parsed.id === 'string' && parsed.id.length > 0) {
      return parsed.id;
    }
    return null;
  } catch {
    return null;
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
