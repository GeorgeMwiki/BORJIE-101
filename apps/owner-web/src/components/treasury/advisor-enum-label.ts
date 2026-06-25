/**
 * advisor-enum-label — the single source of truth for rendering a DB enum
 * token (snake_case / kebab-case code) as a locale-correct label inside the
 * non-owner-os ADVISOR surfaces (treasury advisor, fleet ops).
 *
 * The Stream-A sibling of `components/owner-os/panels/enum-label.ts`. Same
 * contract: NEVER render `{rec.kind}` / `{r.type}` verbatim (the raw token
 * leaks English under `sw`); resolve through `advisorEnumLabel(domain,
 * token, locale)` which maps the token to a single-language label from the
 * guard-exempt `i18n/strings/advisor-enum-labels.ts` vocabulary.
 *
 * FALLBACK: a token absent from the vocabulary (wire drift, a value added
 * server-side before the label lands) is humanised — `snake_case` /
 * `kebab-case` → Title Case — via the shared `humanizeToken`, never printed
 * raw and never crashing.
 */

import { humanizeToken } from '@/components/owner-os/panels/enum-label';
import { advisorEnumLabels as A } from '@/i18n/strings/advisor-enum-labels';
import type { Locale } from '@/lib/locale-shared';

/** The bounded advisor enum domains this helper localises. */
export type AdvisorEnumDomain = keyof typeof A;

type BilingualLabel = { readonly en: string; readonly sw: string };

/**
 * Resolve `(domain, token)` to a locale-correct advisor label.
 *
 * @param domain  which bounded advisor vocabulary the token belongs to.
 * @param token   the raw enum value off the wire (may be null/undefined).
 * @param locale  the active owner locale; the label is single-language.
 * @returns the localised label, the humanised token, or '—' when empty.
 */
export function advisorEnumLabel(
  domain: AdvisorEnumDomain,
  token: string | null | undefined,
  locale: Locale,
): string {
  if (token === null || token === undefined || token === '') return '—';
  const vocab = A[domain] as Record<string, BilingualLabel>;
  const entry = vocab[token];
  if (entry) return locale === 'sw' ? entry.sw : entry.en;
  return humanizeToken(token);
}
