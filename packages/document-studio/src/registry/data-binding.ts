/**
 * @borjie/document-studio — data-binding helpers.
 *
 * A binder maps source facts (ledger entries, corpus chunks, entity
 * records) into a render-ready view. These helpers keep that mapping
 * HONEST about the two hard rails that must survive into the rendered
 * bytes:
 *
 *   1. MULTI-CURRENCY — every monetary figure passes through
 *      `formatCurrency(amount, currencyCode)` with the tenant currency.
 *      `bindMoney` is the single funnel; a binder that emits a bare
 *      number for a money field is a bug the citation/quality gates will
 *      not catch, so the funnel is the guarantee.
 *   2. EN/SW ABSOLUTE TOGGLE — a binder selects exactly ONE label set by
 *      locale via `selectLabels`; the template renders only `view.labels`,
 *      so the rendered document is physically single-language.
 *
 * These helpers are pure + dependency-light (they only use `../format`).
 */

import { formatCurrency, formatNumber, roundMoney } from '../format.js';
import type { Citation } from '../types.js';

export type DocLocale = 'en' | 'sw';

/** BCP-47 tag for digit grouping — Swahili groups like sw-TZ, else en. */
export function localeTag(locale: DocLocale): string {
  return locale === 'sw' ? 'sw-TZ' : 'en';
}

/**
 * Select the single-language label set. Both dictionaries MUST be
 * complete (every key present in both) — this is the EN/SW absolute
 * toggle in code: there is no path that returns a partially-translated
 * mix.
 */
export function selectLabels<T>(
  locale: DocLocale,
  labels: { readonly en: T; readonly sw: T },
): T {
  return locale === 'sw' ? labels.sw : labels.en;
}

/**
 * Bind a monetary figure → a print-ready string in the document's
 * currency. The ONLY sanctioned way a binder renders money. Throws
 * (via `formatCurrency`) when `currencyCode` is missing — never
 * silently defaults to a hard-coded code.
 */
export function bindMoney(
  amount: number,
  currencyCode: string,
  locale: DocLocale,
): string {
  return formatCurrency(roundMoney(amount), currencyCode, {
    locale: localeTag(locale),
  });
}

/** Bind a non-monetary quantity (tonnage, area, count) → grouped string. */
export function bindNumber(value: number, locale: DocLocale): string {
  return formatNumber(value, { locale: localeTag(locale) });
}

/**
 * Project a citation set into the compact, template-friendly shape the
 * existing builders already emit (`{ id, claim, ref }`). Keeps the
 * evidence chain attached to the view so the citation gate can verify
 * coverage downstream.
 */
export function bindCitations(
  citations: ReadonlyArray<Citation>,
): ReadonlyArray<{ readonly id: string; readonly claim: string; readonly ref: string }> {
  return citations.map((c) => ({
    id: c.id,
    claim: c.claim,
    ref: c.source.ref,
  }));
}

/**
 * A single ledger row a binder can fold into a statement total. Mirrors
 * the read-only projection the studio receives from the ledger — it does
 * NOT write the ledger (hard rail: money path is `LedgerService.post`).
 */
export interface LedgerLine {
  readonly ref: string;
  readonly date: string;
  readonly description: string;
  /** Signed minor-unit-rounded amount in the statement currency. */
  readonly amount: number;
}

/**
 * Sum a set of ledger lines and bind the total as money. Pure read-only
 * aggregation — the canonical "ledger → document model" join. Returns
 * both the raw rounded number (for further computation) and the
 * formatted string (for the view).
 */
export function bindLedgerTotal(
  lines: ReadonlyArray<LedgerLine>,
  currencyCode: string,
  locale: DocLocale,
): { readonly total: number; readonly formatted: string } {
  const total = roundMoney(
    lines.reduce((acc, line) => acc + line.amount, 0),
  );
  return { total, formatted: bindMoney(total, currencyCode, locale) };
}
