/**
 * Expo Push provider — covers iOS + Android via the Expo Push API.
 *
 * Uses Expo's HTTP push endpoint directly (no SDK) to keep the
 * dependency surface minimal, mirroring the Twilio / Resend adapters.
 *
 * Endpoint:
 *   POST https://exp.host/--/api/v2/push/send
 *
 * Auth:
 *   Optional. When `EXPO_ACCESS_TOKEN` is set (enhanced security /
 *   push-security enabled in the Expo project) it is sent as
 *   `Authorization: Bearer <token>`. Expo also accepts unauthenticated
 *   sends for projects without push security, so the token is optional.
 *
 * Request body (single message — the dispatcher fans out per token):
 *   { to, title, body, data, sound: 'default' }
 *
 * Response (push *ticket*):
 *   { "data": [{ "status": "ok", "id": "<receipt-id>" }] }
 *   { "data": [{ "status": "error", "message": "...",
 *                "details": { "error": "DeviceNotRegistered" } }] }
 *
 * Status mapping (identical vocabulary to the email / SMS rails so the
 * dispatcher sees one stable error model):
 *   - ticket status 'ok'                       → 'sent', providerRef = id
 *   - ticket error DeviceNotRegistered         → failed, retryable=false
 *   - ticket error InvalidCredentials          → failed, retryable=false
 *   - ticket error MessageTooBig / MessageRateExceeded / other
 *                                              → failed, retryable=false
 *     (except MessageRateExceeded → retryable=true)
 *   - HTTP 429                                 → failed, retryable=true
 *   - HTTP 5xx                                 → failed, retryable=true
 *   - HTTP other 4xx                           → failed, retryable=false
 *   - network / timeout throw                  → failed, retryable=true
 *
 * When unconfigured (`PUSH_DISABLED=true`) the provider NEVER throws
 * out of `send()` — it returns
 * `{ status: 'failed', errorCode: 'provider_not_configured',
 *    retryable: false }` so the dispatcher can mark the row failed
 * without a re-run storm.
 *
 * The access token is stripped from any error message before return.
 */
import { randomUUID } from 'crypto';

import type {
  PushProvider,
  PushProviderInput,
  PushProviderResult,
} from './types';

const EXPO_TIMEOUT_MS = 15_000;
const PROVIDER_NAME = 'expo';
const EXPO_DEFAULT_URL = 'https://exp.host/--/api/v2/push/send';

export type ExpoConfig = {
  /** Optional Expo access token (push security). */
  readonly accessToken: string | null;
  /** Override endpoint (tests / Expo self-host). */
  readonly apiUrl?: string;
};

export type ExpoDeps = {
  readonly fetch?: typeof fetch;
  readonly renderTitle?: (input: PushProviderInput) => string;
  readonly renderBody?: (input: PushProviderInput) => string;
};

/**
 * Read Expo config from the environment. The token is optional, so this
 * always returns a config object (never `null`) — the composite decides
 * whether push is *enabled* via `PUSH_DISABLED`.
 */
export function readExpoConfigFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ExpoConfig {
  return {
    accessToken: env.EXPO_ACCESS_TOKEN ?? null,
    ...(env.EXPO_PUSH_API_URL !== undefined
      ? { apiUrl: env.EXPO_PUSH_API_URL }
      : {}),
  };
}

type ExpoTicket = {
  readonly status?: string;
  readonly id?: string;
  readonly message?: string;
  readonly details?: { readonly error?: string };
};

