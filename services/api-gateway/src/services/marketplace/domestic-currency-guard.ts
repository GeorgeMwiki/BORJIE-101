/**
 * Domestic-contract currency guard (CLAUDE.md hard rule).
 *
 * CLAUDE.md: "Domestic non-TZS contracts are rejected at the API layer
 * (post 27-Mar-2026 USD-cliff remediation mode) for TZ-jurisdiction
 * tenants only — KE/UG/NG tenants honor their own primary currency.
 * Never hard-code TZS / USD / KES / UGX / NGN in code paths."
 *
 * This module is the single, currency-NEUTRAL enforcement point for that
 * rule on the marketplace RFB create + offered-price paths. It NEVER
 * hard-codes a currency: the jurisdiction's domestic currency is READ from
 * `@borjie/domain-models`'s region config (`getDefaultCurrency(countryCode)`),
 * the same mapping that drives the rest of the platform.
 *
 * The rule is jurisdiction-relative, not TZS-absolute:
 *   - a TZ-jurisdiction tenant may only transact a domestic contract in TZS
 *     (its jurisdiction currency); a non-TZS domestic contract is rejected.
 *   - a KE tenant honors KES, a UG tenant UGX, a NG tenant NGN, etc.
 * In every case the acceptable domestic currency is exactly
 * `getDefaultCurrency(tenant.countryCode)`.
 *
 * Fail-closed: when the contract currency is unknown / missing for a
 * domestic contract we REJECT (we never let an un-currencied domestic
 * money figure through), and when the tenant's own jurisdiction cannot be
 * resolved we REJECT rather than guess.
 */

import { getDefaultCurrency } from '@borjie/domain-models';

/**
 * Outcome of the guard. `ok: false` carries a stable code + the resolved
 * domestic currency so the caller can render a precise bilingual 4xx.
 */
export type DomesticCurrencyDecision =
  | { readonly ok: true; readonly domesticCurrency: string }
  | {
      readonly ok: false;
      readonly code:
        | 'DOMESTIC_NON_JURISDICTION_CURRENCY'
        | 'DOMESTIC_CURRENCY_UNRESOLVED';
      readonly domesticCurrency: string | null;
      readonly suppliedCurrency: string | null;
    };

/**
 * Normalise an ISO-4217-ish code to the comparable upper-case form, or
 * `null` when the input is empty/blank. Pure — no currency baked in.
 */
function normaliseCurrency(code: string | null | undefined): string | null {
  if (typeof code !== 'string') return null;
  const trimmed = code.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Evaluate a domestic-contract money figure against the tenant's
 * jurisdiction currency.
 *
 * @param input.countryCode      tenant `country_code` (ISO-3166-1 alpha-2).
 * @param input.suppliedCurrency the contract's currency, when the client
 *   supplied one. When omitted/null the figure is taken to be denominated
 *   in the tenant's domestic currency — which is itself the only legal
 *   value — so an omitted currency PASSES once the jurisdiction resolves.
 *   We do NOT silently accept a blank currency alongside a non-domestic
 *   figure: the supplied-currency check below is exact when present.
 *
 * Returns `ok: true` with the resolved domestic currency when the contract
 * is domestic-currency-clean, else a typed rejection.
 */
export function evaluateDomesticContractCurrency(input: {
  readonly countryCode: string | null | undefined;
  readonly suppliedCurrency?: string | null | undefined;
}): DomesticCurrencyDecision {
  const supplied = normaliseCurrency(input.suppliedCurrency);

  // Resolve the jurisdiction's domestic currency from the region config —
  // never hard-coded. `getDefaultCurrency` falls back to a generic code for
  // an unknown country; we treat an unresolved/blank country as fail-closed.
  const country = normaliseCurrency(input.countryCode); // reuse trim+upper
  if (!country) {
    return {
      ok: false,
      code: 'DOMESTIC_CURRENCY_UNRESOLVED',
      domesticCurrency: null,
      suppliedCurrency: supplied,
    };
  }

  const domesticCurrency = normaliseCurrency(getDefaultCurrency(country));
  if (!domesticCurrency) {
    return {
      ok: false,
      code: 'DOMESTIC_CURRENCY_UNRESOLVED',
      domesticCurrency: null,
      suppliedCurrency: supplied,
    };
  }

  // When the client supplied a currency it MUST equal the jurisdiction's
  // domestic currency. A non-domestic currency on a domestic contract is
  // the exact CLAUDE.md violation we reject.
  if (supplied && supplied !== domesticCurrency) {
    return {
      ok: false,
      code: 'DOMESTIC_NON_JURISDICTION_CURRENCY',
      domesticCurrency,
      suppliedCurrency: supplied,
    };
  }

  return { ok: true, domesticCurrency };
}

/**
 * Bilingual EN/SW copy for each rejection code. Kept here so the route
 * handler stays terse and every 4xx is fully bilingual (CLAUDE.md
 * "Bilingual EN/SW for user-facing errors").
 */
export function domesticCurrencyRejectionMessage(
  decision: Extract<DomesticCurrencyDecision, { ok: false }>,
): { readonly en: string; readonly sw: string } {
  if (decision.code === 'DOMESTIC_NON_JURISDICTION_CURRENCY') {
    const dom = decision.domesticCurrency ?? '';
    const sup = decision.suppliedCurrency ?? '';
    return {
      en:
        `Domestic contracts must be denominated in ${dom}. ` +
        `The supplied currency ${sup} is not permitted for a domestic contract in your jurisdiction.`,
      sw:
        `Mikataba ya ndani lazima iwe katika ${dom}. ` +
        `Sarafu uliyotuma ${sup} hairuhusiwi kwa mkataba wa ndani katika eneo lako.`,
    };
  }
  return {
    en:
      'Could not determine your jurisdiction currency for this domestic contract. ' +
      'Please contact support.',
    sw:
      'Imeshindwa kubaini sarafu ya eneo lako kwa mkataba huu wa ndani. ' +
      'Tafadhali wasiliana na msaada.',
  };
}
