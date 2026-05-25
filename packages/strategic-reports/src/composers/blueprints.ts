/**
 * Composer blueprints — one per report type.
 *
 * Each blueprint declares (a) the section spine the persona is
 * expected to fill, (b) the executive-summary defaults the composer
 * threads through, and (c) the seeded action plan (the persona may
 * augment it via the brain, but the composer guarantees the minimum
 * count + owner/due-date discipline).
 *
 * Blueprints are pure-functional: ctx.spec.actorId + ctx.spec.period
 * are the only inputs. Action ids include the report-type prefix to
 * keep the citation key human-readable.
 */

import type { ActionItem, ComposerContext } from '../types.js';
import type { ComposerBlueprint } from './shared.js';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function isoDateAdd(baseIso: string, days: number): string {
  const dt = new Date(baseIso);
  if (Number.isNaN(dt.getTime())) {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function actorOwner(ctx: ComposerContext): string {
  return ctx.spec.actorId;
}

function asActionPlan(items: ReadonlyArray<Omit<ActionItem, 'id'> & { idSuffix: string }>): ReadonlyArray<ActionItem> {
  return items.map((item) => {
    const { idSuffix, ...rest } = item;
    return { id: `act-${idSuffix}`, ...rest };
  });
}

// ────────────────────────────────────────────────────────────────────────────
// 1. Leasing financial performance
// ────────────────────────────────────────────────────────────────────────────

export const LEASING_FINANCIAL_BLUEPRINT: ComposerBlueprint = {
  title: (ctx) => `Leasing financial performance — ${ctx.spec.period.label}`,
  composerSystemNote:
    'Compose a leasing-financial report. Sections: trend-headline, revenue-detail, occupancy-detail, collection-detail, scenario-outlook.',
  sectionBlueprints: [
    { id: 'trend-headline', title: 'Trend headline', heading: 1, fragmentPrefixes: ['lf-rev-', 'lf-occ-'] },
    { id: 'revenue-detail', title: 'Revenue detail', heading: 2, fragmentPrefixes: ['lf-rev-'], tableIds: ['lf-revenue-table'], chartIds: ['lf-revenue-chart'] },
    { id: 'occupancy-detail', title: 'Occupancy detail', heading: 2, fragmentPrefixes: ['lf-occ-'], chartIds: ['lf-occupancy-chart'] },
    { id: 'collection-detail', title: 'Collection performance', heading: 2, fragmentPrefixes: ['lf-rev-'] },
    { id: 'scenario-outlook', title: 'Scenario outlook', heading: 2, fragmentPrefixes: ['lf-rev-', 'lf-occ-'] },
  ],
  executiveSummary: (ctx) =>
    `Leasing financial performance for ${ctx.spec.period.label}. ${ctx.evidence.fragments.length} evidence fragments triangulated across revenue, occupancy, and collection. Collection performance and arrears age form the leading indicators for the next two quarters; the scenario outlook stress-tests two paths around the central revenue trajectory.`,
  actionPlan: (ctx) =>
    asActionPlan([
      {
        idSuffix: 'lf-1',
        title: 'Close arrears > 60 days for the top-decile units',
        description: 'Operations lead initiates structured engagement on units in the 61-90 + 91+ ageing buckets within 14 days.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 14),
        priority: 'p0',
        successCriterion: 'Top-decile arrears reduced ≥30% within 30 days.',
        citationIds: ctx.evidence.fragments.filter((f) => f.id.startsWith('lf-rev-')).slice(0, 3).map((f) => f.id),
      },
      {
        idSuffix: 'lf-2',
        title: 'Renew leases expiring inside 90 days',
        description: 'Issue renewal terms to every lease expiring in the next 90 days with priority on top-quartile rent units.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 30),
        priority: 'p1',
        successCriterion: 'Renewal cover ratio ≥75% measured at +60 days.',
        citationIds: ctx.evidence.fragments.filter((f) => f.id.startsWith('lf-occ-')).slice(0, 2).map((f) => f.id),
      },
      {
        idSuffix: 'lf-3',
        title: 'Tighten the collection cadence',
        description: 'Move from a monthly to a weekly collection reconciliation; pair every aged invoice with an SMS + WhatsApp nudge.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 21),
        priority: 'p1',
        successCriterion: 'Collection ratio improves ≥3pp month-on-month.',
        citationIds: ctx.evidence.fragments.filter((f) => f.id.startsWith('lf-rev-')).slice(0, 2).map((f) => f.id),
      },
      {
        idSuffix: 'lf-4',
        title: 'Recalibrate the occupancy forecast',
        description: 'Refresh the 12-month occupancy forecast using the latest trend; surface the variance to the Asset Committee.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 45),
        priority: 'p2',
        successCriterion: 'Forecast variance to actuals within ±3pp at the +90-day check.',
        citationIds: ctx.evidence.fragments.filter((f) => f.id.startsWith('lf-occ-')).slice(0, 2).map((f) => f.id),
      },
      {
        idSuffix: 'lf-5',
        title: 'Sign off the period MIS pack',
        description: 'Confirm the renderer-produced report against the source GL; sign off and archive the WORM-signed PDF.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 7),
        priority: 'p1',
        successCriterion: 'Signed PDF + reconciliation note archived inside 7 days of period close.',
        citationIds: ctx.evidence.fragments.slice(0, 1).map((f) => f.id),
      },
    ]),
};

// ────────────────────────────────────────────────────────────────────────────
// 2. Conditional survey of assets
// ────────────────────────────────────────────────────────────────────────────

export const CONDITIONAL_SURVEY_BLUEPRINT: ComposerBlueprint = {
  title: (ctx) => `Conditional survey — ${ctx.spec.scope.kind === 'property' ? ctx.spec.scope.propertyId : 'portfolio'}`,
  composerSystemNote:
    'Compose an RICS Building Survey Class 3 conditional survey. Sections: condition-overview, defect-register, prior-comparison, capex-prioritisation, recommended-actions.',
  sectionBlueprints: [
    { id: 'condition-overview', title: 'Condition overview', heading: 1, fragmentPrefixes: ['cs-latest-overall'] },
    { id: 'defect-register', title: 'Defect register', heading: 2, fragmentPrefixes: ['cs-defect-'], tableIds: ['cs-defect-table'], chartIds: ['cs-capex-by-element'] },
    { id: 'prior-comparison', title: 'Prior survey comparison', heading: 2, fragmentPrefixes: ['cs-prior-comparison'] },
    { id: 'capex-prioritisation', title: 'Capex prioritisation', heading: 2, fragmentPrefixes: ['cs-defect-'] },
    { id: 'recommended-actions', title: 'Recommended actions', heading: 2, fragmentPrefixes: ['cs-defect-'] },
  ],
  executiveSummary: (ctx) =>
    `Conditional survey snapshot for ${ctx.spec.period.label}. ${ctx.evidence.fragments.length} defects and survey observations consolidated against the prior period. The recommended capex pathway prioritises envelope and mechanical-electrical defects ahead of cosmetic items; the prior-comparison section quantifies the velocity of grade decay.`,
  actionPlan: (ctx) =>
    asActionPlan([
      {
        idSuffix: 'cs-1',
        title: 'Engage RICS-accredited assessor for critical defects',
        description: 'Procure a quote within 14 days from an RICS-accredited assessor to scope the highest-severity defects.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 14),
        priority: 'p0',
        successCriterion: 'Quote signed within 14 days; scope-of-work attached to capex schedule.',
        citationIds: ctx.evidence.fragments.filter((f) => f.id.startsWith('cs-defect-')).slice(0, 2).map((f) => f.id),
      },
      {
        idSuffix: 'cs-2',
        title: 'Refresh the capex schedule',
        description: 'Update the rolling 36-month capex schedule with the prioritised defect bench.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 21),
        priority: 'p1',
        successCriterion: 'Capex schedule signed off by Asset Committee at the next meeting.',
        citationIds: ctx.evidence.fragments.filter((f) => f.id.startsWith('cs-defect-')).slice(0, 2).map((f) => f.id),
      },
      {
        idSuffix: 'cs-3',
        title: 'Issue work-orders for moderate defects',
        description: 'Convert moderate-severity defects into structured work-orders inside the maintenance workflow.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 30),
        priority: 'p1',
        successCriterion: 'All moderate defects have an open work-order with an assigned vendor.',
        citationIds: ctx.evidence.fragments.filter((f) => f.id.startsWith('cs-defect-')).slice(0, 2).map((f) => f.id),
      },
      {
        idSuffix: 'cs-4',
        title: 'Photograph + close minor defects',
        description: 'Operations team closes minor defects in the next maintenance cycle; photo evidence stored for the next survey.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 60),
        priority: 'p2',
        successCriterion: '≥80% of minor defects closed and photographed within 60 days.',
        citationIds: ctx.evidence.fragments.filter((f) => f.id.startsWith('cs-defect-')).slice(0, 1).map((f) => f.id),
      },
      {
        idSuffix: 'cs-5',
        title: 'Schedule the next conditional survey',
        description: 'Book the next conditional survey at the +12-month mark.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 365),
        priority: 'p2',
        successCriterion: 'Next survey booked with vendor; calendar entry confirmed.',
        citationIds: ctx.evidence.fragments.slice(0, 1).map((f) => f.id),
      },
    ]),
};

// ────────────────────────────────────────────────────────────────────────────
// 3. Acquisition deal IC memo
// ────────────────────────────────────────────────────────────────────────────

export const ACQUISITION_IC_BLUEPRINT: ComposerBlueprint = {
  title: (ctx) => `Acquisition IC memo — deal ${ctx.spec.scope.kind === 'deal' ? ctx.spec.scope.dealId : 'unknown'}`,
  composerSystemNote:
    'Compose an Investment Committee acquisition memo. Sections: recommendation, valuation, deal-killers, risk-adjusted-irr, sensitivity-and-stress.',
  sectionBlueprints: [
    { id: 'recommendation', title: 'Recommendation', heading: 1, fragmentPrefixes: ['ic-recommendation'] },
    { id: 'valuation', title: 'Valuation triangulation', heading: 2, fragmentPrefixes: ['ic-ask', 'ic-modelled', 'ic-comp-range'], tableIds: ['ic-valuation-table'] },
    { id: 'deal-killers', title: 'Deal-killer table', heading: 2, fragmentPrefixes: ['ic-dk-'], tableIds: ['ic-dk-table'] },
    { id: 'risk-adjusted-irr', title: 'Risk-adjusted IRR/MOIC', heading: 2, fragmentPrefixes: ['ic-ask', 'ic-modelled'] },
    { id: 'sensitivity-and-stress', title: 'Sensitivity and stress', heading: 2, fragmentPrefixes: ['ic-ask', 'ic-comp-range'] },
  ],
  executiveSummary: (_ctx) =>
    `IC-grade acquisition memo for the deal in scope. Valuation triangulation between ask, model, and comps frames the negotiation; the deal-killer register flags the items the IC must price. Recommendation grounded in the advisor output and the modelled value.`,
  actionPlan: (ctx) =>
    asActionPlan([
      {
        idSuffix: 'ic-1',
        title: 'Lodge LOI consistent with the modelled value',
        description: 'Submit a non-binding LOI at the modelled-value anchor with a 30-day exclusivity period.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 7),
        priority: 'p0',
        successCriterion: 'LOI signed and acknowledged by seller inside 7 days.',
        citationIds: ['ic-modelled', 'ic-recommendation'],
      },
      {
        idSuffix: 'ic-2',
        title: 'Open the Phase I environmental scope',
        description: 'Commission a Phase I ESA with focus on the contaminants flagged in the deal-killer register.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 21),
        priority: 'p1',
        successCriterion: 'Phase I report received within 21 days; no REC unresolved.',
        citationIds: ctx.evidence.fragments.filter((f) => f.id.startsWith('ic-dk-')).slice(0, 2).map((f) => f.id),
      },
      {
        idSuffix: 'ic-3',
        title: 'Source the title commitment',
        description: 'Order an ALTA title commitment; resolve every Schedule B-II item before close.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 21),
        priority: 'p1',
        successCriterion: 'Clean Schedule B-II in 21 days.',
        citationIds: ['ic-modelled'],
      },
      {
        idSuffix: 'ic-4',
        title: 'Run the cap-stack scenarios',
        description: 'Model three cap-stack scenarios (senior-only, senior + mezz, senior + pref).',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 14),
        priority: 'p1',
        successCriterion: 'Three scenarios circulated to IC with delta IRR/MOIC.',
        citationIds: ['ic-ask', 'ic-modelled'],
      },
      {
        idSuffix: 'ic-5',
        title: 'Prepare IC binder',
        description: 'Compile the IC binder including this memo, the modelling pack, and the deal-killer responses.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 28),
        priority: 'p1',
        successCriterion: 'Binder circulated 5 business days before IC meeting.',
        citationIds: ['ic-recommendation'],
      },
    ]),
};

// ────────────────────────────────────────────────────────────────────────────
// 4. Disposition memo + asset profile
// ────────────────────────────────────────────────────────────────────────────

export const DISPOSITION_BLUEPRINT: ComposerBlueprint = {
  title: (ctx) => `Disposition memo — ${ctx.spec.scope.kind === 'property' ? ctx.spec.scope.propertyId : 'portfolio'}`,
  composerSystemNote:
    'Compose a disposition memo + asset profile. Sections: exit-thesis, buyer-pool, pricing-range, sensitivities, marketing-plan.',
  sectionBlueprints: [
    { id: 'exit-thesis', title: 'Exit thesis', heading: 1, fragmentPrefixes: ['d-exit'] },
    { id: 'buyer-pool', title: 'Buyer pool', heading: 2, fragmentPrefixes: ['d-buyer-'], tableIds: ['d-buyer-table'] },
    { id: 'pricing-range', title: 'Pricing range', heading: 2, fragmentPrefixes: ['d-exit'] },
    { id: 'sensitivities', title: 'Sensitivities', heading: 2, fragmentPrefixes: ['d-sens-'], tableIds: ['d-sens-table'] },
    { id: 'marketing-plan', title: 'Marketing plan', heading: 2, fragmentPrefixes: ['d-buyer-'] },
  ],
  executiveSummary: (ctx) =>
    `Disposition memo for ${ctx.spec.period.label}. Exit thesis grounded in the lifecycle-advisor recommendation; the buyer-pool weights frame the marketing plan; sensitivities flag the four factors most likely to move the realised price.`,
  actionPlan: (ctx) =>
    asActionPlan([
      {
        idSuffix: 'd-1',
        title: 'Engage the disposition broker shortlist',
        description: 'Send NDAs and OM briefs to the three top-scoring brokers.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 14),
        priority: 'p0',
        successCriterion: 'NDAs returned signed inside 14 days.',
        citationIds: ['d-exit'],
      },
      {
        idSuffix: 'd-2',
        title: 'Finalise the Offering Memorandum',
        description: 'Produce a 24-page OM with the property profile and the bidder-friendly model.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 30),
        priority: 'p1',
        successCriterion: 'OM circulated to brokers and Tier-1 buyers inside 30 days.',
        citationIds: ['d-exit'],
      },
      {
        idSuffix: 'd-3',
        title: 'Bid-deadline launch',
        description: 'Set a hard bid deadline at +45 days from broker engagement; prepare the bid-grid template.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 45),
        priority: 'p1',
        successCriterion: '≥3 institutional bids received inside the deadline.',
        citationIds: ctx.evidence.fragments.filter((f) => f.id.startsWith('d-buyer-')).slice(0, 2).map((f) => f.id),
      },
      {
        idSuffix: 'd-4',
        title: 'Run sensitivity scenarios for the IC',
        description: 'Pre-bake three pricing scenarios (−5%, central, +5%) so the IC has a fast acceptance path.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 14),
        priority: 'p2',
        successCriterion: 'Sensitivity workbook circulated to IC inside 14 days.',
        citationIds: ctx.evidence.fragments.filter((f) => f.id.startsWith('d-sens-')).slice(0, 2).map((f) => f.id),
      },
      {
        idSuffix: 'd-5',
        title: 'Close path',
        description: 'Negotiate PSA and target signature within 30 days of bid acceptance.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 90),
        priority: 'p1',
        successCriterion: 'PSA executed inside 90 days of bid acceptance.',
        citationIds: ['d-exit'],
      },
    ]),
};

// ────────────────────────────────────────────────────────────────────────────
// 5. Refinancing strategy memo
// ────────────────────────────────────────────────────────────────────────────

export const REFINANCING_BLUEPRINT: ComposerBlueprint = {
  title: (ctx) => `Refinancing memo — ${ctx.spec.scope.kind === 'property' ? ctx.spec.scope.propertyId : 'portfolio'}`,
  composerSystemNote:
    'Compose a refinancing strategy memo. Sections: thesis, trade-space, lender-shortlist, stress-tests, execution-plan.',
  sectionBlueprints: [
    { id: 'thesis', title: 'Refinancing thesis', heading: 1, fragmentPrefixes: ['rf-current', 'rf-proposed'] },
    { id: 'trade-space', title: 'LTV/DSCR/debt-yield trade space', heading: 2, fragmentPrefixes: ['rf-current', 'rf-proposed'] },
    { id: 'lender-shortlist', title: 'Lender shortlist', heading: 2, fragmentPrefixes: ['rf-lender-'], tableIds: ['rf-lender-table'] },
    { id: 'stress-tests', title: 'Stress tests', heading: 2, fragmentPrefixes: ['rf-stress-'], tableIds: ['rf-stress-table'] },
    { id: 'execution-plan', title: 'Execution plan', heading: 2, fragmentPrefixes: ['rf-proposed'] },
  ],
  executiveSummary: (ctx) =>
    `Refinancing memo for ${ctx.spec.period.label}. Frames the trade space between the current loan and the proposed terms; ranks the lender shortlist; surfaces the stress-test results that condition execution.`,
  actionPlan: (ctx) =>
    asActionPlan([
      {
        idSuffix: 'rf-1',
        title: 'Issue term-sheet RFP to the lender shortlist',
        description: 'Send the term-sheet RFP to the top three lenders by fit-score.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 10),
        priority: 'p0',
        successCriterion: 'Three competing term-sheets received inside 21 days.',
        citationIds: ctx.evidence.fragments.filter((f) => f.id.startsWith('rf-lender-')).slice(0, 2).map((f) => f.id),
      },
      {
        idSuffix: 'rf-2',
        title: 'Run the covenant-headroom analysis',
        description: 'Model DSCR and ICR headroom across the term-sheets vs. the current covenant.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 14),
        priority: 'p1',
        successCriterion: 'Headroom ≥20% under every selected term-sheet.',
        citationIds: ['rf-current', 'rf-proposed'],
      },
      {
        idSuffix: 'rf-3',
        title: 'Stress-test against +200bp parallel shock',
        description: 'Stress-test the chosen path against a +200bp parallel rate shock + a covenant-breach scenario.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 14),
        priority: 'p1',
        successCriterion: 'Stress workbook circulated; covenant pass/fail flag explicit.',
        citationIds: ctx.evidence.fragments.filter((f) => f.id.startsWith('rf-stress-')).slice(0, 2).map((f) => f.id),
      },
      {
        idSuffix: 'rf-4',
        title: 'Negotiate the spread',
        description: 'Negotiate the spread against the term-sheets; target a 15bp improvement on indicative pricing.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 30),
        priority: 'p1',
        successCriterion: 'Final spread ≥15bp inside indicative.',
        citationIds: ['rf-proposed'],
      },
      {
        idSuffix: 'rf-5',
        title: 'Execute the chosen path',
        description: 'Sign credit agreement, defease the existing loan, fund the refinance.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 60),
        priority: 'p1',
        successCriterion: 'Refi closes inside 60 days.',
        citationIds: ['rf-proposed'],
      },
    ]),
};

// ────────────────────────────────────────────────────────────────────────────
// 6. Sustainability + GHG report
// ────────────────────────────────────────────────────────────────────────────

export const SUSTAINABILITY_BLUEPRINT: ComposerBlueprint = {
  title: (ctx) => `Sustainability + GHG report — ${ctx.spec.period.label}`,
  composerSystemNote:
    'Compose an IFRS S2 + TCFD-aligned sustainability and GHG report. Sections: overview, ghg-by-scope, crrem-pathway, eu-taxonomy, opportunities.',
  sectionBlueprints: [
    { id: 'overview', title: 'Overview', heading: 1, fragmentPrefixes: ['sus-intensity', 'sus-crrem'] },
    { id: 'ghg-by-scope', title: 'GHG by scope', heading: 2, fragmentPrefixes: ['sus-scope1', 'sus-scope2', 'sus-scope3'], tableIds: ['sus-scope-table'], chartIds: ['sus-scope-chart'] },
    { id: 'crrem-pathway', title: 'CRREM pathway analysis', heading: 2, fragmentPrefixes: ['sus-crrem', 'sus-intensity'] },
    { id: 'eu-taxonomy', title: 'EU Taxonomy alignment', heading: 2, fragmentPrefixes: ['sus-eut'] },
    { id: 'opportunities', title: 'NbS + BNG opportunities', heading: 2, fragmentPrefixes: ['sus-nbs-', 'sus-bng'] },
  ],
  executiveSummary: (ctx) =>
    `Sustainability and GHG report for ${ctx.spec.period.label}. Footprint disclosed Scope 1/2/3 in line with the GHG Protocol; intensity compared to the CRREM pathway; EU Taxonomy 7.7 alignment scored; NbS + BNG opportunities priced.`,
  actionPlan: (ctx) =>
    asActionPlan([
      {
        idSuffix: 'sus-1',
        title: 'Commission a deep-retrofit feasibility',
        description: 'Engage an ESCo to scope a deep-retrofit feasibility focused on the highest-intensity assets.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 60),
        priority: 'p1',
        successCriterion: 'Feasibility report received inside 60 days.',
        citationIds: ['sus-intensity', 'sus-crrem'],
      },
      {
        idSuffix: 'sus-2',
        title: 'Procure Scope 2 PPAs',
        description: 'Issue an RFP for renewables PPAs covering the next 36 months of grid load.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 45),
        priority: 'p1',
        successCriterion: 'PPA shortlist received inside 45 days.',
        citationIds: ['sus-scope2'],
      },
      {
        idSuffix: 'sus-3',
        title: 'Pilot the highest-priority NbS opportunity',
        description: 'Pilot the top NbS opportunity on a single property; measure uplift on BNG net-gain.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 90),
        priority: 'p2',
        successCriterion: 'Pilot measured uplift ≥10% on biodiversity-units score.',
        citationIds: ctx.evidence.fragments.filter((f) => f.id.startsWith('sus-nbs-')).slice(0, 1).map((f) => f.id),
      },
      {
        idSuffix: 'sus-4',
        title: 'Refresh the CRREM gap analysis',
        description: 'Refresh the CRREM pathway calculation with the latest period and circulate the gap analysis.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 30),
        priority: 'p2',
        successCriterion: 'Gap analysis circulated inside 30 days.',
        citationIds: ['sus-crrem'],
      },
      {
        idSuffix: 'sus-5',
        title: 'Disclose the IFRS S2 pack',
        description: 'File the IFRS S2 disclosure pack with the auditor inside the statutory window.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 90),
        priority: 'p1',
        successCriterion: 'IFRS S2 pack accepted by auditor; no qualified opinions.',
        citationIds: ['sus-intensity'],
      },
    ]),
};

// ────────────────────────────────────────────────────────────────────────────
// 7. Expansion strategy memo
// ────────────────────────────────────────────────────────────────────────────

export const EXPANSION_BLUEPRINT: ComposerBlueprint = {
  title: (ctx) => `Expansion strategy — ${ctx.spec.period.label}`,
  composerSystemNote:
    'Compose an expansion strategy memo. Sections: market-thesis, market-ranking, capital-stack, green-angles, execution.',
  sectionBlueprints: [
    { id: 'market-thesis', title: 'Market thesis', heading: 1, fragmentPrefixes: ['ex-mkt-', 'ex-hbu'] },
    { id: 'market-ranking', title: 'Market ranking', heading: 2, fragmentPrefixes: ['ex-mkt-'], tableIds: ['ex-mkt-table'] },
    { id: 'capital-stack', title: 'Capital stack', heading: 2, fragmentPrefixes: ['ex-capital-stack'] },
    { id: 'green-angles', title: 'Green opportunities', heading: 2, fragmentPrefixes: ['ex-grn-'], tableIds: ['ex-grn-table'] },
    { id: 'execution', title: 'Execution plan', heading: 2, fragmentPrefixes: ['ex-mkt-', 'ex-capital-stack'] },
  ],
  executiveSummary: (ctx) =>
    `Expansion strategy for ${ctx.spec.period.label}. Markets ranked by risk-adjusted yield-on-cost; capital stack proposed; green angles surfaced as concurrent capex options.`,
  actionPlan: (ctx) =>
    asActionPlan([
      {
        idSuffix: 'ex-1',
        title: 'Run a focused HBU on the top-ranked market',
        description: 'Apply the Appraisal Institute four-test framework to the top-ranked market.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 30),
        priority: 'p1',
        successCriterion: 'HBU report signed off by the Investment team in 30 days.',
        citationIds: ['ex-hbu'],
      },
      {
        idSuffix: 'ex-2',
        title: 'Identify off-market triggers',
        description: 'Mine the off-market trigger list in the top-2 markets and rank by conversion likelihood.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 30),
        priority: 'p1',
        successCriterion: '≥10 triggers identified per market inside 30 days.',
        citationIds: ctx.evidence.fragments.filter((f) => f.id.startsWith('ex-mkt-')).slice(0, 2).map((f) => f.id),
      },
      {
        idSuffix: 'ex-3',
        title: 'Pre-commit the capital stack',
        description: 'Engage debt + pref-equity providers with indicative terms aligned to the recommended stack.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 45),
        priority: 'p1',
        successCriterion: 'Indicative terms in hand from ≥2 providers per layer.',
        citationIds: ['ex-capital-stack'],
      },
      {
        idSuffix: 'ex-4',
        title: 'Cost the top green angle',
        description: 'Engage a feasibility consultant on the top green angle for the chosen markets.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 60),
        priority: 'p2',
        successCriterion: 'Feasibility report received and integrated into the expansion model.',
        citationIds: ctx.evidence.fragments.filter((f) => f.id.startsWith('ex-grn-')).slice(0, 1).map((f) => f.id),
      },
      {
        idSuffix: 'ex-5',
        title: 'Prepare the expansion IC binder',
        description: 'Compile the expansion IC binder with the memo + the deal sheet.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 75),
        priority: 'p2',
        successCriterion: 'IC binder circulated 5 business days before IC meeting.',
        citationIds: ['ex-hbu'],
      },
    ]),
};

// ────────────────────────────────────────────────────────────────────────────
// 8. Tenant credit + risk profile
// ────────────────────────────────────────────────────────────────────────────

export const TENANT_CREDIT_BLUEPRINT: ComposerBlueprint = {
  title: (ctx) => `Tenant credit profile — ${ctx.spec.scope.kind === 'tenant' ? ctx.spec.scope.tenantPersonId : 'unknown'}`,
  composerSystemNote:
    'Compose a tenant credit + risk profile. Sections: stage, payment-history, complaints, credit-signals, recommended-stance.',
  sectionBlueprints: [
    { id: 'stage', title: 'Lifecycle stage', heading: 1, fragmentPrefixes: ['tc-stage'] },
    { id: 'payment-history', title: 'Payment history', heading: 2, fragmentPrefixes: ['tc-pay-'], tableIds: ['tc-pay-table'] },
    { id: 'complaints', title: 'Complaints record', heading: 2, fragmentPrefixes: ['tc-cmp-'] },
    { id: 'credit-signals', title: 'Credit signals', heading: 2, fragmentPrefixes: ['tc-sig-'], tableIds: ['tc-sig-table'] },
    { id: 'recommended-stance', title: 'Recommended stance', heading: 2, fragmentPrefixes: ['tc-stage', 'tc-pay-', 'tc-sig-'] },
  ],
  executiveSummary: (ctx) =>
    `Tenant credit profile for ${ctx.spec.period.label}. Payment cadence and complaint record triangulated with the credit-signal weights; recommended stance grounded in the lifecycle stage and the weighted signal score.`,
  actionPlan: (ctx) =>
    asActionPlan([
      {
        idSuffix: 'tc-1',
        title: 'Recalibrate the tenant risk band',
        description: 'Apply the weighted credit-signal score to the tenant\'s risk band; update the CRM.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 7),
        priority: 'p1',
        successCriterion: 'Risk band updated and visible in the tenant CRM inside 7 days.',
        citationIds: ['tc-stage'],
      },
      {
        idSuffix: 'tc-2',
        title: 'Schedule a relationship call',
        description: 'Relationship lead calls the tenant within 14 days; document the call in the CRM.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 14),
        priority: 'p2',
        successCriterion: 'Call logged with summary inside 14 days.',
        citationIds: ['tc-stage'],
      },
      {
        idSuffix: 'tc-3',
        title: 'Close open complaints',
        description: 'Close any open complaint older than 7 days.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 14),
        priority: 'p1',
        successCriterion: 'No open complaints older than 14 days.',
        citationIds: ctx.evidence.fragments.filter((f) => f.id.startsWith('tc-cmp-')).slice(0, 1).map((f) => f.id),
      },
      {
        idSuffix: 'tc-4',
        title: 'Activate proactive arrears nudges',
        description: 'If the tenant has any arrears bucket activity, enable the proactive nudge sequence.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 7),
        priority: 'p1',
        successCriterion: 'Nudge sequence enabled inside 7 days.',
        citationIds: ctx.evidence.fragments.filter((f) => f.id.startsWith('tc-pay-')).slice(0, 1).map((f) => f.id),
      },
      {
        idSuffix: 'tc-5',
        title: 'Plan the renewal conversation',
        description: 'Brief the lease-renewal team on the credit profile before the renewal window opens.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 30),
        priority: 'p2',
        successCriterion: 'Brief delivered to renewal team inside 30 days.',
        citationIds: ['tc-stage'],
      },
    ]),
};

// ────────────────────────────────────────────────────────────────────────────
// 9. Rent-roll + arrears ledger
// ────────────────────────────────────────────────────────────────────────────

export const RENT_ROLL_BLUEPRINT: ComposerBlueprint = {
  title: (ctx) => `Rent-roll + arrears ledger — ${ctx.spec.period.label}`,
  composerSystemNote:
    'Compose a rent-roll and arrears ledger report. Sections: rent-roll-overview, ageing-waterfall, top-drivers, recovery-plan, gl-reconciliation.',
  sectionBlueprints: [
    { id: 'rent-roll-overview', title: 'Rent-roll overview', heading: 1, fragmentPrefixes: ['rr-'], tableIds: ['rr-table'] },
    { id: 'ageing-waterfall', title: 'Ageing-bucket waterfall', heading: 2, fragmentPrefixes: ['rr-'], tableIds: ['rr-ageing-table'], chartIds: ['rr-ageing-chart'] },
    { id: 'top-drivers', title: 'Top arrears drivers', heading: 2, fragmentPrefixes: ['rr-'], tableIds: ['rr-top-drivers'] },
    { id: 'recovery-plan', title: 'Recovery plan', heading: 2, fragmentPrefixes: ['rr-'] },
    { id: 'gl-reconciliation', title: 'GL reconciliation', heading: 2, fragmentPrefixes: ['rr-'] },
  ],
  executiveSummary: (ctx) =>
    `Rent-roll + arrears ledger as of ${ctx.spec.period.label}. ${ctx.evidence.fragments.filter((f) => f.id.startsWith('rr-')).length} units reconciled. Ageing-bucket waterfall surfaces the recovery priority; the top-drivers list is the action-grid for the next 30 days.`,
  actionPlan: (ctx) =>
    asActionPlan([
      {
        idSuffix: 'rr-1',
        title: 'Send formal arrears notices for the 91+ bucket',
        description: 'Issue formal arrears notices for every unit in the 91+ days bucket.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 7),
        priority: 'p0',
        successCriterion: 'All notices sent inside 7 days; receipt confirmed.',
        citationIds: ctx.evidence.fragments.slice(0, 2).map((f) => f.id),
      },
      {
        idSuffix: 'rr-2',
        title: 'Open payment-plan negotiations for the 61-90 bucket',
        description: 'Offer a structured payment plan to every tenant in the 61-90 bucket.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 14),
        priority: 'p1',
        successCriterion: '≥50% of bucket on a signed payment plan inside 14 days.',
        citationIds: ctx.evidence.fragments.slice(0, 2).map((f) => f.id),
      },
      {
        idSuffix: 'rr-3',
        title: 'Reconcile to the GL',
        description: 'Reconcile the rent-roll arrears total to the GL receivables sub-ledger.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 7),
        priority: 'p0',
        successCriterion: 'Zero unexplained variance > 1%.',
        citationIds: ctx.evidence.fragments.slice(0, 1).map((f) => f.id),
      },
      {
        idSuffix: 'rr-4',
        title: 'Refresh the SMS + WhatsApp nudge cadence',
        description: 'Refresh the nudge cadence with this period\'s top-driver list.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 7),
        priority: 'p1',
        successCriterion: 'Nudge cadence live inside 7 days; conversion measured at +14 days.',
        citationIds: ctx.evidence.fragments.slice(0, 1).map((f) => f.id),
      },
      {
        idSuffix: 'rr-5',
        title: 'Escalate the top-decile cases',
        description: 'Escalate the top-decile arrears cases to the asset-manager review.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 14),
        priority: 'p1',
        successCriterion: 'Asset-manager decision recorded inside 14 days per case.',
        citationIds: ctx.evidence.fragments.slice(0, 1).map((f) => f.id),
      },
    ]),
};

// ────────────────────────────────────────────────────────────────────────────
// 10. Annual estate operating review (AOR)
// ────────────────────────────────────────────────────────────────────────────

export const AOR_BLUEPRINT: ComposerBlueprint = {
  title: (ctx) => `Annual Estate Operating Review — ${ctx.spec.period.label}`,
  composerSystemNote:
    'Compose the Annual Estate Operating Review for the Board. Sections: operating-verdict, leasing, sustainability, capex, capital-structure, expansion-pipeline.',
  sectionBlueprints: [
    { id: 'operating-verdict', title: 'Operating verdict', heading: 1, fragmentPrefixes: ['lf-lf-', 'sus-sus-', 'rr-rr-'] },
    { id: 'leasing', title: 'Leasing performance', heading: 2, fragmentPrefixes: ['lf-lf-rev-', 'lf-lf-occ-'] },
    { id: 'sustainability', title: 'Sustainability and GHG', heading: 2, fragmentPrefixes: ['sus-sus-'] },
    { id: 'capex', title: 'Capex and conditional surveys', heading: 2, fragmentPrefixes: ['cs-cs-'] },
    { id: 'capital-structure', title: 'Capital structure and arrears', heading: 2, fragmentPrefixes: ['rr-rr-'] },
    { id: 'expansion-pipeline', title: 'Expansion pipeline', heading: 2, fragmentPrefixes: ['ex-ex-'] },
  ],
  executiveSummary: (ctx) =>
    `Annual Estate Operating Review for ${ctx.spec.period.label}. The Board verdict integrates leasing, sustainability, capex, capital structure, and the expansion pipeline into a single defensible operating outcome for the fiscal year.`,
  actionPlan: (ctx) =>
    asActionPlan([
      {
        idSuffix: 'aor-1',
        title: 'Lock the FY business plan',
        description: 'Update the FY business plan with this report\'s findings and the action plans of the sub-reports.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 30),
        priority: 'p0',
        successCriterion: 'Updated business plan signed by the Board inside 30 days.',
        citationIds: ctx.evidence.fragments.slice(0, 2).map((f) => f.id),
      },
      {
        idSuffix: 'aor-2',
        title: 'Approve the capex pathway',
        description: 'Approve the prioritised capex pathway from the conditional-survey sub-report.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 30),
        priority: 'p1',
        successCriterion: 'Capex pathway approved by the Asset Committee inside 30 days.',
        citationIds: ctx.evidence.fragments.filter((f) => f.id.startsWith('cs-cs-')).slice(0, 2).map((f) => f.id),
      },
      {
        idSuffix: 'aor-3',
        title: 'Greenlight the expansion pipeline',
        description: 'Greenlight the expansion pipeline and authorise the capital stack engagement.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 45),
        priority: 'p1',
        successCriterion: 'Expansion pipeline budget approved inside 45 days.',
        citationIds: ctx.evidence.fragments.filter((f) => f.id.startsWith('ex-ex-')).slice(0, 2).map((f) => f.id),
      },
      {
        idSuffix: 'aor-4',
        title: 'Disclose the IFRS S2 pack',
        description: 'Lodge the IFRS S2 sustainability disclosure pack with the auditor.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 90),
        priority: 'p1',
        successCriterion: 'IFRS S2 pack accepted without qualification.',
        citationIds: ctx.evidence.fragments.filter((f) => f.id.startsWith('sus-sus-')).slice(0, 2).map((f) => f.id),
      },
      {
        idSuffix: 'aor-5',
        title: 'Approve the arrears recovery plan',
        description: 'Approve the structured arrears-recovery plan; track weekly to the Board.',
        owner: actorOwner(ctx),
        dueDateIso: isoDateAdd(ctx.spec.period.periodEnd, 14),
        priority: 'p0',
        successCriterion: 'Recovery plan approved inside 14 days; weekly trend report to Board.',
        citationIds: ctx.evidence.fragments.filter((f) => f.id.startsWith('rr-rr-')).slice(0, 2).map((f) => f.id),
      },
    ]),
};
