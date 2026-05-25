/**
 * Africa's Talking SMS adapter.
 *
 * Pan-Africa SMS rail (KE/UG/TZ/MW/RW). Does NOT natively support
 * WhatsApp from this endpoint, so the composite routes 'whatsapp'
 * channel rows to Twilio when both are configured.
 *
 * Endpoint:
 *   POST https://api.africastalking.com/version1/messaging
 *
 * Auth:
 *   Header `apiKey: ${AT_API_KEY}` + form field `username=${AT_USERNAME}`.
 *
 * Env vars (all required for `configured = true`):
 *   AT_USERNAME   (Africa's Talking username, e.g. "sandbox" for tests)
 *   AT_API_KEY    (API key from AT dashboard)
 *   AT_FROM       (alphanumeric sender ID or short code)
 *
 * Error model:
 *   - HTTP 4xx (except 429) -> failed, retryable=false
 *   - HTTP 5xx / 429 / network -> failed, retryable=true
 *   - API key is stripped from any error message before return.
 */
import type {
  SmsProvider,
  SmsProviderInput,
  SmsProviderResult,
} from '../sms-provider';

export type AfricasTalkingConfig = {
  readonly username: string;
  readonly apiKey: string;
  readonly from: string;
};

export type AfricasTalkingFetch = (
  url: string,
  init: {
    readonly method: 'POST';
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly signal: AbortSignal;
  }
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}>;

const AT_TIMEOUT_MS = 15_000;
const E164_RE = /^\+[1-9]\d{6,14}$/;

export function readAfricasTalkingConfigFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env
): AfricasTalkingConfig | null {
  const username = env.AT_USERNAME;
  const apiKey = env.AT_API_KEY;
  const from = env.AT_FROM;
  if (!username || !apiKey || !from) return null;
  return { username, apiKey, from };
}

function sanitiseKey(message: string, apiKey: string): string {
  if (!apiKey) return message;
  return message.split(apiKey).join('***');
}

function isE164(value: string): boolean {
  return E164_RE.test(value);
}

function isRetryable(status: number): boolean {
  if (status === 429) return true;
  return status >= 500 && status < 600;
}

export function createAfricasTalkingSmsProvider(
  config: AfricasTalkingConfig | null,
  fetchImpl: AfricasTalkingFetch = globalThis.fetch as unknown as AfricasTalkingFetch
): SmsProvider {
  const name = 'africastalking';

  if (!config) {
    return {
      name,
      configured: false,
      async send(_input: SmsProviderInput): Promise<SmsProviderResult> {
        return {
          status: 'failed',
          errorCode: 'provider_not_configured',
          errorMessage: "Africa's Talking not configured.",
          retryable: true,
          provider: name,
        };
      },
    };
  }

  return {
    name,
    configured: true,
    async send(input: SmsProviderInput): Promise<SmsProviderResult> {
      if (input.channel !== 'sms') {
        return {
          status: 'failed',
          errorCode: 'channel_unsupported',
          errorMessage: "Africa's Talking does not support WhatsApp.",
          retryable: false,
          provider: name,
        };
      }

      const recipient = input.recipientAddress.trim();
      if (!isE164(recipient)) {
        return {
          status: 'failed',
          errorCode: 'invalid_msisdn',
          errorMessage: `Recipient is not E.164: ${recipient}`,
          retryable: false,
          provider: name,
        };
      }

      const body = renderBody(input);

      const params = new URLSearchParams({
        username: config.username,
        to: recipient,
        message: body,
        from: config.from,
      });

      try {
        const response = await fetchImpl(
          'https://api.africastalking.com/version1/messaging',
          {
            method: 'POST',
            headers: {
              apiKey: config.apiKey,
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/json',
              'X-Borjie-Tenant': input.tenantId,
            },
            body: params.toString(),
            signal: AbortSignal.timeout(AT_TIMEOUT_MS),
          }
        );

        if (!response.ok) {
          const rawText = await safeReadText(response);
          const sanitised = sanitiseKey(rawText, config.apiKey);
          return {
            status: 'failed',
            errorCode: `at_http_${response.status}`,
            errorMessage: `AT HTTP ${response.status}: ${truncate(sanitised, 256)}`,
            retryable: isRetryable(response.status),
            provider: name,
          };
        }

        const text = await safeReadText(response);
        const parsed = parseAtResponse(text);
        if (parsed.status === 'failed') {
          return {
            status: 'failed',
            errorCode: parsed.errorCode,
            errorMessage: sanitiseKey(parsed.errorMessage, config.apiKey),
            retryable: parsed.retryable,
            provider: name,
          };
        }

        return {
          status: 'sent',
          providerRef: parsed.providerRef,
          provider: name,
        };
      } catch (err) {
        const raw = err instanceof Error ? err.message : 'unknown error';
        const sanitised = sanitiseKey(raw, config.apiKey);
        return {
          status: 'failed',
          errorCode: 'at_network_error',
          errorMessage: `AT request failed: ${truncate(sanitised, 256)}`,
          retryable: true,
          provider: name,
        };
      }
    },
  };
}

function renderBody(input: SmsProviderInput): string {
  const payload = input.payload;
  const text = typeof payload.text === 'string' ? payload.text : null;
  if (text) return text;
  return `[${input.templateKey}] ${JSON.stringify(payload).slice(0, 800)}`;
}

type AtParseResult =
  | {
      readonly status: 'sent';
      readonly providerRef: string;
    }
  | {
      readonly status: 'failed';
      readonly errorCode: string;
      readonly errorMessage: string;
      readonly retryable: boolean;
    };

/**
 * AT response shape:
 *   {
 *     "SMSMessageData": {
 *       "Message": "Sent to 1/1 ...",
 *       "Recipients": [{
 *         "statusCode": 101, "status": "Success",
 *         "messageId": "ATXid_xxx", ...
 *       }]
 *     }
 *   }
 *
 * statusCode 101..103 = Success / Sent / Queued -> success.
 * statusCode 401..409 = various failure modes.
 */
function parseAtResponse(text: string): AtParseResult {
  if (!text) {
    return {
      status: 'failed',
      errorCode: 'at_empty_response',
      errorMessage: 'Empty response body from AT.',
      retryable: true,
    };
  }
  try {
    const parsed = JSON.parse(text) as {
      SMSMessageData?: {
        Recipients?: ReadonlyArray<{
          statusCode?: number;
          status?: string;
          messageId?: string;
        }>;
      };
    };
    const recipients = parsed.SMSMessageData?.Recipients;
    if (!recipients || recipients.length === 0) {
      return {
        status: 'failed',
        errorCode: 'at_no_recipients',
        errorMessage: 'AT returned no recipients.',
        retryable: false,
      };
    }
    const first = recipients[0];
    const statusCode = first?.statusCode ?? 0;
    if (statusCode >= 101 && statusCode <= 103) {
      return {
        status: 'sent',
        providerRef: first?.messageId ?? `at_${Date.now()}`,
      };
    }
    return {
      status: 'failed',
      errorCode: `at_status_${statusCode}`,
      errorMessage: `AT recipient status: ${first?.status ?? 'unknown'}`,
      retryable: statusCode >= 500,
    };
  } catch {
    return {
      status: 'failed',
      errorCode: 'at_invalid_json',
      errorMessage: 'AT returned non-JSON response.',
      retryable: false,
    };
  }
}

async function safeReadText(response: {
  text(): Promise<string>;
}): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}...`;
}
