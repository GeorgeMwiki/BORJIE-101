/**
 * Regulatory mirror — kernel-side statute lookup.
 *
 * The kernel's step 10 policy gate consults this module BEFORE final
 * output assembly. Given a `(jurisdiction, action, payload)` triple,
 * the mirror walks the configured rule sets (TZ Landlord & Tenant Act,
 * KE Rent Restriction Act, RERA placeholder) and returns the first
 * matching verdict:
 *
 *   - 'refuse' — the action violates statute; policy gate hard-blocks.
 *   - 'flag'   — the action is statute-adjacent; policy gate softens
 *                the verdict and requires explicit operator approval.
 *   - 'allow'  — explicit allow override.
 *
 * Multiple matches return verdict precedence: refuse > flag > allow.
 *
 * The mirror is intentionally pure (no I/O, no LLM). Rules are
 * structured data living under
 * `@borjie/domain-models/regulatory/*`.
 */

// Types mirror `@borjie/domain-models/regulatory/rules-types.ts`
// but are duplicated here so the central-intelligence package keeps a
// zero domain-models dependency footprint (kernel ports are
// intentionally structural). Composition root wires the data sets.

export type RegulatoryJurisdiction = 'TZ' | 'KE' | 'UAE';

export type RegulatoryVerdict = 'allow' | 'refuse' | 'flag';

export type RegulatoryAction =
  | 'collect_deposit'
  | 'issue_eviction_notice'
  | 'raise_rent'
  | 'distrain_goods'
  | 'enter_premises'
  | 'evict'
  | 'recover_arrears';

export interface RegulatoryRulePayload {
  readonly amountMinor?: number;
  readonly monthlyRentMinor?: number;
  readonly currencyCode?: string;
  readonly noticeDays?: number;
  readonly increasePercentage?: number;
  readonly tenantHasArrears?: boolean;
  readonly hasCourtOrder?: boolean;
  readonly extra?: Readonly<Record<string, unknown>>;
}

export interface RegulatoryRule {
  readonly id: string;
  readonly jurisdiction: RegulatoryJurisdiction;
  readonly action: RegulatoryAction;
  readonly citation: string;
  readonly rationale: string;
  readonly verdict: RegulatoryVerdict;
  readonly predicate: (payload: RegulatoryRulePayload) => boolean;
}

export interface RegulatoryRuleSet {
  readonly jurisdiction: RegulatoryJurisdiction;
  readonly displayName: string;
  readonly statuteVersion: string;
  readonly rules: ReadonlyArray<RegulatoryRule>;
}

export interface RegulatoryMirrorMatch {
  readonly ruleId: string;
  readonly citation: string;
  readonly rationale: string;
  readonly verdict: RegulatoryVerdict;
}

export interface RegulatoryMirrorResult {
  readonly verdict: RegulatoryVerdict;
  readonly matches: ReadonlyArray<RegulatoryMirrorMatch>;
  /**
   * Aggregated cite-text suitable for the agent's grounding fragment.
   * Empty string when no rule matched.
   */
  readonly citeText: string;
}

export interface RegulatoryMirrorCheckArgs {
  readonly jurisdiction: RegulatoryJurisdiction;
  readonly action: RegulatoryAction;
  readonly payload: RegulatoryRulePayload;
}

export interface RegulatoryMirror {
  check(args: RegulatoryMirrorCheckArgs): RegulatoryMirrorResult;
  /** Diagnostic — surfaces configured jurisdictions. */
  knownJurisdictions(): ReadonlyArray<RegulatoryJurisdiction>;
}

export interface RegulatoryMirrorDeps {
  readonly ruleSets: ReadonlyArray<RegulatoryRuleSet>;
}

const VERDICT_RANK: Record<RegulatoryVerdict, number> = {
  refuse: 2,
  flag: 1,
  allow: 0,
};

function strongerVerdict(
  a: RegulatoryVerdict,
  b: RegulatoryVerdict,
): RegulatoryVerdict {
  return VERDICT_RANK[a] >= VERDICT_RANK[b] ? a : b;
}

export function createRegulatoryMirror(
  deps: RegulatoryMirrorDeps,
): RegulatoryMirror {
  const byJurisdiction = new Map<RegulatoryJurisdiction, RegulatoryRuleSet>();
  for (const rs of deps.ruleSets) {
    byJurisdiction.set(rs.jurisdiction, rs);
  }

  return {
    check(args) {
      const rs = byJurisdiction.get(args.jurisdiction);
      if (!rs) {
        return { verdict: 'allow', matches: [], citeText: '' };
      }

      const matches: RegulatoryMirrorMatch[] = [];
      let overall: RegulatoryVerdict = 'allow';

      for (const rule of rs.rules) {
        if (rule.action !== args.action) continue;
        let fired = false;
        try {
          fired = rule.predicate(args.payload);
        } catch {
          // A defective predicate is treated as a non-match so a bad
          // rule can't take the entire turn down.
          fired = false;
        }
        if (!fired) continue;
        matches.push({
          ruleId: rule.id,
          citation: rule.citation,
          rationale: rule.rationale,
          verdict: rule.verdict,
        });
        overall = strongerVerdict(overall, rule.verdict);
      }

      const citeText =
        matches.length === 0
          ? ''
          : matches
              .map((m) => `${m.citation} — ${m.rationale}`)
              .join('\n');

      return {
        verdict: overall,
        matches,
        citeText,
      };
    },
    knownJurisdictions() {
      return Array.from(byJurisdiction.keys());
    },
  };
}

/**
 * Convenience factory — wires the default TZ + KE + UAE rule sets
 * exported from `@borjie/domain-models`.
 */
export function createDefaultRegulatoryMirror(
  ruleSets: ReadonlyArray<RegulatoryRuleSet>,
): RegulatoryMirror {
  return createRegulatoryMirror({ ruleSets });
}
