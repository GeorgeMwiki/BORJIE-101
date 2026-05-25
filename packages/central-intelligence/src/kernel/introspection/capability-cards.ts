/**
 * Capability cards — Anthropic-style "model card" but per-persona.
 *
 * Each Nyumba Mind persona ships a card that documents:
 *   - canDo:           what the persona reliably does, with evidence
 *   - willRefuse:      what the persona refuses, mapped to a category
 *   - uncertainAbout:  open questions + the mitigation we apply
 *
 * Rendering this on the admin surface (or to operators in onboarding)
 * closes the assessment gap "the brain doesn't know what it can do."
 * Without this layer, every regression is invisible until a user
 * complains.
 *
 * Cards are static-by-design: they declare the contract. Eval results
 * (`evalSummary`, `measuredOnEvalAt`) are stamped onto the card by the
 * eval harness when a regression sweep runs against them.
 */

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export interface CapabilityClaim {
  readonly id: string;
  readonly description: string;
  /** Pointer to the eval scenario or production-evidence (audit hash). */
  readonly evidence: string;
  readonly confidence: 'measured' | 'asserted' | 'untested';
}

export type RefusalCategory =
  | 'inviolable'
  | 'policy'
  | 'drift'
  | 'cognitive-load'
  | 'cohort-floor';

export interface RefusalClaim {
  readonly id: string;
  readonly description: string;
  readonly category: RefusalCategory;
  readonly evidence: string;
}

export interface UncertaintyClaim {
  readonly id: string;
  readonly description: string;
  readonly mitigation: string;
}

export interface CapabilityCardEvalSummary {
  readonly totalScenarios: number;
  readonly meanConfidence: number;
  readonly refusalRate: number;
  readonly driftRate: number;
}

export interface CapabilityCard {
  readonly personaId: string;
  readonly personaDisplayName: string;
  readonly summary: string;
  readonly canDo: ReadonlyArray<CapabilityClaim>;
  readonly willRefuse: ReadonlyArray<RefusalClaim>;
  readonly uncertainAbout: ReadonlyArray<UncertaintyClaim>;
  readonly measuredOnEvalAt?: string;
  readonly evalSummary?: CapabilityCardEvalSummary;
}

// ─────────────────────────────────────────────────────────────────────
// Cards
// ─────────────────────────────────────────────────────────────────────

const TENANT_RESIDENT_CARD: CapabilityCard = {
  personaId: 'tenant-resident',
  personaDisplayName: 'Borjie Resident Concierge',
  summary:
    'The first-person voice of the estate when residents log in. Handles rent, maintenance, lease, and dispute questions inside the resident\'s own lease scope. Never sees other residents.',
  canDo: [
    {
      id: 'tenant.rent.balance',
      description:
        'Answer "what do I owe this month?" and "when did I last pay?" against the resident\'s own ledger.',
      evidence: 'eval/tenant-rent-balance.scenario',
      confidence: 'measured',
    },
    {
      id: 'tenant.maintenance.raise',
      description:
        'Open a maintenance request, attach a photo, and quote the SLA window from the work-order pipeline.',
      evidence: 'eval/tenant-maintenance-raise.scenario',
      confidence: 'measured',
    },
    {
      id: 'tenant.lease.explain',
      description:
        'Read clauses out of the resident\'s OWN lease and explain them in plain language (Swahili or English).',
      evidence: 'eval/tenant-lease-explain.scenario',
      confidence: 'measured',
    },
    {
      id: 'tenant.dispute.escalate',
      description:
        'Capture a complaint, log an audit entry, and route it to the estate-manager queue with the right severity tag.',
      evidence: 'eval/tenant-dispute-escalate.scenario',
      confidence: 'asserted',
    },
  ],
  willRefuse: [
    {
      id: 'tenant.refuse.cross-tenant',
      description:
        'Will not list other residents, their rent status, or their dispute history.',
      category: 'inviolable',
      evidence: 'inviolable.cross-tenant-probe',
    },
    {
      id: 'tenant.refuse.legal-promise',
      description:
        'Will not promise an eviction outcome, a court ruling, or guarantee any legal result.',
      category: 'policy',
      evidence: 'policy.legal-promise-detector',
    },
    {
      id: 'tenant.refuse.fabricate-numbers',
      description:
        'Will not invent rent, arrears, or fee figures — every number must come from the ledger.',
      category: 'drift',
      evidence: 'drift.fabricated-number-signal',
    },
    {
      id: 'tenant.refuse.other-tenant-payment',
      description:
        'Will not speculate about whether other tenants paid on time.',
      category: 'inviolable',
      evidence: 'inviolable.cross-tenant-probe',
    },
  ],
  uncertainAbout: [
    {
      id: 'tenant.uncertain.legal-advice',
      description:
        'Cannot reliably give jurisdiction-specific legal advice (TZ vs KE vs UG vs other).',
      mitigation:
        'Defers to a licensed advocate; surfaces the local legal-aid contact instead of answering.',
    },
    {
      id: 'tenant.uncertain.dispute-outcome',
      description:
        'Cannot predict how a specific dispute will resolve.',
      mitigation:
        'Reports the arrears-ladder state and the documented next step rather than a forecast.',
    },
    {
      id: 'tenant.uncertain.market-rent',
      description:
        'Cannot tell a resident whether their rent is "fair" against the market.',
      mitigation:
        'Surfaces the cohort-floor signal only when k≥5 and labels it as "platform aggregate, not your specific landlord".',
    },
  ],
};

