/**
 * Borjie email sender.
 *
 * Renders a registered Borjie template via React Email and ships it
 * through Resend. Throws synchronously if RESEND_API_KEY is missing —
 * per the no-mock-fallback directive, callers must wire the real
 * provider before invoking sendEmail.
 *
 * Usage:
 *   const { message_id } = await sendEmail({
 *     template: 'welcome',
 *     to: 'owner@example.tz',
 *     data: { ownerName, cockpitUrl, lang: 'sw' },
 *   });
 */
import { render } from '@react-email/components';
import { z } from 'zod';

import {
  getBorjieTemplate,
  type BorjieTemplateDataMap,
  type BorjieTemplateName,
} from './templates/borjie';

export type BorjieLang = 'sw' | 'en';

export interface SendEmailParams<TName extends BorjieTemplateName> {
  readonly template: TName;
  readonly to: string | ReadonlyArray<string>;
  readonly data: BorjieTemplateDataMap[TName];
  readonly lang?: BorjieLang;
  readonly from?: string;
  readonly replyTo?: string;
  readonly idempotencyKey?: string;
}

export interface SendEmailResult {
  readonly message_id: string;
  readonly provider: 'resend';
  readonly to: ReadonlyArray<string>;
  readonly subject: string;
}

interface ResendClient {
  emails: {
    send(payload: ResendSendPayload): Promise<ResendResponse>;
  };
}

interface ResendSendPayload {
  from: string;
  to: ReadonlyArray<string>;
  subject: string;
  html: string;
  text: string;
  reply_to?: string;
  headers?: Record<string, string>;
}

interface ResendResponse {
  data?: { id: string } | null;
  error?: { message: string; name?: string } | null;
}

// Lazy singleton — we only construct the client once per process, but
// not at module-load time (so test envs that never call sendEmail don't
// trip the "missing key" check).
let cachedClient: ResendClient | null = null;
let cachedClientApiKey: string | null = null;

function loadResend(apiKey: string): ResendClient {
  if (cachedClient && cachedClientApiKey === apiKey) return cachedClient;
  // Dynamic require keeps the dependency optional at type-check time;
  // production runtimes have `resend` installed via package.json.
  let ResendCtor: new (key: string) => ResendClient;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('resend') as { Resend: new (key: string) => ResendClient };
    ResendCtor = mod.Resend;
  } catch (err) {
    throw new Error(
      `[borjie-sender] failed to load 'resend' package: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  cachedClient = new ResendCtor(apiKey);
  cachedClientApiKey = apiKey;
  return cachedClient;
}

const EnvSchema = z.object({
  RESEND_API_KEY: z.string().min(8),
  RESEND_FROM_EMAIL: z.string().email().default('noreply@borjie.com'),
});

function readEnv(): z.infer<typeof EnvSchema> {
  const raw = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
  };
  if (!raw.RESEND_API_KEY) {
    throw new Error(
      '[borjie-sender] RESEND_API_KEY is not configured. No mock fallback — set the env var or wire a real provider.'
    );
  }
  return EnvSchema.parse(raw);
}

function normaliseRecipients(to: string | ReadonlyArray<string>): ReadonlyArray<string> {
  const arr = typeof to === 'string' ? [to] : to;
  const valid = arr
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
  if (valid.length === 0) {
    throw new Error('[borjie-sender] no valid recipient email addresses');
  }
  return valid;
}

export async function sendEmail<TName extends BorjieTemplateName>(
  params: SendEmailParams<TName>
): Promise<SendEmailResult> {
  const env = readEnv();
  const entry = getBorjieTemplate(params.template);

  const dataWithLang = {
    ...params.data,
    ...(params.lang ? { lang: params.lang } : {}),
  } as BorjieTemplateDataMap[TName];

  const validated = entry.schema.parse(dataWithLang);
  const element = entry.render(validated);
  const html = await render(element);
  const text = entry.text(validated);
  const subject = entry.subject(validated);
  const recipients = normaliseRecipients(params.to);

  const client = loadResend(env.RESEND_API_KEY);
  const headers: Record<string, string> = {};
  if (params.idempotencyKey) {
    headers['Idempotency-Key'] = params.idempotencyKey;
  }

  const payload: ResendSendPayload = {
    from: params.from ?? env.RESEND_FROM_EMAIL,
    to: recipients,
    subject,
    html,
    text,
    ...(params.replyTo ? { reply_to: params.replyTo } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  };

  let response: ResendResponse;
  try {
    response = await client.emails.send(payload);
  } catch (err) {
    throw new Error(
      `[borjie-sender] Resend transport failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  if (response.error) {
    throw new Error(
      `[borjie-sender] Resend rejected send: ${response.error.message}`
    );
  }
  if (!response.data?.id) {
    throw new Error('[borjie-sender] Resend returned no message id');
  }

  return {
    message_id: response.data.id,
    provider: 'resend',
    to: recipients,
    subject,
  };
}

/**
 * Test-seam reset. Lets tests blow away the cached client between runs
 * (e.g. after toggling RESEND_API_KEY). Not exported from the package
 * barrel — only consumed by the package's own tests.
 */
export function __resetBorjieSenderForTests(): void {
  cachedClient = null;
  cachedClientApiKey = null;
}
