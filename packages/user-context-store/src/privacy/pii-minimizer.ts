/**
 * PII minimizer.
 *
 * When the audience is NOT the data subject (e.g. an owner asking about
 * a tenant, a PM asking about a portfolio resident), we strip names,
 * phone numbers, and email addresses from snippet `content` strings.
 *
 * Pure function — no IO, no mutation. Returns a new snippet.
 *
 * Patterns:
 *   - Names: we can't reliably ID arbitrary names from text alone, so
 *     callers should pre-mark them with `[name:Foo Bar]` if they want
 *     them stripped. This function strips that marker.
 *   - Phones: digit clusters >= 7, optional country code, optional spaces.
 *   - Emails: standard local@domain.
 */
import type { Audience, Snippet } from '../types.js';

// E.164-ish: optional +, optional country code, 7-15 digits with optional spacing.
const PHONE_RE = /(\+?\d[\d\s\-().]{6,16}\d)/g;
const EMAIL_RE = /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const NAME_MARKER_RE = /\[name:[^\]]+\]/g;

/**
 * Strip names, phones, and emails from a snippet's `content` when the
 * audience isn't the data subject. Pass-through otherwise.
 */
export function minimizePII(snippet: Snippet, audience: Audience): Snippet {
  if (audience === 'data_subject') return snippet;
  let content = snippet.content;
  content = content.replace(NAME_MARKER_RE, '[redacted:name]');
  content = content.replace(EMAIL_RE, '[redacted:email]');
  content = content.replace(PHONE_RE, '[redacted:phone]');
  if (content === snippet.content) return snippet;
  return {
    ...snippet,
    content,
  };
}