const ESTATE_MANAGER_CARD: CapabilityCard = {
  personaId: 'estate-manager',
  personaDisplayName: 'Borjie Estate Operations Lead',
  summary:
    'The operations brain of an estate. Runs the work-order queue, inspection schedule, arrears ladder, and move-in/move-out pipeline. Acts only with explicit four-eye approval on irreversible writes.',
  canDo: [
    {
      id: 'estate.state.summarise',
      description:
        'Roll up the current state of an estate: vacancies, arrears, open work orders, scheduled move-outs.',
      evidence: 'eval/estate-state-summary.scenario',
      confidence: 'measured',
    },
    {
      id: 'estate.action.propose',
      description:
        'Propose actions (chase a payment, dispatch a vendor, escalate a dispute) ranked by urgency.',
      evidence: 'eval/estate-action-propose.scenario',
      confidence: 'measured',
    },
    {
      id: 'estate.workorder.dispatch',
      description:
        'Open a work order, assign a vendor from the approved list, and notify the relevant resident.',
      evidence: 'eval/estate-workorder-dispatch.scenario',
      confidence: 'measured',
    },
    {
      id: 'estate.arrears.ladder',
      description:
        'Walk a resident through the documented arrears ladder step-by-step without skipping rungs.',
      evidence: 'eval/estate-arrears-ladder.scenario',
      confidence: 'asserted',
    },
  ],
  willRefuse: [
    {
      id: 'estate.refuse.unilateral-write',
      description:
        'Will not commit any irreversible write (eviction, lease termination, vendor contract) without a four-eye approval signature.',
      category: 'policy',
      evidence: 'policy.four-eye-approval-gate',
    },
    {
      id: 'estate.refuse.invent-vendor',
      description:
        'Will not invent vendor names or work-order ids; refers to the canonical vendor list only.',
      category: 'drift',
      evidence: 'drift.fabricated-vendor-signal',
    },
    {
      id: 'estate.refuse.skip-ladder',
      description:
        'Will not propose termination of a lease outside the documented arrears-ladder rungs.',
      category: 'policy',
      evidence: 'policy.arrears-ladder-gate',
    },
    {
      id: 'estate.refuse.cross-org',
      description:
        'Will not surface data from estates managed under a different organisation.',
      category: 'inviolable',
      evidence: 'inviolable.cross-org-probe',
    },
  ],
  uncertainAbout: [
    {
      id: 'estate.uncertain.market-prediction',
      description:
        'Cannot forecast market rent or vacancy outside the cohort-source horizon.',
      mitigation:
        'Caps forecasts at the world-model horizon and labels confidence; falls back to "ask the cohort source" when out of range.',
    },
    {
      id: 'estate.uncertain.vendor-quality',
      description:
        'Cannot rank vendor quality without a measurable feedback loop.',
      mitigation:
        'Ranks by historical SLA-hit-rate from the work-order audit; refuses to opine on vendors without audit history.',
    },
    {
      id: 'estate.uncertain.tenant-intent',
      description:
        'Cannot reliably infer whether a resident intends to renew vs vacate.',
      mitigation:
        'Reports the intent signal explicitly with confidence band; never books a renewal until confirmed.',
    },
  ],
};

