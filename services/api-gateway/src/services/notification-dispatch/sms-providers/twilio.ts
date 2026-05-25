/**
 * Twilio SMS + WhatsApp adapter.
 *
 * Uses Twilio's REST API directly (no SDK) to keep the dependency
 * surface minimal and the bundle small.
 *
 * Endpoint:
 *   POST https://api.twilio.com/2010-04-01/Accounts/{ACCOUNT_SID}/Messages.json
 *
 * Auth:
 *   HTTP Basic — user = ACCOUNT_SID, password = AUTH_TOKEN.
 *
 * Channel routing:
 *   - 'sms'       -> From = TWILIO_FROM_NUMBER (E.164),
 *                    To   = msisdn (E.164)
 *   - 'whatsapp'  -> From = `whatsapp:${TWILIO_WHATSAPP_FROM}`,
 *                    To   = `whatsapp:${msisdn}`
 *
 * Env vars (all optional — adapter is `configured = false` if any
 * required field is missing):
 *   TWILIO_ACCOUNT_SID    (required)
 *   TWILIO_AUTH_TOKEN     (required)
 *   TWILIO_FROM_NUMBER    (required for SMS)
 *   TWILIO_WHATSAPP_FROM  (required for WhatsApp; falls back to FROM_NUMBER)
 *
 * Error model:
 *   - HTTP 4xx (except 429) -> failed, retryable=false
 *   - HTTP 5xx / 429 / network -> failed, retryable=true
 *   - Auth tokens are stripped from any error message before return.
 */
import type {
  SmsProvider,
  SmsProviderInput,
  SmsProviderResult,
} from '../sms-provider';

export type TwilioConfig = {
  readonly accountSid: string;
  readonly authToken: string;
  readonly fromNumber: string | null;
  readonly whatsappFrom: string | null;
};

export type TwilioFetch = (
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

const TWILIO_TIMEOUT_MS = 15_000;
const E164_RE = /^\+[1-9]\d{6,14}$/;

export function readTwilioConfigFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env
): TwilioConfig | null {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
  return {
    accountSid,
    authToken,
    fromNumber: env.TWILIO_FROM_NUMBER ?? null,
    whatsappFrom: env.TWILIO_WHATSAPP_FROM ?? env.TWILIO_FROM_NUMBER ?? null,
  };
}

function sanitiseToken(message: string, token: string): string {
  if (!token) return message;
  return message.split(token).join('***');
}

function isE164(value: string): boolean {
  return E164_RE.test(value);
}

function isRetryable(status: number): boolean {
  if (status === 429) return true;
  return status >= 500 && status < 600;
}

export function createTwilioSmsProvider(
  config: TwilioConfig | null,
  fetchImpl: TwilioFetch = globalThis.fetch as unknown as TwilioFetch
): SmsProvider {
  const configured = config !== null;
  const name = 'twilio';

  if (!config) {
    return {
      name,
      configured: false,
      async send(_input: SmsProviderInput): Promise<SmsProviderResult> {
        return {
          status: 'failed',
          errorCode: 'provider_not_configured',
          errorMessage: 'Twilio not configured (missing SID / token).',
          retryable: true,
          provider: name,
        };
      },
    };
  }

  return {
    name,
    configured,
    async send(input: SmsProviderInput): Promise<SmsProviderResult> {
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

      const isWhatsApp = input.channel === 'whatsapp';
      const fromCandidate = isWhatsApp
        ? config.whatsappFrom
        : config.fromNumber;

      if (!fromCandidate) {
        return {
          status: 'failed',
          errorCode: 'provider_not_configured',
          errorMessage: isWhatsApp
            ? 'TWILIO_WHATSAPP_FROM not configured.'
            : 'TWILIO_FROM_NUMBER not configured.',
          retryable: false,
          provider: name,
        };
      }

      const fromAddr = isWhatsApp
        ? `whatsapp:${fromCandidate}`
        : fromCandidate;
      const toAddr = isWhatsApp ? `whatsapp:${recipient}` : recipient;

      const body = renderBody(input);

      const params = new URLSearchParams({
        From: fromAddr,
        To: toAddr,
        Body: body,
      });

      const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
        config.accountSid
      )}/Messages.json`;

      const basicAuth = Buffer.from(
        `${config.accountSid}:${config.authToken}`,
        'utf8'
      ).toString('base64');

      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${basicAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Borjie-Tenant': input.tenantId,
            ...(input.idempotencyKey
              ? { 'Idempotency-Key': input.idempotencyKey }
              : {}),
          },
          body: params.toString(),
          signal: AbortSignal.timeout(TWILIO_TIMEOUT_MS),
        });

        if (!response.ok) {
          const rawText = await safeReadText(response);
          const sanitised = sanitiseToken(
            sanitiseToken(rawText, config.authToken),
            basicAuth
          );
          return {
            status: 'failed',
            errorCode: `twilio_http_${response.status}`,
            errorMessage: `Twilio HTTP ${response.status}: ${truncate(sanitised, 256)}`,
            retryable: isRetryable(response.status),
            provider: name,
          };
        }

        const text = await safeReadText(response);
        const providerRef = parseProviderRef(text) ?? `twilio_${Date.now()}`;
        return {
          status: 'sent',
          providerRef,
          provider: name,
        };
      } catch (err) {
        const raw = err instanceof Error ? err.message : 'unknown error';
        const sanitised = sanitiseToken(
          sanitiseToken(raw, config.authToken),
          basicAuth
        );
        return {
          status: 'failed',
          errorCode: 'twilio_network_error',
          errorMessage: `Twilio request failed: ${truncate(sanitised, 256)}`,
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

async function safeReadText(response: {
  text(): Promise<string>;
}): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function parseProviderRef(body: string): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as { sid?: unknown };
    if (typeof parsed.sid === 'string' && parsed.sid.length > 0) {
      return parsed.sid;
    }
  } catch {
    return null;
  }
  return null;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}...`;
}
