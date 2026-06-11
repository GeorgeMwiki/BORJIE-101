/**
 * Gap sovereign classifier (Loop A, P0 — FIX 2).
 *
 * A capability gap born from a SOVEREIGN tool / intent (money / licence-
 * suspension / deletion / four-eye class + the sovereign policy prefixes) MUST
 * carry `sovereign=true` so the auto-completer PARKS it (needs_approval, HITL
 * forever) and NEVER auto-actuates when the blocker clears. Higher autonomy on
 * these paths raises risk super-linearly (THE_METACOGNITIVE_SELF_MODEL.md §3.5).
 *
 * SINGLE SOURCE OF TRUTH. This does NOT invent a fresh sovereign list — it
 * reuses the SAME `HIGH_RISK_LITERAL_ONLY_PREFIXES` the policy-gate rails
 * already force to literal-only matching (money movement, licence/offtake
 * hard-stops, kill-switch, key/secret rotation, policy/model-pin rollouts,
 * operator/org suspension, cross-tenant disclosure). The dispatcher sees only
 * the failing tool NAME + the blocked-intent string, so the derivation is:
 *
 *   1. `isHighRiskLiteralOnly(toolName)` — exact, for `md:` / `sovereign:`
 *      prefixed tool names that the rail already classifies.
 *   2. a verb-stem scan over the tool name + intent, where the stems are
 *      DERIVED from that same prefix list (suspend / disburse / transfer /
 *      settle / refund / payout / revoke / terminate / kill / rotate / archive
 *      + sovereign / four-eye / delete) — so `platform.suspend_licence`,
 *      `disburse_royalty`, etc. are caught even though their NAME does not carry
 *      the `md:` prefix. Adding to the policy list automatically widens this.
 *   3. (FIX 2) a conservative STEM-PREFIX scan over a money/licence/deletion
 *      lexeme set (pay* / disburse / settle* / remit / withdraw / transfer /
 *      refund / royalty / treasury / licence|license / permit / revoke / suspend /
 *      delete / remove / erase / destroy / void), plus an EXACT-token money set
 *      (`wire`/`wires` — exact only so the NOT_YET_WIRED "wired" idiom stays
 *      benign), so the NAME + free-text intent ALONE classify sovereignty — the
 *      detection seam has NO competence_domain. A token whose prefix is a
 *      sovereign stem flips it (`payment`, `payouts`, `disbursement`,
 *      `settlement`, `licences`, `revoked`, `suspending`, ...).
 *
 * Pure + dependency-free beyond the policy-gate import. Fail-SAFE: when in
 * doubt the bias is toward `sovereign=true` (park), never toward auto-actuation.
 */

import {
  HIGH_RISK_LITERAL_ONLY_PREFIXES,
  isHighRiskLiteralOnly,
} from '../../policy-gate/high-risk-literal-only.js';

/**
 * The sovereign verb stems, DERIVED ONCE from the high-risk literal-only prefix
 * list so the two never drift. Each prefix like `md:propose-suspension` or
 * `md:disburse-` contributes its action stems (`suspension`/`suspend`,
 * `disburse`, ...). We also fold in the structural sovereign markers the rail
 * encodes as bare `sovereign:` / `kill_switch:` / `*_rotation:` prefixes and the
 * four-eye / deletion class the inviolable rails treat as sovereign.
 */
const SOVEREIGN_VERB_STEMS: ReadonlyArray<string> = Object.freeze(
  Array.from(
    new Set<string>([
      // Stems mined from the policy-gate prefix list (single source of truth).
      ...HIGH_RISK_LITERAL_ONLY_PREFIXES.flatMap((p) =>
        p
          .replace(/^(md|sovereign|kill_switch|killswitch|key_rotation|secret_rotation|policy_rollout|model_pin|model_version_pin):/i, '')
          .replace(/[:-]+$/g, '')
          .split(/[:_-]+/)
          .map((s) => s.toLowerCase())
          .filter((s) => s.length >= 4),
      ),
      // Structural sovereign / HIGH-risk markers the rail carries as prefixes,
      // plus the four-eye + deletion class the inviolable rails treat as HITL.
      'sovereign',
      'killswitch',
      'rotation',
      'rollout',
      'four_eye',
      'four-eye',
      'foureye',
      'delete',
      'destroy',
      'suspend',
      'disburse',
    ]),
  ),
);