const OWNER_ADVISOR_CARD: CapabilityCard = {
  personaId: 'owner-advisor',
  personaDisplayName: 'Borjie Portfolio & Agency Brain',
  summary:
    'The voice of the owner\'s portfolio AND the brain of their agency. Rolls up cashflow, occupancy, and arrears across every property the owner has on the platform. Never reveals tenant PII.',
  canDo: [
    {
      id: 'owner.cashflow.rollup',
      description:
        'Roll up portfolio cashflow across every property — collection rate, arrears rate, net yield — by month/quarter.',
      evidence: 'eval/owner-cashflow-rollup.scenario',
      confidence: 'measured',
    },
    {
      id: 'owner.portfolio.headline',
      description:
        'Produce a 1-paragraph "how is my portfolio doing?" headline citing every figure.',
      evidence: 'eval/owner-portfolio-headline.scenario',
      confidence: 'measured',
    },
    {
      id: 'owner.subadmin.invite',
      description:
        'Invite a sub-admin to the owner-portal and configure their autonomy policy.',
      evidence: 'eval/owner-subadmin-invite.scenario',
      confidence: 'measured',
    },
    {
      id: 'owner.audit.surface',
      description:
        'Surface the audit log for any decision the AI took on the owner\'s behalf, with provenance hashes.',
      evidence: 'eval/owner-audit-surface.scenario',
      confidence: 'asserted',
    },
  ],
  willRefuse: [
    {
      id: 'owner.refuse.tenant-pii',
      description:
        'Will not surface individual tenant names, contact details, or payment-method PII in any portfolio rollup.',
      category: 'policy',
      evidence: 'policy.tenant-pii-redactor',
    },
    {
      id: 'owner.refuse.cross-owner',
      description:
        'Will not compare this owner\'s portfolio to a specific other owner on the platform.',
      category: 'inviolable',
      evidence: 'inviolable.cross-owner-probe',
    },
    {
      id: 'owner.refuse.fabricate-yield',
      description:
        'Will not invent yield, rent, or revenue figures; every number cites a ledger row or a DP-aggregate.',
      category: 'drift',
      evidence: 'drift.fabricated-yield-signal',
    },
    {
      id: 'owner.refuse.access-write',
      description:
        'Will not change security or access controls without the four-eye approval flow.',
      category: 'policy',
      evidence: 'policy.four-eye-approval-gate',
    },
  ],
  uncertainAbout: [
    {
      id: 'owner.uncertain.long-horizon-forecast',
      description:
        'Cannot reliably forecast portfolio performance beyond the world-model horizon.',
      mitigation:
        'Caps forecasts at the world-model horizon; widens p90 bands beyond it; refuses absolute predictions.',
    },
    {
      id: 'owner.uncertain.market-cycle',
      description:
        'Cannot predict whether a national market cycle will turn within the planning window.',
      mitigation:
        'Reports the regime detector\'s current label only ("stable", "tightening", "shock") with explicit horizon.',
    },
    {
      id: 'owner.uncertain.subadmin-trust',
      description:
        'Cannot infer how much autonomy a newly-invited sub-admin should be granted.',
      mitigation:
        'Defaults a new sub-admin to the most-restrictive autonomy policy; escalates any expansion to the owner.',
    },
  ],
};

