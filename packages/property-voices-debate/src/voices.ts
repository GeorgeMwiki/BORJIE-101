/**
 * Mining offtake/licence three-voice debate preset.
 *
 * Adapts LITFIN's 3-voice credit-decision debate (Proposer = Credit-
 * Mind quantitative / Critic = Rules-engine compliance / Synthesizer =
 * Borrower-advocate) to BORJIE's mining-estate domain. The three
 * pinned voices are:
 *
 *   1. CONSERVATIVE_OWNER — anchors on asset value, royalty / payment
 *      collection, counterparty churn cost, offtake-covenant
 *      enforcement. Confident, numbers-first. Argues for the owner's
 *      protected position without inventing facts the context does
 *      not provide.
 *
 *   2. PRO_COUNTERPARTY — anchors on buyer / off-taker rights,
 *      fair-dealing, force-majeure and delivery-relief obligations,
 *      mining-tribunal and licensing-authority precedent. Pushes back
 *      on anything that would expose the owner to discrimination,
 *      retaliation, or wrongful-suspension claims. Cites statute or
 *      tribunal ruling when possible.
 *
 *   3. PRAGMATIC_OPS — the operations-manager synthesiser. Re-reads
 *      both and produces the final recommendation: minimum-friction
 *      path that preserves owner economics, treats the counterparty
 *      fairly, and keeps the site within licence compliance. MUST
 *      address every pro-counterparty concern before issuing a
 *      recommendation.
 *
 * Use cases — contested decisions:
 *   - Licence suspension (outstanding royalties past statutory cure period)
 *   - Offtake termination for cause (delivery default, off-spec ore)
 *   - Performance-bond dispute (delivery shortfall, withholding)
 *   - Grievance triage (genuine operability fault vs preference)
 *   - Renewal denial (problem counterparty, no statutory violation)
 *
 * Why an orchestrator pattern? Single-prompt LLM calls tend to
 * rubber-stamp the framing of the input. Three explicit voices force
 * structurally different perspectives so the synthesis cannot
 * collapse to any single voice's bias.
 */

export const CONSERVATIVE_LANDLORD_SYSTEM =
  "You are the CONSERVATIVE OWNER voice in a three-voice mining-offtake " +
  "deliberation. Anchor every claim in site economics: royalty / payment " +
  "owed, available-capacity carrying cost, counterparty churn cost, offtake " +
  "covenant language, licence-suspension timeline, and statutory cure " +
  "periods. Be confident and numbers-first. Cite the offtake clause id or " +
  "statute section when relevant. Do NOT invent solvency data the context " +
  "does not provide. Do NOT pad with euphemisms — say 'suspend the licence' " +
  "not 'pursue resolution'. 4-8 sentences. End with a draft action " +
  "(proceed / hold / negotiate) backed by the numbers + clauses " +
  "you cited.";

export const PRO_TENANT_SYSTEM =
  "You are the PRO-COUNTERPARTY voice in a three-voice mining-offtake " +
  "deliberation. Read the Conservative Owner's recommendation and " +
  "identify (a) buyer / off-taker rights concerns, (b) fair-dealing / anti-" +
  "discrimination exposure, (c) delivery-relief or force-majeure grounds the " +
  "owner has not weighed, (d) procedural gaps (notice period, cure window, " +
  "service of process, retaliation appearance). Cite statute or " +
  "tribunal ruling when possible — TZ Mining Act, KE Mining Act, OECD " +
  "due-diligence guidance, EITI standard. Refuse " +
  "framings that would not survive substituting the counterparty's gender, " +
  "ethnicity, cooperative status, or region of origin. 4-8 sentences. End by " +
  "listing the single biggest unaddressed risk to the owner OR " +
  "counterparty.";

export const PRAGMATIC_PM_SYSTEM =
  "You are the PRAGMATIC OPERATIONS MANAGER voice in a three-voice " +
  "deliberation. Read the Conservative Owner's recommendation and " +
  "the Pro-Counterparty's analysis. Produce the final recommendation: the " +
  "minimum-friction path that (1) preserves owner economics, (2) " +
  "treats the counterparty fairly, (3) keeps the site within statutory " +
  "and licence compliance, (4) avoids predictable tribunal/court loss. " +
  "HOWEVER: if the Pro-Counterparty flagged a statutory violation or " +
  "fair-dealing exposure, you MUST address it before issuing the " +
  "recommendation. Do NOT rubber-stamp the Owner; do NOT ignore the " +
  "Counterparty voice. End with a single recommended action and a " +
  "1-line next-step.";

/**
 * Statute clauses surfaced to the Pro-Counterparty by default. Caller
 * can override per call (e.g. only TZ clauses for a TZ-jurisdiction
 * deliberation).
 */
export interface StatuteClausePrompt {
  readonly id: string;
  readonly description: string;
}

export const DEFAULT_PROPERTY_STATUTE_CLAUSES: ReadonlyArray<StatuteClausePrompt> =
  Object.freeze([
    {
      id: "S-01-NOTICE-PERIOD",
      description:
        "Owner shall serve statutory notice and observe the cure window before proceeding with licence suspension.",
    },
    {
      id: "S-02-HABITABILITY",
      description:
        "Site shall be safe and operable to the agreed standard. Failed operability obligations are a defence against payment claims.",
    },
    {
      id: "S-03-NON-DISCRIMINATION",
      description:
        "Decisions shall not adversely differentiate on protected attributes (gender, ethnicity, religion, cooperative status, region of origin).",
    },
    {
      id: "S-04-DEPOSIT-RETURN",
      description:
        "Performance bond shall be returned within the statutory window minus itemised, supported deductions.",
    },
    {
      id: "S-05-RETALIATION",
      description:
        "Adverse action following a counterparty grievance within the statutory window creates a rebuttable presumption of retaliation.",
    },
    {
      id: "S-06-PEACEFUL-ENJOYMENT",
      description:
        "Owner shall not interfere with the counterparty's lawful site access — no self-help suspension, no utility cut-off, no lock-out without an authority order.",
    },
  ]);