export function createExpoPushProvider(
  config: ExpoConfig,
  deps: ExpoDeps = {},
): PushProvider {
  const url = config.apiUrl ?? EXPO_DEFAULT_URL;
  const fetchImpl = deps.fetch ?? fetch;
  const renderTitle = deps.renderTitle ?? defaultRenderTitle;
  const renderBody = deps.renderBody ?? defaultRenderBody;

  return {
    name: PROVIDER_NAME,
    configured: true,
    async send(input: PushProviderInput): Promise<PushProviderResult> {
      const message = {
        to: input.pushToken,
        title: renderTitle(input),
        body: renderBody(input),
        data: { templateKey: input.templateKey, ...input.payload },
        sound: 'default' as const,
      };

      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            ...(config.accessToken
              ? { authorization: `Bearer ${config.accessToken}` }
              : {}),
            'X-Borjie-Tenant-Id': input.tenantId,
          },
          body: JSON.stringify(message),
          signal: AbortSignal.timeout(EXPO_TIMEOUT_MS),
        });

        if (response.status < 200 || response.status >= 300) {
          const rawText = await safeReadText(response);
          const sanitised = sanitiseToken(rawText, config.accessToken);
          return {
            status: 'failed',
            errorCode: mapHttpStatusToErrorCode(response.status),
            errorMessage: `expo http ${response.status}: ${truncate(sanitised, 256)}`,
            retryable: isRetryableHttpStatus(response.status),
            provider: PROVIDER_NAME,
          };
        }

        const ticket = await parseTicket(response);
        return mapTicket(ticket, config.accessToken);
      } catch (error) {
        const isTimeout =
          error instanceof Error &&
          (error.name === 'TimeoutError' || error.name === 'AbortError');
        const message = sanitiseToken(
          error instanceof Error ? error.message : String(error),
          config.accessToken,
        );
        return {
          status: 'failed',
          errorCode: isTimeout ? 'http_timeout' : 'http_network_error',
          errorMessage: `expo: ${truncate(message, 256)}`,
          retryable: true,
          provider: PROVIDER_NAME,
        };
      }
    },
  };
}

function mapTicket(
  ticket: ExpoTicket | null,
  accessToken: string | null,
): PushProviderResult {
  if (ticket && ticket.status === 'ok') {
    return {
      status: 'sent',
      providerRef: ticket.id ?? `expo_${randomUUID()}`,
      provider: PROVIDER_NAME,
    };
  }

  const expoError = ticket?.details?.error ?? 'UnknownError';
  const rawMessage = ticket?.message ?? 'Expo push ticket reported an error.';
  return {
    status: 'failed',
    errorCode: mapExpoErrorToCode(expoError),
    errorMessage: `expo ticket ${expoError}: ${sanitiseToken(rawMessage, accessToken)}`,
    retryable: isRetryableExpoError(expoError),
    provider: PROVIDER_NAME,
  };
}

function defaultRenderTitle(input: PushProviderInput): string {
  const title = input.payload.title;
  if (typeof title === 'string' && title.length > 0) return title;
  return 'Borjie';
}

function defaultRenderBody(input: PushProviderInput): string {
  const text = input.payload.body ?? input.payload.text;
  if (typeof text === 'string' && text.length > 0) return text;
  return `[${input.templateKey}]`;
}

async function safeReadText(response: {
  text(): Promise<string>;
}): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return '';
  }
}

/**
 * Expo wraps tickets in `{ data: [...] }` (array — one entry per `to`).
 * We send one token per request, so the single ticket is `data[0]`.
 * Tolerate a bare-object `data` shape too.
 */
async function parseTicket(response: {
  text(): Promise<string>;
}): Promise<ExpoTicket | null> {
  try {
    const text = await response.text();
    if (!text) return null;
    const parsed = JSON.parse(text) as { data?: unknown };
    const data = parsed.data;
    if (Array.isArray(data)) {
      const first = data[0];
      return isTicket(first) ? first : null;
    }
    return isTicket(data) ? data : null;
  } catch {
    return null;
  }
}

function isTicket(value: unknown): value is ExpoTicket {
  return typeof value === 'object' && value !== null;
}

function mapExpoErrorToCode(expoError: string): string {
  switch (expoError) {
    case 'DeviceNotRegistered':
      return 'device_not_registered';
    case 'InvalidCredentials':
      return 'auth_failed';
    case 'MessageTooBig':
      return 'message_too_big';
    case 'MessageRateExceeded':
      return 'rate_limited';
    default:
      return 'expo_ticket_error';
  }
}

function isRetryableExpoError(expoError: string): boolean {
  // DeviceNotRegistered / InvalidCredentials / MessageTooBig are
  // permanent for this (token, payload) pair — never retry. A rate
  // limit is transient.
  return expoError === 'MessageRateExceeded';
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
  if (status === 408 || status === 429) return true;
  if (status >= 500) return true;
  return false;
}

function sanitiseToken(value: string, token: string | null): string {
  if (!token) return value;
  return value.split(token).join('***');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}...`;
}
