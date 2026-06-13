/**
 * Shared email render logic for every concrete email provider
 * (Resend / SendGrid / SES).
 *
 * The dispatch core composes `createEmailProviderFromEnv()` with NO
 * custom `renderSubject` / `renderHtml`, so without this module each
 * provider's default renderer emitted a one-line placeholder
 * (`<p>Notification <key> (<locale>)</p>` + `BORJIE: <key>`) and threw
 * away everything the producer pre-rendered into `input.payload`. The
 * daily-brief cron, for example, renders a full branded subject + HTML
 * into `payload.subject` / `payload.bodyHtml`; those were discarded and
 * recipients got a meaningless, locale-impure stub.
 *
 * This renderer reads `input.payload` first:
 *   - SUBJECT  — `payload.subject` (string) → used verbatim; else
 *                `payload.title` (string) → used verbatim (reminders);
 *                else the honest fallback `BORJIE: <templateKey>`.
 *   - HTML     — `payload.html` (string) → used verbatim (spec name);
 *                else `payload.bodyHtml` (string) (the daily-brief
 *                producer field); else `payload.body` (string) wrapped
 *                in an escaped `<p>` (reminders plaintext); else an
 *                honest minimal fallback that never fabricates content.
 *
 * Path (b) — looking up the `@borjie/notifications` borjie template
 * registry by templateKey/locale — is intentionally NOT done here: that
 * package is ESM + React (`@react-email/components`, `react`) and is not
 * a dependency of api-gateway, so importing it would break the CJS
 * bundle (see notes). Producers that have a template instead pre-render
 * into `payload.subject` / `payload.html` / `payload.bodyHtml`, which
 * path (a) above already honours.
 *
 * NOTE on trust boundary: the HTML in `payload.html` / `payload.bodyHtml`
 * is produced by our own first-party producers (cron / dispatcher), not
 * by end-user input, so it is treated as trusted markup and passed
 * through verbatim. Free-text fields surfaced into HTML by the fallback
 * (`payload.body`) ARE escaped.
 */
import { z } from 'zod';

import type { EmailProviderInput } from '../email-provider';

/**
 * The render-relevant slice of `input.payload`. Every field is optional
 * — producers vary (daily-brief sets subject+bodyHtml, reminders set
 * title+body, the dispatcher passes an arbitrary queued payload). zod
 * `.catchall` keeps the rest of the payload intact without coercion.
 */
const renderPayloadSchema = z
  .object({
    subject: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    html: z.string().min(1).optional(),
    bodyHtml: z.string().min(1).optional(),
    body: z.string().min(1).optional(),
  })
  .catchall(z.unknown());

type RenderPayload = z.infer<typeof renderPayloadSchema>;

function parsePayload(
  payload: Readonly<Record<string, unknown>>,
): RenderPayload {
  const parsed = renderPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data : {};
}

/**
 * Subject: pre-rendered `payload.subject`, then `payload.title`, then an
 * honest fallback derived from the template key. Never fabricated.
 */
export function renderEmailSubject(input: EmailProviderInput): string {
  const payload = parsePayload(input.payload);
  if (payload.subject) return payload.subject;
  if (payload.title) return payload.title;
  return `BORJIE: ${input.templateKey}`;
}

/**
 * HTML body: pre-rendered `payload.html` (spec field), then
 * `payload.bodyHtml` (daily-brief producer field), then an escaped
 * wrap of plaintext `payload.body` (reminders), then an honest minimal
 * fallback. Trusted first-party HTML passes through; free text is
 * escaped.
 */
export function renderEmailHtml(input: EmailProviderInput): string {
  const payload = parsePayload(input.payload);
  if (payload.html) return payload.html;
  if (payload.bodyHtml) return payload.bodyHtml;
  if (payload.body) return `<p>${escapeHtml(payload.body)}</p>`;
  return defaultEmailHtml(input);
}

/**
 * Honest fallback body — used only when the payload carries no rendered
 * subject/html/body and no known template is available. Says exactly
 * what it is (a notification keyed by templateKey) without inventing
 * content. Locale-pure: emits a single language per `input.locale`.
 */
function defaultEmailHtml(input: EmailProviderInput): string {
  const key = escapeHtml(input.templateKey);
  const line =
    input.locale === 'sw'
      ? `Una arifa mpya kutoka BORJIE (${key}).`
      : `You have a new BORJIE notification (${key}).`;
  return `<p>${line}</p>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
