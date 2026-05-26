/**
 * AWS SES email provider.
 *
 * Issues `SendEmail` against the SES query API at
 * `https://email.<region>.amazonaws.com/` using SigV4 signed
 * `x-www-form-urlencoded` POSTs. We avoid `@aws-sdk/client-ses` to
 * keep the api-gateway bundle lean (the SDK is not in deps yet).
 *
 * Required env:
 *   - `AWS_ACCESS_KEY_ID`
 *   - `AWS_SECRET_ACCESS_KEY`
 *   - `AWS_SES_REGION`
 *   - `SES_FROM_EMAIL`
 * Optional env:
 *   - `AWS_SESSION_TOKEN` (for STS / role-assumed creds)
 *   - `SES_API_BASE_URL` (override for tests / VPC endpoints)
 *
 * Tenant scoping: SES tags the message with `Tags.member.1.Name=tenant_id`
 * so per-tenant deliverability dashboards work without a separate config.
 *
 * Status mapping & retry policy mirrors the SendGrid adapter for
 * consistency at the dispatcher seam.
 *
 * Secrets are sanitised from any error message that escapes this
 * module — we never let the secret access key, session token, or
 * Authorization header reach a logger.
 */
import { createHash, createHmac, randomUUID } from 'crypto';

import type {
  EmailProvider,
  EmailProviderInput,
  EmailProviderResult,
} from '../email-provider';

const HTTP_TIMEOUT_MS = 15_000;
const PROVIDER_NAME = 'ses';
const SERVICE = 'ses';

export type SesConfig = {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region: string;
  readonly fromEmail: string;
  readonly sessionToken?: string;
  readonly apiBaseUrl?: string;
};

export type SesDeps = {
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly renderSubject?: (input: EmailProviderInput) => string;
  readonly renderHtml?: (input: EmailProviderInput) => string;
};

export function readSesConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SesConfig | null {
  const accessKeyId = env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
  const region = env.AWS_SES_REGION;
  const fromEmail = env.SES_FROM_EMAIL;
  if (!accessKeyId || !secretAccessKey || !region || !fromEmail) {
    return null;
  }
  return {
    accessKeyId,
    secretAccessKey,
    region,
    fromEmail,
    ...(env.AWS_SESSION_TOKEN !== undefined ? { sessionToken: env.AWS_SESSION_TOKEN } : {}),
    ...(env.SES_API_BASE_URL !== undefined ? { apiBaseUrl: env.SES_API_BASE_URL } : {}),
  };
}

export function createSesEmailProvider(
  config: SesConfig,
  deps: SesDeps = {},
): EmailProvider {
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());
  const renderSubject = deps.renderSubject ?? defaultRenderSubject;
  const renderHtml = deps.renderHtml ?? defaultRenderHtml;
  const baseUrl =
    config.apiBaseUrl ?? `https://email.${config.region}.amazonaws.com`;
  const host = new URL(baseUrl).host;

  return {
    name: PROVIDER_NAME,
    configured: true,
    async send(input: EmailProviderInput): Promise<EmailProviderResult> {
      const form = buildSendEmailForm({
        from: config.fromEmail,
        to: input.recipientAddress,
        subject: renderSubject(input),
        bodyHtml: renderHtml(input),
        tenantId: input.tenantId,
        templateKey: input.templateKey,
      });

      const body = encodeForm(form);
      const date = now();
      const headers = signRequest({
        method: 'POST',
        host,
        path: '/',
        body,
        config,
        date,
      });
      const allHeaders: Record<string, string> = {
        ...headers,
        'X-Bossnyumba-Tenant-Id': input.tenantId,
      };

      try {
        const response = await fetchImpl(`${baseUrl}/`, {
          method: 'POST',
          headers: allHeaders,
          body,
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        });

        const text = await safeReadBody(response);
        if (response.status >= 200 && response.status < 300) {
          const ref =
            extractMessageId(text) ?? `ses_${randomUUID()}`;
          return {
            status: 'sent',
            providerRef: ref,
            provider: PROVIDER_NAME,
          };
        }

        const sanitised = sanitiseSecrets(text, config);
        return {
          status: 'failed',
          errorCode: mapHttpStatusToErrorCode(response.status),
          errorMessage: `ses http ${response.status}: ${sanitised}`,
          retryable: isRetryableHttpStatus(response.status),
          provider: PROVIDER_NAME,
        };
      } catch (error) {
        const isTimeout =
          error instanceof Error &&
          (error.name === 'TimeoutError' ||
            error.name === 'AbortError');
        const message = sanitiseSecrets(
          error instanceof Error ? error.message : String(error),
          config,
        );
        return {
          status: 'failed',
          errorCode: isTimeout ? 'http_timeout' : 'http_network_error',
          errorMessage: `ses: ${message}`,
          retryable: true,
          provider: PROVIDER_NAME,
        };
      }
    },
  };
}