/**
 * The conservative SOVEREIGN LEXEME STEMS (FIX 2). The tool-dispatcher detection
 * seam classifies from the tool NAME + free-text intent ALONE — it has NO
 * `competence_domain` (see `tool-dispatcher.ts` → `isSovereignGapSource({ toolName,
 * intent })`). So money / licence / deletion sovereignty MUST be catchable from
 * the name/intent words even when the tool name does not carry an `md:` prefix.
 *
 * These are STEMS matched case-insensitively against a token's PREFIX (so `payment`,
 * `payments`, `payouts`, `disbursement`, `settlement`, `settled`, `licences`,
 * `revoked`, `suspending`, all hit). Fail CLOSED: any match → sovereign=true. The
 * set is deliberately money/licence/deletion-scoped so a benign tool (e.g.
 * `forecast.run`, `list_sites`) is never tripped.
 */
const SOVEREIGN_LEXEME_STEMS: ReadonlyArray<string> = Object.freeze([
  // Money movement (the Borjie money path). Each entry is a MORPHOLOGICAL ROOT
  // (not a full word) so verb->noun and y->ies inflections are caught by the
  // prefix scan — `royalt` -> royalty/royalties, `treasur` -> treasury/
  // treasuries, `settl` -> settle/settlement, `disburs` -> disburse/
  // disbursement, `delet` -> delete/deletion, `remov` -> remove/removal,
  // `eras` -> erase/erasure, `destr` -> destroy/destruction, `revoc` ->
  // revocation. Fail-CLOSED: a slightly broad root over-parks a benign gap to
  // four-eye (safe) rather than under-classifying a money/licence gap (unsafe).
  'pay', // pay / payment / payout / payouts / payable / payroll
  'disburs', // disburse / disbursement / disbursed
  'settl', // settle / settlement / settled
  'remit', // remit / remittance
  'withdraw', // withdraw / withdrawal
  'transfer', // transfer / transfers / transferred
  'refund', // refund / refunds / refunded
  'royalt', // royalty / royalties
  'treasur', // treasury / treasuries
  // Licence / permit hard-stops.
  'licen', // licence / license / licences / licensing
  'permit', // permit / permits / permitted
  'revok', // revoke / revoked / revoking
  'revoc', // revocation
  'suspen', // suspend / suspension / suspended
  // Deletion / destruction class (inviolable HITL).
  'delet', // delete / deletion / deleted
  'remov', // remove / removal / removed
  'eras', // erase / erasure / erased
  'destr', // destroy / destruction / destroyed
  'void', // void / voided / voids
]);

/**
 * EXACT-token sovereign lexemes (FIX 2). Short money words that, as a STEM, would
 * over-match common non-sovereign idioms — `wire` would catch the pervasive
 * NOT_YET_WIRED organ phrasing ("adapter not yet wired"). Matched only as a whole
 * token (`bank.wire_out` → token `wire`), never as a prefix, so the wiring idiom
 * stays benign while a genuine money-`wire` parks.
 */
const SOVEREIGN_EXACT_LEXEMES: ReadonlySet<string> = new Set(['wire', 'wires']);

/**
 * The SOVEREIGN COMPETENCE DOMAINS (FIX 3) — the jagged-frontier coordinates on
 * which a capability gap is HIGH-risk by DOMAIN regardless of the tool verb. A
 * gap filed against one of these domains is parked even if its tool name +
 * free-text intent happen to omit a sovereign verb stem (fail CLOSED on the
 * money/licence edge so under-classification never auto-actuates a money / payout
 * / licence / royalty / treasury / settlement / deletion gap).
 *
 * DERIVED from the SAME `HIGH_RISK_LITERAL_ONLY_PREFIXES` source — not invented.
 * Each high-risk money/licence prefix is mapped to the estate-domain it governs;
 * the union of those domains is the sovereign-domain set. We additionally fold
 * the deletion class the inviolable rails treat as sovereign. The mapping is a
 * fixed, audited projection of the policy list (extending the policy list and
 * its mapping widens this automatically).
 */
const PREFIX_DOMAIN_MAP: ReadonlyArray<{
  readonly match: string;
  readonly domain: string;
}> = Object.freeze([
  // Money movement (the Borjie money path) → treasury / payout / settlement.
  { match: 'md:transfer-', domain: 'treasury' },
  { match: 'md:approve-payout', domain: 'payout' },
  { match: 'md:disburse-', domain: 'payout' },
  { match: 'md:settle-', domain: 'settlement' },
  { match: 'md:refund-', domain: 'settlement' },
  { match: 'md:payout-', domain: 'payout' },
  { match: 'md:release-funds', domain: 'treasury' },
  { match: 'md:adjust-ledger', domain: 'treasury' },
  { match: 'md:write-off-arrears', domain: 'royalty' },
  // Offtake + licence hard-stops → licence / royalty.
  { match: 'md:terminate-offtake', domain: 'royalty' },
  { match: 'md:propose-suspension', domain: 'licence' },
  { match: 'md:execute-suspension', domain: 'licence' },
  { match: 'md:revoke-operator', domain: 'licence' },
]);

