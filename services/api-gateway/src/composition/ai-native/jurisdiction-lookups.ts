/**
 * Real jurisdiction-law lookups for the AI-native PhL features, backed by
 * `@borjie/compliance-plugins`.
 *
 * Two ports the PhL factories require are populated here from the live
 * country-plugin registry (`getCountryPlugin(countryCode).miningLaw`):
 *
 *   - `PriceControlLookup` (dynamic-pricing) — derived from the
 *     jurisdiction's royalty-escalation cap. A `pctPerAnnum` cap becomes
 *     the price-increase ceiling the optimizer clamps against. Index-linked
 *     or unconfigured caps yield `maxIncreasePct: null` (no clamp).
 *
 *   - `LegalLawDispatchPort` (legal-drafter) — resolves a jurisdiction's
 *     mandatory contract clauses + notice window for the relevant
 *     termination reason, citing the statute each clause/window references.
 *
 * Global-first: nothing is hard-coded to Tanzania. The caller supplies the
 * ISO-3166-1 country code; an unknown code surfaces a typed VALIDATION
 * error from the PhL factory (the dispatch port re-throws
 * `UnknownJurisdictionError`).
 *
 * Mining-domain mapping: the PhL legal `documentKind` vocabulary is mapped
 * onto the compliance-plugin `NoticeReason` vocabulary. Operation kind
 * defaults to `artisanal` (Tanzanian PML estates) for clause + bond lookup.
 */

import {
  getCountryPlugin,
  DEFAULT_MINING_LAW,
  type MiningLawPort,
  type NoticeReason,
  type OperationKind,
  type BondCapRegime,
} from '@borjie/compliance-plugins';
import {
  LegalDrafter as LegalDrafterNs,
  DynamicPricing as DynamicPricingNs,
} from '@borjie/ai-copilot/ai-native';

type LegalLawSnapshot = LegalDrafterNs.LegalLawSnapshot;
type LegalLawDispatchPort = LegalDrafterNs.LegalLawDispatchPort;
type LegalDocumentKind = LegalDrafterNs.LegalDocumentKind;
type PriceControlLookup = DynamicPricingNs.PriceControlLookup;
type PriceIncreaseCapSnapshot = DynamicPricingNs.PriceIncreaseCapSnapshot;

/**
 * Resolve the jurisdiction's `MiningLawPort`. Falls back to the package's
 * DEFAULT_MINING_LAW (universal-minimum clauses, "CONFIGURE" citations)
 * when a plugin omits the optional port — never silently returns the wrong
 * country's law.
 */
function resolveMiningLaw(countryCode: string): MiningLawPort {
  return getCountryPlugin(countryCode).miningLaw ?? DEFAULT_MINING_LAW;
}

// ---------------------------------------------------------------------------
// PriceControlLookup — royalty-escalation cap → price-increase ceiling
// ---------------------------------------------------------------------------

const DEFAULT_BOND_REGIME: BondCapRegime = 'artisanal-standard';

/**
 * Build the dynamic-pricing `PriceControlLookup`. A jurisdiction with a
 * percentage royalty-escalation cap clamps the LLM's proposed mineral
 * price increase; an index-linked or unconfigured cap leaves the optimizer
 * free (its own ceiling applies).
 */
export function createPriceControlLookup(): PriceControlLookup {
  return (countryCode: string): PriceIncreaseCapSnapshot => {
    const law = resolveMiningLaw(countryCode);
    const cap = law.royaltyEscalationCap(DEFAULT_BOND_REGIME);
    const pct =
      typeof cap.pctPerAnnum === 'number' && Number.isFinite(cap.pctPerAnnum)
        ? cap.pctPerAnnum
        : null;
    return pct === null
      ? { maxIncreasePct: null }
      : { maxIncreasePct: pct, sourceCitation: cap.citation };
  };
}

// ---------------------------------------------------------------------------
// LegalLawDispatchPort — clauses + notice window per document kind
// ---------------------------------------------------------------------------

/**
 * Map a PhL legal document kind to the compliance-plugin `NoticeReason`
 * that drives the statutory notice window. Mining-estate semantics:
 *   - licence-suspension / cure-or-cease  → breach / royalty default
 *   - royalty-increase                    → renewal non-continuation window
 *   - offtake addendum / renewal offer    → renewal non-continuation
 */
const NOTICE_REASON_BY_KIND: Readonly<
  Record<LegalDocumentKind, NoticeReason>
> = Object.freeze({
  notice_to_cease: 'breach-of-condition',
  cure_or_cease: 'breach-of-condition',
  demand_letter: 'royalty-default',
  royalty_increase_notice: 'renewal-non-continuation',
  licence_suspension_notice: 'state-repossession',
  renewal_offer: 'renewal-non-continuation',
  offtake_addendum: 'renewal-non-continuation',
  offboarding_statement: 'renewal-non-continuation',
  other: 'breach-of-condition',
});

const DEFAULT_OPERATION_KIND: OperationKind = 'artisanal';

/**
 * Build the legal-drafter `LegalLawDispatchPort` from the live country
 * plugins. Throws `UnknownJurisdictionError` for an unrecognised code,
 * which the drafter maps to a VALIDATION (422) result.
 */
export function createLegalLawDispatchPort(): LegalLawDispatchPort {
  return {
    resolve(
      countryCode: string,
      documentKind: LegalDocumentKind,
    ): LegalLawSnapshot {
      // `getCountryPlugin` throws on unknown codes — let it propagate so
      // the drafter surfaces a typed VALIDATION error rather than a wrong
      // jurisdiction's law.
      const plugin = getCountryPlugin(countryCode);
      const law = plugin.miningLaw ?? DEFAULT_MINING_LAW;

      const clauses = law.requiredClauses(DEFAULT_OPERATION_KIND);
      const reason = NOTICE_REASON_BY_KIND[documentKind];
      const noticeWindowDays = law.noticeWindowDays(reason) ?? 0;

      const requiredClauses = clauses
        .filter((clause) => clause.mandatory)
        .map((clause) => clause.label);
      const citations = clauses.map((clause) => clause.citation);

      return {
        noticeWindowDays,
        requiredClauses: Object.freeze(requiredClauses),
        citations: Object.freeze(citations),
        forbiddenClauses: Object.freeze([]),
        sourceTag: `${plugin.countryCode}-mining-law`,
      };
    },
  };
}
