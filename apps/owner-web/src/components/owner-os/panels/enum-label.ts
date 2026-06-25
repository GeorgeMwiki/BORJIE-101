/**
 * enum-label — the single source of truth for rendering a DB enum token
 * (UPPER/snake_case code) as a locale-correct label inside an owner-os
 * panel cell.
 *
 * WHY THIS EXISTS (raw-enum-render class)
 * A table cell that renders `r.status` / `r.kind` / `r.category` verbatim
 * emits the raw enum token (`active`, `processing_plant`) — an
 * English-ish string the source-literal locale scanner can never see,
 * yet which leaks under `sw`. RiskPanel already solved its kill-switch
 * tile this way (hand-rolled `{ value }` pairs); this helper generalises
 * that so EVERY panel resolves enum tokens through ONE map.
 *
 * The bilingual labels live in the guard-exempt i18n strings module
 * (`i18n/strings/owner-os-panels.ts → enumLabels`); this file holds only
 * keys + resolution logic, so it carries no hardcoded Swahili and never
 * trips the locale-purity guard.
 *
 * FALLBACK: a token absent from the vocabulary (wire drift, a value added
 * server-side before the label lands) is humanised — snake_case →
 * Title Case — rather than printed raw. It never crashes and never emits
 * a bare `snake_case` code; the contract test pins the known vocab so the
 * fallback is a safety net, not the happy path.
 */

import { ownerOsPanelsStrings as P } from '@/i18n/strings/owner-os-panels';
import type { Locale } from '@/lib/locale-shared';

/** The bounded enum domains this helper localises. */
export type EnumDomain = keyof typeof P.enumLabels;

type BilingualLabel = { readonly sw: string; readonly en: string };

/**
 * Humanise an unknown token: `processing_plant` → `Processing plant`,
 * `HTML_BUNDLE` → `Html bundle`. Locale-neutral by construction (no
 * translatable words), so it is safe to show under either locale as a
 * last resort. Empty / nullish input yields the em-dash placeholder.
 */
export function humanizeToken(token: string | null | undefined): string {
  if (token === null || token === undefined) return '—';
  const cleaned = token.replace(/[_-]+/g, ' ').trim().toLowerCase();
  if (cleaned.length === 0) return '—';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Resolve `(domain, token)` to a locale-correct label.
 *
 * @param domain  which bounded vocabulary the token belongs to.
 * @param token   the raw enum value off the wire (may be null/undefined).
 * @param locale  the active owner locale; the label is single-language.
 * @returns the localised label, or a humanised token, or '—' when empty.
 */
export function enumLabel(
  domain: EnumDomain,
  token: string | null | undefined,
  locale: Locale,
): string {
  if (token === null || token === undefined || token === '') return '—';
  const vocab = P.enumLabels[domain] as Record<string, BilingualLabel>;
  const entry = vocab[token];
  if (entry) return locale === 'sw' ? entry.sw : entry.en;
  return humanizeToken(token);
}

/**
 * `isSw`-flavoured convenience for the existing `isSw ? … : …` call sites.
 * Keeps panel columns terse: `render: (r) => enumLabelSw('entityKind', r.kind, isSw)`.
 */
export function enumLabelSw(
  domain: EnumDomain,
  token: string | null | undefined,
  isSw: boolean,
): string {
  return enumLabel(domain, token, isSw ? 'sw' : 'en');
}