/**
 * The sovereign domain set, DERIVED from the prefix→domain projection above plus
 * the money/deletion umbrellas the rails treat as sovereign. Lower-cased; the
 * compare is an exact, normalized domain-token match so a benign domain
 * (`forecast`, `sites`) never trips it. The PREFIX_DOMAIN_MAP entries are all
 * exact matches against the policy list (asserted in the test) so the two never
 * drift.
 */
const SOVEREIGN_DOMAINS: ReadonlySet<string> = new Set<string>([
  ...PREFIX_DOMAIN_MAP.map((m) => m.domain),
  // Money is the umbrella money-path domain; deletion is the inviolable HITL class.
  'money',
  'deletion',
  'licences', // plural coordinate used by the gap rows (e.g. competence_domain).
]);

/** Normalize a competence-domain coordinate for the sovereign-domain compare. */
function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

/**
 * True when a competence domain is a SOVEREIGN domain (FIX 3). Exported so the
 * detection-seam wiring can fail CLOSED on the domain edge. Singular/plural
 * `licence`/`licences` both match (the policy prefix yields `licence`, the gap
 * rows coordinate as `licences`).
 */
export function isSovereignCompetenceDomain(
  domain: string | null | undefined,
): boolean {
  if (!domain) return false;
  const d = normalizeDomain(domain);
  if (SOVEREIGN_DOMAINS.has(d)) return true;
  // Fold licence/licences so either spelling of the coordinate parks.
  if (d === 'licence' || d === 'licences') return true;
  return false;
}

/**
 * True when a capability gap born from this (toolName, intent) must be sovereign
 * (parked HITL, never auto-actuated). Reuses the policy-gate classifier + the
 * stems derived from it — no bespoke sovereign list.
 *
 * FIX 3 — fail CLOSED on the sovereign-DOMAIN edge: when the tool name + intent
 * omit a sovereign verb stem BUT the gap's `competenceDomain` is a sovereign
 * domain (money / treasury / licence / royalty / payout / settlement / deletion,
 * derived from the SAME policy-gate HIGH_RISK source), classify `sovereign=true`
 * (park). A money / licence gap is then never auto-actuated by under-detection.
 */
export function isSovereignGapSource(args: {
  readonly toolName: string;
  readonly intent: string;
  /**
   * The gap's jagged-frontier coordinate (e.g. `treasury`, `licences`). When it
   * is a sovereign domain the gap parks regardless of the verb scan (FIX 3).
   */
  readonly competenceDomain?: string | null;
}): boolean {
  const toolName = args.toolName ?? '';
  // (1) Exact rail classification for `md:` / `sovereign:`-prefixed tool names.
  if (isHighRiskLiteralOnly(toolName)) return true;

  // (2) Verb-stem scan over the tool name + the blocked intent. Names use
  // dot/underscore separators (`platform.suspend_licence`); intents are free
  // text. Token-boundary match so `suspend` hits but `unsuspended-note` style
  // false positives stay narrow.
  const haystack = `${toolName} ${args.intent ?? ''}`
    .toLowerCase()
    .replace(/[._/]+/g, ' ');
  const tokenList = haystack.split(/[^a-z0-9]+/).filter(Boolean);
  const tokens = new Set(tokenList);
  // (2a) Exact match against the policy-derived verb stems (single source of truth).
  for (const stem of SOVEREIGN_VERB_STEMS) {
    if (tokens.has(stem)) return true;
  }
  // (2b) FIX 2 — conservative STEM-PREFIX scan over the money/licence/deletion
  // lexemes so the NAME + intent alone catch sovereignty (the detection seam has
  // no competence_domain). A token whose PREFIX is a sovereign stem (e.g.
  // `payment`, `payouts`, `disbursement`, `settlement`, `licences`, `revoked`,
  // `suspending`) flips it. Fail CLOSED — any match → sovereign=true.
  for (const token of tokenList) {
    // (2b-i) exact-token money words (e.g. `wire`) — never prefix-matched so the
    // ubiquitous NOT_YET_WIRED "wired" idiom stays benign.
    if (SOVEREIGN_EXACT_LEXEMES.has(token)) return true;
    // (2b-ii) stem-prefix scan over the money/licence/deletion lexemes.
    for (const stem of SOVEREIGN_LEXEME_STEMS) {
      if (token.startsWith(stem)) return true;
    }
  }

  // (3) FIX 3 — fail CLOSED on the sovereign-DOMAIN edge. Even with no sovereign
  // verb in the name/intent, a gap whose competence domain is sovereign (money /
  // treasury / licence / royalty / payout / settlement / deletion) parks rather
  // than auto-actuates. Under-classification on a money/licence gap is unsafe.
  if (isSovereignCompetenceDomain(args.competenceDomain)) return true;

  return false;
}
