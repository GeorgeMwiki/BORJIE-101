/**
 * MiningLawPort — jurisdiction-specific mining-law knowledge.
 *
 * The existing `CompliancePolicy` covers coarse numerics (min/max bond,
 * generic notice period). This port adds:
 *   - the STRUCTURED list of clauses an offtake / supply agreement in this
 *     jurisdiction MUST contain (useful for agreement-template validators),
 *   - notice-window resolution by termination REASON (licence-suspension for
 *     royalty default differs from notice for renewal non-continuation),
 *   - performance-bond cap expressed flexibly (months OR absolute-weeks-of-
 *     royalty, OR an absolute minor-unit cap),
 *   - royalty-escalation caps (percentage or index-linked).
 */

/** Operation kind — artisanal (PML) vs industrial (ML/SML) drives different statutes. */
export type OperationKind = 'artisanal' | 'industrial' | 'exploration';

/**
 * Reasons a party gives notice. Names align with common mining-estate
 * vocabulary across jurisdictions.
 */
export type NoticeReason =
  | 'royalty-default'
  | 'licence-expiry'
  | 'state-repossession'
  | 'breach-of-condition'
  | 'renewal-non-continuation'
  | 'illegal-mining'
  | 'environmental-breach';

/** Performance-bond cap expression forms seen across jurisdictions. */
export type BondCapRegime =
  | 'artisanal-standard'
  | 'artisanal-controlled'
  | 'industrial';

export interface ClauseSpec {
  /** Stable machine ID (e.g. 'royalty-rate', 'bond-return-window'). */
  readonly id: string;
  /** Human label rendered in the agreement-template validator. */
  readonly label: string;
  /** True if missing the clause renders the agreement unenforceable. */
  readonly mandatory: boolean;
  /** One-sentence regulator citation or rationale. */
  readonly citation: string;
}

export interface BondCap {
  /** Upper bound expressed as whole months of royalty/payment — preferred form. */
  readonly maxMonthsOfRoyalty?: number;
  /** Upper bound expressed in weeks-of-royalty. */
  readonly maxWeeksOfRoyalty?: number;
  /** Absolute cap in minor units (rare). */
  readonly absoluteMaxMinorUnits?: number;
  /** Regulator / statute reference. */
  readonly citation: string;
}

export interface RoyaltyEscalationCap {
  /** Maximum annual percentage escalation allowed, if any. */
  readonly pctPerAnnum?: number;
  /** Set when the cap is indexed to a public series. */
  readonly indexedTo?: 'CPI' | 'RPI' | 'LOCAL_INDEX';
  /** Free-form regulator / statute reference. */
  readonly citation: string;
}

export interface MiningLawPort {
  /** Clauses that an offtake / supply agreement of this kind MUST contain. */
  requiredClauses(operationKind: OperationKind): readonly ClauseSpec[];
  /**
   * Statutory notice-window in calendar days for the given reason. Returns
   * `null` when the jurisdiction has no fixed window — consumers fall back
   * to the offtake / supply agreement.
   */
  noticeWindowDays(reason: NoticeReason): number | null;
  /** Performance-bond cap under a specific regime. */
  bondCapMultiple(regime: BondCapRegime): BondCap;
  /** Royalty-escalation cap applied in this jurisdiction. */
  royaltyEscalationCap(regime: BondCapRegime): RoyaltyEscalationCap;
}

// ---------------------------------------------------------------------------
// Default — returns empty / null with "CONFIGURE" citations.
// ---------------------------------------------------------------------------

const NOT_CONFIGURED_CITATION =
  'CONFIGURE_FOR_YOUR_JURISDICTION: no mining-law rules registered — consult counsel.';

export const DEFAULT_MINING_LAW: MiningLawPort = {
  requiredClauses(_operationKind) {
    // Universal-minimum offtake/supply clauses that apply everywhere.
    return Object.freeze([
      {
        id: 'parties',
        label: 'Names and addresses of owner and counterparty',
        mandatory: true,
        citation: 'Universal contract formation requirement.',
      },
      {
        id: 'site',
        label: 'Description of the licensed mining area / site',
        mandatory: true,
        citation: 'Universal contract formation requirement.',
      },
      {
        id: 'royalty-rate',
        label: 'Royalty/payment rate, due date, and payment method',
        mandatory: true,
        citation: 'Universal contract formation requirement.',
      },
      {
        id: 'term',
        label: 'Offtake/supply term with start and end dates',
        mandatory: true,
        citation: 'Universal contract formation requirement.',
      },
    ]);
  },
  noticeWindowDays(_reason) {
    return null;
  },
  bondCapMultiple(_regime) {
    return {
      citation: NOT_CONFIGURED_CITATION,
    };
  },
  royaltyEscalationCap(_regime) {
    return {
      citation: NOT_CONFIGURED_CITATION,
    };
  },
};