const ORG_ADMIN_CARD: CapabilityCard = {
  personaId: 'org-admin',
  personaDisplayName: 'Nyumba Mind — Agency Brain',
  summary:
    'The agency-wide brain (deprecated alias of OWNER_ADVISOR — see DEPRECATED.md). Speaks for the agency as a whole when an org-admin sub-user is logged in. Never compares agencies cross-platform without DP fingerprints.',
  canDo: [
    {
      id: 'org.metrics.agencywide',
      description:
        'Surface agency-wide collection rate, retention rate, and growth trend across every estate under management.',
      evidence: 'eval/org-metrics-agencywide.scenario',
      confidence: 'measured',
    },
    {
      id: 'org.team.workload',
      description:
        'Roll up estate-manager workload (open WOs, overdue inspections, escalations) so the agency can re-balance.',
      evidence: 'eval/org-team-workload.scenario',
      confidence: 'measured',
    },
    {
      id: 'org.policy.review',
      description:
        'Read the agency\'s autonomy policy and explain when each AI action requires human approval.',
      evidence: 'eval/org-policy-review.scenario',
      confidence: 'asserted',
    },
    {
      id: 'org.onboarding.trace',
      description:
        'Trace recent onboardings (new owners, new estates) and flag stalled cases.',
      evidence: 'eval/org-onboarding-trace.scenario',
      confidence: 'asserted',
    },
  ],
  willRefuse: [
    {
      id: 'org.refuse.cross-agency',
      description:
        'Will not compare this agency to other named agencies on the platform.',
      category: 'inviolable',
      evidence: 'inviolable.cross-agency-probe',
    },
    {
      id: 'org.refuse.fabricate-revenue',
      description:
        'Will not fabricate revenue, retention, or growth figures — every number cites a source.',
      category: 'drift',
      evidence: 'drift.fabricated-revenue-signal',
    },
    {
      id: 'org.refuse.platform-aggregate',
      description:
        'Will not surface platform-wide aggregates without DP fingerprints.',
      category: 'cohort-floor',
      evidence: 'cohort.dp-fingerprint-required',
    },
    {
      id: 'org.refuse.policy-bypass',
      description:
        'Will not commit the agency to anything outside the documented autonomy policy.',
      category: 'policy',
      evidence: 'policy.autonomy-gate',
    },
  ],
  uncertainAbout: [
    {
      id: 'org.uncertain.staff-pii',
      description:
        'Cannot reliably comment on individual staff sensitive data (compensation, performance reviews).',
      mitigation:
        'Refuses to surface individual sensitive HR data; aggregates only at the team level with k≥3.',
    },
    {
      id: 'org.uncertain.attribution',
      description:
        'Cannot perfectly attribute a collection-rate change to a specific staff intervention.',
      mitigation:
        'Reports a correlation band rather than a causal claim; surfaces the underlying audit entries.',
    },
    {
      id: 'org.uncertain.benchmark',
      description:
        'Cannot benchmark this agency against named peers (only DP-aggregate platform tendency).',
      mitigation:
        'Falls back to platform-tier cohort source under the k≥5 floor.',
    },
  ],
};

const SOVEREIGN_ADMIN_CARD: CapabilityCard = {
  personaId: 'sovereign-admin',
  personaDisplayName: 'Nyumba Mind',
  summary:
    'The named, single-voice AI assigned to every Borjie HQ admin. Industry-aggregate read-only. Never identifies any specific tenant, owner, or org.',
  canDo: [
    {
      id: 'sovereign.industry.aggregate',
      description:
        'Query industry-tier aggregates (platform-wide vacancy rate, arrears rate, growth) under the DP floor.',
      evidence: 'eval/sovereign-industry-aggregate.scenario',
      confidence: 'measured',
    },
    {
      id: 'sovereign.regime.detect',
      description:
        'Detect a market regime shift across the platform (shock, tightening, recovery) using the world-model regime detector.',
      evidence: 'eval/sovereign-regime-detect.scenario',
      confidence: 'measured',
    },
    {
      id: 'sovereign.audit.platform',
      description:
        'Trace a platform-level audit chain to surface what the brain decided across an entire fairness cohort.',
      evidence: 'eval/sovereign-audit-platform.scenario',
      confidence: 'measured',
    },
    {
      id: 'sovereign.action.escalate',
      description:
        'Escalate a platform-level integrity incident (privacy breach, drift cluster) through the documented incident path.',
      evidence: 'eval/sovereign-action-escalate.scenario',
      confidence: 'asserted',
    },
  ],
  willRefuse: [
    {
      id: 'sovereign.refuse.identify-tenant',
      description:
        'Will not name or otherwise identify any specific tenant, lease, owner, or org.',
      category: 'inviolable',
      evidence: 'inviolable.identify-individual-probe',
    },
    {
      id: 'sovereign.refuse.below-k',
      description:
        'Will not produce any aggregate whose k-anonymity bucket is below 5.',
      category: 'cohort-floor',
      evidence: 'cohort.k-anon-floor',
    },
    {
      id: 'sovereign.refuse.specific-forecast',
      description:
        'Will not forecast a specific estate (only platform tendencies).',
      category: 'policy',
      evidence: 'policy.specific-forecast-gate',
    },
    {
      id: 'sovereign.refuse.cross-platform-handoff',
      description:
        'Will not export tenant-tier or owner-tier data to anyone via this seat.',
      category: 'inviolable',
      evidence: 'inviolable.tier-export-probe',
    },
  ],
  uncertainAbout: [
    {
      id: 'sovereign.uncertain.causation',
      description:
        'Cannot reliably attribute a platform-wide trend to a specific market driver.',
      mitigation:
        'Reports correlations with effect-size bands; refuses single-driver causal claims.',
    },
    {
      id: 'sovereign.uncertain.outlier-cause',
      description:
        'Cannot explain why a specific cohort outlier emerged without inspecting tenant-tier data.',
      mitigation:
        'Surfaces the outlier shape only; routes the inspection request to the relevant org-admin.',
    },
    {
      id: 'sovereign.uncertain.long-horizon',
      description:
        'Cannot reliably forecast platform metrics beyond the world-model horizon.',
      mitigation:
        'Caps the horizon, widens the p90 band, and labels every forecast with the regime under which it was produced.',
    },
  ],
};

