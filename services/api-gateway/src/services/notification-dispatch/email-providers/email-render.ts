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
 * Precedence (subject AND html), highest first:
 *   1. EXPLICIT pre-rendered payload fields:
 *        SUBJECT — `payload.subject` (string) → verbatim; else
 *                  `payload.title` (string) → verbatim (reminders).
 *        HTML    — `payload.html` (string) → verbatim (spec name); else
 *                  `payload.bodyHtml` (string) (daily-brief field); else
 *                  `payload.body` (string) wrapped in an escaped `<p>`.
 *   2. TEMPLATE-KEY MAP (this module) — for the known dispatch
 *      `template_key` values that enqueue ONLY a structured payload (no
 *      pre-rendered subject/html), render a clean localized (en/sw,
 *      single-language per `input.locale`) subject + minimal safe HTML
 *      from the structured fields. Every interpolated payload value is
 *      escaped; nothing is raw-interpolated.
 *   3. HONEST GENERIC FALLBACK — `BORJIE: <templateKey>` + a single
 *      localized line that never fabricates content.
 *
 * Path (b) of the original slice — importing the `@borjie/notifications`
 * borjie template registry by templateKey/locale — is intentionally NOT
 * done: that package is ESM + React (`@react-email/components`, `react`)
 * and is not a dependency of api-gateway, so importing it would break the
 * CJS bundle (see notes). This module is the CJS-safe, dependency-free
 * substitute: a small data-driven map of `key → { en, sw }` builders.
 *
 * NOTE on trust boundary: the HTML in `payload.html` / `payload.bodyHtml`
 * is produced by our own first-party producers (cron / dispatcher), not
 * by end-user input, so it is treated as trusted markup and passed
 * through verbatim. EVERY value the template-key map interpolates (and
 * the fallback's `payload.body`) is escaped via `escapeHtml`.
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

// ---------------------------------------------------------------------------
// Locale helpers
// ---------------------------------------------------------------------------

type Locale = 'en' | 'sw';

/** Single-language per `input.locale`: `sw` only when explicitly `sw`. */
function resolveLocale(locale: string): Locale {
  return locale === 'sw' ? 'sw' : 'en';
}

/** A localized string pair — exactly one is emitted per active locale. */
type Localized = { readonly en: string; readonly sw: string };

function pick(localized: Localized, locale: Locale): string {
  return localized[locale];
}

/**
 * Read a string field from the raw payload, defaulting (already-localized,
 * never mixed) when absent. The returned value is the RAW string — callers
 * MUST escape before interpolating into HTML.
 */
function str(
  payload: Readonly<Record<string, unknown>>,
  key: string,
  fallback: Localized,
  locale: Locale,
): string {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0
    ? value
    : pick(fallback, locale);
}

// ---------------------------------------------------------------------------
// Template-key map (path 2) — data-driven, CJS-safe, dependency-free.
//
// Each entry builds a localized subject + minimal safe HTML body from the
// structured payload. Builders escape EVERY interpolated value; subjects
// are plain text (escaped at the call site is unnecessary — they are not
// HTML) and the body wraps escaped values in a fixed safe tag set.
// ---------------------------------------------------------------------------

type TemplateBuilder = {
  readonly subject: (
    payload: Readonly<Record<string, unknown>>,
    locale: Locale,
  ) => string;
  readonly html: (
    payload: Readonly<Record<string, unknown>>,
    locale: Locale,
  ) => string;
};

/** Wrap pre-escaped lines into a minimal, safe paragraph block. */
function paragraphs(lines: readonly string[]): string {
  return lines.map((line) => `<p>${line}</p>`).join('');
}

const UNKNOWN: Localized = { en: 'unknown', sw: 'haijulikani' };

const TEMPLATE_BUILDERS: Readonly<Record<string, TemplateBuilder>> = {
  // Licence expiry warning — the licence-expiry cron enqueues ONLY a
  // structured payload (licenceKind / licenceNumber / mineral / windowDays /
  // expiryDate), so without this entry recipients got the generic stub.
  'licence.expiry_warning': {
    subject: (payload, locale) => {
      const number = str(payload, 'licenceNumber', UNKNOWN, locale);
      return locale === 'sw'
        ? `BORJIE: leseni ${number} inakaribia kuisha`
        : `BORJIE: licence ${number} is expiring soon`;
    },
    html: (payload, locale) => {
      const kind = escapeHtml(str(payload, 'licenceKind', UNKNOWN, locale));
      const number = escapeHtml(str(payload, 'licenceNumber', UNKNOWN, locale));
      const mineral = escapeHtml(str(payload, 'mineral', UNKNOWN, locale));
      const expiry = escapeHtml(str(payload, 'expiryDate', UNKNOWN, locale));
      const windowDays =
        typeof payload.windowDays === 'number' ? payload.windowDays : null;
      const lead =
        locale === 'sw'
          ? `Leseni yako ya ${kind} (${number}) ya madini ya ${mineral} inakaribia kuisha tarehe ${expiry}.`
          : `Your ${kind} licence (${number}) for ${mineral} is expiring on ${expiry}.`;
      const windowLine =
        windowDays === null
          ? null
          : locale === 'sw'
            ? `Imebakia takriban siku ${windowDays}. Tafadhali anza mchakato wa kuhuisha.`
            : `About ${windowDays} day(s) remain. Please begin the renewal process.`;
      return paragraphs(windowLine ? [lead, windowLine] : [lead]);
    },
  },

  // Owner reminder — the reminders worker sets payload.title/body which path
  // 1 already honours; this entry only fires if a producer omits both.
  'owner.reminder.generic': {
    subject: (_payload, locale) =>
      locale === 'sw' ? 'BORJIE: kikumbusho' : 'BORJIE: a reminder',
    html: (payload, locale) => {
      const line = escapeHtml(
        str(
          payload,
          'body',
          {
            en: 'You have a new reminder from BORJIE.',
            sw: 'Una kikumbusho kipya kutoka BORJIE.',
          },
          locale,
        ),
      );
      return paragraphs([line]);
    },
  },

  // Owner daily brief — the cron pre-renders subject + bodyHtml (path 1);
  // this entry is a safety net if a future producer enqueues only the
  // structured brief fields.
  'owner.daily_brief': {
    subject: (_payload, locale) =>
      locale === 'sw'
        ? 'BORJIE: muhtasari wako wa kila siku'
        : 'BORJIE: your daily brief',
    html: (payload, locale) => {
      const line = escapeHtml(
        str(
          payload,
          'body',
          {
            en: 'Your BORJIE daily brief is ready.',
            sw: 'Muhtasari wako wa kila siku wa BORJIE uko tayari.',
          },
          locale,
        ),
      );
      return paragraphs([line]);
    },
  },

  // Platform announcement broadcast — the fanout worker sets subject + body
  // (path 1); the map renders structured fields if a producer omits them.
  'platform.announcement.broadcast': {
    subject: (_payload, locale) =>
      locale === 'sw'
        ? 'BORJIE: tangazo la jukwaa'
        : 'BORJIE: platform announcement',
    html: (payload, locale) => {
      const line = escapeHtml(
        str(
          payload,
          'body',
          {
            en: 'A new platform announcement is available.',
            sw: 'Tangazo jipya la jukwaa linapatikana.',
          },
          locale,
        ),
      );
      return paragraphs([line]);
    },
  },

  // Safety-incident escalation legs — the route pre-renders subject + body
  // (path 1); the map renders the structured summary/severity if absent.
  ...incidentEscalationBuilders(),
};

/** Build the three incident-escalation leg builders (manager / compliance / regulator-prep). */
function incidentEscalationBuilders(): Record<string, TemplateBuilder> {
  const builder: TemplateBuilder = {
    subject: (_payload, locale) =>
      locale === 'sw'
        ? 'BORJIE: arifa ya kupandishwa kwa tukio la usalama'
        : 'BORJIE: safety incident escalation alert',
    html: (payload, locale) => {
      const severity = escapeHtml(str(payload, 'severity', UNKNOWN, locale));
      const detail = readSummary(payload, locale);
      const head =
        locale === 'sw'
          ? `Tukio la usalama limepandishwa (ukali: ${severity}).`
          : `A safety incident has been escalated (severity: ${severity}).`;
      return paragraphs(detail ? [head, escapeHtml(detail)] : [head]);
    },
  };
  return {
    'mining.incident.escalation.manager': builder,
    'mining.incident.escalation.admin_compliance': builder,
    'mining.incident.escalation.regulator_prep': builder,
  };
}

/**
 * The incident producer nests `summary: { en, sw }`. Read the active-locale
 * leg honestly; return null when absent (the head line then stands alone).
 */
function readSummary(
  payload: Readonly<Record<string, unknown>>,
  locale: Locale,
): string | null {
  const summary = payload.summary;
  if (summary === null || typeof summary !== 'object') return null;
  const value = (summary as Record<string, unknown>)[locale];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// ---------------------------------------------------------------------------
// Public render API
// ---------------------------------------------------------------------------

/**
 * Subject precedence: pre-rendered `payload.subject`, then `payload.title`,
 * then the template-key map for a known key, then the honest fallback. Never
 * fabricated; single-language per `input.locale`.
 */
export function renderEmailSubject(input: EmailProviderInput): string {
  const payload = parsePayload(input.payload);
  if (payload.subject) return payload.subject;
  if (payload.title) return payload.title;
  const builder = TEMPLATE_BUILDERS[input.templateKey];
  if (builder) return builder.subject(input.payload, resolveLocale(input.locale));
  return `BORJIE: ${input.templateKey}`;
}

/**
 * HTML body precedence: pre-rendered `payload.html` (spec field), then
 * `payload.bodyHtml` (daily-brief field), then an escaped wrap of plaintext
 * `payload.body`, then the template-key map for a known key, then the honest
 * minimal fallback. Trusted first-party HTML passes through; every value the
 * map interpolates (and `payload.body`) is escaped.
 */
export function renderEmailHtml(input: EmailProviderInput): string {
  const payload = parsePayload(input.payload);
  if (payload.html) return payload.html;
  if (payload.bodyHtml) return payload.bodyHtml;
  if (payload.body) return `<p>${escapeHtml(payload.body)}</p>`;
  const builder = TEMPLATE_BUILDERS[input.templateKey];
  if (builder) return builder.html(input.payload, resolveLocale(input.locale));
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
    resolveLocale(input.locale) === 'sw'
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
