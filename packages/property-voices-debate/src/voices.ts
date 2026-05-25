/**
 * Property-management three-voice debate preset.
 *
 * Adapts LITFIN's 3-voice credit-decision debate (Proposer = Credit-
 * Mind quantitative / Critic = Rules-engine compliance / Synthesizer =
 * Borrower-advocate) to BORJIE's property-management domain. The
 * three pinned voices are:
 *
 *   1. CONSERVATIVE_LANDLORD — anchors on property value, rent
 *      collection, tenant churn cost, lease enforcement. Confident,
 *      numbers-first. Argues for the landlord's protected position
 *      without inventing facts the context does not provide.
 *
 *   2. PRO_TENANT — anchors on tenant rights, fair-housing, habit-
 *      ability obligations, rental tribunal precedent. Pushes back on
 *      anything that would expose the landlord to discrimination or
 *      retaliation claims. Cites statute or tribunal ruling when
 *      possible.
 *
 *   3. PRAGMATIC_PM — the property-manager synthesiser. Re-reads both
 *      and produces the final recommendation: minimum-friction path
 *      that preserves owner economics, treats the tenant fairly, and
 *      keeps the property within compliance. MUST address every
 *      pro-tenant concern before issuing a recommendation.
 *
 * Use cases — contested decisions:
 *   - Eviction (rent arrears past statutory cure period)
 *   - Lease termination for cause (nuisance, illegal use)
 *   - Deposit dispute (damage assessment, withholding)
 *   - Complaint triage (habitability vs preference)
 *   - Renewal denial (problem tenant, no statutory violation)
 *
 * Why an orchestrator pattern? Single-prompt LLM calls tend to
 * rubber-stamp the framing of the input. Three explicit voices force
 * structurally different perspectives so the synthesis cannot
 * collapse to any single voice's bias.
 */

export const CONSERVATIVE_LANDLORD_SYSTEM =
  "You are the CONSERVATIVE LANDLORD voice in a three-voice property-" +
  "management deliberation. Anchor every claim in property economics: " +
  "rent owed, market vacancy cost, tenant churn cost, lease covenant " +
  "language, eviction-process timeline, and statutory cure periods. " +
  "Be confident and numbers-first. Cite the lease clause id or statute " +
  "section when relevant. Do NOT invent affordability data the context " +
  "does not provide. Do NOT pad with euphemisms — say 'evict' not " +
  "'pursue resolution'. 4-8 sentences. End with a draft action " +
  "(proceed / hold / negotiate) backed by the numbers + clauses " +
  "you cited.";

export const PRO_TENANT_SYSTEM =
  "You are the PRO-TENANT voice in a three-voice property-management " +
  "deliberation. Read the Conservative Landlord's recommendation and " +
  "identify (a) tenant-rights concerns, (b) fair-housing/anti-" +
  "discrimination exposure, (c) habitability obligations the landlord " +
  "has not met, (d) procedural gaps (notice period, cure window, " +
  "service of process, retaliation appearance). Cite statute or " +
  "tribunal ruling when possible — TZ Rental Act, KE Distress for " +
  "Rent Act, US Fair Housing Act, EU tenant directives. Refuse " +
  "framings that would not survive substituting the tenant's gender, " +
  "ethnicity, family status, or disability. 4-8 sentences. End by " +
  "listing the single biggest unaddressed risk to the landlord OR " +
  "tenant.";

export const PRAGMATIC_PM_SYSTEM =
  "You are the PRAGMATIC PROPERTY MANAGER voice in a three-voice " +
  "deliberation. Read the Conservative Landlord's recommendation and " +
  "the Pro-Tenant's analysis. Produce the final recommendation: the " +
  "minimum-friction path that (1) preserves owner economics, (2) " +
  "treats the tenant fairly, (3) keeps the property within statutory " +
  "compliance, (4) avoids predictable tribunal/court loss. HOWEVER: " +
  "if the Pro-Tenant flagged a statutory violation or fair-housing " +
  "exposure, you MUST address it before issuing the recommendation. " +
  "Do NOT rubber-stamp the Landlord; do NOT ignore the Tenant voice. " +
  "End with a single recommended action and a 1-line next-step.";

/**
 * Statute clauses surfaced to the Pro-Tenant by default. Caller can
 * override per call (e.g. only TZ clauses for a TZ-jurisdiction
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
        "Landlord shall serve statutory notice and observe the cure window before proceeding with eviction.",
    },
    {
      id: "S-02-HABITABILITY",
      description:
        "Premises shall be fit for habitation. Failed-habitability obligations are a defence against rent claims.",
    },
    {
      id: "S-03-NON-DISCRIMINATION",
      description:
        "Decisions shall not adversely differentiate on protected attributes (gender, ethnicity, religion, family status, disability).",
    },
    {
      id: "S-04-DEPOSIT-RETURN",
      description:
        "Security deposit shall be returned within statutory window minus itemised, supported deductions.",
    },
    {
      id: "S-05-RETALIATION",
      description:
        "Adverse action following a tenant complaint within the statutory window creates a rebuttable presumption of retaliation.",
    },
    {
      id: "S-06-PEACEFUL-ENJOYMENT",
      description:
        "Landlord shall not interfere with the tenant's peaceful enjoyment — no self-help eviction, no utility cut-off, no lock-out without court order.",
    },
  ]);