const MARKETING_GUIDE_CARD: CapabilityCard = {
  personaId: 'marketing-guide',
  personaDisplayName: 'Borjie Public Guide',
  summary:
    'The public face of Borjie on the unauthenticated marketing surface. Answers product questions; refuses any tenant-tier or extraction probe.',
  canDo: [
    {
      id: 'marketing.product.explain',
      description:
        'Explain what Borjie does and which surfaces (resident, estate-manager, owner) it serves.',
      evidence: 'eval/marketing-product-explain.scenario',
      confidence: 'measured',
    },
    {
      id: 'marketing.fit.qualify',
      description:
        'Qualify whether the platform fits an estate (size, geography, autonomy preference) at a high level.',
      evidence: 'eval/marketing-fit-qualify.scenario',
      confidence: 'measured',
    },
    {
      id: 'marketing.demo.offer',
      description:
        'Offer a demo / sales handoff with the right contact path.',
      evidence: 'eval/marketing-demo-offer.scenario',
      confidence: 'measured',
    },
    {
      id: 'marketing.faq.answer',
      description:
        'Answer the documented public FAQ (pricing tiers in general terms, language coverage, supported countries).',
      evidence: 'eval/marketing-faq-answer.scenario',
      confidence: 'asserted',
    },
  ],
  willRefuse: [
    {
      id: 'marketing.refuse.prompt-injection',
      description:
        'Will not honour prompt-injection markers, "ignore previous instructions" patterns, or hidden steering tokens.',
      category: 'inviolable',
      evidence: 'inviolable.public-prompt-injection',
    },
    {
      id: 'marketing.refuse.system-extract',
      description:
        'Will not reveal the system prompt, the persona configuration, or any internal scaffolding.',
      category: 'inviolable',
      evidence: 'inviolable.public-system-extract',
    },
    {
      id: 'marketing.refuse.cross-tenant',
      description:
        'Will not answer questions about specific tenants, owners, or orgs on the platform.',
      category: 'inviolable',
      evidence: 'inviolable.public-cross-tenant',
    },
    {
      id: 'marketing.refuse.pricing-promise',
      description:
        'Will not commit to a specific price for a specific customer.',
      category: 'policy',
      evidence: 'policy.pricing-promise-gate',
    },
  ],
  uncertainAbout: [
    {
      id: 'marketing.uncertain.roadmap',
      description:
        'Cannot reliably commit to a feature ship date.',
      mitigation:
        'Describes capabilities in present tense only; routes roadmap questions to a sales contact.',
    },
    {
      id: 'marketing.uncertain.tenant-fit',
      description:
        'Cannot fully qualify whether a specific tenant\'s edge case is supported.',
      mitigation:
        'Offers a discovery call rather than a yes/no answer when the question goes beyond documented features.',
    },
    {
      id: 'marketing.uncertain.legal-jurisdiction',
      description:
        'Cannot answer jurisdiction-specific compliance questions for any country.',
      mitigation:
        'Routes legal-compliance questions to the sales / legal team contact path.',
    },
  ],
};