type FormParams = ReadonlyArray<readonly [string, string]>;

function buildSendEmailForm(args: {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly bodyHtml: string;
  readonly tenantId: string;
  readonly templateKey: string;
}): FormParams {
  return [
    ['Action', 'SendEmail'],
    ['Version', '2010-12-01'],
    ['Source', args.from],
    ['Destination.ToAddresses.member.1', args.to],
    ['Message.Subject.Data', args.subject],
    ['Message.Subject.Charset', 'UTF-8'],
    ['Message.Body.Html.Data', args.bodyHtml],
    ['Message.Body.Html.Charset', 'UTF-8'],
    ['Tags.member.1.Name', 'tenant_id'],
    ['Tags.member.1.Value', sanitiseTagValue(args.tenantId)],
    ['Tags.member.2.Name', 'template_key'],
    ['Tags.member.2.Value', sanitiseTagValue(args.templateKey)],
  ];
}

function sanitiseTagValue(value: string): string {
  // SES tag values: ASCII letters, digits, '_', '-'. Replace others.
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256);
}

function encodeForm(params: FormParams): string {
  return params
    .map(
      ([k, v]) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(v)}`,
    )
    .join('&');
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
    return text.slice(0, 1000);
  } catch {
    return '';
  }
}

function extractMessageId(xml: string): string | null {
  const match = xml.match(/<MessageId>([^<]+)<\/MessageId>/);
  return match?.[1] ?? null;
}

function sanitiseSecrets(value: string, config: SesConfig): string {
  let sanitised = value;
  if (config.secretAccessKey) {
    sanitised = sanitised.split(config.secretAccessKey).join('***');
  }
  if (config.accessKeyId) {
    sanitised = sanitised.split(config.accessKeyId).join('***');
  }
  if (config.sessionToken) {
    sanitised = sanitised.split(config.sessionToken).join('***');
  }
  return sanitised;
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

/**
 * Internal: SigV4 request signing for SES query API.
 *
 * Returns the full header set (host, x-amz-date, x-amz-security-token,
 * content-type, authorization). The caller is free to merge tenant
 * headers in afterwards.
 *
 * Exported via `__sigv4` for tests.
 */
type SignArgs = {
  readonly method: string;
  readonly host: string;
  readonly path: string;
  readonly body: string;
  readonly config: SesConfig;
  readonly date: Date;
};

function signRequest(args: SignArgs): Record<string, string> {
  const amzDate = toAmzDate(args.date);
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${args.config.region}/${SERVICE}/aws4_request`;
  const payloadHash = sha256Hex(args.body);

  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
    host: args.host,
    'x-amz-date': amzDate,
  };
  if (args.config.sessionToken) {
    headers['x-amz-security-token'] = args.config.sessionToken;
  }

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders =
    signedHeaderNames.map((n) => `${n}:${headers[n]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');

  const canonicalRequest = [
    args.method,
    args.path,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = deriveSigningKey(
    args.config.secretAccessKey,
    dateStamp,
    args.config.region,
    SERVICE,
  );
  const signature = createHmac('sha256', signingKey)
    .update(stringToSign)
    .digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${args.config.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    ...headers,
    authorization,
  };
}

function toAmzDate(date: Date): string {
  const iso = date.toISOString();
  // YYYYMMDDTHHMMSSZ
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function deriveSigningKey(
  secret: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

/**
 * Test-only export: lets unit tests verify signing without an HTTP
 * round-trip. Not part of the public adapter surface.
 */
export const __sigv4 = { signRequest, toAmzDate, sha256Hex };