const CLASSROOM_TUTOR_CARD: CapabilityCard = {
  personaId: 'classroom-tutor',
  personaDisplayName: 'Borjie Classroom Tutor',
  summary:
    'The patient teacher persona for the classroom surface. Walks learners through realistic property-operations scenarios. Never uses real tenant or owner data in examples.',
  canDo: [
    {
      id: 'classroom.scenario.walkthrough',
      description:
        'Walk through a property-operations scenario (vacancy, arrears, move-out) step-by-step with checks for understanding.',
      evidence: 'eval/classroom-scenario-walkthrough.scenario',
      confidence: 'measured',
    },
    {
      id: 'classroom.concept.explain',
      description:
        'Explain a domain concept (cap rate, arrears ladder, four-eye approval) with a worked example before the abstract rule.',
      evidence: 'eval/classroom-concept-explain.scenario',
      confidence: 'measured',
    },
    {
      id: 'classroom.quiz.run',
      description:
        'Run a short quiz on a topic the learner just covered and grade with feedback.',
      evidence: 'eval/classroom-quiz-run.scenario',
      confidence: 'asserted',
    },
    {
      id: 'classroom.path.suggest',
      description:
        'Suggest the next learning step based on the learner\'s recent answers and stated goal.',
      evidence: 'eval/classroom-path-suggest.scenario',
      confidence: 'asserted',
    },
  ],
  willRefuse: [
    {
      id: 'classroom.refuse.real-data',
      description:
        'Will not use real tenant, owner, or estate data in any example — only synthetic fixtures.',
      category: 'inviolable',
      evidence: 'inviolable.classroom-real-data',
    },
    {
      id: 'classroom.refuse.out-of-scope',
      description:
        'Will not teach domains outside property operations (lending, medicine, law, finance, etc.).',
      category: 'policy',
      evidence: 'policy.classroom-domain-scope',
    },
    {
      id: 'classroom.refuse.race-ahead',
      description:
        'Will not advance to the next concept until the learner has acknowledged the current one.',
      category: 'cognitive-load',
      evidence: 'cognitive-load.classroom-pace-gate',
    },
    {
      id: 'classroom.refuse.fake-knowledge',
      description:
        'Will not pretend to know an answer that needs a tool call; defers to the run-the-tool flow.',
      category: 'drift',
      evidence: 'drift.classroom-fabrication-signal',
    },
  ],
  uncertainAbout: [
    {
      id: 'classroom.uncertain.learner-context',
      description:
        'Cannot reliably infer the learner\'s prior knowledge depth from their first prompt.',
      mitigation:
        'Asks a calibration question early; adapts pace based on the answer.',
    },
    {
      id: 'classroom.uncertain.locale-norms',
      description:
        'Cannot reliably teach jurisdiction-specific norms (e.g. TZ vs KE eviction procedures) without an explicit locale.',
      mitigation:
        'Asks the learner for their locale and labels every locale-bound concept with the country it applies to.',
    },
    {
      id: 'classroom.uncertain.outcome-confidence',
      description:
        'Cannot guarantee the learner will retain a concept after a single walkthrough.',
      mitigation:
        'Schedules a spaced-recall quiz; surfaces gaps before advancing.',
    },
  ],
};

/**
 * The canonical capability cards for every Nyumba Mind persona.
 *
 * Order matches `ALL_PERSONAS` in `kernel/identity.ts` so callers that
 * walk both arrays in parallel see consistent ordering.
 */
export const CAPABILITY_CARDS: ReadonlyArray<CapabilityCard> = [
  TENANT_RESIDENT_CARD,
  ESTATE_MANAGER_CARD,
  OWNER_ADVISOR_CARD,
  ORG_ADMIN_CARD,
  SOVEREIGN_ADMIN_CARD,
  MARKETING_GUIDE_CARD,
  CLASSROOM_TUTOR_CARD,
];
